package com.aliyun.autowonder.prd;

import okhttp3.Dispatcher;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocketListener;
import okio.BufferedSink;
import okio.ByteString;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.server.support.DefaultHandshakeHandler;
import org.springframework.web.socket.server.support.WebSocketHttpRequestHandler;

import javax.annotation.PreDestroy;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.Proxy;
import java.net.URI;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;

/** One hop to a configured platform peer, through the same authorized preview endpoints. */
@Component
class PrdPreviewPeer {
    private static final long MAX_BODY = 32L * 1024 * 1024;
    private static final Set<String> SKIP = Set.of("host", "authorization", "cookie", "set-cookie", "forwarded",
            "connection", "keep-alive", "transfer-encoding", "content-length", "upgrade", "te", "trailer",
            "proxy-authorization", "proxy-authenticate");
    private static final Set<String> NO_BODY = Set.of("GET", "HEAD");
    // Leave servlet threads for executor data handshakes, including at maximum local relay occupancy.
    private static final int BROWSER_FORWARDS = 48;
    private final Semaphore browserCapacity = new Semaphore(BROWSER_FORWARDS, true);
    private final Semaphore waitingBrowserRequests = new Semaphore(BROWSER_FORWARDS);
    private final Semaphore dataCapacity = new Semaphore(PrdPreviewRelay.TOTAL);
    private final OkHttpClient client = new OkHttpClient.Builder()
            .dispatcher(dispatcher()).proxy(Proxy.NO_PROXY).followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .connectTimeout(3, TimeUnit.SECONDS).readTimeout(35, TimeUnit.SECONDS)
            .writeTimeout(5, TimeUnit.SECONDS).build();

    private static Dispatcher dispatcher() {
        var dispatcher = new Dispatcher();
        dispatcher.setMaxRequests(BROWSER_FORWARDS + PrdPreviewRelay.TOTAL);
        return dispatcher;
    }

    void browser(URI peer, PrdPreviewCluster.Owner owner, HttpServletRequest request,
                 HttpServletResponse response, String token) throws Exception {
        boolean upgrade = "websocket".equalsIgnoreCase(request.getHeader("Upgrade"));
        var outbound = outbound(peer, owner, request)
                .header("Cookie", PrdReviewPreviewGateway.COOKIE + "=" + token);
        copyBrowserHeaders(request, outbound);
        if (upgrade) {
            String protocol = request.getHeader("Sec-WebSocket-Protocol");
            if (protocol != null) outbound.header("Sec-WebSocket-Protocol", protocol);
            socket(outbound.build(), request, response, browserCapacity, protocol);
            return;
        }
        if (!browserCapacity.tryAcquire(0, TimeUnit.SECONDS)) {
            if (!waitingBrowserRequests.tryAcquire()) throw new PrdPreviewRelay.CapacityException();
            try {
                if (!browserCapacity.tryAcquire(PrdPreviewRelay.ADMISSION_WAIT_SECONDS, TimeUnit.SECONDS)) {
                    throw new PrdPreviewRelay.CapacityException();
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw interrupted;
            } finally {
                waitingBrowserRequests.release();
            }
        }
        try {
            var wire = outbound.method(request.getMethod(), NO_BODY.contains(request.getMethod()) ? null : requestBody(request));
            try (Response remote = client.newCall(wire.build()).execute()) {
                response.setStatus(remote.code());
                var skip = hopHeaders(remote.header("Connection"));
                for (int index = 0; index < remote.headers().size(); index++) {
                    String name = remote.headers().name(index);
                    if ("Cache-Control".equalsIgnoreCase(name) && copy(name, skip)) {
                        response.setHeader(name, remote.headers().value(index));
                    } else if (copy(name, skip) || "X-Autowonder-Preview-Error".equalsIgnoreCase(name)) {
                        response.addHeader(name, remote.headers().value(index));
                    }
                }
                if (remote.body() == null || "HEAD".equals(request.getMethod())) return;
                try (var input = remote.body().byteStream()) {
                    byte[] buffer = new byte[PrdPreviewRelay.CHUNK];
                    for (int count; (count = input.read(buffer)) != -1; ) {
                        response.getOutputStream().write(buffer, 0, count);
                        response.flushBuffer();
                    }
                }
            }
        } catch (BodyTooLarge oversized) {
            if (!response.isCommitted()) response.setStatus(413);
        } finally {
            browserCapacity.release();
        }
    }

    void data(URI peer, PrdPreviewCluster.Owner owner, HttpServletRequest request,
              HttpServletResponse response, String credential) throws Exception {
        var outbound = outbound(peer, owner, request).header("Authorization", "Bearer " + credential);
        socket(outbound.build(), request, response, dataCapacity, null);
    }

    private static Request.Builder outbound(URI peer, PrdPreviewCluster.Owner owner, HttpServletRequest request) {
        // Both callers have matched an exact, validated preview path before constructing this URL.
        String query = request.getQueryString();
        return new Request.Builder().url(peer + request.getRequestURI() + (query == null ? "" : "?" + query))
                .header(PrdPreviewCluster.HANDOFF, owner.generation()).header("Accept-Encoding", "identity");
    }

    private static void copyBrowserHeaders(HttpServletRequest request, Request.Builder outbound) {
        var skip = hopHeaders(request.getHeader("Connection"));
        for (Enumeration<String> names = request.getHeaderNames(); names.hasMoreElements(); ) {
            String name = names.nextElement();
            if (copy(name, skip) && !"Accept-Encoding".equalsIgnoreCase(name)) {
                for (var values = request.getHeaders(name); values.hasMoreElements(); ) {
                    outbound.addHeader(name, values.nextElement());
                }
            }
        }
    }

    private static Set<String> hopHeaders(String connection) {
        var result = new HashSet<>(SKIP);
        if (connection != null) {
            for (String name : connection.split(",")) result.add(name.trim().toLowerCase(Locale.ROOT));
        }
        return result;
    }

    private static boolean copy(String name, Set<String> skip) {
        String lower = name.toLowerCase(Locale.ROOT);
        return !skip.contains(lower) && !lower.startsWith("x-autowonder-")
                && !lower.startsWith("x-forwarded-") && !lower.startsWith("sec-websocket-");
    }

    private static RequestBody requestBody(HttpServletRequest request) {
        long length = request.getContentLengthLong();
        return new RequestBody() {
            @Override public okhttp3.MediaType contentType() { return null; }
            @Override public long contentLength() { return length; }
            @Override public boolean isOneShot() { return true; }
            @Override public void writeTo(BufferedSink sink) throws IOException {
                var input = request.getInputStream();
                byte[] buffer = new byte[PrdPreviewRelay.CHUNK];
                long total = 0;
                for (int count; (count = input.read(buffer)) != -1; ) {
                    total += count;
                    if (total > MAX_BODY) throw new BodyTooLarge();
                    sink.write(buffer, 0, count);
                }
            }
        };
    }

    private void socket(Request outbound, HttpServletRequest request, HttpServletResponse response,
                        Semaphore capacity, String protocol) throws Exception {
        if (!capacity.tryAcquire()) throw new PrdPreviewRelay.CapacityException();
        var bridge = new SocketBridge(capacity, capacity == dataCapacity);
        try {
            bridge.upstream = client.newWebSocket(outbound, bridge.listener);
            if (bridge.closed.get()) bridge.upstream.cancel();
            int status = bridge.handshake.get(5, TimeUnit.SECONDS);
            if (status != 101) {
                response.setStatus(status);
                return;
            }
            var handler = new DefaultHandshakeHandler() {
                @Override protected String selectProtocol(List<String> requested, WebSocketHandler handler) {
                    return protocol != null && requested.contains(protocol) ? protocol : null;
                }
            };
            new WebSocketHttpRequestHandler(bridge, handler).handleRequest(request, response);
        } catch (TimeoutException timeout) {
            response.setStatus(504);
        } finally {
            if (response.getStatus() != 101) bridge.close();
        }
    }

    private static final class BodyTooLarge extends IOException {}

    private static final class SocketBridge extends AbstractWebSocketHandler {
        private static final int MAX_QUEUE = 2 * PrdPreviewRelay.FRAME;
        private final Semaphore capacity;
        private final boolean backpressure;
        private final AtomicBoolean closed = new AtomicBoolean();
        private final CompletableFuture<Integer> handshake = new CompletableFuture<>();
        private final CompletableFuture<WebSocketSession> downstream = new CompletableFuture<>();
        private volatile okhttp3.WebSocket upstream;

        SocketBridge(Semaphore capacity, boolean backpressure) {
            this.capacity = capacity;
            this.backpressure = backpressure;
        }

        private final WebSocketListener listener = new WebSocketListener() {
            @Override public void onOpen(okhttp3.WebSocket socket, Response response) { handshake.complete(101); }
            @Override public void onMessage(okhttp3.WebSocket socket, String text) { deliver(new TextMessage(text)); }
            @Override public void onMessage(okhttp3.WebSocket socket, ByteString bytes) {
                deliver(new BinaryMessage(bytes.asByteBuffer()));
            }
            @Override public void onClosing(okhttp3.WebSocket socket, int code, String reason) { close(); }
            @Override public void onFailure(okhttp3.WebSocket socket, Throwable error, Response response) {
                int code = response == null ? 502 : response.code();
                handshake.complete(code >= 400 && code <= 599 ? code : 502);
                close();
            }
        };

        @Override public void afterConnectionEstablished(WebSocketSession session) throws IOException {
            session.setTextMessageSizeLimit(PrdPreviewRelay.FRAME);
            session.setBinaryMessageSizeLimit(PrdPreviewRelay.CHUNK);
            if (!downstream.complete(new ConcurrentWebSocketSessionDecorator(session, 5000, MAX_QUEUE))) {
                session.close(CloseStatus.GOING_AWAY);
            }
        }

        private void deliver(WebSocketMessage<?> message) {
            int limit = message instanceof BinaryMessage ? PrdPreviewRelay.CHUNK : PrdPreviewRelay.FRAME;
            try {
                if (message.getPayloadLength() > limit) { close(); return; }
                downstream.get(5, TimeUnit.SECONDS).sendMessage(message);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                close();
            } catch (Exception failed) {
                close();
            }
        }

        @Override protected void handleTextMessage(WebSocketSession session, TextMessage message) {
            if (!writable(message.getPayloadLength()) || !upstream.send(message.getPayload())) close();
        }
        @Override protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) {
            if (!writable(message.getPayloadLength()) || !upstream.send(ByteString.of(message.getPayload()))) close();
        }
        private boolean writable(int bytes) {
            // OkHttp sends asynchronously. A full queue on an independent data socket
            // pauses reads until the peer drains it, with the same bounded write timeout.
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (!closed.get() && upstream.queueSize() + bytes > MAX_QUEUE) {
                if (!backpressure || System.nanoTime() >= deadline) return false;
                try { TimeUnit.MILLISECONDS.sleep(2); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); return false; }
            }
            return !closed.get();
        }
        @Override public void afterConnectionClosed(WebSocketSession session, CloseStatus status) { close(); }
        @Override public void handleTransportError(WebSocketSession session, Throwable error) { close(); }

        void close() {
            if (!closed.compareAndSet(false, true)) return;
            capacity.release();
            if (upstream != null) upstream.cancel();
            if (!downstream.completeExceptionally(new IOException("Preview peer disconnected"))
                    && !downstream.isCompletedExceptionally()) {
                var session = downstream.getNow(null);
                if (session != null) try { session.close(CloseStatus.GOING_AWAY); } catch (IOException ignored) {}
            }
        }
    }

    @PreDestroy void shutdown() {
        client.dispatcher().cancelAll();
        client.dispatcher().executorService().shutdownNow();
        client.connectionPool().evictAll();
    }
}
