package com.aliyun.autowonder.common.web;

import com.aliyun.autowonder.configuration.ConversationEventReadConfiguration;
import com.aliyun.autowonder.filter.ConversationEventReadAdmissionFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import javax.servlet.AsyncContext;
import javax.servlet.AsyncEvent;
import javax.servlet.AsyncListener;
import javax.servlet.ServletOutputStream;
import javax.servlet.WriteListener;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Writes a bounded detail response with non-blocking servlet output.
 *
 * <p>No request thread ever blocks on a socket write: bytes are pushed only while the container
 * reports ready, and a watchdog completes the async response at the write deadline. The admission
 * slot is released by the async completion/timeout/error callback, not by the service returning.
 */
@Component
public class ConversationEventBoundedResponse {

    private static final Logger log = LoggerFactory.getLogger(ConversationEventBoundedResponse.class);
    /** Bounded bodies (256KiB list / 128KiB segment) fit in one buffer write in production. */
    private static final int MAX_ASYNC_BUFFER_BYTES = 512 * 1024;
    private static final long COMPLETION_FALLBACK_MS = 2_000L;

    private final ObjectMapper objectMapper;
    private final long writeDeadlineMs;
    private long completionFallbackMs = COMPLETION_FALLBACK_MS;
    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(runnable -> {
                Thread thread = new Thread(runnable, "conversation-event-writer");
                thread.setDaemon(true);
                return thread;
            });

    /**
     * Exactly one constructor: Spring 2.7 cannot choose between multiple unannotated
     * constructors and fails the whole context refresh when none is the default.
     */
    public ConversationEventBoundedResponse(ObjectMapper objectMapper,
            ConversationEventReadConfiguration configuration) {
        this.objectMapper = objectMapper;
        this.writeDeadlineMs = configuration.getWriteDeadlineMs();
    }

    /** Test seam for the bounded completion fallback; production keeps the default. */
    void setCompletionFallbackMs(long completionFallbackMs) {
        this.completionFallbackMs = completionFallbackMs;
    }

    public void write(HttpServletRequest request, HttpServletResponse response, Object payload)
            throws IOException {
        byte[] body = objectMapper.writeValueAsBytes(payload);
        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentLength(body.length);
        response.setHeader("Cache-Control", "no-store");

        ConversationEventReadAdmissionFilter.Slot slot =
                (ConversationEventReadAdmissionFilter.Slot) request.getAttribute(
                        ConversationEventReadAdmissionFilter.SLOT_ATTRIBUTE);

        if (!request.isAsyncSupported()) {
            response.getOutputStream().write(body);
            return;
        }
        AsyncContext async = request.startAsync();
        async.setTimeout(writeDeadlineMs);
        async.addListener(new AsyncListener() {
            @Override
            public void onComplete(AsyncEvent event) {
                release(slot);
            }

            @Override
            public void onTimeout(AsyncEvent event) {
                log.warn("conversation event detail write timed out conversationPath={}",
                        request.getRequestURI());
                complete(async);
                release(slot);
            }

            @Override
            public void onError(AsyncEvent event) {
                release(slot);
            }

            @Override
            public void onStartAsync(AsyncEvent event) {
                // no nested async dispatch in this path
            }
        });

        int currentBuffer = response.getBufferSize() > 0 ? response.getBufferSize() : 8_192;
        // Keep one write inside the container buffer: crossing the buffer during a non-blocking
        // write used to interleave with the container flush and duplicate a buffer-sized fragment.
        int bufferSize = Math.max(currentBuffer, Math.min(MAX_ASYNC_BUFFER_BYTES, body.length));
        if (bufferSize > currentBuffer) {
            response.setBufferSize(bufferSize);
        }
        int chunkLimit = Math.min(bufferSize, MAX_ASYNC_BUFFER_BYTES);
        ServletOutputStream out = response.getOutputStream();

        AtomicInteger offset = new AtomicInteger();
        AtomicBoolean writing = new AtomicBoolean();
        AtomicBoolean finished = new AtomicBoolean();
        AtomicBoolean completed = new AtomicBoolean();

        ScheduledFuture<?> deadline = scheduler.schedule(() -> {
            log.warn("conversation event detail write deadline reached path={} written={}/{}",
                    request.getRequestURI(), offset.get(), body.length);
            ConversationEventReadAdmissionFilter.cancelSafety(request);
            if (completed.compareAndSet(false, true)) {
                complete(async);
            }
            release(slot);
        }, Math.max(1000L, writeDeadlineMs), TimeUnit.MILLISECONDS);

        Runnable finish = () -> {
            if (finished.compareAndSet(false, true)) {
                deadline.cancel(false);
                // The async response is done: cancel the 25s admission safety timer so a normal
                // request never leaves a misleading grace-timer warning in the service log.
                ConversationEventReadAdmissionFilter.cancelSafety(request);
                if (completed.compareAndSet(false, true)) {
                    complete(async);
                }
                // Completion normally arrives through onComplete; keep a short, attributable
                // fallback so a missing container callback cannot hold the slot to the grace timer.
                scheduler.schedule(() -> {
                    if (slot != null && !slot.isReleased()) {
                        log.info("conversation event detail slot released by completion fallback path={}",
                                request.getRequestURI());
                        slot.release();
                    }
                }, Math.max(200L, completionFallbackMs), TimeUnit.MILLISECONDS);
            }
        };

        out.setWriteListener(new WriteListener() {
            @Override
            public void onWritePossible() {
                // One callback at a time: a re-entrant delivery must not write the same range twice.
                if (finished.get() || !writing.compareAndSet(false, true)) {
                    return;
                }
                try {
                    boolean ready = out.isReady();
                    while (!finished.get() && offset.get() < body.length && ready) {
                        int from = offset.get();
                        int length = Math.min(chunkLimit, body.length - from);
                        out.write(body, from, length);
                        offset.set(from + length);
                        ready = out.isReady();
                    }
                    if (offset.get() >= body.length) {
                        finish.run();
                    }
                } catch (IOException e) {
                    log.info("conversation event detail client disconnected path={}: {}",
                            request.getRequestURI(), e.getMessage());
                    finish.run();
                } finally {
                    writing.set(false);
                }
            }

            @Override
            public void onError(Throwable throwable) {
                log.info("conversation event detail write error path={}: {}",
                        request.getRequestURI(), throwable.getMessage());
                finish.run();
            }
        });
    }

    private static void complete(AsyncContext async) {
        try {
            async.complete();
        } catch (IllegalStateException ignored) {
            // Already completed by the container.
        }
    }

    private static void release(ConversationEventReadAdmissionFilter.Slot slot) {
        if (slot != null) {
            slot.release();
        }
    }
}
