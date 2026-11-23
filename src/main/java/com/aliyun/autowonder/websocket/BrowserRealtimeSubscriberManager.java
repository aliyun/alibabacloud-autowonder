package com.aliyun.autowonder.websocket;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.annotation.PreDestroy;
import javax.websocket.CloseReason;
import javax.websocket.Session;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@Component
public class BrowserRealtimeSubscriberManager {

    private static final Logger log = LoggerFactory.getLogger(BrowserRealtimeSubscriberManager.class);

    private static final ConcurrentHashMap<Session, PrincipalInfo> SESSION_PRINCIPALS = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<Session, Set<String>> SESSION_CHANNELS = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, Set<Session>> CHANNEL_SESSIONS = new ConcurrentHashMap<>();
    private static final int MAX_QUEUED_FRAMES = 64;
    private static final int MAX_QUEUED_BYTES = 512 * 1024;
    private static final String CLOSED_SEND_KEY = BrowserRealtimeSubscriberManager.class.getName() + ".closed";

    private final ConcurrentHashMap<Session, Sender> senders = new ConcurrentHashMap<>();
    private final ScheduledThreadPoolExecutor deadlines = new ScheduledThreadPoolExecutor(1, task -> {
        Thread thread = new Thread(task, "browser-send-deadline");
        thread.setDaemon(true);
        return thread;
    });
    // Closing a socket may itself wait on the transport; it must not run on the Redis subscriber.
    private final ThreadPoolExecutor closers = new ThreadPoolExecutor(1, 2, 30, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(64), task -> {
                Thread thread = new Thread(task, "browser-send-close");
                thread.setDaemon(true);
                return thread;
            }, new ThreadPoolExecutor.DiscardPolicy());
    private final long sendTimeoutMs;

    public BrowserRealtimeSubscriberManager() {
        this(5_000L);
    }

    @Autowired
    public BrowserRealtimeSubscriberManager(
            @Value("${autowonder.browser-realtime.send-timeout-ms:5000}") long sendTimeoutMs) {
        if (sendTimeoutMs <= 0) throw new IllegalArgumentException("browser send timeout must be positive");
        this.sendTimeoutMs = sendTimeoutMs;
        deadlines.setRemoveOnCancelPolicy(true);
    }

    public void recordPrincipal(Session session, long tenantId, long userId) {
        SESSION_PRINCIPALS.put(session, new PrincipalInfo(tenantId, userId));
    }

    public PrincipalInfo getPrincipal(Session session) {
        return SESSION_PRINCIPALS.get(session);
    }

    public boolean addSubscription(Session session, String channel) {
        SESSION_CHANNELS.computeIfAbsent(session, k -> ConcurrentHashMap.newKeySet()).add(channel);
        CHANNEL_SESSIONS.computeIfAbsent(channel, k -> ConcurrentHashMap.newKeySet()).add(session);
        log.debug("subscription added sessionId={} channel={}", session.getId(), channel);
        return true;
    }

    public void removeSubscription(Session session, String channel) {
        Set<String> channels = SESSION_CHANNELS.get(session);
        if (channels != null) {
            channels.remove(channel);
        }
        Set<Session> sessions = CHANNEL_SESSIONS.get(channel);
        if (sessions != null) {
            sessions.remove(session);
            if (sessions.isEmpty()) {
                CHANNEL_SESSIONS.remove(channel);
            }
        }
    }

    public Set<Session> getChannelSubscribers(String channel) {
        Set<Session> sessions = CHANNEL_SESSIONS.get(channel);
        if (sessions == null) {
            return Collections.emptySet();
        }
        return Collections.unmodifiableSet(sessions);
    }

    public void removeSession(Session session) {
        if (session.getUserProperties() != null) session.getUserProperties().put(CLOSED_SEND_KEY, Boolean.TRUE);
        Sender sender = senders.remove(session);
        if (sender != null) sender.stop();
        SESSION_PRINCIPALS.remove(session);
        Set<String> channels = SESSION_CHANNELS.remove(session);
        if (channels != null) {
            for (String channel : channels) {
                Set<Session> sessions = CHANNEL_SESSIONS.get(channel);
                if (sessions != null) {
                    sessions.remove(session);
                    if (sessions.isEmpty()) {
                        CHANNEL_SESSIONS.remove(channel);
                    }
                }
            }
        }
    }

    public void deliverToChannel(String channel, String frameJson) {
        Set<Session> subscribers = CHANNEL_SESSIONS.get(channel);
        if (subscribers == null || subscribers.isEmpty()) {
            return;
        }
        for (Session session : subscribers) {
            deliverToSession(session, frameJson);
        }
    }

    /** All browser sends, including legacy broadcasts, share one ordered async mailbox. */
    public void deliverToSession(Session session, String frameJson) {
        if (session.getUserProperties() != null
                && Boolean.TRUE.equals(session.getUserProperties().get(CLOSED_SEND_KEY))) return;
        if (!session.isOpen()) {
            removeSession(session);
            return;
        }
        Sender sender = senders.computeIfAbsent(session, Sender::new);
        sender.enqueue(new Frame(frameJson));
    }

    @PreDestroy
    public void shutdown() {
        for (Session session : senders.keySet()) removeSession(session);
        deadlines.shutdownNow();
        closers.shutdownNow();
    }

    private final class Sender {
        private final Session session;
        private final ArrayDeque<Frame> queue = new ArrayDeque<>();
        private int queuedBytes;
        private boolean closed;

        private Sender(Session session) {
            this.session = session;
        }

        void enqueue(Frame frame) {
            boolean start;
            boolean overflow;
            synchronized (this) {
                if (closed) return;
                overflow = queue.size() >= MAX_QUEUED_FRAMES
                        || frame.bytes > MAX_QUEUED_BYTES - queuedBytes;
                start = queue.isEmpty();
                if (!overflow) {
                    queue.addLast(frame);
                    queuedBytes += frame.bytes;
                }
            }
            if (overflow) fail("send queue full");
            else if (start) send(frame);
        }

        private void send(Frame frame) {
            try {
                synchronized (this) {
                    if (closed || queue.peekFirst() != frame) return;
                    frame.deadline = deadlines.schedule(() -> timedOut(frame), sendTimeoutMs,
                            TimeUnit.MILLISECONDS);
                }
                session.getAsyncRemote().setSendTimeout(sendTimeoutMs);
                session.getAsyncRemote().sendText(frame.text, result -> {
                    if (!result.isOK()) {
                        fail("async send failed");
                        return;
                    }
                    Frame next;
                    synchronized (this) {
                        if (closed || queue.peekFirst() != frame) return;
                        frame.cancelDeadline();
                        queue.removeFirst();
                        queuedBytes -= frame.bytes;
                        next = queue.peekFirst();
                    }
                    if (next != null) send(next);
                });
            } catch (RuntimeException e) {
                fail("async send rejected");
            }
        }

        private void timedOut(Frame frame) {
            synchronized (this) {
                if (closed || queue.peekFirst() != frame) return;
                fail("async send timed out");
            }
        }

        private void fail(String reason) {
            synchronized (this) {
                if (closed) return;
                stop();
            }
            removeSession(session);
            log.warn("browser realtime disconnected sessionId={} reason={}", session.getId(), reason);
            // Idle timeout is a bounded fallback if the close executor is saturated.
            try { session.setMaxIdleTimeout(1L); } catch (RuntimeException ignored) { }
            closers.execute(() -> {
                try {
                    session.close(new CloseReason(CloseReason.CloseCodes.TRY_AGAIN_LATER, reason));
                } catch (Exception ignored) { }
            });
        }

        synchronized void stop() {
            closed = true;
            for (Frame frame : queue) frame.cancelDeadline();
            queue.clear();
            queuedBytes = 0;
        }
    }

    private static final class Frame {
        private final String text;
        private final int bytes;
        private ScheduledFuture<?> deadline;

        private Frame(String text) {
            this.text = text;
            this.bytes = text.length() > MAX_QUEUED_BYTES
                    ? MAX_QUEUED_BYTES + 1 : text.getBytes(StandardCharsets.UTF_8).length;
        }

        private void cancelDeadline() {
            if (deadline != null) deadline.cancel(false);
        }
    }

    public static class PrincipalInfo {
        private final long tenantId;
        private final long userId;

        public PrincipalInfo(long tenantId, long userId) {
            this.tenantId = tenantId;
            this.userId = userId;
        }

        public long getTenantId() {
            return tenantId;
        }

        public long getUserId() {
            return userId;
        }
    }
}
