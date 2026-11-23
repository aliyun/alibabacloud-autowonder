package com.aliyun.autowonder.common.web;

import com.aliyun.autowonder.common.result.Result;
import com.aliyun.autowonder.configuration.ConversationEventReadConfiguration;
import com.aliyun.autowonder.conversation.AgentConversationTurnDO;
import com.aliyun.autowonder.conversation.AgentConversationTurnDao;
import com.aliyun.autowonder.conversation.ConversationEventContentSegmentDao;
import com.aliyun.autowonder.conversation.ConversationEventDisplayDO;
import com.aliyun.autowonder.conversation.ConversationEventDisplayDao;
import com.aliyun.autowonder.conversation.ConversationEventDisplayPreparationService;
import com.aliyun.autowonder.conversation.ConversationEventDisplayReadService;
import com.aliyun.autowonder.filter.ConversationEventReadAdmissionFilter;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.catalina.Context;
import org.apache.catalina.Wrapper;
import org.apache.catalina.startup.Tomcat;
import org.apache.tomcat.util.descriptor.web.FilterDef;
import org.apache.tomcat.util.descriptor.web.FilterMap;
import org.junit.jupiter.api.Test;

import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 真实嵌入 Tomcat 上的详情读入口门禁（plan 任务 4）。
 *
 * <p>真实性边界：容器、`ConversationEventReadAdmissionFilter`、`ConversationEventBoundedResponse`
 * 与 `ConversationEventDisplayReadService` 都是产品实现；授权 Filter 与登录会话不在本测试内，
 * 因此入口使用等价的只读 servlet 调用真实读服务。本测试只证明「慢读客户端不会占满 HTTP 线程、
 * 超限快速 429、看门狗在写出期限后终止并回收名额」，不作为业务 E2E 或产品页面验收。
 */
class ConversationEventReadTomcatGateTest {

    private static final int HTTP_THREADS = 8;
    private static final long DEADLINE_MS = 1_500L;
    private static final long GRACE_MS = 1_000L;
    private static final String DETAIL_PATH =
            "/api/platform/conversations/1/turns/2/event-summaries";

    @Test
    void nonReadingClientsKeepHealthResponsiveAndSlotsAreReclaimedAfterTheDeadline() throws Exception {
        Path base = Files.createTempDirectory("aw-tomcat-gate");
        Tomcat tomcat = new Tomcat();
        tomcat.setBaseDir(base.toString());
        var connector = tomcat.getConnector();
        connector.setPort(0);
        connector.setProperty("maxThreads", String.valueOf(HTTP_THREADS));
        connector.setProperty("minSpareThreads", "2");
        connector.setProperty("acceptCount", "100");
        connector.setProperty("socket.txBufSize", "4096");
        Context context = tomcat.addContext("", base.toString());

        var configuration = new ConversationEventReadConfiguration(
                HTTP_THREADS, true, DEADLINE_MS, GRACE_MS);
        FilterDef filterDef = new FilterDef();
        filterDef.setFilterName("conversation-event-admission");
        var admission = new ConversationEventReadAdmissionFilter(configuration);
        filterDef.setFilter(admission);
        context.addFilterDef(filterDef);
        FilterMap filterMap = new FilterMap();
        filterMap.setFilterName("conversation-event-admission");
        filterMap.addURLPattern("/*");
        context.addFilterMap(filterMap);

        var readService = readServiceWithLargePage();
        var writer = new ConversationEventBoundedResponse(new ObjectMapper(), configuration);
        Wrapper detail = Tomcat.addServlet(context, "detail", new HttpServlet() {
            @Override
            protected void doGet(HttpServletRequest request, HttpServletResponse response)
                    throws IOException {
                Object page = readService.readSummaries(1L, 2L, 2L, null, 100);
                if (request.getParameter("padding") != null) {
                    // 8MiB padding is far larger than any socket buffer so non-reading clients
                    // reliably create write backpressure; product budgets are enforced upstream.
                    writer.write(request, response, Result.ok(Map.of("page", page,
                            "padding", "x".repeat(8 * 1024 * 1024))));
                    return;
                }
                writer.write(request, response, Result.ok(page));
            }
        });
        detail.setAsyncSupported(true);
        context.addServletMappingDecoded(DETAIL_PATH, "detail");
        Wrapper health = Tomcat.addServlet(context, "health", new HttpServlet() {
            @Override
            protected void doGet(HttpServletRequest request, HttpServletResponse response)
                    throws IOException {
                response.setStatus(200);
                response.setContentType("text/plain");
                response.getOutputStream().write("ok".getBytes(StandardCharsets.UTF_8));
            }
        });
        health.setAsyncSupported(true);
        context.addServletMappingDecoded("/health", "health");

        tomcat.start();
        int port = connector.getLocalPort();
        List<Socket> stalled = new ArrayList<>();
        try {
            // 4 个不读客户端超过 G=2 的配额；多出的直接得到 429，不占用线程。
            for (int i = 0; i < 4; i++) {
                stalled.add(openNonReadingClient(port));
            }
            Thread.sleep(400L);

            for (int probe = 0; probe < 3; probe++) {
                long started = System.currentTimeMillis();
                assertEquals(200, statusOf("http://127.0.0.1:" + port + "/health"));
                assertTrue(System.currentTimeMillis() - started < 1_000L,
                        "health probe exceeded 1s under slow readers");
            }

            long started = System.currentTimeMillis();
            HttpURLConnection rejected = (HttpURLConnection) new URL(
                    "http://127.0.0.1:" + port + DETAIL_PATH).openConnection();
            rejected.setConnectTimeout(2_000);
            rejected.setReadTimeout(3_000);
            assertEquals(429, rejected.getResponseCode());
            assertEquals("3", rejected.getHeaderField("Retry-After"));
            assertTrue(System.currentTimeMillis() - started < 1_000L,
                    "over-limit detail request must fail fast instead of queueing");
            assertEquals(0, countThreadsStuckInSocketWrite());

            // 看门狗在 deadline 后完成异步响应；名额应在 deadline+grace 内归还。
            long retryUntil = System.currentTimeMillis() + DEADLINE_MS + GRACE_MS + 4_000L;
            int recovered = 0;
            while (System.currentTimeMillis() < retryUntil) {
                recovered = statusOf("http://127.0.0.1:" + port + DETAIL_PATH);
                if (recovered == 200) {
                    break;
                }
                Thread.sleep(100L);
            }
            assertEquals(200, recovered, "admission slots were not reclaimed after the deadline");
            assertEquals(0, countThreadsStuckInSocketWrite());

            // P1/P2 回归：连续读取摘要页必须字节一致、无重复尾段，且名额在响应完成后立即复用
            // （旧实现会把名额压到 grace timer，第三次起就 429）。
            ObjectMapper strict = new ObjectMapper()
                    .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
            for (int request = 0; request < 10; request++) {
                HttpURLConnection connection = (HttpURLConnection) new URL(
                        "http://127.0.0.1:" + port + DETAIL_PATH).openConnection();
                connection.setConnectTimeout(3_000);
                connection.setReadTimeout(10_000);
                assertEquals(200, connection.getResponseCode(),
                        "detail request " + request + " was rejected: slot not released on completion");
                byte[] bytes;
                try (InputStream body = connection.getInputStream()) {
                    bytes = body.readAllBytes();
                }
                assertEquals(connection.getContentLengthLong(), (long) bytes.length,
                        "Content-Length must equal the received byte count");
                JsonNode tree = strict.readTree(bytes);
                assertEquals("0", tree.get("code").asText(),
                        "response body must be exactly one valid Result without duplicated tail");
                connection.disconnect();
            }
            // P4 回归：正常读取全部完成后不得有任何 grace-timer 兜底释放。
            assertEquals(0, admission.graceTimerReleases());
        } finally {
            for (Socket socket : stalled) {
                try {
                    socket.close();
                } catch (IOException ignored) {
                    // test cleanup
                }
            }
            tomcat.stop();
            tomcat.destroy();
            deleteRecursively(base);
        }
    }

    private ConversationEventDisplayReadService readServiceWithLargePage() {
        var displayDao = mock(ConversationEventDisplayDao.class);
        var segmentDao = mock(ConversationEventContentSegmentDao.class);
        var turnDao = mock(AgentConversationTurnDao.class);
        var turn = new AgentConversationTurnDO();
        turn.setId(2L);
        when(turnDao.findByConversationTurn(1L, 2L, 2L)).thenReturn(turn);
        List<ConversationEventDisplayDO> rows = IntStream.rangeClosed(1, 100)
                .mapToObj(seq -> {
                    var row = new ConversationEventDisplayDO();
                    row.setId((long) seq);
                    row.setTenantId(1L);
                    row.setConversationId(2L);
                    row.setTurnId(2L);
                    row.setDispatchAttempt(1);
                    row.setEventSeq((long) seq);
                    row.setEventType("tool_result");
                    row.setStatus(ConversationEventDisplayDO.STATUS_READY);
                    row.setPublicationSeq((long) seq);
                    row.setSummary("x".repeat(2_000));
                    row.setDetailAvailable(0);
                    row.setTruncated(0);
                    row.setTotalSegments(1);
                    row.setContentLength(2_000L);
                    row.setGmtCreate(new java.util.Date());
                    return row;
                })
                .toList();
        when(displayDao.listPublishedAfter(1L, 2L, 2L, 0L, 101)).thenReturn(rows);
        when(displayDao.countByStatus(anyLong(), anyLong(), anyLong(), anyString()))
                .thenReturn(0);
        return new ConversationEventDisplayReadService(displayDao, segmentDao, turnDao,
                mock(com.aliyun.autowonder.conversation.ConversationEventDisplayRecovery.class));
    }

    private Socket openNonReadingClient(int port) throws IOException {
        Socket socket = new Socket();
        socket.setReceiveBufferSize(4_096);
        socket.connect(new InetSocketAddress("127.0.0.1", port), 2_000);
        String request = "GET " + DETAIL_PATH + "?padding=1 HTTP/1.1\r\n"
                + "Host: 127.0.0.1\r\nConnection: close\r\n\r\n";
        socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
        socket.getOutputStream().flush();
        return socket;
    }

    private int statusOf(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(3_000);
        connection.setReadTimeout(5_000);
        try {
            int status = connection.getResponseCode();
            try (InputStream body = status >= 400
                    ? connection.getErrorStream() : connection.getInputStream()) {
                if (body != null) {
                    body.transferTo(java.io.OutputStream.nullOutputStream());
                }
            }
            return status;
        } finally {
            connection.disconnect();
        }
    }

    private long countThreadsStuckInSocketWrite() {
        return Thread.getAllStackTraces().values().stream()
                .filter(stack -> stack.length > 0)
                .filter(stack -> java.util.Arrays.stream(stack).anyMatch(element ->
                        element.getMethodName().contains("socketWrite")))
                .count();
    }

    private void deleteRecursively(Path root) {
        try (var paths = Files.walk(root)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // best effort
                }
            });
        } catch (IOException ignored) {
            // best effort
        }
    }

}
