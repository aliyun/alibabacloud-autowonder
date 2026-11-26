package com.aliyun.autowonder.prd;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;
import org.springframework.web.socket.server.support.WebSocketHttpRequestHandler;
import org.springframework.web.filter.OncePerRequestFilter;
import javax.servlet.*;
import javax.servlet.http.*;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.FutureTask;
import java.util.concurrent.RejectedExecutionException;
import java.util.regex.Pattern;

/** Browser authorization stays at the platform boundary; no platform credentials reach Vite. */
@Configuration
public class PrdReviewPreviewGateway {
    static final String COOKIE="aw_design_preview";
    private static final Set<String> METHODS = Set.of("GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS");
    private static final Set<String> ASSET_DESTINATIONS = Set.of("script","style","image","font","worker","sharedworker");
    private static final Set<String> DROP=Set.of("authorization","cookie","host","connection","content-length","proxy-authorization","proxy-authenticate","upgrade","te","trailer","transfer-encoding","keep-alive","origin","referer","forwarded","sec-websocket-key","sec-websocket-version","sec-websocket-extensions","sec-websocket-protocol");
    private static final Pattern SOURCE_MODULE=Pattern.compile("(?:[A-Za-z0-9_.+-]+/)*[A-Za-z0-9_.+-]+\\.(?:[cm]?js|[jt]sx?|vue|svelte|css|json)");
    private static final Pattern VITE_MODULE_QUERY=Pattern.compile("(?:import(?:&t=[0-9]{13})?|t=[0-9]{13}(?:&import)?)");
    private static final Pattern HTML_HEAD=Pattern.compile("(?i)<head(?:\\s+[^<>]*)?>");
    private static final Set<String> SOURCE_REVALIDATION_DIRECTIVES=Set.of("no-cache","private","must-revalidate","max-age=0");
    private final PrdReviewPreviewProperties properties;
    private final PrdReviewPreviewService previews;
    private final PrdReviewPreviewDao dao;
    private final PrdPreviewRelay relay;
    private PrdPreviewCluster cluster;
    private PrdPreviewPeer peer;

    @org.springframework.beans.factory.annotation.Autowired
    void configureCluster(PrdPreviewCluster cluster, PrdPreviewPeer peer) {
        this.cluster = cluster;
        this.peer = peer;
    }
    private final Map<WebSocketSession,SocketLink> sockets=new ConcurrentHashMap<>();
    private record AssetAuthorization(String bindingId,String session) {}
    private record AssetAccess(PrdReviewPreviewProperties.Binding binding,PrdPreviewCluster.Owner owner) {}
    private final Map<AssetAuthorization,CompletableFuture<AssetAccess>> authorizingAssets=new ConcurrentHashMap<>();
    // Waiting for executor capacity must not consume the servlet threads needed
    // to accept the executor's data WebSocket handshakes and ordinary API calls.
    private final ThreadPoolExecutor assetTransfers=new ThreadPoolExecutor(96,96,30,TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(256),task->{
                var thread=new Thread(task,"prd-preview-transfer"); thread.setDaemon(true); return thread;
            },new ThreadPoolExecutor.AbortPolicy());
    public PrdReviewPreviewGateway(PrdReviewPreviewProperties properties,PrdReviewPreviewService previews,
            PrdReviewPreviewDao dao,PrdPreviewRelay relay) {
        this.properties=properties; this.previews=previews; this.dao=dao; this.relay=relay;
        assetTransfers.allowCoreThreadTimeOut(true);
    }
    @Bean public FilterRegistrationBean<OncePerRequestFilter> designPreviewGatewayFilter() {
        var bean=new FilterRegistrationBean<OncePerRequestFilter>();
        bean.setFilter(new OncePerRequestFilter() {
            @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
                String path=request.getRequestURI();
                if(!path.equals("/design-preview") && !path.startsWith("/design-preview/")) { chain.doFilter(request,response); return; }
                response.setHeader("Cache-Control","no-store"); response.setHeader("Referrer-Policy","no-referrer");
                response.setHeader("X-Content-Type-Options","nosniff");
                try {
                    String bindingId=PrdReviewPreviewProperties.bindingIdFromPath(path);
                    if (bindingId==null) { response.setStatus(404); return; }
                    boolean upgrade="websocket".equalsIgnoreCase(request.getHeader("Upgrade"));
                    String requestedBase="/design-preview/"+bindingId+"/";
                    String relative=path.substring(requestedBase.length());
                    boolean asset=!upgrade && isAssetRequest(request,relative);
                    String token=cookie(request);
                    long authorizationStarted=System.nanoTime();
                    if (asset) validatePath(path,requestedBase);
                    var access=asset ? authorizeAsset(bindingId,token) : null;
                    var binding=asset ? access.binding() : properties.byId(bindingId);
                    if(binding==null) { response.setStatus(404); return; }
                    binding.validate(properties.getPlatformOrigin());
                    if (!asset) validatePath(path,binding);
                    if((binding.basePath()+"_autowonder/health").equals(URI.create(path).getPath())) { response.setStatus(404); return; }
                    if((binding.basePath()+"_autowonder/enter").equals(path)) { enter(request,response,binding); return; }
                    if((binding.basePath()+"_autowonder/renew").equals(path)) { renew(request,response,binding); return; }
                    if (!asset) previews.authorize(token,binding.getId(),"SESSION");
                    if (asset) timing(response,"aw-preview-auth",authorizationStarted);
                    if (upgrade && !validUpgrade(request)) { response.setStatus(403); return; }
                    if (!upgrade && !METHODS.contains(request.getMethod())) { response.setStatus(405); return; }
                    if (!upgrade && request.getContentLengthLong() > 32L * 1024 * 1024) { response.setStatus(413); return; }
                    PrdPreviewCluster.Owner owner = null;
                    if (cluster != null && cluster.enabled()) {
                        owner = asset ? access.owner() : cluster.owner(binding.getId());
                        String handoff = request.getHeader(PrdPreviewCluster.HANDOFF);
                        if (owner == null || !owner.ready()) {
                            unavailable(response, owner == null ? "DISCONNECTED" : "LOCAL_SERVICE_UNAVAILABLE");
                            return;
                        }
                        if (!cluster.local(owner) && handoff == null) {
                            if (asset) response.addHeader("Server-Timing","aw-preview-peer");
                            var target=owner;
                            transfer(request,response,asset || isPreviewDocument(request,binding),
                                    ()->peer.browser(cluster.peer(target), target, request, response, token));
                            return;
                        }
                        if (!cluster.local(owner) || handoff != null && !handoff.equals(owner.generation())
                                || !relay.localAvailable(binding, owner)) {
                            unavailable(response, "DISCONNECTED");
                            return;
                        }
                    } else if (!relay.available(binding)) {
                        unavailable(response, relay.status(binding));
                        return;
                    }
                    if (upgrade) socket(request, response, binding, token, owner);
                    else {
                        var target=owner;
                        transfer(request,response,asset || isPreviewDocument(request,binding),
                                ()->proxy(request,response,binding,target));
                    }
                } catch(com.aliyun.autowonder.common.error.BizException unavailable) { response.setStatus(403); }
                catch(PrdPreviewRelay.CapacityException busy) { response.setHeader("X-Autowonder-Preview-Error","CAPACITY"); response.setStatus(503); }
                catch(IllegalArgumentException invalid) { response.setStatus(400); }
                catch(Exception unavailable) { if(!response.isCommitted()) response.setStatus(502); else throw new IOException("Preview transport interrupted",unavailable); }
            }
        });
        // Unique servlet names also give OncePerRequestFilter independent invocation markers.
        // Only the preview prefix is handled here; other paths retain the normal login filter chain.
        bean.setName("designPreviewGateway"); bean.setAsyncSupported(true); bean.setOrder(-201); bean.addUrlPatterns("/*"); return bean;
    }

    @FunctionalInterface private interface Transfer { void run() throws Exception; }
    private void transfer(HttpServletRequest request,HttpServletResponse response,boolean asset,Transfer transfer) throws Exception {
        if (!asset || !request.isAsyncSupported()) { transfer.run(); return; }
        var context=request.startAsync(request,response);
        context.setTimeout(60_000);
        long queued=System.nanoTime();
        var task=new FutureTask<Void>(()->{
            try {
                timing(response,"aw-preview-transfer-queue",queued);
                transfer.run();
            } catch (PrdPreviewRelay.CapacityException busy) {
                if (!response.isCommitted()) { response.setHeader("X-Autowonder-Preview-Error","CAPACITY"); response.setStatus(503); }
            } catch (Exception failed) {
                if (!response.isCommitted()) response.setStatus(502);
            } finally {
                try { context.complete(); } catch (IllegalStateException completed) { /* Timeout already completed it. */ }
            }
            return null;
        });
        context.addListener(new AsyncListener() {
            public void onComplete(AsyncEvent event) {}
            public void onStartAsync(AsyncEvent event) {}
            public void onError(AsyncEvent event) { task.cancel(true); assetTransfers.remove(task); }
            public void onTimeout(AsyncEvent event) {
                task.cancel(true); assetTransfers.remove(task);
                if (!response.isCommitted()) response.setStatus(504);
                try { context.complete(); } catch (IllegalStateException completed) { /* Concurrent completion. */ }
            }
        });
        try { assetTransfers.execute(task); }
        catch (RejectedExecutionException busy) {
            response.setHeader("X-Autowonder-Preview-Error","CAPACITY"); response.setStatus(503); context.complete();
        }
    }

    private AssetAccess authorizeAsset(String bindingId,String token) {
        var key=new AssetAuthorization(bindingId,token);
        var lookup=new CompletableFuture<AssetAccess>();
        var pending=authorizingAssets.putIfAbsent(key,lookup);
        if (pending!=null) {
            try { return pending.join(); }
            catch (CompletionException failed) {
                if (failed.getCause() instanceof RuntimeException cause) throw cause;
                if (failed.getCause() instanceof Error cause) throw cause;
                throw failed;
            }
        }
        // Coalesce only overlapping checks. Each later request rechecks the session and revocation.
        try {
            var binding=properties.byId(bindingId);
            if (binding!=null) previews.authorize(token,bindingId,"SESSION");
            var owner=binding!=null && cluster!=null && cluster.enabled() ? cluster.owner(bindingId) : null;
            var access=new AssetAccess(binding,owner);
            authorizingAssets.remove(key,lookup);
            lookup.complete(access);
            return access;
        } catch (RuntimeException | Error failed) {
            authorizingAssets.remove(key,lookup);
            lookup.completeExceptionally(failed);
            throw failed;
        }
    }

    private static void timing(HttpServletResponse response,String metric,long started) {
        response.addHeader("Server-Timing",metric+";dur="+TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started));
    }
    private static void unavailable(HttpServletResponse response, String reason) {
        response.setHeader("X-Autowonder-Preview-Error", reason);
        response.setStatus(503);
    }
    static void validatePath(String path,PrdReviewPreviewProperties.Binding binding) {
        validatePath(path,binding.basePath());
    }
    private static void validatePath(String path,String base) {
        if(!path.startsWith(base) || path.contains("\\") || path.matches("(?i).*(%2e|%2f|%5c|%25).*")) throw new IllegalArgumentException("Invalid preview path");
        String decoded=URI.create(path).getPath();
        if(Arrays.stream(decoded.split("/",-1)).anyMatch(part->part.equals(".") || part.equals(".."))
                || decoded.chars().anyMatch(Character::isISOControl)) throw new IllegalArgumentException("Invalid preview path");
    }
    private void enter(HttpServletRequest request,HttpServletResponse response,PrdReviewPreviewProperties.Binding binding) throws IOException {
        if(!"POST".equals(request.getMethod()) || !properties.getPlatformOrigin().equals(request.getHeader("Origin"))) { response.setStatus(403); return; }
        String route=PrdReviewService.route(Objects.toString(request.getParameter("route"),"/"));
        String location=binding.basePath()+route.substring(1); validatePath(URI.create(location).getRawPath(),binding);
        String token=previews.exchange(request.getParameter("code"),binding.getId());
        setCookie(response,binding.basePath(),properties.getPlatformOrigin(),token);
        response.setStatus(303); response.setHeader("Location",location);
    }
    private void renew(HttpServletRequest request,HttpServletResponse response,PrdReviewPreviewProperties.Binding binding) {
        if(!"POST".equals(request.getMethod()) || !properties.getPlatformOrigin().equals(request.getHeader("Origin"))) { response.setStatus(403); return; }
        setCookie(response,binding.basePath(),properties.getPlatformOrigin(),previews.renew(request.getParameter("code"),cookie(request),binding.getId()));
        response.setStatus(204);
    }
    static void setCookie(HttpServletResponse response,String basePath,String origin,String token) {
        boolean secure=origin.startsWith("https:");
        response.addHeader("Set-Cookie",COOKIE+"="+token+"; Path="+basePath+"; HttpOnly; SameSite=Strict; Max-Age=900"+(secure?"; Secure":""));
    }
    private static boolean dropped(String name) { return DROP.contains(name) || name.startsWith("x-forwarded-") || name.startsWith("x-autowonder-"); }
    private Map<String,Object> head(HttpServletRequest request,PrdReviewPreviewProperties.Binding binding,String kind) {
        var headers=new ArrayList<List<String>>();
        var dynamic=new HashSet<String>();
        String connection=request.getHeader("Connection");
        if(connection!=null) for(String name:connection.split(",")) dynamic.add(name.trim().toLowerCase(Locale.ROOT));
        for(var names=request.getHeaderNames();names.hasMoreElements();) {
            String name=names.nextElement(),lower=name.toLowerCase(Locale.ROOT);
            if(!dropped(lower) && !dynamic.contains(lower)) for(var values=request.getHeaders(name);values.hasMoreElements();) headers.add(List.of(name,values.nextElement()));
        }
        // Vite supplies business backend authorization through the project's own proxy configuration.
        headers.add(List.of("Accept-Encoding","identity"));
        String path=request.getRequestURI()+(request.getQueryString()==null?"":"?"+request.getQueryString());
        return Map.of("type","request","kind",kind,"method",request.getMethod(),"path",path,"headers",headers);
    }
    private void proxy(HttpServletRequest request, HttpServletResponse response, PrdReviewPreviewProperties.Binding binding,
                       PrdPreviewCluster.Owner owner) throws IOException {
        String method=request.getMethod();
        var requestHead=head(request,binding,"http");
        boolean asset=isAssetRequest(request,request.getRequestURI().substring(binding.basePath().length()));
        boolean document=!asset && isPreviewDocument(request,binding);
        boolean versioned=asset && isVersionedViteDependency(request,binding);
        String module=asset && "script".equals(request.getHeader("Sec-Fetch-Dest")) ? sourceModule(request,binding) : null;
        if (document) {
            requestHead=new HashMap<>(requestHead);
            requestHead.put("document",true);
        }
        if (asset || document) {
            if (proxyAssetRequest(response,binding,owner,requestHead,versioned,document,module)) return;
            // The fast path is optional. Retry the same authorized, bodyless GET
            // through the regular transport before any response body is committed.
            response.addHeader("Server-Timing","aw-preview-asset-fallback");
        }
        try(var stream=relay.open(binding,"http",owner)) {
            if (asset) {
                requestHead=new HashMap<>(requestHead);
                requestHead.put("responseWindow",PrdPreviewRelay.ASSET_RESPONSE_WINDOW);
            }
            stream.head(requestHead);
            byte[] buffer=new byte[PrdPreviewRelay.CHUNK]; int size; long total=0;
            while(!stream.responseRejectsUpload() && (size=request.getInputStream().read(buffer))!=-1) {
                if(stream.responseRejectsUpload()) break;
                total+=size; if(total>32L*1024*1024) { response.setStatus(413); return; }
                stream.bytes(buffer,size);
            }
            if(stream.responseRejectsUpload() && total<request.getContentLengthLong()) response.setHeader("Connection","close");
            stream.send(Map.of("type","end"));
            writeResponse(response,binding,stream,"HEAD".equals(method),true,versioned,module);
        }
    }
    private boolean proxyAssetRequest(HttpServletResponse response,PrdReviewPreviewProperties.Binding binding,
                                      PrdPreviewCluster.Owner owner,Map<String,Object> request,
                                      boolean versioned,boolean document,String module) throws IOException {
        long admissionStarted=System.nanoTime();
        try (var stream=relay.asset(binding,owner,request)) {
            if (stream==null) return false;
            timing(response,"aw-preview-admission",admissionStarted);
            long responseStarted=System.nanoTime();
            JsonNode result;
            try { result=stream.assetResponse(); }
            catch (IOException unavailable) { return false; }
            timing(response,"aw-preview-upstream",responseStarted);
            if (proxyAsset(response,binding,stream,result,versioned,document,module)) return true;
            if (!stream.assetData) return false;
            try { stream.awaitConnected(); }
            catch (IOException unavailable) { return false; }
            response.addHeader("Server-Timing","aw-preview-asset-stream");
            // Once streaming begins, failures propagate; never replay a partial response.
            writeResponse(response,binding,stream,false,false,versioned,module);
            return true;
        }
    }
    private static void writeResponse(HttpServletResponse response,PrdReviewPreviewProperties.Binding binding,
                                      PrdPreviewRelay.Stream stream,boolean headOnly,boolean acknowledge,boolean versioned,
                                      String module) throws IOException {
        Object first=stream.next();
        if (!(first instanceof JsonNode status) || !"response".equals(status.path("type").asText())
                || status.path("status").asInt()<200 || status.path("status").asInt()>599) throw new IOException("Invalid preview response");
        writeResponseHead(response,binding,status,versioned,module!=null,false);
        while (true) {
            Object item=stream.next();
            if (item instanceof byte[] bytes) {
                if (!headOnly) {
                    response.getOutputStream().write(bytes);
                    if (acknowledge) response.flushBuffer();
                }
                if (acknowledge) stream.acknowledge();
            } else if (item instanceof JsonNode frame && "end".equals(frame.path("type").asText())) {
                recordModule(stream,module,status);
                return;
            }
            else throw new IOException("Invalid preview response frame");
        }
    }
    private static boolean isAssetRequest(HttpServletRequest request,String path) {
        if (!isBodylessGet(request)
                || !ASSET_DESTINATIONS.contains(Objects.toString(request.getHeader("Sec-Fetch-Dest"),""))) return false;
        if (path.equals("api") || path.startsWith("api/")) return false;
        return path.startsWith("@vite/") || path.startsWith("@id/") || path.equals("@react-refresh")
                || path.matches("(?i).+\\.(?:[cm]?js|[jt]sx?|json|css|vue|svelte|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|otf)");
    }
    private static boolean isPreviewDocument(HttpServletRequest request,PrdReviewPreviewProperties.Binding binding) {
        String type=request.getHeader("Sec-Fetch-Dest");
        if (!("document".equals(type) || "iframe".equals(type)) || !isBodylessGet(request)) return false;
        String path=request.getRequestURI().substring(binding.basePath().length());
        return !path.equals("api") && !path.startsWith("api/") && !path.startsWith("_autowonder/");
    }
    private static boolean isBodylessGet(HttpServletRequest request) {
        return "GET".equals(request.getMethod()) && request.getContentLengthLong()<=0
                && request.getHeader("Transfer-Encoding")==null && request.getHeader("Range")==null;
    }
    private static boolean isVersionedViteDependency(HttpServletRequest request,PrdReviewPreviewProperties.Binding binding) {
        String path=request.getRequestURI().substring(binding.basePath().length());
        return path.matches("(?:@fs/.*/)?node_modules/\\.vite/deps/[^/]+\\.[cm]?js")
                && Objects.toString(request.getQueryString(),"").matches("v=[0-9a-f]{8}");
    }
    private static String sourceModule(HttpServletRequest request, PrdReviewPreviewProperties.Binding binding) {
        String uri=request.getRequestURI(),path=uri.substring(binding.basePath().length()),query=request.getQueryString();
        if (path.length()>200 || path.contains("node_modules/") || !SOURCE_MODULE.matcher(path).matches()) return null;
        if (query==null) return uri;
        return VITE_MODULE_QUERY.matcher(query).matches() ? uri+"?"+query : null;
    }
    private static String headerValue(JsonNode result, String name) {
        for (var header:result.path("headers")) {
            if (name.equalsIgnoreCase(header.path(0).asText())) return header.path(1).asText();
        }
        return "";
    }
    private static boolean javascript(String contentType) {
        return contentType.split(";",2)[0].trim().matches("(?i)(?:text|application)/(?:javascript|x-javascript|ecmascript)");
    }
    private static void recordModule(PrdPreviewRelay.Stream stream, String module, JsonNode result) {
        if (module==null || result.path("status").asInt()==304) return;
        stream.recordModule(module,result.path("status").asInt()==200 && javascript(headerValue(result,"Content-Type")));
    }
    private static byte[] preloadModules(byte[] body, JsonNode result, PrdReviewPreviewProperties.Binding binding,
                                         PrdPreviewRelay.Stream stream) {
        if (!headerValue(result,"Content-Type").matches("(?i)text/html(?:\\s*;\\s*charset=utf-8)?")
                || !headerValue(result,"Content-Encoding").isEmpty()) return body;
        String html=new String(body,StandardCharsets.UTF_8);
        if (!html.contains(binding.basePath()+"@vite/client") || !Arrays.equals(body,html.getBytes(StandardCharsets.UTF_8))) return body;
        var head=HTML_HEAD.matcher(html);
        if (!head.find()) return body;
        var modules=stream.claimModulePreloads();
        if (modules.isEmpty()) return body;
        var links=new StringBuilder();
        for (String path:modules) links.append("<link rel=\"modulepreload\" href=\"").append(path).append("\">\n");
        return new StringBuilder(html).insert(head.end(),links).toString().getBytes(StandardCharsets.UTF_8);
    }
    private static boolean proxyAsset(HttpServletResponse response,PrdReviewPreviewProperties.Binding binding,
                                      PrdPreviewRelay.Stream stream,JsonNode result,boolean versioned,boolean document,
                                      String module) throws IOException {
        if (result==null || !result.path("body").isTextual() || !result.path("headers").isArray()) return false;
        int status=result.path("status").asInt();
        if (status!=200 && status!=304) return false;
        String encoded=result.path("body").textValue();
        if (encoded.length()>(PrdPreviewRelay.CHUNK+2)/3*4) return false;
        byte[] body;
        try { body=Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException invalid) { return false; }
        if (body.length>PrdPreviewRelay.CHUNK || status==304 && body.length!=0) return false;
        byte[] content=document && status==200 ? preloadModules(body,result,binding,stream) : body;
        writeResponseHead(response,binding,result,versioned,module!=null,content!=body);
        response.addHeader("Server-Timing","aw-preview-asset");
        if (content!=body) response.addHeader("Server-Timing","aw-preview-module-preload");
        recordModule(stream,module,result);
        if (status==200) {
            response.setContentLength(content.length);
            response.getOutputStream().write(content);
        }
        return true;
    }
    private static void writeResponseHead(HttpServletResponse response,PrdReviewPreviewProperties.Binding binding,JsonNode status,
                                          boolean versioned,boolean sourceModule,boolean rewrittenHtml) {
        response.setStatus(status.path("status").asInt());
        boolean immutable=false, fresh=false, nonCacheable=false, javascript=false;
        boolean hasCacheControl=false, revalidate=false, eligibleSourcePolicy=true, hasEtag=false;
        sourceModule=sourceModule && !rewrittenHtml;
        var dynamic=new HashSet<String>();
        for(var header:status.path("headers")) if("connection".equalsIgnoreCase(header.path(0).asText()))
            for(String name:header.path(1).asText().split(",")) dynamic.add(name.trim().toLowerCase(Locale.ROOT));
        for(var header:status.path("headers")) {
            String name=header.path(0).asText(),value=header.path(1).asText(),lower=name.toLowerCase(Locale.ROOT);
            if ((versioned || sourceModule) && "cache-control".equals(lower)) {
                hasCacheControl=true;
                for (String part:value.split(",")) {
                    String directive=part.trim().toLowerCase(Locale.ROOT);
                    immutable|="immutable".equals(directive);
                    fresh|=directive.matches("max-age=(?:[6-9][0-9]|[1-9][0-9]{2,})");
                    nonCacheable|=Set.of("no-store","no-cache","private").contains(directive);
                    revalidate|="no-cache".equals(directive);
                    eligibleSourcePolicy&=SOURCE_REVALIDATION_DIRECTIVES.contains(directive);
                }
            }
            if ("set-cookie".equals(lower)) {
                nonCacheable=true;
                eligibleSourcePolicy=false;
            }
            if ((versioned || sourceModule) && "content-type".equals(lower) && !dynamic.contains(lower)) {
                javascript=javascript(value);
            }
            if ("etag".equals(lower) && !dynamic.contains(lower) && !value.isBlank()) hasEtag=true;
            if (rewrittenHtml && Set.of("etag","last-modified","content-md5","content-digest","repr-digest","digest").contains(lower)) continue;
            if(dropped(lower) || dynamic.contains(lower) || Set.of("set-cookie","www-authenticate","cache-control","access-control-allow-origin","access-control-allow-credentials").contains(lower)) continue;
            if("location".equals(lower)) {
                // Runtime maps only redirects back to this registered Vite into a relative path.
                if(!value.startsWith("/") || value.startsWith("//")) continue;
                URI target=URI.create(value);
                String path=target.getRawPath();
                if(!path.startsWith(binding.basePath())) path=binding.basePath()+path.replaceFirst("^/","");
                validatePath(path,binding);
                response.setHeader(name,path+(target.getRawQuery()==null?"":"?"+target.getRawQuery())+(target.getRawFragment()==null?"":"#"+target.getRawFragment()));
            } else response.addHeader(name,value);
        }
        if (versioned && javascript && immutable && fresh && !nonCacheable && response.getStatus()==200) {
            // Reuse Vite's hashed dependency for a short interval in this browser only.
            response.setHeader("Cache-Control","private, max-age=60, immutable");
        } else if (sourceModule && eligibleSourcePolicy && !dynamic.contains("cache-control")
                && (response.getStatus()==200 && revalidate && javascript && hasEtag
                || response.getStatus()==304 && (!hasCacheControl || revalidate))) {
            // Vite may omit cache metadata on 304. Every reuse still passes preview authorization.
            response.setHeader("Cache-Control","private, no-cache");
            // A 304 without Vary must leave all of the cached response's Vary fields intact.
            if (response.getStatus()==200 || response.containsHeader("Vary")) response.addHeader("Vary","Sec-Fetch-Dest");
        }
    }
    private boolean validUpgrade(HttpServletRequest request) {
        String protocols = request.getHeader("Sec-WebSocket-Protocol");
        return "GET".equals(request.getMethod()) && properties.getPlatformOrigin().equals(request.getHeader("Origin"))
                && (protocols == null || "vite-hmr".equals(protocols));
    }
    private void socket(HttpServletRequest request, HttpServletResponse response, PrdReviewPreviewProperties.Binding binding,
                        String token, PrdPreviewCluster.Owner owner) throws Exception {
        var stream=relay.open(binding,"ws",owner);
        var requestHead=head(request,binding,"ws");
        var handler=new AbstractWebSocketHandler() {
            @Override public void afterConnectionEstablished(WebSocketSession session) throws Exception {
                session.setTextMessageSizeLimit(64*1024); session.setBinaryMessageSizeLimit(64*1024);
                sockets.put(session,new SocketLink(token,binding.getId(),stream)); stream.browser(session);
                try {
                    stream.head(requestHead);
                    Object opened=stream.next();
                    if(!(opened instanceof JsonNode frame) || !"opened".equals(frame.path("type").asText())) throw new IOException("Preview WebSocket did not open");
                } catch(Exception error) { close(session); throw error; }
            }
            @Override protected void handleTextMessage(WebSocketSession session,TextMessage message) throws Exception {
                previews.authorize(token,binding.getId(),"SESSION"); stream.browserText(message.getPayload());
            }
            @Override protected void handleBinaryMessage(WebSocketSession session,BinaryMessage message) throws Exception {
                previews.authorize(token,binding.getId(),"SESSION"); stream.browserBytes(message.getPayload());
            }
            @Override public void afterConnectionClosed(WebSocketSession session,CloseStatus status) { sockets.remove(session); stream.close(); }
            @Override public void handleTransportError(WebSocketSession session,Throwable error) { close(session); }
        };
        var handshake=new org.springframework.web.socket.server.support.DefaultHandshakeHandler() {
            @Override protected String selectProtocol(List<String> requested,WebSocketHandler handler) { return requested.contains("vite-hmr")?"vite-hmr":null; }
        };
        try { new WebSocketHttpRequestHandler(handler,handshake).handleRequest(request,response); }
        catch(Exception error) { stream.close(); throw error; }
        if(response.getStatus()!=101) stream.close();
    }
    private record SocketLink(String token,String bindingId,PrdPreviewRelay.Stream stream) {}
    private void close(WebSocketSession session) {
        var link=sockets.remove(session); if(link!=null) link.stream.close();
        try { session.close(CloseStatus.POLICY_VIOLATION); } catch(IOException ignored) {}
    }
    @Scheduled(fixedDelay=2000) public void revokeSockets() {
        sockets.forEach((session,link)-> { try { previews.authorize(link.token,link.bindingId,"SESSION"); } catch(Exception revoked) { close(session); } });
    }
    @Scheduled(fixedDelay=60000) public void purgeGrants() { dao.purge(); }
    @javax.annotation.PreDestroy public void shutdown() { assetTransfers.shutdownNow(); sockets.keySet().forEach(this::close); }
    private static String cookie(HttpServletRequest request) {
        if(request.getCookies()!=null) for(javax.servlet.http.Cookie cookie:request.getCookies()) if(COOKIE.equals(cookie.getName())) return cookie.getValue();
        return null;
    }
}
