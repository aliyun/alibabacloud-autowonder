package com.aliyun.autowonder.common.web;

import com.aliyun.autowonder.common.result.Result;
import com.aliyun.autowonder.configuration.ConversationEventReadConfiguration;
import com.aliyun.autowonder.filter.ConversationEventReadAdmissionFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import javax.servlet.AsyncContext;
import javax.servlet.AsyncListener;
import javax.servlet.ServletOutputStream;
import javax.servlet.WriteListener;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ConversationEventBoundedResponseTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final ConversationEventBoundedResponse response = new ConversationEventBoundedResponse(
            objectMapper, new ConversationEventReadConfiguration(8, true, 1000, 5000));

    private ConversationEventReadAdmissionFilter.Slot realSlot(AtomicInteger releases) throws Exception {
        var constructor = ConversationEventReadAdmissionFilter.Slot.class
                .getDeclaredConstructor(Runnable.class);
        constructor.setAccessible(true);
        return constructor.newInstance((Runnable) releases::incrementAndGet);
    }

    @Test
    void writesTheSerializedResultWhenAsyncIsUnavailable() throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/workitems/1/x/event-summaries");
        request.setAsyncSupported(false);
        var servletResponse = new MockHttpServletResponse();

        response.write(request, servletResponse, Result.ok(Map.of("items", 2)));

        assertEquals(200, servletResponse.getStatus());
        assertTrue(servletResponse.getContentType().contains("application/json"));
        assertTrue(servletResponse.getContentAsString().contains("\"items\":2"));
        assertEquals("no-store", servletResponse.getHeader("Cache-Control"));
    }

    @Test
    void asyncWriteUsesNonBlockingOutputAndReleasesTheSlot() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse servletResponse = mock(HttpServletResponse.class);
        AsyncContext async = mock(AsyncContext.class);
        ServletOutputStream out = mock(ServletOutputStream.class);
        var releases = new AtomicInteger();
        var slot = realSlot(releases);
        when(request.isAsyncSupported()).thenReturn(true);
        when(request.startAsync()).thenReturn(async);
        when(request.getAttribute(ConversationEventReadAdmissionFilter.SLOT_ATTRIBUTE)).thenReturn(slot);
        when(servletResponse.getOutputStream()).thenReturn(out);
        when(out.isReady()).thenReturn(true, true);

        response.write(request, servletResponse, Result.ok(Map.of("items", 1)));

        var writeListener = ArgumentCaptor.forClass(WriteListener.class);
        var asyncListener = ArgumentCaptor.forClass(AsyncListener.class);
        verify(out).setWriteListener(writeListener.capture());
        verify(async).addListener(asyncListener.capture());

        writeListener.getValue().onWritePossible();
        verify(out).write(any(byte[].class), anyInt(), anyInt());
        verify(async, atLeastOnce()).complete();

        asyncListener.getValue().onComplete(mock(javax.servlet.AsyncEvent.class));
        assertTrue(releases.get() >= 1);
    }

    @Test
    void timeoutCallbackCompletesAndReleases() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse servletResponse = mock(HttpServletResponse.class);
        AsyncContext async = mock(AsyncContext.class);
        ServletOutputStream out = mock(ServletOutputStream.class);
        var releases = new AtomicInteger();
        when(request.isAsyncSupported()).thenReturn(true);
        when(request.startAsync()).thenReturn(async);
        when(request.getAttribute(ConversationEventReadAdmissionFilter.SLOT_ATTRIBUTE))
                .thenReturn(realSlot(releases));
        when(servletResponse.getOutputStream()).thenReturn(out);
        when(out.isReady()).thenReturn(false);

        response.write(request, servletResponse, Result.ok(Map.of("items", 1)));

        var asyncListener = ArgumentCaptor.forClass(AsyncListener.class);
        verify(async).addListener(asyncListener.capture());
        asyncListener.getValue().onTimeout(mock(javax.servlet.AsyncEvent.class));

        verify(async, atLeastOnce()).complete();
        assertTrue(releases.get() >= 1);
    }

    @Test
    void writeFailureCompletesWithoutThrowing() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse servletResponse = mock(HttpServletResponse.class);
        AsyncContext async = mock(AsyncContext.class);
        ServletOutputStream out = mock(ServletOutputStream.class);
        var releases = new AtomicInteger();
        when(request.isAsyncSupported()).thenReturn(true);
        when(request.startAsync()).thenReturn(async);
        when(request.getAttribute(ConversationEventReadAdmissionFilter.SLOT_ATTRIBUTE))
                .thenReturn(realSlot(releases));
        when(servletResponse.getOutputStream()).thenReturn(out);
        when(out.isReady()).thenReturn(true);
        doThrow(new IOException("client gone")).when(out).write(any(byte[].class), anyInt(), anyInt());

        response.write(request, servletResponse, Result.ok(Map.of("items", 1)));

        var writeListener = ArgumentCaptor.forClass(WriteListener.class);
        verify(out).setWriteListener(writeListener.capture());
        writeListener.getValue().onWritePossible();
        writeListener.getValue().onError(new RuntimeException("boom"));

        verify(async, atLeastOnce()).complete();
    }

    @Test
    void missingSlotAndAlreadyCompletedAsyncAreTolerated() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse servletResponse = mock(HttpServletResponse.class);
        AsyncContext async = mock(AsyncContext.class);
        ServletOutputStream out = mock(ServletOutputStream.class);
        when(request.isAsyncSupported()).thenReturn(true);
        when(request.startAsync()).thenReturn(async);
        when(servletResponse.getOutputStream()).thenReturn(out);
        when(out.isReady()).thenReturn(true);
        doThrow(new IllegalStateException("already completed")).when(async).complete();

        response.write(request, servletResponse, Result.ok(Map.of("items", 1)));

        var writeListener = ArgumentCaptor.forClass(WriteListener.class);
        verify(out).setWriteListener(writeListener.capture());
        writeListener.getValue().onWritePossible();

        verify(async, atLeastOnce()).complete();
    }

    @Test
    void deadlineCompletesAStalledWrite() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse servletResponse = mock(HttpServletResponse.class);
        AsyncContext async = mock(AsyncContext.class);
        ServletOutputStream out = mock(ServletOutputStream.class);
        var releases = new AtomicInteger();
        when(request.isAsyncSupported()).thenReturn(true);
        when(request.startAsync()).thenReturn(async);
        when(request.getAttribute(ConversationEventReadAdmissionFilter.SLOT_ATTRIBUTE))
                .thenReturn(realSlot(releases));
        when(servletResponse.getOutputStream()).thenReturn(out);
        when(out.isReady()).thenReturn(false);

        response.write(request, servletResponse, Result.ok(Map.of("items", 1)));

        long deadline = System.currentTimeMillis() + 3000;
        while (System.currentTimeMillis() < deadline && releases.get() == 0) {
            Thread.sleep(50);
        }
        assertTrue(releases.get() >= 1);
        verify(async, atLeastOnce()).complete();
    }

    /** QA-B4：异步 onError（客户端中断/异常）与 onComplete 并发时名额只释放一次。 */
    @Test
    void asyncErrorReleasesTheSlotExactlyOnce() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse servletResponse = mock(HttpServletResponse.class);
        AsyncContext async = mock(AsyncContext.class);
        ServletOutputStream out = mock(ServletOutputStream.class);
        var releases = new AtomicInteger();
        when(request.isAsyncSupported()).thenReturn(true);
        when(request.startAsync()).thenReturn(async);
        when(request.getAttribute(ConversationEventReadAdmissionFilter.SLOT_ATTRIBUTE))
                .thenReturn(realSlot(releases));
        when(servletResponse.getOutputStream()).thenReturn(out);
        when(out.isReady()).thenReturn(false);

        response.write(request, servletResponse, Result.ok(Map.of("items", 1)));

        var asyncListener = ArgumentCaptor.forClass(AsyncListener.class);
        verify(async).addListener(asyncListener.capture());
        asyncListener.getValue().onError(mock(javax.servlet.AsyncEvent.class));
        asyncListener.getValue().onComplete(mock(javax.servlet.AsyncEvent.class));

        assertEquals(1, releases.get());
    }

    /** P1：整个响应只在容器缓冲内写一次，避免跨缓冲写与刷出交错。 */
    @Test
    void writesTheWholeBodyInOneBoundedWrite() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse servletResponse = mock(HttpServletResponse.class);
        AsyncContext async = mock(AsyncContext.class);
        ServletOutputStream out = mock(ServletOutputStream.class);
        when(request.isAsyncSupported()).thenReturn(true);
        when(request.startAsync()).thenReturn(async);
        when(servletResponse.getOutputStream()).thenReturn(out);
        when(servletResponse.getBufferSize()).thenReturn(8_192);
        when(out.isReady()).thenReturn(true);
        String padding = "x".repeat(20_000);

        response.write(request, servletResponse, Result.ok(Map.of("padding", padding)));

        var writeListener = ArgumentCaptor.forClass(WriteListener.class);
        verify(out).setWriteListener(writeListener.capture());
        writeListener.getValue().onWritePossible();

        var written = ArgumentCaptor.forClass(byte[].class);
        verify(out).write(written.capture(), org.mockito.ArgumentMatchers.eq(0),
                org.mockito.ArgumentMatchers.anyInt());
        var bufferSize = ArgumentCaptor.forClass(Integer.class);
        verify(servletResponse).setBufferSize(bufferSize.capture());
        assertTrue(bufferSize.getValue() >= written.getValue().length);
        verify(out, org.mockito.Mockito.times(1))
                .write(org.mockito.ArgumentMatchers.any(byte[].class),
                        org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyInt());
    }

    /** P1：容器回调重入时不得把同一段字节写两次。 */
    @Test
    void reentrantWriteCallbacksDoNotDuplicateBytes() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse servletResponse = mock(HttpServletResponse.class);
        AsyncContext async = mock(AsyncContext.class);
        ServletOutputStream out = mock(ServletOutputStream.class);
        when(request.isAsyncSupported()).thenReturn(true);
        when(request.startAsync()).thenReturn(async);
        when(servletResponse.getOutputStream()).thenReturn(out);
        when(servletResponse.getBufferSize()).thenReturn(8_192);
        when(out.isReady()).thenReturn(true);
        java.util.List<int[]> written = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        org.mockito.Mockito.doAnswer(invocation -> {
            entered.countDown();
            release.await(2, java.util.concurrent.TimeUnit.SECONDS);
            written.add(new int[]{((Integer) invocation.getArgument(1)).intValue(),
                    ((Integer) invocation.getArgument(2)).intValue()});
            return null;
        }).when(out).write(org.mockito.ArgumentMatchers.any(byte[].class),
                org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyInt());

        response.write(request, servletResponse, Result.ok(Map.of("padding", "y".repeat(20_000))));
        var writeListener = ArgumentCaptor.forClass(WriteListener.class);
        verify(out).setWriteListener(writeListener.capture());

        Runnable writeOnce = () -> {
            try {
                writeListener.getValue().onWritePossible();
            } catch (java.io.IOException e) {
                throw new RuntimeException(e);
            }
        };
        var first = new Thread(writeOnce);
        first.start();
        assertTrue(entered.await(2, java.util.concurrent.TimeUnit.SECONDS));
        var second = new Thread(writeOnce);
        second.start();
        release.countDown();
        first.join(2_000L);
        second.join(2_000L);

        long total = written.stream().mapToLong(range -> range[1]).sum();
        assertEquals(1, written.size());
        assertEquals(0, written.get(0)[0]);
        assertTrue(total > 0);
    }

    /** P2：onComplete 缺失时由短路兜底释放名额，不再等 grace timer。 */
    @Test
    void completionFallbackReleasesTheSlotWhenOnCompleteNeverArrives() throws Exception {
        var configuration = new ConversationEventReadConfiguration(8, true, 1_000, 5_000);
        var fastFallback = new ConversationEventBoundedResponse(objectMapper, configuration);
        fastFallback.setCompletionFallbackMs(50L);
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse servletResponse = mock(HttpServletResponse.class);
        AsyncContext async = mock(AsyncContext.class);
        ServletOutputStream out = mock(ServletOutputStream.class);
        var releases = new AtomicInteger();
        when(request.isAsyncSupported()).thenReturn(true);
        when(request.startAsync()).thenReturn(async);
        when(request.getAttribute(ConversationEventReadAdmissionFilter.SLOT_ATTRIBUTE))
                .thenReturn(realSlot(releases));
        when(servletResponse.getOutputStream()).thenReturn(out);
        when(servletResponse.getBufferSize()).thenReturn(8_192);
        when(out.isReady()).thenReturn(true);

        fastFallback.write(request, servletResponse, Result.ok(Map.of("items", 1)));
        var writeListener = ArgumentCaptor.forClass(WriteListener.class);
        verify(out).setWriteListener(writeListener.capture());
        writeListener.getValue().onWritePossible();

        long timeout = System.currentTimeMillis() + 2_000L;
        while (System.currentTimeMillis() < timeout && releases.get() == 0) {
            Thread.sleep(20L);
        }
        assertEquals(1, releases.get());
    }

    /** P4：写完成时取消准入安全定时器，正常请求不再留下 grace-timer WARN。 */
    @Test
    void finishCancelsTheAdmissionSafetyTimer() throws Exception {
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpServletResponse servletResponse = mock(HttpServletResponse.class);
        AsyncContext async = mock(AsyncContext.class);
        ServletOutputStream out = mock(ServletOutputStream.class);
        ScheduledFuture<?> safety = mock(ScheduledFuture.class);
        when(request.isAsyncSupported()).thenReturn(true);
        when(request.startAsync()).thenReturn(async);
        when(request.getAttribute(ConversationEventReadAdmissionFilter.SAFETY_ATTRIBUTE))
                .thenReturn(safety);
        when(servletResponse.getOutputStream()).thenReturn(out);
        when(servletResponse.getBufferSize()).thenReturn(8_192);
        when(out.isReady()).thenReturn(true);

        response.write(request, servletResponse, Result.ok(Map.of("items", 1)));
        var writeListener = ArgumentCaptor.forClass(WriteListener.class);
        verify(out).setWriteListener(writeListener.capture());
        writeListener.getValue().onWritePossible();

        verify(safety).cancel(false);
    }
}
