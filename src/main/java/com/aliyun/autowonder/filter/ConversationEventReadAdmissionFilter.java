package com.aliyun.autowonder.filter;

import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.common.i18n.SystemMessages;
import com.aliyun.autowonder.configuration.ConversationEventReadConfiguration;
import com.aliyun.autowonder.context.AutoWonderContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

/**
 * No-wait admission for conversation event detail reads.
 *
 * <p>A slot is held from admission until the response body has actually been written (sync) or the
 * async response completed/timed out/errored. Over-limit requests get an immediate 429 instead of
 * queueing behind a slow reader.
 */
public class ConversationEventReadAdmissionFilter extends OncePerRequestFilter {

    private static final Logger log =
            LoggerFactory.getLogger(ConversationEventReadAdmissionFilter.class);

    public static final String SLOT_ATTRIBUTE = ConversationEventReadAdmissionFilter.class.getName() + ".slot";
    /** Handle of the per-request safety timer; cancelled as soon as the async response finishes. */
    public static final String SAFETY_ATTRIBUTE = ConversationEventReadAdmissionFilter.class.getName() + ".safety";

    private static final Pattern DETAIL_PATH = Pattern.compile(
            "^/api/(?:platform/conversations/[^/]+"
                    + "|workitems/[^/]+/(?:clarification-conversations|prd/conversation)/[^/]+)"
                    + "/(?:events(?:/page)?"
                    + "|turns/page|turns/[^/]+/(?:content|questions/(?:page|[^/]+/content)|events(?:/page)?|event-summaries(?:/[^/]+/content)?))$");
    private static final Pattern HISTORY_PATH = Pattern.compile("^/api/(?:platform/conversations/[^/]+"
            + "|workitems/[^/]+/clarification-conversations/[^/]+|workitems/[^/]+/prd/conversation)$");

    private final int globalLimit;
    private final int perUserLimit;
    private final int perWorkspaceLimit;
    private final long writeDeadlineMs;
    private final long releaseGraceMs;
    private final boolean enabled;
    private final Object lock = new Object();
    private final AtomicInteger global = new AtomicInteger();
    private final AtomicInteger graceTimerReleases = new AtomicInteger();
    private final ConcurrentHashMap<Long, AtomicInteger> perUser = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<Long, AtomicInteger> perWorkspace = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(runnable -> {
                Thread thread = new Thread(runnable, "conversation-event-admission");
                thread.setDaemon(true);
                return thread;
            });

    public ConversationEventReadAdmissionFilter(ConversationEventReadConfiguration configuration) {
        this.globalLimit = configuration.getGlobalLimit();
        this.perUserLimit = configuration.getPerUserLimit();
        this.perWorkspaceLimit = configuration.getPerWorkspaceLimit();
        this.writeDeadlineMs = configuration.getWriteDeadlineMs();
        this.releaseGraceMs = configuration.getReleaseGraceMs();
        this.enabled = configuration.isAdmissionEnabled();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if (!enabled) {
            return true;
        }
        if (!"GET".equalsIgnoreCase(request.getMethod())) {
            return true;
        }
        return !DETAIL_PATH.matcher(request.getRequestURI()).matches()
                && !HISTORY_PATH.matcher(request.getRequestURI()).matches();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        Long userKey = currentUserId();
        Long workspaceKey = currentWorkspaceId();
        Slot slot = acquire(userKey, workspaceKey);
        if (slot == null) {
            reject(response);
            return;
        }
        request.setAttribute(SLOT_ATTRIBUTE, slot);
        String requestPath = request.getRequestURI();
        String requestId = org.slf4j.MDC.get("requestId");
        ScheduledFuture<?> safety = scheduler.schedule(() -> {
            // Normal async responses release the slot themselves; never warn for those. Only an
            // overdue, still-held slot means the response really is stuck.
            if (slot.isReleased()) {
                return;
            }
            graceTimerReleases.incrementAndGet();
            log.warn("conversation event detail slot released by grace timer user={} workspace={} "
                            + "path={} requestId={}",
                    userKey, workspaceKey, requestPath, requestId);
            slot.release();
        }, Math.max(1000L, writeDeadlineMs + releaseGraceMs), TimeUnit.MILLISECONDS);
        request.setAttribute(SAFETY_ATTRIBUTE, safety);
        try {
            filterChain.doFilter(request, response);
        } finally {
            if (!request.isAsyncStarted()) {
                safety.cancel(false);
                slot.release();
            }
        }
    }

    /** Cancels the per-request safety timer once the async response has finished. */
    public static void cancelSafety(javax.servlet.http.HttpServletRequest request) {
        Object value = request.getAttribute(SAFETY_ATTRIBUTE);
        if (value instanceof ScheduledFuture<?> future) {
            future.cancel(false);
        }
    }

    /** Number of times the safety timer actually had to release an overdue slot. */
    public int graceTimerReleases() {
        return graceTimerReleases.get();
    }

    private Slot acquire(Long userKey, Long workspaceKey) {
        synchronized (lock) {
            if (global.get() >= globalLimit) {
                return null;
            }
            AtomicInteger user = perUser.computeIfAbsent(userKey, ignored -> new AtomicInteger());
            if (user.get() >= perUserLimit) {
                return null;
            }
            AtomicInteger workspace = perWorkspace.computeIfAbsent(workspaceKey, ignored -> new AtomicInteger());
            if (workspace.get() >= perWorkspaceLimit) {
                return null;
            }
            global.incrementAndGet();
            user.incrementAndGet();
            workspace.incrementAndGet();
            return new Slot(() -> {
                synchronized (lock) {
                    global.decrementAndGet();
                    decrement(perUser, userKey);
                    decrement(perWorkspace, workspaceKey);
                }
            });
        }
    }

    private static void decrement(ConcurrentHashMap<Long, AtomicInteger> counters, Long key) {
        AtomicInteger counter = counters.get(key);
        if (counter != null) {
            counter.decrementAndGet();
        }
    }

    private void reject(HttpServletResponse response) throws IOException {
        response.setStatus(429);
        response.setHeader("Retry-After", "3");
        response.setHeader("Cache-Control", "no-store");
        response.setContentType("application/json;charset=UTF-8");
        String message = SystemMessages.render(ErrorCode.RATE_LIMITED.getMessageKey(), null,
                ErrorCode.RATE_LIMITED.getMessage());
        String body = "{\"success\":false,\"code\":\"" + ErrorCode.RATE_LIMITED.getCode()
                + "\",\"message\":\"" + escape(message) + "\",\"data\":null}";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        response.setContentLength(bytes.length);
        response.getOutputStream().write(bytes);
        response.flushBuffer();
    }

    private static String escape(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static Long currentUserId() {
        try {
            Long userId = AutoWonderContext.get().getUserId();
            return userId == null ? -1L : userId;
        } catch (RuntimeException e) {
            return -1L;
        }
    }

    private static Long currentWorkspaceId() {
        try {
            Long workspaceId = AutoWonderContext.get().getCurrentWorkspaceId();
            return workspaceId == null ? -1L : workspaceId;
        } catch (RuntimeException e) {
            return -1L;
        }
    }

    /** Idempotent admission slot. */
    public static final class Slot {
        private final AtomicBoolean released = new AtomicBoolean();
        private final Runnable releaseAction;

        Slot(Runnable releaseAction) {
            this.releaseAction = releaseAction;
        }

        public void release() {
            if (released.compareAndSet(false, true)) {
                releaseAction.run();
            }
        }

        public boolean isReleased() {
            return released.get();
        }
    }
}
