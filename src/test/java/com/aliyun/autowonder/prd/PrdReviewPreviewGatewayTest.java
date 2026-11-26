package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import okhttp3.*;
import org.apache.catalina.startup.Tomcat;
import org.apache.tomcat.websocket.server.WsSci;
import org.junit.jupiter.api.*;
import com.aliyun.autowonder.websocket.ExecutorWsAuthenticator;
import javax.servlet.http.*;
import javax.websocket.*;
import javax.websocket.server.*;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Real HTTP and WebSocket sockets: session paths, credential stripping and live revocation. */
class PrdReviewPreviewGatewayTest {
    private static final int LARGE_ASSET_SIZE=3_500_000;
    Tomcat platform,upstream;
    PrdReviewPreviewGateway gateway;
    PrdPreviewRelay relay;
    PrdReviewPreviewProperties properties;
    PrdReviewPreviewProperties.Binding configuredBinding;
    java.nio.file.Path runtime,home,config;
    PrdReviewPreviewService previews=mock(PrdReviewPreviewService.class);
    AtomicReference<String> received=new AtomicReference<>();
    AtomicReference<String> receivedSmallAsset=new AtomicReference<>();
    AtomicInteger receivedLargeAsset=new AtomicInteger();
    AtomicInteger sourceVersion=new AtomicInteger(1);
    AtomicInteger sourceRequests=new AtomicInteger();
    String origin;
    int port;
    private final CountDownLatch releaseBurst = new CountDownLatch(1);
    private final CountDownLatch firstBurst = new CountDownLatch(PrdPreviewRelay.PER_BINDING);
    OkHttpClient client=new OkHttpClient.Builder().proxy(java.net.Proxy.NO_PROXY).followRedirects(false).build();
    @BeforeEach void setup() throws Exception {
        Assumptions.assumeTrue(System.getProperty("preview.runtime")!=null,"Cross-repository live test: set -Dpreview.runtime=/absolute/runtime/worktree");
        runtime=java.nio.file.Path.of(System.getProperty("preview.runtime"));
        home=Files.createTempDirectory("relay-cli-test"); config=home.resolve("config.json");
        upstream=server("review-upstream");
        var upstreamContext=upstream.addContext("",Files.createTempDirectory("review-upstream-doc").toString());
        upstreamContext.addServletContainerInitializer(new WsSci(),Set.of());
        var app=Tomcat.addServlet(upstreamContext,"app",new HttpServlet() {
            @Override protected void service(HttpServletRequest req,HttpServletResponse res) throws java.io.IOException {
                if (req.getRequestURI().contains("/burst/")) {
                    firstBurst.countDown();
                    try {
                        if (!releaseBurst.await(12, TimeUnit.SECONDS)) throw new java.io.IOException("Test request was not released");
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                        throw new java.io.IOException(interrupted);
                    }
                }
                String requestDetails=req.getMethod()+" "+req.getRequestURI()+"?"+req.getQueryString()+" host="+req.getHeader("Host")+" auth="+req.getHeader("Authorization")+" cookie="+req.getHeader("Cookie");
                received.set(requestDetails);
                if (req.getRequestURI().endsWith("/small.js")) receivedSmallAsset.set(requestDetails);
                if (req.getRequestURI().matches(".*/revalidate(?:-large|-deny-store|-cookie|-no-etag)?\\.tsx")) {
                    sourceRequests.incrementAndGet();
                    int version=sourceVersion.get();
                    String etag="W/\"source-"+version+"\"";
                    String path=req.getRequestURI();
                    boolean denyStore=path.endsWith("-deny-store.tsx");
                    if (denyStore) res.setHeader("Cache-Control","no-cache, no-store");
                    if (path.endsWith("-cookie.tsx")) res.setHeader("Set-Cookie","application-cookie=fixture");
                    // Like Vite, the unchanged response can omit Cache-Control and ETag.
                    if (etag.equals(req.getHeader("If-None-Match"))) { res.setStatus(304); return; }
                    if (!denyStore) res.setHeader("Cache-Control","no-cache");
                    if (!path.endsWith("-no-etag.tsx")) res.setHeader("ETag",etag);
                    res.setHeader("Vary","Accept");
                    res.setContentType("text/javascript");
                    res.getWriter().write("export default "+version+";"+(path.endsWith("-large.tsx")?" ".repeat(100_000):""));
                    return;
                }
                if (req.getRequestURI().contains("/node_modules/.vite/deps/")) {
                    res.setHeader("Cache-Control","max-age=31536000,immutable");
                } else {
                    res.setHeader("Set-Cookie","must-not-escape=secret"); res.setHeader("Cache-Control","public, max-age=9999");
                }
                if(req.getRequestURI().endsWith("/early")) { res.setStatus(401); res.getWriter().write("backend-denied"); return; }
                if(req.getRequestURI().endsWith("/echo")) {
                    res.setHeader("X-Method",req.getMethod()); res.setHeader("X-Query",Objects.toString(req.getQueryString(),""));
                    res.setContentType("application/octet-stream"); req.getInputStream().transferTo(res.getOutputStream()); return;
                }
                if (req.getRequestURI().endsWith("/small.js") || req.getRequestURI().contains("/burst/")) res.setContentType("text/javascript");
                if (req.getRequestURI().endsWith("/messages.json"))
                    res.setContentType(Objects.toString(req.getQueryString(),"").contains("import") ? "text/javascript" : "application/json");
                if (req.getRequestURI().endsWith("/document")) res.setContentType("text/html");
                if (req.getRequestURI().endsWith("/vite-page")) {
                    res.setContentType("text/html; charset=utf-8");
                    res.setHeader("ETag","\"vite-page\"");
                    res.getWriter().write("<html><head><script type=\"module\" src=\"/design-preview/binding/@vite/client\"></script></head><body>Vite</body></html>");
                    return;
                }
                if (req.getRequestURI().endsWith("/large.js")) {
                    receivedLargeAsset.incrementAndGet();
                    res.setContentType("text/javascript");
                    if ("known".equals(req.getParameter("length"))) res.setContentLength(LARGE_ASSET_SIZE);
                    res.getWriter().write("a".repeat(LARGE_ASSET_SIZE));
                    return;
                }
                res.getWriter().write("demo:"+req.getRequestURI());
            }
        }); app.setAsyncSupported(true); upstreamContext.addServletMappingDecoded("/","app"); upstream.start();
        ((ServerContainer)upstreamContext.getServletContext().getAttribute(ServerContainer.class.getName())).addEndpoint(Echo.class);
        platform=server("review-gateway"); var ctx=platform.addContext("",Files.createTempDirectory("review-gateway-doc").toString());
        ctx.addServletContainerInitializer(new WsSci(),Set.of());
        Tomcat.addServlet(ctx,"platform",new HttpServlet() { @Override protected void doGet(HttpServletRequest req,HttpServletResponse res) throws java.io.IOException { res.getWriter().write("platform"); } }).setAsyncSupported(true); ctx.addServletMappingDecoded("/","platform");
        properties=new PrdReviewPreviewProperties();
        var binding=new PrdReviewPreviewProperties.Binding(); binding.setId("binding");
        configuredBinding=binding;
        binding.setWorkspaceId(1); binding.setWorkitemId(10); binding.setConversationId(20); binding.setExecutorId(30); binding.setSourceKey("source");
        binding.setExecutorConfigPath("/test/preview.json");
        var second=new PrdReviewPreviewProperties.Binding(); second.setId("binding-two"); second.setWorkspaceId(1); second.setWorkitemId(11);
        second.setConversationId(21); second.setExecutorId(31); second.setSourceKey("second-source"); second.setExecutorConfigPath("/test/second.json");
        properties.setBindings(List.of(binding,second));
        when(previews.exchange("code","binding")).thenReturn("session");
        when(previews.authorize(any(),eq("binding"),eq("SESSION"))).thenAnswer(call->{ if(!"session".equals(call.getArgument(0))) throw new BizException(ErrorCode.NO_PERMISSION); return new PrdReviewGrantDO(); });
        var auth=mock(ExecutorWsAuthenticator.class); var accepted=mock(ExecutorWsAuthenticator.AuthResult.class); when(accepted.isSuccess()).thenReturn(true);
        var rejected=mock(ExecutorWsAuthenticator.AuthResult.class);
        when(auth.authenticate(anyLong(),anyString())).thenReturn(rejected); when(auth.authenticate(30,"fixture-executor-token")).thenReturn(accepted);
        when(auth.authenticate(31,"fixture-second-executor-token")).thenReturn(accepted);
        relay=new PrdPreviewRelay(properties,auth);
        gateway=new PrdReviewPreviewGateway(properties,previews,mock(PrdReviewPreviewDao.class),relay);
        var platformLogin=new org.springframework.boot.web.servlet.FilterRegistrationBean<javax.servlet.Filter>();
        platformLogin.setName("platformLogin"); platformLogin.setOrder(-200); platformLogin.addUrlPatterns("/*");
        platformLogin.setFilter((request,response,chain)->((HttpServletResponse)response).sendRedirect("/company-login"));
        // Use the production servlet registrations rather than inventing filter names in the fixture.
        var registrations=new ArrayList<>(List.of(relay.previewRelayFilter(),gateway.designPreviewGatewayFilter(),platformLogin));
        registrations.sort(Comparator.comparingInt(org.springframework.boot.web.servlet.FilterRegistrationBean::getOrder));
        ctx.addServletContainerInitializer((classes,servlet)->{
            for(var registration:registrations) registration.onStartup(servlet);
            assertNotNull(servlet.getFilterRegistration("designPreviewRelay"));
            assertNotNull(servlet.getFilterRegistration("designPreviewGateway"));
        },Set.of());
        platform.start(); port=platform.getConnector().getLocalPort(); origin="http://localhost:"+port; properties.setPlatformOrigin(origin);
        startWorker(port);
    }
    private void startWorker(int relayPort) throws Exception {
        Files.writeString(config,"{\"relayUrl\":\"ws://localhost:"+relayPort+"/design-preview-relay/v1/control/binding\",\"bindingId\":\"binding\",\"executorId\":30,\"auth\":{\"tokenEnv\":\"RELAY_TEST_TOKEN\"}}");
        String startup=cli("start","--id","gateway-test","--port",Integer.toString(upstream.getConnector().getLocalPort()),"--config",config.toString());
        // start deliberately returns RECONNECTING after its bounded wait instead
        // of inventing READY. Await the actual registration under concurrent load.
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(20);
        while(!startup.contains("\"READY\"") && System.nanoTime()<deadline) {
            assertFalse(startup.contains("\"FAILED\""),startup);
            Thread.sleep(100);
            startup=cli("status","--id","gateway-test");
        }
        assertTrue(startup.contains("\"READY\""),startup);
    }
    String cli(String... args) throws Exception {
        var command=new ArrayList<String>(List.of("node",runtime.resolve("npm/bin/cli.js").toString(),"preview")); command.addAll(List.of(args)); command.add("--json");
        var builder=new ProcessBuilder(command); builder.environment().put("AUTOWONDER_PREVIEW_HOME",home.resolve("state").toString());
        builder.environment().put("RELAY_TEST_TOKEN","fixture-executor-token"); builder.environment().put("AUTOWONDER_PREVIEW_OWNER_PID",Long.toString(ProcessHandle.current().pid()));
        builder.environment().put("RELAY_TEST_SECOND_TOKEN","fixture-second-executor-token");
        var child=builder.start(); assertTrue(child.waitFor(22,TimeUnit.SECONDS)); String output=new String(child.getInputStream().readAllBytes());
        assertEquals(0,child.exitValue(),output); return output;
    }
    private Tomcat server(String name) throws Exception {
        var server=new Tomcat(); server.setBaseDir(Files.createTempDirectory(name).toString()); server.setPort(0); server.getConnector().setProperty("address","127.0.0.1"); return server;
    }
    @AfterEach void close() throws Exception { if(home!=null) { cli("stop","--id","gateway-test"); cli("stop","--id","gateway-two"); } if(relay!=null) relay.shutdown(); if(gateway!=null) gateway.shutdown(); client.dispatcher().cancelAll(); client.dispatcher().executorService().shutdownNow(); client.connectionPool().evictAll(); if(platform!=null) { platform.stop(); platform.destroy(); } if(upstream!=null) { upstream.stop(); upstream.destroy(); } }
    Request.Builder request(String path) { return new Request.Builder().url("http://127.0.0.1:"+port+path).header("Host","localhost:"+port); }
    @Test void failedAssetOptimizationFallsBackBeforeReturningAModuleError() throws Exception {
        var transport=spy(relay);
        var failed=mock(PrdPreviewRelay.Stream.class);
        org.springframework.test.util.ReflectionTestUtils.setField(failed,"continuousAsset",true);
        when(failed.assetResponse()).thenThrow(new java.io.IOException("fixture transient asset transport failure"))
                .thenReturn(new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode());
        doReturn(failed).when(transport).asset(eq(configuredBinding),any(),anyMap());
        org.springframework.test.util.ReflectionTestUtils.setField(gateway,"relay",transport);
        var module=request("/design-preview/binding/small.js")
                .header("Sec-Fetch-Dest","script").header("Cookie","aw_design_preview=session").build();
        for (int attempt=0;attempt<2;attempt++) {
            try (var response=client.newCall(module).execute()) {
                assertEquals(200,response.code());
                assertEquals("demo:/design-preview/binding/small.js",Objects.requireNonNull(response.body()).string());
                assertTrue(response.headers("Server-Timing").stream().anyMatch(value->value.contains("aw-preview-asset-fallback")));
            }
        }
        verify(failed,times(2)).close();
        verify(transport,times(2)).open(eq(configuredBinding),eq("http"),isNull());
    }
    @Test void htmlPreviewUsesTheExistingControlConnection() throws Exception {
        var document=request("/design-preview/binding/document")
                .header("Sec-Fetch-Dest","iframe").header("Cookie","aw_design_preview=session").build();
        try (var response=client.newCall(document).execute()) {
            assertEquals(200,response.code());
            assertEquals("aw-preview-asset",response.header("Server-Timing"));
            assertEquals("demo:/design-preview/binding/document",response.body().string());
        }
    }
    @Test void viteDocumentStartsPreviouslyObservedModulesInParallel() throws Exception {
        var builder=request("/design-preview/binding/vite-page").header("Sec-Fetch-Dest","iframe");
        try (var response=client.newCall(builder.build()).execute()) {
            assertEquals(403,response.code());
        }
        var document=builder.header("Cookie","aw_design_preview=session").build();
        try (var response=client.newCall(document).execute()) {
            assertEquals(200,response.code());
            assertEquals("\"vite-page\"",response.header("ETag"));
            assertFalse(response.body().string().contains("modulepreload"));
        }
        for (String path:List.of("small.js","src/large.js","missing.js","other/small.js?t=123",
                "changed/small.js?t=1795074570559","changed/small.js?t=1795074570558",
                "translations/messages.json?import","raw/messages.json",
                "changed/messages.json?import&t=1795074570559","changed/messages.json?import&t=1795074570558")) {
            var asset=request("/design-preview/binding/"+path).header("Sec-Fetch-Dest","script")
                    .header("Cookie","aw_design_preview=session").build();
            try (var response=client.newCall(asset).execute()) {
                assertEquals(200,response.code());
                assertEquals("no-store",response.header("Cache-Control"));
                assertTrue(response.body().bytes().length>0);
            }
        }
        try (var response=client.newCall(document).execute()) {
            assertEquals(200,response.code());
            assertEquals("no-store",response.header("Cache-Control"));
            assertNull(response.header("ETag"));
            assertTrue(response.headers("Server-Timing").contains("aw-preview-module-preload"));
            String body=response.body().string();
            assertTrue(body.contains("<head><link rel=\"modulepreload\" href=\"/design-preview/binding/small.js\">"));
            assertTrue(body.contains("<link rel=\"modulepreload\" href=\"/design-preview/binding/src/large.js\">"));
            assertFalse(body.contains("missing.js"));
            assertFalse(body.contains("other/small.js"));
            assertTrue(body.contains("changed/small.js?t=1795074570559"));
            assertFalse(body.contains("changed/small.js?t=1795074570558"));
            assertTrue(body.contains("translations/messages.json?import"));
            assertFalse(body.contains("raw/messages.json"));
            assertTrue(body.contains("changed/messages.json?import&t=1795074570559"));
            assertFalse(body.contains("changed/messages.json?import&t=1795074570558"));
            assertTrue(body.contains("<script type=\"module\" src=\"/design-preview/binding/@vite/client\"></script>"));
        }
    }
    @Test void smallViteAssetsReuseControlWithoutForwardingCredentials() throws Exception {
        var asset=request("/design-preview/binding/small.js")
                .header("Sec-Fetch-Dest","script").header("Authorization","must-not-escape");
        try (var response=client.newCall(asset.build()).execute()) {
            assertEquals(403,response.code());
            assertNull(receivedSmallAsset.get());
        }
        try (var response=client.newCall(asset.header("Cookie","aw_design_preview=session").build()).execute()) {
            assertEquals(200,response.code());
            assertEquals("aw-preview-asset",response.header("Server-Timing"));
            assertEquals("no-store",response.header("Cache-Control"));
            assertNull(response.header("Set-Cookie"));
            assertEquals("demo:/design-preview/binding/small.js",response.body().string());
            assertTrue(receivedSmallAsset.get().endsWith("auth=null cookie=null"));
        }
        var api=request("/design-preview/binding/api/small.js")
                .header("Sec-Fetch-Dest","script").header("Cookie","aw_design_preview=session").build();
        try (var response=client.newCall(api).execute()) {
            assertEquals(200,response.code());
            assertNull(response.header("Server-Timing"));
            assertEquals("demo:/design-preview/binding/api/small.js",response.body().string());
        }
    }
    @Test void largeAssetsStreamTheSameViteResponseWithOrWithoutContentLength() throws Exception {
        int requests=0;
        for (String path:List.of("large.js","large.js?length=known")) {
            var request=request("/design-preview/binding/"+path).header("Sec-Fetch-Dest","script")
                    .header("Accept-Encoding","identity").header("Cookie","aw_design_preview=session").build();
            try (var response=client.newCall(request).execute()) {
                assertEquals(200,response.code());
                assertEquals("aw-preview-asset-stream",response.header("Server-Timing"));
                assertNull(response.header("Content-Encoding"));
                assertEquals("a".repeat(LARGE_ASSET_SIZE),response.body().string());
                assertEquals(++requests,receivedLargeAsset.get());
            }
        }
    }
    @Test void onlyViteVersionedDependenciesCanBeReusedWithoutRevalidation() throws Exception {
        String scope="/design-preview/binding/";
        for (String asset:List.of("small.js","large.js")) {
            String path=scope+"node_modules/.vite/deps/"+asset;
            var versioned=request(path+"?v=f4aedb6e").header("Sec-Fetch-Dest","script");
            try (var response=client.newCall(versioned.build()).execute()) {
                assertEquals(403,response.code());
                assertEquals("no-store",response.header("Cache-Control"));
            }
            try (var response=client.newCall(versioned.header("Cookie","aw_design_preview=session").build()).execute()) {
                assertEquals(200,response.code());
                assertEquals("private, max-age=60, immutable",response.header("Cache-Control"));
                assertNotNull(response.body());
            }
            try (var response=client.newCall(request(path).header("Sec-Fetch-Dest","script")
                    .header("Cookie","aw_design_preview=session").build()).execute()) {
                assertEquals(200,response.code());
                assertEquals("no-store",response.header("Cache-Control"));
                assertNotNull(response.body());
            }
        }
    }
    @Test void sourceModulesRevalidateThroughViteAndRecheckPreviewAuthorization() throws Exception {
        for (String path:List.of("revalidate.tsx", "revalidate-large.tsx?import")) {
            int version=sourceVersion.incrementAndGet();
            var source=request("/design-preview/binding/src/"+path)
                    .header("Sec-Fetch-Dest","script").header("Cookie","aw_design_preview=session").build();
            String etag;
            try (var response=client.newCall(source).execute()) {
                assertEquals(200,response.code());
                assertEquals("private, no-cache",response.header("Cache-Control"));
                assertEquals(List.of("Accept","Sec-Fetch-Dest"),response.headers("Vary"));
                etag=response.header("ETag");
                assertEquals("W/\"source-"+version+"\"",etag);
                assertTrue(response.body().string().startsWith("export default "+version+";"));
            }
            var conditional=source.newBuilder().header("If-None-Match",etag).build();
            try (var response=client.newCall(conditional).execute()) {
                assertEquals(304,response.code());
                assertEquals("private, no-cache",response.header("Cache-Control"));
                assertNull(response.header("Vary"));
                assertEquals("",response.body().string());
            }
            int updated=sourceVersion.incrementAndGet();
            try (var response=client.newCall(conditional).execute()) {
                assertEquals(200,response.code());
                assertEquals("private, no-cache",response.header("Cache-Control"));
                assertEquals("W/\"source-"+updated+"\"",response.header("ETag"));
                assertTrue(response.body().string().startsWith("export default "+updated+";"));
            }
        }
        assertEquals(6,sourceRequests.get());
        when(previews.authorize("session","binding","SESSION")).thenThrow(new BizException(ErrorCode.NO_PERMISSION));
        var revoked=request("/design-preview/binding/src/revalidate.tsx")
                .header("Sec-Fetch-Dest","script").header("Cookie","aw_design_preview=session")
                .header("If-None-Match","W/\"source-"+sourceVersion.get()+"\"").build();
        try (var response=client.newCall(revoked).execute()) {
            assertEquals(403,response.code());
            assertEquals("no-store",response.header("Cache-Control"));
        }
        assertEquals(6,sourceRequests.get(),"Revoked requests must not be validated by Vite");
    }
    @Test void sourceRevalidationDoesNotOverrideUpstreamPrivacyOrCacheApiResponses() throws Exception {
        String scope="/design-preview/binding/";
        for (String suffix:List.of("src/revalidate-deny-store.tsx","src/revalidate-cookie.tsx",
                "src/revalidate-no-etag.tsx","api/revalidate.tsx")) {
            var source=request(scope+suffix).header("Sec-Fetch-Dest","script")
                    .header("Cookie","aw_design_preview=session").build();
            try (var response=client.newCall(source).execute()) {
                assertEquals(200,response.code(),suffix);
                assertEquals("no-store",response.header("Cache-Control"),suffix);
            }
        }
        var conditional=request(scope+"src/revalidate-deny-store.tsx").header("Sec-Fetch-Dest","script")
                .header("Cookie","aw_design_preview=session").header("If-None-Match","W/\"source-1\"").build();
        try (var response=client.newCall(conditional).execute()) {
            assertEquals(304,response.code());
            assertEquals("no-store",response.header("Cache-Control"));
        }
    }
    @Test void largeAssetTraversesASeparateIngressPeerWithoutReopeningVite() throws Exception {
        cli("stop","--id","gateway-test");
        var peer=new PrdPreviewPeer();
        var edge=server("review-edge");
        var edgeRelay=new PrdPreviewRelay(properties,mock(ExecutorWsAuthenticator.class));
        var edgeGateway=new PrdReviewPreviewGateway(properties,previews,mock(PrdReviewPreviewDao.class),edgeRelay);
        var ownerCluster=mock(PrdPreviewCluster.class);
        var edgeCluster=mock(PrdPreviewCluster.class);
        var owner=new PrdPreviewCluster.Owner("owner",UUID.randomUUID().toString(),true);
        var published=new ConcurrentHashMap<String,PrdPreviewCluster.Owner>();
        when(ownerCluster.enabled()).thenReturn(true);
        when(ownerCluster.acquire("binding")).thenReturn(owner.withReady(false));
        when(ownerCluster.renew(eq("binding"),any(),any())).thenReturn(true);
        when(ownerCluster.owner("binding")).thenReturn(owner);
        when(ownerCluster.local(owner)).thenReturn(true);
        doAnswer(call->{published.put(call.getArgument(0),call.getArgument(1)); return null;}).when(ownerCluster).publishStream(any(),any());
        when(edgeCluster.enabled()).thenReturn(true);
        when(edgeCluster.owner("binding")).thenReturn(owner);
        when(edgeCluster.routeStream(any())).thenAnswer(call->published.get(call.getArgument(0)));
        when(edgeCluster.peer(owner)).thenReturn(java.net.URI.create("http://127.0.0.1:"+port));
        relay.configureCluster(ownerCluster,peer);
        gateway.configureCluster(ownerCluster,peer);
        edgeRelay.configureCluster(edgeCluster,peer);
        edgeGateway.configureCluster(edgeCluster,peer);
        try {
            var ctx=edge.addContext("",Files.createTempDirectory("review-edge-doc").toString());
            ctx.addServletContainerInitializer(new WsSci(),Set.of());
            Tomcat.addServlet(ctx,"default",new HttpServlet() {});
            ctx.addServletMappingDecoded("/","default");
            var control=relay.previewRelayFilter();
            control.setName("reviewEdgeControl");
            control.setUrlPatterns(List.of("/design-preview-relay/v1/control/*"));
            ctx.addServletContainerInitializer((classes,servlet)->{
                control.onStartup(servlet);
                edgeRelay.previewRelayFilter().onStartup(servlet);
                edgeGateway.designPreviewGatewayFilter().onStartup(servlet);
            },Set.of());
            edge.start();
            int edgePort=edge.getConnector().getLocalPort();
            startWorker(edgePort);
            var asset=new Request.Builder().url("http://127.0.0.1:"+edgePort+"/design-preview/binding/node_modules/.vite/deps/large.js?v=f4aedb6e")
                    .header("Sec-Fetch-Dest","script")
                    .header("Cookie","aw_design_preview=session").build();
            try (var response=client.newCall(asset).execute()) {
                assertEquals(200,response.code());
                assertEquals("aw-preview-asset-stream",response.header("Server-Timing"));
                assertEquals(List.of("private, max-age=60, immutable"),response.headers("Cache-Control"));
                assertEquals("a".repeat(LARGE_ASSET_SIZE),response.body().string());
                assertEquals(1,receivedLargeAsset.get());
                assertEquals(1,published.size());
            }
        } finally {
            cli("stop","--id","gateway-test");
            edgeGateway.shutdown();
            edgeRelay.shutdown();
            peer.shutdown();
            edge.stop(); edge.destroy();
        }
    }
    @Test void aViteModuleBurstWaitsForCapacityInsteadOfFailing() throws Exception {
        var connector=(org.apache.coyote.AbstractProtocol<?>)platform.getConnector().getProtocolHandler();
        connector.setMinSpareThreads(2); connector.setMaxThreads(8);
        int modules = PrdPreviewRelay.PER_BINDING + 8;
        var authorizations = new AtomicInteger();
        when(previews.authorize("session","binding","SESSION")).thenAnswer(call -> {
            authorizations.incrementAndGet();
            Thread.sleep(100);
            return new PrdReviewGrantDO();
        });
        try (var clients = Executors.newFixedThreadPool(modules)) {
            var responses = new ArrayList<Future<Integer>>();
            for (int module = 0; module < modules; module++) {
                var request = request("/design-preview/binding/burst/module-" + module + ".js")
                        .header("Cookie", "aw_design_preview=session").header("Sec-Fetch-Dest","script").build();
                responses.add(clients.submit(() -> {
                    try (var response = client.newCall(request).execute()) {
                        assertNotNull(response.body());
                        response.body().string();
                        return response.code();
                    }
                }));
            }
            try {
                assertTrue(firstBurst.await(10, TimeUnit.SECONDS), "The first wave filled the relay");
            } finally {
                releaseBurst.countDown();
            }
            for (var response : responses) assertEquals(200, response.get(20, TimeUnit.SECONDS));
            assertTrue(authorizations.get() < modules, "Concurrent modules reuse an authorization still in progress");
        }
    }
    @Test void laterAssetRequestRechecksRevokedSession() throws Exception {
        var asset=request("/design-preview/binding/small.js")
                .header("Sec-Fetch-Dest","script").header("Cookie","aw_design_preview=session").build();
        try (var authorized=client.newCall(asset).execute()) {
            assertEquals(200,authorized.code());
        }
        when(previews.authorize("session","binding","SESSION")).thenThrow(new BizException(ErrorCode.NO_PERMISSION));
        try (var revoked=client.newCall(asset).execute()) {
            assertEquals(403,revoked.code());
        }
    }
    @Test void servletRegistrationsPreservePreviewAuthenticationBeforePlatformLogin() throws Exception {
        try(var platformPage=client.newCall(request("/ordinary-platform-page").build()).execute();
            var denied=client.newCall(request("/design-preview/binding/").build()).execute();
            var preview=client.newCall(request("/design-preview/binding/").header("Cookie","aw_design_preview=session").build()).execute()) {
            assertEquals(302,platformPage.code()); assertEquals("/company-login",platformPage.header("Location"));
            assertEquals(403,denied.code()); assertEquals(200,preview.code());
        }
    }
    @Test void forwardingWorkerCrashRecoversWithoutAnotherStartOrAiMessage() throws Exception {
        var mapper=new com.fasterxml.jackson.databind.ObjectMapper();
        var file=home.resolve("state/sessions/gateway-test/state.json");
        var before=mapper.readTree(Files.readString(file));
        long worker=before.path("workerPid").asLong();
        assertTrue(worker>0); assertTrue(ProcessHandle.of(worker).orElseThrow().destroyForcibly());
        boolean recovered=false;
        for(int i=0;i<100 && !recovered;i++) {
            Thread.sleep(100);
            var current=mapper.readTree(Files.readString(file));
            if(current.path("workerPid").asLong()==worker || !"READY".equals(current.path("status").asText())) continue;
            try(var response=client.newCall(request("/design-preview/binding/recovered?q=1").header("Cookie","aw_design_preview=session").build()).execute()) {
                recovered=response.code()==200 && "demo:/design-preview/binding/recovered".equals(response.body().string());
            }
        }
        assertTrue(recovered,"The existing authenticated preview must recover without CLI start");
        var after=mapper.readTree(Files.readString(file));
        assertEquals(before.path("pid").asLong(),after.path("pid").asLong());
        assertEquals(1,after.path("restartCount").asInt());
    }
    @Test void twoExecutorsAndDesignSessionsNeverShareDestinationsOrPreviewCookies() throws Exception {
        var second=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        second.createContext("/",exchange->{ byte[] body=("second-executor:"+exchange.getRequestURI()).getBytes(); exchange.sendResponseHeaders(200,body.length); exchange.getResponseBody().write(body); exchange.close(); }); second.start();
        try {
            var file=home.resolve("second.json"); Files.writeString(file,"{\"relayUrl\":\"ws://localhost:"+port+"/design-preview-relay/v1/control/binding-two\",\"bindingId\":\"binding-two\",\"executorId\":31,\"auth\":{\"tokenEnv\":\"RELAY_TEST_SECOND_TOKEN\"}}");
            when(previews.authorize(any(),eq("binding-two"),eq("SESSION"))).thenAnswer(call->{ if(!"session-two".equals(call.getArgument(0))) throw PrdReviewService.unavailable(); return new PrdReviewGrantDO(); });
            assertTrue(cli("start","--id","gateway-two","--port",Integer.toString(second.getAddress().getPort()),"--config",file.toString()).contains("\"READY\""));
            for(int i=0;i<8;i++) {
                try(var first=client.newCall(request("/design-preview/binding/resource?q="+i).header("Cookie","aw_design_preview=session").build()).execute();
                    var other=client.newCall(request("/design-preview/binding-two/resource?q="+i).header("Cookie","aw_design_preview=session-two").build()).execute()) {
                    assertEquals("demo:/design-preview/binding/resource",first.body().string());
                    assertEquals("second-executor:/design-preview/binding-two/resource?q="+i,other.body().string());
                }
            }
            for(var route:List.of(List.of("binding","session-two"),List.of("binding-two","session"))) {
                try(var denied=client.newCall(request("/design-preview/"+route.get(0)+"/").header("Cookie","aw_design_preview="+route.get(1)).build()).execute()) { assertEquals(403,denied.code()); }
            }
            cli("stop","--id","gateway-two");
            try(var first=client.newCall(request("/design-preview/binding/still-alive").header("Cookie","aw_design_preview=session").build()).execute()) { assertEquals(200,first.code()); }
        } finally { second.stop(0); }
    }
    @Test void forwardsAllCommonMethodsAndBinaryBodiesWithoutChangingQuery() throws Exception {
        byte[] bytes=new byte[180_000]; new Random(12).nextBytes(bytes);
        for(String method:List.of("GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS")) {
            RequestBody body=Set.of("GET","HEAD").contains(method)?null:RequestBody.create(bytes,MediaType.get("application/octet-stream"));
            try(var response=client.newCall(request("/design-preview/binding/echo?q=%2F&x=1").header("Cookie","aw_design_preview=session").method(method,body).build()).execute()) {
                assertEquals(200,response.code()); assertEquals(method,response.header("X-Method")); assertEquals("q=%2F&x=1",response.header("X-Query"));
                assertArrayEquals(body==null?new byte[0]:bytes,response.body().bytes());
            }
        }
        try(var early=client.newCall(request("/design-preview/binding/early").header("Cookie","aw_design_preview=session").post(RequestBody.create(bytes,MediaType.get("application/octet-stream"))).build()).execute()) {
            assertEquals(401,early.code()); assertEquals("backend-denied",early.body().string());
        }
    }
    @Test void rejectsExecutorImpersonationAndOneTimeDataSocketTheft() throws Exception {
        for(var check:List.of(List.of("control/binding","wrong-token","30","401"),List.of("control/binding","fixture-executor-token","31","401"),
                List.of("control/binding","fixture-executor-token","30","409"),List.of("data/unknown","fixture-executor-token","30","403"))) {
            try(var response=client.newCall(request("/design-preview-relay/v1/"+check.get(0)).header("Upgrade","websocket").header("Connection","Upgrade")
                    .header("Sec-WebSocket-Version","13").header("Sec-WebSocket-Key","dGhlIHNhbXBsZSBub25jZQ==").header("Authorization","Bearer "+check.get(1)).header("X-Autowonder-Executor",check.get(2)).build()).execute()) {
                assertEquals(Integer.parseInt(check.get(3)),response.code());
            }
        }
    }
    @Test void managedControlFencesDelayedPortUpdates() throws Exception {
        var dao=mock(PrdDesignRuntimeDao.class);
        var row=new PrdDesignRuntimeDO();
        row.setWorkspaceId(1L); row.setConversationId(40L); row.setWorkitemId(12L);
        row.setExecutorId(30L); row.setSourceKey("abcdef123456");
        when(dao.find(1L,40L)).thenReturn(row);
        properties.setRuntimeDao(dao);
        var binding=properties.forRuntime(row);
        var portUpdates=mock(PrdDesignRuntimeService.class);
        when(portUpdates.activatePreview(eq(binding),anyInt())).thenReturn(true);
        org.springframework.test.util.ReflectionTestUtils.setField(relay,"runtimes",portUpdates);
        var connection=request("/design-preview-relay/v1/control/"+binding.getId())
                .header("Authorization","Bearer fixture-executor-token").header("X-Autowonder-Executor","30").build();

        var acknowledged=new LinkedBlockingQueue<String>();
        var retired=new CountDownLatch(1);
        var listener=new WebSocketListener() {
            @Override public void onMessage(okhttp3.WebSocket socket,String text) { acknowledged.offer(text); }
            @Override public void onClosing(okhttp3.WebSocket socket,int code,String reason) {
                socket.close(code,reason); retired.countDown();
            }
        };
        var old=client.newWebSocket(connection,listener);
        okhttp3.WebSocket current=null;
        try {
            assertTrue(old.send("{\"type\":\"health\",\"available\":true,\"port\":5173}"));
            assertNotNull(acknowledged.poll(5,TimeUnit.SECONDS));
            assertTrue(relay.available(binding));
            // Only a newly registered control can change the port.
            assertTrue(old.send("{\"type\":\"health\",\"available\":true,\"port\":5999}"));
            assertTrue(retired.await(5,TimeUnit.SECONDS));
            assertFalse(relay.available(binding));
            current=client.newWebSocket(connection,listener);
            assertTrue(current.send("{\"type\":\"health\",\"available\":true,\"port\":5175}"));
            assertNotNull(acknowledged.poll(5,TimeUnit.SECONDS));
            assertTrue(relay.available(binding));
            assertFalse(old.send("{\"type\":\"health\",\"available\":true,\"port\":5173}"));
            var ordered=inOrder(portUpdates);
            ordered.verify(portUpdates).activatePreview(binding,5173);
            ordered.verify(portUpdates).activatePreview(binding,5175);
            verifyNoMoreInteractions(portUpdates);
        } finally {
            old.cancel();
            if(current!=null) current.cancel();
        }
    }
    @Test void capacityAndIdleTimeoutReleaseOnlyTheirOwnStreams() throws Exception {
        var binding=relayBinding();
        var streams=new ArrayList<PrdPreviewRelay.Stream>();
        try {
            for(int i=0;i<PrdPreviewRelay.PER_BINDING;i++) streams.add(relay.open(binding,"http"));
            assertThrows(PrdPreviewRelay.CapacityException.class,()->relay.open(binding,"http"));
            var expired=streams.getFirst(); expired.awaitConnected(); expired.touched-=PrdPreviewRelay.IDLE_MS+1; relay.expire();
            assertTrue(expired.closed.get()); assertTrue(relay.available(binding));
            // Every replacement must be admitted immediately, even before the old
            // data socket's close event reaches the worker. HMR/other streams stay live.
            for(int attempt=0;attempt<64;attempt++) {
                try(var stream=relay.open(binding,"http")) { stream.awaitConnected(); }
            }
            assertTrue(relay.available(binding)); assertFalse(streams.get(1).closed.get());
        } finally { streams.forEach(PrdPreviewRelay.Stream::close); }
        for(int i=0;i<8;i++) { var cancelled=relay.open(binding,"http"); cancelled.close(); }
        assertTrue(relay.available(binding));
    }
    PrdReviewPreviewProperties.Binding relayBinding() {
        // Captured from the configured gateway rather than constructing a lookalike generation.
        return configuredBinding;
    }
    @Test void proxiesOnlyAuthorizedPreviewTrafficAndStripsPlatformCredentials() throws Exception {
        try(var response=client.newCall(request("/design-preview/binding/settings?q=1").build()).execute()) { assertEquals(403,response.code()); }
        try(var response=client.newCall(request("/design-preview/binding/settings?q=1").header("Cookie","aw_design_preview=session; platform_secret=do-not-forward").header("Authorization","Bearer do-not-forward").build()).execute()) {
            assertEquals(200,response.code()); assertEquals("demo:/design-preview/binding/settings",response.body().string()); assertNull(response.header("Set-Cookie")); assertEquals("no-store",response.header("Cache-Control"));
        }
        assertTrue(received.get().contains("GET /design-preview/binding/settings?q=1 host=localhost:"));
        assertTrue(received.get().contains("auth=null"));
        assertTrue(received.get().contains("cookie=null")); assertFalse(received.get().contains("do-not-forward"));
        try(var response=client.newCall(new Request.Builder().url("http://127.0.0.1:"+port+"/").header("Host","localhost:"+port).build()).execute()) { assertEquals(302,response.code()); assertEquals("/company-login",response.header("Location")); }
    }
    @Test void unknownOrRetiredPreviewPathsNeverFallBackToThePlatformApplication() throws Exception {
        for(String path:List.of("/design-preview/binding/%252e%252e/api", "/design-preview/binding/%2fapi")) {
            try(var response=client.newCall(request(path).header("Cookie","aw_design_preview=session").build()).execute()) { assertEquals(400,response.code()); }
        }
        for(String path:List.of("/design-preview/retired/", "/design-preview", "/design-preview/binding-other/api/auth/login",
                "/design-preview/binding/_autowonder/health")) {
            try(var response=client.newCall(request(path).build()).execute()) {
                assertEquals(404,response.code()); assertFalse(response.body().string().contains("platform"));
                assertEquals("no-store",response.header("Cache-Control"));
            }
        }
    }
    @Test void exchangesCodeOnlyFromPlatformAndSetsAnHttpOnlyHostCookie() throws Exception {
        for(String route:List.of("/../../api/auth/login", "/%252e%252e/api")) {
            try(var response=client.newCall(request("/design-preview/binding/_autowonder/enter").header("Origin",origin).post(new FormBody.Builder().add("code","code").add("route",route).build()).build()).execute()) { assertEquals(400,response.code()); }
        }
        try(var response=client.newCall(request("/design-preview/binding/_autowonder/enter").header("Origin","https://evil.example").post(new FormBody.Builder().add("code","code").build()).build()).execute()) { assertEquals(403,response.code()); }
        try(var response=client.newCall(request("/design-preview/binding/_autowonder/enter").header("Origin",origin).post(new FormBody.Builder().add("code","code").add("route","/settings?q=1#save").build()).build()).execute()) {
            assertEquals(303,response.code()); assertEquals("/design-preview/binding/settings?q=1#save",response.header("Location"));
            assertTrue(response.header("Set-Cookie").contains("Path=/design-preview/binding/; HttpOnly; SameSite=Strict")); assertFalse(response.header("Set-Cookie").contains("Domain="));
        }
    }
    @Test void renewalResetsCookieLifetimeWithoutNavigationAndRejectsForeignOrigins() throws Exception {
        when(previews.renew("fresh-code","session","binding")).thenReturn("session");
        try(var denied=client.newCall(request("/design-preview/binding/_autowonder/renew").header("Origin","https://evil.example")
                .header("Cookie","aw_design_preview=session").post(new FormBody.Builder().add("code","fresh-code").build()).build()).execute()) { assertEquals(403,denied.code()); }
        verify(previews,never()).renew(any(),any(),any());
        try(var renewed=client.newCall(request("/design-preview/binding/_autowonder/renew").header("Origin",origin)
                .header("Cookie","aw_design_preview=session").post(new FormBody.Builder().add("code","fresh-code").build()).build()).execute()) {
            assertEquals(204,renewed.code()); assertNull(renewed.header("Location"));
            assertTrue(renewed.header("Set-Cookie").contains("aw_design_preview=session;"));
            assertTrue(renewed.header("Set-Cookie").contains("Max-Age=900"));
        }
    }
    @Test void websocketPassesHmrMessagesAndIsClosedWhenShareIsRevoked() throws Exception {
        var receivedMessage=new ArrayBlockingQueue<String>(1); var closed=new CountDownLatch(1); var failure=new AtomicReference<Throwable>();
        var socket=client.newWebSocket(request("/design-preview/binding/hmr").header("Origin",origin).header("Sec-WebSocket-Protocol","vite-hmr").header("Cookie","aw_design_preview=session").build(),new WebSocketListener() {
            @Override public void onOpen(okhttp3.WebSocket socket,Response response) { socket.send("update"); }
            @Override public void onMessage(okhttp3.WebSocket socket,String text) { receivedMessage.offer(text); }
            @Override public void onClosing(okhttp3.WebSocket socket,int code,String reason) { socket.close(code,reason); closed.countDown(); }
            @Override public void onFailure(okhttp3.WebSocket socket,Throwable error,Response response) { failure.set(error); closed.countDown(); }
        });
        assertEquals("echo:update",receivedMessage.poll(8,TimeUnit.SECONDS),()->"WebSocket failure: "+failure.get());
        when(previews.authorize("session","binding","SESSION")).thenThrow(new BizException(ErrorCode.NO_PERMISSION));
        gateway.revokeSockets(); assertTrue(closed.await(5,TimeUnit.SECONDS)); socket.cancel();
    }
    @ServerEndpoint(value="/design-preview/binding/hmr",subprotocols={"vite-hmr"})
    public static class Echo { @OnMessage public String echo(String text) { return "echo:"+text; } }
}
