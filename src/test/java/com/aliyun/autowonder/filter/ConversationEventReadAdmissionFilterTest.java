package com.aliyun.autowonder.filter;

import com.aliyun.autowonder.configuration.ConversationEventReadConfiguration;
import com.aliyun.autowonder.context.AutoWonderContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import javax.servlet.FilterChain;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConversationEventReadAdmissionFilterTest {

    private ExecutorService pool;

    @AfterEach
    void tearDown() {
        if (pool != null) pool.shutdownNow();
        AutoWonderContext.destroy();
    }

    private ConversationEventReadConfiguration config(int threads) {
        return new ConversationEventReadConfiguration(threads, true, 20_000, 5_000);
    }

    private MockHttpServletRequest detailRequest() {
        var request = new MockHttpServletRequest("GET",
                "/api/workitems/10/clarification-conversations/20/turns/30/events/page");
        AutoWonderContext.get().setCurrentWorkspaceId(1L);
        AutoWonderContext.get().setUserId(2L);
        return request;
    }

    @Test
    void historyPageAndContentRoutesShareAdmissionAcrossAllConversationTypes() {
        var filter = new ConversationEventReadAdmissionFilter(config(8));
        for (String base : java.util.List.of("/api/platform/conversations/1",
                "/api/workitems/2/clarification-conversations/3", "/api/workitems/2/prd/conversation/3")) {
            assertFalse(filter.shouldNotFilter(new MockHttpServletRequest("GET", base + "/turns/page")));
            assertFalse(filter.shouldNotFilter(new MockHttpServletRequest("GET", base + "/turns/4/content")));
            if (!base.contains("/prd/")) {
                assertFalse(filter.shouldNotFilter(new MockHttpServletRequest("GET", base + "/turns/4/questions/page")));
                assertFalse(filter.shouldNotFilter(new MockHttpServletRequest("GET", base + "/turns/4/questions/5/content")));
            }
        }
        for (String path : java.util.List.of("/api/platform/conversations/1",
                "/api/workitems/2/clarification-conversations/3", "/api/workitems/2/prd/conversation"))
            assertFalse(filter.shouldNotFilter(new MockHttpServletRequest("GET", path)));
    }

    @Test
    void globalLimitFollowsOneQuarterOfHttpThreads() {
        assertEquals(2, config(8).getGlobalLimit());
        assertEquals(2, config(8).getPerUserLimit());
        assertEquals(2, config(8).getPerWorkspaceLimit());
        assertEquals(32, config(400).getGlobalLimit());
        assertEquals(2, config(400).getPerUserLimit());
        assertEquals(8, config(400).getPerWorkspaceLimit());
        assertEquals(1, config(4).getGlobalLimit());
    }

    @Test
    void refusesConfigurationsThatCannotLeaveANormalRequestThread() {
        assertThrows(IllegalStateException.class, () -> config(3));
    }

    @Test
    void exhaustedSlotsGetImmediate429WithRetryAfter() throws Exception {
        var filter = new ConversationEventReadAdmissionFilter(config(8));
        pool = Executors.newFixedThreadPool(2);
        CountDownLatch held = new CountDownLatch(2);
        CountDownLatch release = new CountDownLatch(1);
        FilterChain blocking = (request, response) -> {
            held.countDown();
            try {
                release.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        };
        for (int i = 0; i < 2; i++) {
            pool.submit(() -> {
                try {
                    filter.doFilter(detailRequest(), new MockHttpServletResponse(), blocking);
                } catch (Exception ignored) {
                    // assertion is on the third request
                }
            });
        }
        assertTrue(held.await(5, TimeUnit.SECONDS));

        var rejected = new MockHttpServletResponse();
        AtomicInteger reached = new AtomicInteger();
        filter.doFilter(detailRequest(), rejected, (request, response) -> reached.incrementAndGet());

        assertEquals(0, reached.get());
        assertEquals(429, rejected.getStatus());
        assertEquals("3", rejected.getHeader("Retry-After"));
        assertTrue(rejected.getContentAsString().contains("10429"));
        assertTrue(rejected.getContentAsByteArray().length <= 8192);

        release.countDown();
        pool.shutdown();
        assertTrue(pool.awaitTermination(5, TimeUnit.SECONDS));

        var afterRelease = new MockHttpServletResponse();
        filter.doFilter(detailRequest(), afterRelease, (request, response) -> reached.incrementAndGet());
        assertEquals(1, reached.get());
        assertEquals(200, afterRelease.getStatus());
    }

    @Test
    void unrelatedPathsAndNonGetMethodsAreNotAdmitted() throws Exception {
        var filter = new ConversationEventReadAdmissionFilter(config(4));
        AtomicInteger reached = new AtomicInteger();

        var other = new MockHttpServletRequest("GET", "/api/workitems/10");
        filter.doFilter(other, new MockHttpServletResponse(), (request, response) -> reached.incrementAndGet());

        var scheduled = new MockHttpServletRequest("GET", "/api/scheduled-task-runs/1/events");
        filter.doFilter(scheduled, new MockHttpServletResponse(), (request, response) -> reached.incrementAndGet());

        var post = new MockHttpServletRequest("POST",
                "/api/workitems/10/clarification-conversations/20/turns/30/events");
        filter.doFilter(post, new MockHttpServletResponse(), (request, response) -> reached.incrementAndGet());

        assertEquals(3, reached.get());
    }

    @Test
    void disabledConfigurationAdmitsEverything() throws Exception {
        var configuration = new ConversationEventReadConfiguration(3, false, 20_000, 5_000);
        var filter = new ConversationEventReadAdmissionFilter(configuration);
        AtomicInteger reached = new AtomicInteger();

        filter.doFilter(detailRequest(), new MockHttpServletResponse(),
                (request, response) -> reached.incrementAndGet());

        assertEquals(1, reached.get());
        assertEquals(3, configuration.getHttpThreads());
        assertEquals(1, configuration.getGlobalLimit());
        assertFalse(configuration.isAdmissionEnabled());
    }

    @Test
    void missingIdentityStillAcquiresAnAnonymousSlot() throws Exception {
        AutoWonderContext.destroy();
        var filter = new ConversationEventReadAdmissionFilter(config(4));
        AtomicInteger reached = new AtomicInteger();
        var request = new MockHttpServletRequest("GET",
                "/api/platform/conversations/1/turns/2/event-summaries");

        filter.doFilter(request, new MockHttpServletResponse(),
                (chainRequest, chainResponse) -> reached.incrementAndGet());

        assertEquals(1, reached.get());
    }

    /** P4：正常异步完成并释放名额后，安全定时器不得再 WARN/释放。 */
    @Test
    void normalAsyncCompletionNeverFallsBackToTheGraceTimer() throws Exception {
        var filter = new ConversationEventReadAdmissionFilter(
                new ConversationEventReadConfiguration(8, true, 200, 200));
        var request = new MockHttpServletRequest("GET",
                "/api/platform/conversations/1/turns/2/event-summaries");
        request.setAsyncSupported(true);
        AutoWonderContext.get().setCurrentWorkspaceId(1L);
        AutoWonderContext.get().setUserId(2L);

        filter.doFilter(request, new MockHttpServletResponse(), (req, res) -> req.startAsync());
        var slot = (ConversationEventReadAdmissionFilter.Slot)
                request.getAttribute(ConversationEventReadAdmissionFilter.SLOT_ATTRIBUTE);
        assertTrue(slot != null && !slot.isReleased());
        slot.release(); // 模拟写出行 onComplete

        Thread.sleep(1_300L);

        assertEquals(0, filter.graceTimerReleases());
        assertTrue(slot.isReleased());
    }

    /** P4：真正卡住（未释放）的名额仍由安全定时器兜底释放且只记一次。 */
    @Test
    void overdueSlotIsStillReleasedByTheGraceTimerOnce() throws Exception {
        var filter = new ConversationEventReadAdmissionFilter(
                new ConversationEventReadConfiguration(8, true, 200, 200));
        var request = new MockHttpServletRequest("GET",
                "/api/platform/conversations/1/turns/2/event-summaries");
        request.setAsyncSupported(true);
        AutoWonderContext.get().setCurrentWorkspaceId(1L);
        AutoWonderContext.get().setUserId(2L);

        filter.doFilter(request, new MockHttpServletResponse(), (req, res) -> req.startAsync());
        var slot = (ConversationEventReadAdmissionFilter.Slot)
                request.getAttribute(ConversationEventReadAdmissionFilter.SLOT_ATTRIBUTE);
        assertTrue(slot != null && !slot.isReleased());

        Thread.sleep(1_300L);

        assertEquals(1, filter.graceTimerReleases());
        assertTrue(slot.isReleased());
    }
}
