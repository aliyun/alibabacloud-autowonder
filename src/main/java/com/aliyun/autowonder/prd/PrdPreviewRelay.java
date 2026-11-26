package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.websocket.ExecutorWsAuthenticator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.server.support.WebSocketHttpRequestHandler;
import javax.servlet.*;
import javax.servlet.http.*;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/** Preview-only reverse transport. Every data socket is one-use and fenced to its control generation. */
@Configuration
public class PrdPreviewRelay {
    static final String PREFIX="/design-preview-relay/v1/";
    public static final int CHUNK=64*1024;
    // Leave admission headroom for data handshakes on the default 200-thread servlet connector.
    static final int FRAME=128*1024, PER_BINDING=24, TOTAL=128;
    // Three chunks plus response headers fit inside the existing peer socket buffer.
    static final int ASSET_RESPONSE_WINDOW=3;
    private static final int PENDING_HTTP=96;
    private static final long ASSET_RESPONSE_MS=1800;
    private static final int MAX_PRELOADED_MODULES=768;
    private static final Pattern MODULE_VERSION=Pattern.compile("(?:\\?|&)t=([0-9]{13})(?:&|$)");
    private static final long MODULE_PRELOAD_INTERVAL_MS=1500;
    static final long ADMISSION_WAIT_SECONDS=15;
    static final long IDLE_MS=30_000, HEARTBEAT_MS=8_000;
    private final PrdReviewPreviewProperties properties;
    private final ExecutorWsAuthenticator authenticator;
    @org.springframework.beans.factory.annotation.Autowired
    private PrdDesignRuntimeService runtimes;
    private PrdPreviewCluster cluster;
    private PrdPreviewPeer peer;

    @org.springframework.beans.factory.annotation.Autowired
    void configureCluster(PrdPreviewCluster cluster, PrdPreviewPeer peer) {
        this.cluster = cluster;
        this.peer = peer;
    }

    private boolean clustered() { return cluster != null && cluster.enabled(); }
    private final ObjectMapper json=new ObjectMapper();
    private final Map<String,Control> controls=new ConcurrentHashMap<>();
    private final Map<String,Stream> streams=new ConcurrentHashMap<>();
    private int pendingHttp;
    public PrdPreviewRelay(PrdReviewPreviewProperties properties,ExecutorWsAuthenticator authenticator) {
        this.properties=properties; this.authenticator=authenticator;
    }
    @Bean public FilterRegistrationBean<OncePerRequestFilter> previewRelayFilter() {
        var bean=new FilterRegistrationBean<OncePerRequestFilter>();
        // Preview has its own executor authentication and runs before the platform login filter.
        bean.setName("designPreviewRelay"); bean.setOrder(-202); bean.addUrlPatterns("/*");
        bean.setFilter(new OncePerRequestFilter() {
            @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
                String path=request.getRequestURI();
                if(!path.startsWith("/design-preview-relay")) { chain.doFilter(request,response); return; }
                response.setHeader("Cache-Control","no-store");
                if(!"websocket".equalsIgnoreCase(request.getHeader("Upgrade")) || !"GET".equals(request.getMethod()) || request.getQueryString()!=null) { response.setStatus(400); return; }
                String credential=bearer(request);
                try {
                    if(path.startsWith(PREFIX+"control/")) {
                        var binding=properties.byId(path.substring((PREFIX+"control/").length()));
                        if(binding==null) { response.setStatus(404); return; }
                        if(!Long.toString(binding.getExecutorId()).equals(request.getHeader("X-Autowonder-Executor")) || !authenticated(binding,credential)) { response.setStatus(401); return; }
                        var control=new Control(binding,credential);
                        synchronized(controls) {
                            if(controls.containsKey(binding.getId())) { response.setStatus(409); return; }
                            if(controls.size()>=128) { response.setStatus(503); return; }
                            controls.put(binding.getId(),control);
                        }
                        try {
                            if (clustered() && !control.acquire()) { response.setStatus(409); return; }
                            new WebSocketHttpRequestHandler(control).handleRequest(request,response);
                        } finally {
                            if (response.getStatus() != 101) control.close();
                        }
                    } else if(path.startsWith(PREFIX+"data/")) {
                        String streamId = path.substring((PREFIX+"data/").length());
                        var stream = streams.get(streamId);
                        String handoff = request.getHeader(PrdPreviewCluster.HANDOFF);
                        if (stream == null && clustered() && handoff == null && !credential.isEmpty()) {
                            var owner = cluster.routeStream(streamId);
                            if (owner != null && !cluster.local(owner)) {
                                peer.data(cluster.peer(owner), owner, request, response, credential);
                                return;
                            }
                        }
                        if (stream == null || stream.assetResult!=null && !stream.assetData || !stream.owner.matchesHandoff(handoff)
                                || !constantEquals(stream.key,credential) || stream.closed.get()
                                || !available(stream.owner.binding, stream.owner)
                                || !stream.claimed.compareAndSet(false,true)) { response.setStatus(403); return; }
                        try { new WebSocketHttpRequestHandler(stream).handleRequest(request,response); }
                        catch(Exception error) { stream.close(); throw error; }
                        if(response.getStatus()!=101) stream.close();
                    } else response.setStatus(404);
                } catch(CapacityException busy) { if (!response.isCommitted()) response.setStatus(503); }
                catch(Exception failed) { if(!response.isCommitted()) response.setStatus(502); }
            }
        }); return bean;
    }
    private static String bearer(HttpServletRequest request) {
        String value=request.getHeader("Authorization");
        return value!=null && value.startsWith("Bearer ") && value.length()<=4096?value.substring(7):"";
    }
    private static boolean constantEquals(String left,String right) {
        return MessageDigest.isEqual(left.getBytes(StandardCharsets.UTF_8),right.getBytes(StandardCharsets.UTF_8));
    }
    private boolean authenticated(PrdReviewPreviewProperties.Binding binding,String credential) {
        if(credential.isEmpty()) return false;
        return authenticator.authenticate(binding.getExecutorId(),credential).isSuccess();
    }
    public boolean available(PrdReviewPreviewProperties.Binding binding) {
        if (!clustered()) return available(binding, controls.get(binding.getId()));
        var owner = cluster.owner(binding.getId());
        return owner != null && owner.ready() && (!cluster.local(owner) || localAvailable(binding, owner));
    }
    boolean localAvailable(PrdReviewPreviewProperties.Binding binding, PrdPreviewCluster.Owner owner) {
        var control = controls.get(binding.getId());
        return control != null && owner.equals(control.lease) && available(binding, control);
    }
    private boolean available(PrdReviewPreviewProperties.Binding binding, Control control) {
        return control!=null && controls.get(binding.getId())==control && control.binding.equals(binding)
                && control.ready && control.socket!=null && control.socket.isOpen() && now()-control.seen<HEARTBEAT_MS
                && (!clustered() || now() < control.leaseUntil);
    }
    public String status(PrdReviewPreviewProperties.Binding binding) {
        if (clustered()) {
            var owner = cluster.owner(binding.getId());
            if (owner == null) return "DISCONNECTED";
            if (!cluster.local(owner)) return owner.ready() ? "READY" : "LOCAL_SERVICE_UNAVAILABLE";
            if (localAvailable(binding, owner)) return "READY";
        }
        var control=controls.get(binding.getId());
        if(!clustered() && available(binding, control)) return "READY";
        return control!=null && now()-control.seen<HEARTBEAT_MS?"LOCAL_SERVICE_UNAVAILABLE":"DISCONNECTED";
    }
    public Stream open(PrdReviewPreviewProperties.Binding binding,String kind) throws IOException {
        return open(binding, kind, null);
    }
    Stream open(PrdReviewPreviewProperties.Binding binding, String kind, PrdPreviewCluster.Owner expected) throws IOException {
        return open(binding,kind,expected,null);
    }
    Stream asset(PrdReviewPreviewProperties.Binding binding, PrdPreviewCluster.Owner expected, Map<String,Object> request) throws IOException {
        return open(binding,"asset",expected,request);
    }
    private Stream open(PrdReviewPreviewProperties.Binding binding, String kind, PrdPreviewCluster.Owner expected,
                        Map<String,Object> assetRequest) throws IOException {
        synchronized(streams) {
            var control=controls.get(binding.getId());
            requireAvailable(binding, expected, control);
            if (assetRequest!=null && (!control.assetRequests
                    || Boolean.TRUE.equals(assetRequest.get("document")) && !control.documentRequests)) return null;
            if (!hasCapacity(control)) {
                if ("ws".equals(kind) || pendingHttp>=PENDING_HTTP) throw new CapacityException();
                long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(ADMISSION_WAIT_SECONDS);
                pendingHttp++;
                try {
                    do {
                        long remaining=deadline-System.nanoTime();
                        if (remaining<=0) throw new CapacityException();
                        TimeUnit.NANOSECONDS.timedWait(streams,remaining);
                        requireAvailable(binding,expected,control);
                    } while (!hasCapacity(control));
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Preview admission was interrupted",interrupted);
                } finally {
                    pendingHttp--;
                }
            }
            var stream=new Stream(control,kind); streams.put(stream.id,stream);
            try {
                if (assetRequest!=null) {
                    if (stream.continuousAsset) {
                        assetRequest=new HashMap<>(assetRequest);
                        assetRequest.put("stream",true);
                    }
                    control.send(Map.of("type","asset","id",stream.id,"request",assetRequest));
                } else {
                    if (clustered()) cluster.publishStream(stream.id, control.lease);
                    control.send(Map.of("type","open","id",stream.id,"key",stream.key,"kind",kind));
                }
                return stream;
            } catch (IOException | RuntimeException error) { stream.close(); throw error; }
        }
    }
    private boolean hasCapacity(Control control) {
        return streams.size()<TOTAL && streams.values().stream().filter(s->s.owner==control).count()<PER_BINDING;
    }
    private void requireAvailable(PrdReviewPreviewProperties.Binding binding, PrdPreviewCluster.Owner expected, Control control) throws IOException {
        if (!available(binding,control) || expected!=null && !expected.equals(control.lease)) {
            throw new IOException("Preview executor is offline");
        }
    }
    public static class CapacityException extends IOException {}
    private static long now() { return System.nanoTime()/1_000_000; }
    private static long moduleVersion(String path) {
        var version=MODULE_VERSION.matcher(path);
        return version.find() ? Long.parseLong(version.group(1)) : 0;
    }
    private static WebSocketSession bounded(WebSocketSession socket) {
        socket.setTextMessageSizeLimit(FRAME); socket.setBinaryMessageSizeLimit(CHUNK);
        return new ConcurrentWebSocketSessionDecorator(socket,5000,FRAME*2);
    }
    private static void closeSocket(WebSocketSession socket) { if(socket!=null) try { socket.close(CloseStatus.GOING_AWAY); } catch(Exception ignored) {} }
    private void send(WebSocketSession socket,Object message) throws IOException {
        if(socket==null || !socket.isOpen()) throw new IOException("Preview connection closed");
        socket.sendMessage(new TextMessage(json.writeValueAsString(message)));
    }
    private class Control extends AbstractWebSocketHandler {
        final PrdReviewPreviewProperties.Binding binding;
        final String credential;
        final Map<String,String> modules=new LinkedHashMap<>();
        long lastModulePreload;
        volatile WebSocketSession socket;
        volatile boolean ready;
        volatile boolean assetRequests;
        volatile boolean documentRequests;
        volatile boolean continuousAssets;
        volatile PrdPreviewCluster.Owner lease;
        volatile long leaseUntil;
        private int port;
        volatile long seen=now(),authAt=now();
        Control(PrdReviewPreviewProperties.Binding binding,String credential) { this.binding=binding; this.credential=credential; }
        synchronized boolean acquire() {
            long started = now();
            if (controls.get(binding.getId()) != this) return false;
            lease = cluster.acquire(binding.getId());
            leaseUntil = started + PrdPreviewCluster.LEASE_MS;
            return lease != null;
        }
        boolean matchesHandoff(String handoff) {
            return handoff == null || lease != null && lease.generation().equals(handoff);
        }
        boolean renew(boolean available) {
            if (!clustered()) return true;
            long started = now();
            if (lease == null || started >= leaseUntil) return false;
            var updated = lease.withReady(available);
            if (!cluster.renew(binding.getId(), lease, updated)) return false;
            lease = updated;
            leaseUntil = started + PrdPreviewCluster.LEASE_MS;
            return true;
        }
        void send(Object message) throws IOException { PrdPreviewRelay.this.send(socket,message); }
        @Override public void afterConnectionEstablished(WebSocketSession session) {
            socket=bounded(session);
            if(controls.get(binding.getId())!=this) closeSocket(socket);
        }
        @Override protected synchronized void handleTextMessage(WebSocketSession session,TextMessage message) throws Exception {
            if (controls.get(binding.getId()) != this) return;
            var frame=json.readTree(message.getPayload());
            String type=frame.path("type").asText();
            if ("asset-result".equals(type) || "asset-data".equals(type)) {
                var stream=streams.get(frame.path("id").asText());
                if (stream!=null && stream.owner==this && stream.assetResult!=null && available(binding,this)) {
                    if ("asset-data".equals(type)) stream.continueAsset(frame);
                    else stream.assetResult.complete(frame);
                }
                return;
            }
            if("rejected".equals(frame.path("type").asText())) {
                var stream=streams.get(frame.path("id").asText());
                if(stream!=null && stream.owner==this && stream.assetResult==null) { stream.connected.completeExceptionally(new CapacityException()); stream.close(); }
                return;
            }
            if(!"health".equals(frame.path("type").asText())) { close(); return; }
            assetRequests=frame.path("assetRequests").asBoolean(false);
            documentRequests=frame.path("documentRequests").asBoolean(false);
            continuousAssets=frame.path("continuousAssets").asBoolean(false);
            seen=now();
            boolean live=frame.path("available").asBoolean(false);
            if (live && binding.isAutomatic()) {
                var announced=frame.path("port");
                if (announced.isMissingNode()) {
                    if (port != 0) { close(); return; }
                    live = runtimes != null && runtimes.acceptsLegacyPreview(binding);
                } else {
                    int actual=announced.isIntegralNumber() && announced.canConvertToInt() ? announced.intValue() : 0;
                    // A control connection owns one port. Port changes require a new registration.
                    if (port != 0 && port != actual) { close(); return; }
                    if (port == 0 || !ready) {
                        live = runtimes != null && (clustered()
                                ? runtimes.activateClusterPreview(binding, actual, () -> renew(false))
                                : runtimes.activatePreview(binding, actual));
                        if (live) port=actual;
                    }
                }
            }
            if (!renew(live)) { close(); return; }
            ready=live;
            if(!ready) {
                synchronized (modules) { modules.clear(); }
                streams.values().stream().filter(s->s.owner==this).forEach(Stream::close);
            }
            send(Map.of("type","registered","available",ready));
        }
        @Override public void afterConnectionClosed(WebSocketSession session,CloseStatus status) { close(); }
        @Override public void handleTransportError(WebSocketSession session,Throwable error) { close(); }
        void close() {
            synchronized (this) {
                ready=false;
                if (!controls.remove(binding.getId(),this)) return;
            }
            streams.values().stream().filter(s->s.owner==this).forEach(Stream::close);
            closeSocket(socket);
            if (lease != null) cluster.release(binding.getId(), lease);
        }
    }
    /** Per-stream credits bound queued bodies independently of response length. */
    public class Stream extends AbstractWebSocketHandler implements AutoCloseable {
        final String id=UUID.randomUUID().toString(),key=PrdReviewService.randomToken(),kind;
        final Control owner;
        final AtomicBoolean claimed=new AtomicBoolean(),closed=new AtomicBoolean();
        final CompletableFuture<Void> connected=new CompletableFuture<>();
        final CompletableFuture<JsonNode> assetResult;
        final boolean continuousAsset;
        final ArrayBlockingQueue<Object> incoming;
        final Object sendLock=new Object();
        volatile CompletableFuture<Void> ack;
        volatile WebSocketSession socket,browser;
        volatile boolean assetData;
        volatile long touched=now();
        final long created=now();
        Stream(Control owner,String kind) {
            this.owner=owner; this.kind=kind;
            this.assetResult="asset".equals(kind)?new CompletableFuture<>():null;
            this.continuousAsset=assetResult!=null && owner.continuousAssets;
            this.incoming=new ArrayBlockingQueue<>("http".equals(kind)||continuousAsset?ASSET_RESPONSE_WINDOW+2:3);
        }
        void recordModule(String path, boolean available) {
            if (path==null || !owner.documentRequests) return;
            int query=path.indexOf('?');
            String resource=query<0 ? path : path.substring(0,query);
            synchronized (owner.modules) {
                String previous=owner.modules.get(resource);
                if (!owner.ready || !available) owner.modules.remove(resource,path);
                else if (previous!=null) {
                    if (moduleVersion(path)>=moduleVersion(previous))
                        owner.modules.put(resource,path);
                } else if (owner.modules.size()<MAX_PRELOADED_MODULES) owner.modules.put(resource,path);
            }
        }
        List<String> claimModulePreloads() {
            synchronized (owner.modules) {
                long now=now();
                if (owner.modules.isEmpty() || owner.lastModulePreload!=0 && now-owner.lastModulePreload<MODULE_PRELOAD_INTERVAL_MS) return List.of();
                owner.lastModulePreload=now;
                return List.copyOf(owner.modules.values());
            }
        }
        JsonNode assetResponse() throws IOException {
            try {
                return assetResult.get(continuousAsset?5000:ASSET_RESPONSE_MS,TimeUnit.MILLISECONDS);
            } catch (TimeoutException | ExecutionException unavailable) {
                if (continuousAsset) throw new IOException("Preview asset response unavailable",unavailable);
                return null;
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IOException("Preview asset request interrupted",interrupted);
            }
        }
        void continueAsset(JsonNode frame) {
            synchronized(streams) {
                if (!continuousAsset || closed.get() || assetResult.isDone()) return;
                try {
                    if (clustered()) cluster.publishStream(id,owner.lease);
                    assetData=true;
                    owner.send(Map.of("type","asset-data","id",id,"key",key));
                    assetResult.complete(frame);
                } catch(IOException | RuntimeException error) { close(); }
            }
        }
        public void awaitConnected() throws IOException { await(connected,5000); }
        public void head(Object head) throws IOException { awaitConnected(); send(head); }
        public void send(Object frame) throws IOException { PrdPreviewRelay.this.send(socket,frame); touched=now(); }
        public void bytes(byte[] bytes,int size) throws IOException { sendAcknowledged(new BinaryMessage(Arrays.copyOf(bytes,size))); }
        public void browser(WebSocketSession session) { browser=bounded(session); }
        public void browserText(String text) throws IOException { sendAcknowledged(new TextMessage(json.writeValueAsString(Map.of("type","text","data",text)))); }
        public void browserBytes(ByteBuffer bytes) throws IOException { sendAcknowledged(new BinaryMessage(bytes)); }
        private void sendAcknowledged(WebSocketMessage<?> frame) throws IOException {
            synchronized(sendLock) {
                if(closed.get() || !available(owner.binding, owner)) throw new IOException("Preview stream closed");
                ack=new CompletableFuture<>();
                try { socket.sendMessage(frame); await(ack,5000); touched=now(); }
                finally { ack=null; }
            }
        }
        public Object next() throws IOException {
            try {
                Object result=incoming.poll(IDLE_MS,TimeUnit.MILLISECONDS);
                if(result==null || result instanceof IOException) throw new IOException("Preview stream closed or timed out");
                touched=now(); return result;
            } catch(InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new IOException(interrupted); }
        }
        public void acknowledge() throws IOException { send(Map.of("type","ack")); }
        public boolean responseRejectsUpload() {
            return incoming.peek() instanceof JsonNode frame && "response".equals(frame.path("type").asText()) && frame.path("status").asInt()>=400;
        }
        @Override public void afterConnectionEstablished(WebSocketSession session) {
            socket=bounded(session);
            // A disconnect/timeout may win while the servlet container is completing upgrade.
            if(closed.get() || !available(owner.binding, owner)) { closeSocket(socket); close(); return; }
            connected.complete(null);
        }
        @Override protected void handleBinaryMessage(WebSocketSession session,BinaryMessage message) throws Exception {
            if (!available(owner.binding, owner)) { close(); return; }
            touched=now(); byte[] bytes=new byte[message.getPayloadLength()]; message.getPayload().get(bytes);
            if("ws".equals(kind)) {
                if(browser==null || !browser.isOpen()) { close(); return; }
                browser.sendMessage(new BinaryMessage(bytes)); acknowledge();
            } else offer(bytes);
        }
        @Override protected void handleTextMessage(WebSocketSession session,TextMessage message) throws Exception {
            if (!available(owner.binding, owner)) { close(); return; }
            touched=now(); JsonNode frame=json.readTree(message.getPayload());
            String type=frame.path("type").asText();
            if("ack".equals(type)) { var pending=ack; if(pending!=null) pending.complete(null); else close(); return; }
            if("error".equals(type)) { close(); return; }
            if("ws".equals(kind) && "text".equals(type)) {
                if(browser==null || !browser.isOpen()) { close(); return; }
                browser.sendMessage(new TextMessage(frame.path("data").asText())); acknowledge();
            } else if(Set.of("response","end","opened").contains(type)) offer(frame);
            else close();
        }
        private void offer(Object item) throws InterruptedException {
            // Each asset data connection has its own bounded queue. A slow HTTP consumer
            // pauses that connection's receive loop, so TCP applies backpressure to the sender.
            if (!(assetData ? incoming.offer(item,5000,TimeUnit.MILLISECONDS) : incoming.offer(item))) close();
        }
        @Override public void afterConnectionClosed(WebSocketSession session,CloseStatus status) { close(); }
        @Override public void handleTransportError(WebSocketSession session,Throwable error) { close(); }
        @Override public void close() {
            if(!closed.compareAndSet(false,true)) return;
            synchronized(streams) {
                // Order retirement before subsequent opens on the same control socket.
                // A data socket's asynchronous close alone leaves the worker briefly full.
                try { owner.send(Map.of("type","cancel","id",id)); } catch(IOException ignored) {}
                streams.remove(id,this);
                streams.notifyAll();
            }
            var error=new IOException("Preview stream closed"); connected.completeExceptionally(error);
            if(assetResult!=null) assetResult.completeExceptionally(error);
            var pending=ack; if(pending!=null) pending.completeExceptionally(error);
            incoming.clear(); incoming.offer(error);
            closeSocket(socket); closeSocket(browser);
        }
    }
    private static void await(CompletableFuture<Void> future,long timeout) throws IOException {
        try { future.get(timeout,TimeUnit.MILLISECONDS); }
        catch(InterruptedException error) { Thread.currentThread().interrupt(); throw new IOException(error); }
        catch(ExecutionException error) { if(error.getCause() instanceof IOException cause) throw cause; throw new IOException("Preview connection failed",error); }
        catch(TimeoutException error) { throw new IOException("Preview connection timed out",error); }
    }
    @Scheduled(fixedDelay=1000) public void expire() {
        controls.values().forEach(control->{
            if (now() - control.seen >= HEARTBEAT_MS || clustered() && now() >= control.leaseUntil && control.lease != null
                    || (!control.binding.isAutomatic()
                    && !control.binding.equals(properties.byId(control.binding.getId())))) control.close();
            else if(now()-control.authAt>30_000) {
                control.authAt=now();
                try {
                    if (!control.binding.equals(properties.byId(control.binding.getId()))
                            || !authenticated(control.binding,control.credential)) control.close();
                } catch(Exception unavailable) { control.close(); }
            }
        });
        streams.values().forEach(stream->{
            if(stream.socket==null && now()-stream.created>5000 || (stream.assetData || "http".equals(stream.kind))
                    && (now()-stream.touched>IDLE_MS || now()-stream.created>600_000)) stream.close();
        });
    }
    @javax.annotation.PreDestroy public void shutdown() { controls.values().forEach(Control::close); streams.values().forEach(Stream::close); }
}
