package com.aliyun.autowonder.websocket;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;

import javax.websocket.Session;
import javax.websocket.RemoteEndpoint;
import javax.websocket.SendHandler;
import javax.websocket.SendResult;
import java.io.IOException;
import java.lang.reflect.Field;
import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class BrowserRealtimeSubscriberManagerTest {

    private BrowserRealtimeSubscriberManager manager;

    @BeforeEach
    void setUp() {
        clearStaticMaps();
        manager = new BrowserRealtimeSubscriberManager();
    }

    @AfterEach
    void tearDown() {
        manager.shutdown();
        clearStaticMaps();
    }

    @SuppressWarnings("unchecked")
    private void clearStaticMaps() {
        try {
            for (String name : new String[]{"SESSION_PRINCIPALS", "SESSION_CHANNELS", "CHANNEL_SESSIONS"}) {
                Field f = BrowserRealtimeSubscriberManager.class.getDeclaredField(name);
                f.setAccessible(true);
                ((ConcurrentHashMap<?, ?>) f.get(null)).clear();
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @Test
    void recordsAndRetrievesPrincipal() {
        Session session = mock(Session.class);
        when(session.getId()).thenReturn("s1");
        manager.recordPrincipal(session, 100L, 42L);

        BrowserRealtimeSubscriberManager.PrincipalInfo info = manager.getPrincipal(session);
        assertNotNull(info);
        assertEquals(100L, info.getTenantId());
        assertEquals(42L, info.getUserId());
    }

    @Test
    void addAndRetrieveSubscription() {
        Session session = mock(Session.class);
        when(session.getId()).thenReturn("s1");
        when(session.isOpen()).thenReturn(true);

        manager.addSubscription(session, "conversation:10");

        Set<Session> subscribers = manager.getChannelSubscribers("conversation:10");
        assertEquals(1, subscribers.size());
        assertTrue(subscribers.contains(session));
    }

    @Test
    void removeSubscription() {
        Session session = mock(Session.class);
        when(session.getId()).thenReturn("s1");
        manager.addSubscription(session, "conversation:10");
        manager.removeSubscription(session, "conversation:10");

        Set<Session> subscribers = manager.getChannelSubscribers("conversation:10");
        assertTrue(subscribers.isEmpty());
    }

    @Test
    void removeSessionCleansAllSubscriptions() {
        Session session = mock(Session.class);
        when(session.getId()).thenReturn("s1");
        manager.addSubscription(session, "conversation:10");
        manager.addSubscription(session, "conversation:20");

        manager.removeSession(session);

        assertTrue(manager.getChannelSubscribers("conversation:10").isEmpty());
        assertTrue(manager.getChannelSubscribers("conversation:20").isEmpty());
        assertNull(manager.getPrincipal(session));
    }

    @Test
    void multipleSubscribersToSameChannel() {
        Session s1 = mock(Session.class);
        when(s1.getId()).thenReturn("s1");
        when(s1.isOpen()).thenReturn(true);
        Session s2 = mock(Session.class);
        when(s2.getId()).thenReturn("s2");
        when(s2.isOpen()).thenReturn(true);

        manager.addSubscription(s1, "conversation:10");
        manager.addSubscription(s2, "conversation:10");

        Set<Session> subscribers = manager.getChannelSubscribers("conversation:10");
        assertEquals(2, subscribers.size());
    }

    @Test
    void emptyChannelReturnsEmptySet() {
        Set<Session> subscribers = manager.getChannelSubscribers("conversation:999");
        assertTrue(subscribers.isEmpty());
    }

    @Test
    void slowSubscriberDoesNotHoldOtherSessionsAndSendsInOrder() throws Exception {
        List<String> slowFrames = new ArrayList<>();
        List<SendHandler> completions = new ArrayList<>();
        Session slow = subscriber("slow", slowFrames, completions);
        List<String> fastFrames = new ArrayList<>();
        List<SendHandler> fastCompletions = new ArrayList<>();
        Session fast = subscriber("fast", fastFrames, fastCompletions);

        manager.deliverToChannel("conversation:10", "first");
        manager.deliverToChannel("conversation:10", "second");
        assertEquals(List.of("first"), slowFrames);
        assertEquals(List.of("first"), fastFrames);
        fastCompletions.get(0).onResult(new SendResult());
        assertEquals(List.of("first", "second"), fastFrames);
        assertEquals(List.of("first"), slowFrames);
        completions.get(0).onResult(new SendResult());
        assertEquals(List.of("first", "second"), slowFrames);
        verify(slow, never()).getBasicRemote();
        verify(fast, never()).getBasicRemote();
    }

    @Test
    void queueFrameLimitDisconnectsOnlyTheSlowSubscriber() {
        Session slow = subscriber("slow", new ArrayList<>(), new ArrayList<>());
        Session healthy = subscriber("healthy", new ArrayList<>(), new ArrayList<>());
        manager.removeSubscription(healthy, "conversation:10");
        manager.addSubscription(healthy, "conversation:20");
        manager.recordPrincipal(slow, 100L, 42L);
        for (int i = 0; i < 65; i++) {
            manager.deliverToChannel("conversation:10", "frame-" + i);
        }
        assertFalse(manager.getChannelSubscribers("conversation:10").contains(slow));
        assertNull(manager.getPrincipal(slow));
        assertTrue(manager.getChannelSubscribers("conversation:20").contains(healthy));
    }

    @Test
    void queueByteLimitCountsUtf8AndDisconnectsBeforeTheFrameLimit() {
        Session slow = subscriber("slow", new ArrayList<>(), new ArrayList<>());
        for (int i = 0; i < 3; i++) {
            manager.deliverToChannel("conversation:10", "界".repeat(90_000));
        }
        assertFalse(manager.getChannelSubscribers("conversation:10").contains(slow));
    }

    @Test
    void failedOrTimedOutSendRemovesTheSessionAndDiscardsPendingFrames() {
        for (Exception failure : List.of(new IOException("disconnected"), new SocketTimeoutException("slow"))) {
            List<String> frames = new ArrayList<>();
            List<SendHandler> completions = new ArrayList<>();
            Session session = subscriber(failure.getClass().getSimpleName(), frames, completions);
            manager.deliverToChannel("conversation:10", "first");
            manager.deliverToChannel("conversation:10", "pending");
            completions.get(0).onResult(new SendResult(failure));
            assertFalse(manager.getChannelSubscribers("conversation:10").contains(session));
            assertEquals(List.of("first"), frames);
        }
    }

    @Test
    void removedSessionCannotRestartSendingFromAnOldCompletion() {
        List<String> frames = new ArrayList<>();
        List<SendHandler> completions = new ArrayList<>();
        Session session = subscriber("removed", frames, completions);
        manager.deliverToChannel("conversation:10", "first");
        manager.deliverToChannel("conversation:10", "pending");
        manager.removeSession(session);
        completions.get(0).onResult(new SendResult());
        manager.deliverToSession(session, "late");
        assertEquals(List.of("first"), frames);
    }

    @Test
    void independentWatchdogReleasesSessionWhenTransportNeverCallsBack() throws Exception {
        manager.shutdown();
        manager = new BrowserRealtimeSubscriberManager(30L);
        Session session = subscriber("timeout", new ArrayList<>(), new ArrayList<>());
        manager.recordPrincipal(session, 100L, 42L);
        manager.deliverToChannel("conversation:10", "first");
        verify(session, timeout(1000)).setMaxIdleTimeout(1L);
        assertFalse(manager.getChannelSubscribers("conversation:10").contains(session));
        assertNull(manager.getPrincipal(session));
    }

    @Test
    void directAndSubscribedFramesShareTheSameOrderedMailbox() {
        List<String> frames = new ArrayList<>();
        List<SendHandler> completions = new ArrayList<>();
        Session session = subscriber("shared", frames, completions);
        manager.removeSubscription(session, "conversation:10");
        manager.deliverToSession(session, "direct");
        manager.addSubscription(session, "conversation:10");
        manager.deliverToChannel("conversation:10", "subscribed");
        assertEquals(List.of("direct"), frames);
        completions.get(0).onResult(new SendResult());
        assertEquals(List.of("direct", "subscribed"), frames);
    }

    @Test
    @SuppressWarnings("unchecked")
    void legacyBroadcastUsesTheSameAsyncMailboxAndKeepsWorkspaceIsolation() throws Exception {
        List<String> frames = new ArrayList<>();
        List<SendHandler> completions = new ArrayList<>();
        Session session = subscriber("broadcast", frames, completions);
        Field workspaceField = BrowserRealtimeEndpoint.class.getDeclaredField("SESSION_WORKSPACES");
        workspaceField.setAccessible(true);
        Map<Session, Long> workspaces = (Map<Session, Long>) workspaceField.get(null);
        Field contextField = WsSpringContext.class.getDeclaredField("context");
        contextField.setAccessible(true);
        Object previousContext = contextField.get(null);
        try (GenericApplicationContext context = new GenericApplicationContext()) {
            context.getBeanFactory().registerSingleton("browserSubscriberManager", manager);
            context.refresh();
            new WsSpringContext().setApplicationContext(context);
            workspaces.put(session, 100L);
            manager.deliverToChannel("conversation:10", "subscribed");
            BrowserRealtimeEndpoint.broadcast(200L, "other-workspace");
            BrowserRealtimeEndpoint.broadcast(100L, "broadcast");
            assertEquals(List.of("subscribed"), frames);
            completions.get(0).onResult(new SendResult());
            assertEquals(List.of("subscribed", "broadcast"), frames);
            verify(session, never()).getBasicRemote();
        } finally {
            workspaces.remove(session);
            contextField.set(null, previousContext);
        }
    }

    private Session subscriber(String id, List<String> frames, List<SendHandler> completions) {
        Session session = mock(Session.class);
        RemoteEndpoint.Async remote = mock(RemoteEndpoint.Async.class);
        RemoteEndpoint.Basic basic = mock(RemoteEndpoint.Basic.class);
        when(session.getId()).thenReturn(id);
        when(session.isOpen()).thenReturn(true);
        when(session.getUserProperties()).thenReturn(new ConcurrentHashMap<>());
        when(session.getAsyncRemote()).thenReturn(remote);
        when(session.getBasicRemote()).thenReturn(basic);
        try {
            doAnswer(invocation -> {
                frames.add(invocation.getArgument(0));
                return null;
            }).when(basic).sendText(anyString());
        } catch (IOException e) {
            throw new AssertionError(e);
        }
        doAnswer(invocation -> {
            frames.add(invocation.getArgument(0));
            completions.add(invocation.getArgument(1));
            return null;
        }).when(remote).sendText(anyString(), any(SendHandler.class));
        manager.addSubscription(session, "conversation:10");
        return session;
    }
}
