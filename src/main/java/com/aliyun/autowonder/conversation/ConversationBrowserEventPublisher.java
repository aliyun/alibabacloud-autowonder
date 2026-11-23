package com.aliyun.autowonder.conversation;

import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.json.Feature;
import com.aliyun.autowonder.websocket.ConversationRealtimePublisher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 会话事件到浏览器的推送出口。
 *
 * <p>单独成一个组件而不是留在 {@link ConversationTurnEventService} 里，是为了
 * 打断一个真实的 Spring 循环依赖：事件服务需要卡片服务来分派 acp_elicitation，
 * 而卡片服务只是想在卡片进终态时推一条事件给浏览器。让两者都依赖这个更小的
 * 出口，依赖方向就是单向的。
 */
@Component
public class ConversationBrowserEventPublisher {

    private static final Logger log =
            LoggerFactory.getLogger(ConversationBrowserEventPublisher.class);

    /**
     * 服务端直推事件的序号基于时间，避免与 Runtime 每轮从 1 递增的 eventSeq
     * 撞号 —— 前端按 (turnId, eventSeq) 去重，撞号会让事件被当成重复丢弃。
     */
    private static final AtomicLong SERVER_PUSHED_EVENT_SEQ =
            new AtomicLong(System.currentTimeMillis());

    private ConversationRealtimePublisher conversationRealtimePublisher;
    static final int MAX_REALTIME_FRAME_BYTES = 16 * 1024;
    private final ThreadPoolExecutor displaySender = new ThreadPoolExecutor(2, 2, 0L,
            TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(256), runnable -> {
                Thread thread = new Thread(runnable, "conversation-display-push");
                thread.setDaemon(true);
                return thread;
            }, new ThreadPoolExecutor.AbortPolicy());
    private final AtomicLong rejectedDisplayPushes = new AtomicLong();

    @Autowired(required = false)
    public void setConversationRealtimePublisher(
            ConversationRealtimePublisher conversationRealtimePublisher) {
        this.conversationRealtimePublisher = conversationRealtimePublisher;
    }

    public void publishDisplay(long tenantId, long conversationId, long turnId, int dispatchAttempt,
            long eventSeq, String eventType, String payloadJson) {
        if (conversationRealtimePublisher == null || payloadJson == null
                || ConversationEventDisplayBudget.utf8Length(payloadJson) > MAX_REALTIME_FRAME_BYTES) {
            return;
        }
        final Map<String, Object> event;
        try {
            event = browserEvent(conversationId, turnId, dispatchAttempt, eventSeq, eventType, payloadJson);
            event.put("projectionVersion", ConversationEventDisplayBudget.PROJECTION_VERSION);
            event.put("segmentIndex", 0);
            event.put("segmentCount", 1);
            Map<String, Object> frame = Map.of("channel", "conversation:" + conversationId,
                    "type", "CONVERSATION_TURN_EVENT", "payload", event, "timestamp", Long.MAX_VALUE);
            if (ConversationEventDisplayBudget.encodedLength(frame) > MAX_REALTIME_FRAME_BYTES) return;
        } catch (RuntimeException invalidPayload) {
            return;
        }
        Runnable enqueue = () -> {
            try {
                displaySender.execute(() -> {
                    try {
                        conversationRealtimePublisher.publish("conversation:" + conversationId,
                                "CONVERSATION_TURN_EVENT", event);
                    } catch (RuntimeException failure) {
                        log.warn("display fast push failed conversationId={} turnId={}", conversationId, turnId);
                    }
                });
            } catch (RejectedExecutionException full) {
                long rejected = rejectedDisplayPushes.incrementAndGet();
                if (rejected == 1 || rejected % 100 == 0) {
                    log.warn("display fast push queue full rejected={}; durable feed will recover", rejected);
                }
            }
        };
        if (org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()
                && org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
            org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                    new org.springframework.transaction.support.TransactionSynchronization() {
                        @Override public void afterCommit() { enqueue.run(); }
                    });
        } else {
            enqueue.run();
        }
    }

    @javax.annotation.PreDestroy
    public void stopDisplaySender() {
        displaySender.shutdownNow();
    }

    /** 推送一条已落库事件（沿用 Runtime 上报的 eventSeq）。 */
    public void publish(long tenantId, long conversationId, long turnId, long eventSeq,
            String eventType, String payloadJson) {
        publish(tenantId, conversationId, turnId, 0, eventSeq, eventType, payloadJson);
    }

    public void publish(long tenantId, long conversationId, long turnId, int dispatchAttempt,
            long eventSeq, String eventType, String payloadJson) {
        if (org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()
                && org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
            org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                    new org.springframework.transaction.support.TransactionSynchronization() {
                        @Override public void afterCommit() {
                            publishCommitted(conversationId, turnId, dispatchAttempt, eventSeq, eventType, payloadJson);
                        }
                    });
            return;
        }
        publishCommitted(conversationId, turnId, dispatchAttempt, eventSeq, eventType, payloadJson);
    }

    private void publishCommitted(long conversationId, long turnId, int dispatchAttempt,
            long eventSeq, String eventType, String payloadJson) {
        if (conversationRealtimePublisher == null) {
            return;
        }
        try {
            Map<String, Object> event = browserEvent(conversationId, turnId, dispatchAttempt,
                    eventSeq, eventType, payloadJson);
            conversationRealtimePublisher.publish(
                    "conversation:" + conversationId, "CONVERSATION_TURN_EVENT", event);
        } catch (Exception e) {
            log.warn("conversation event browser publish failed conversationId={} turnId={} eventSeq={}: {}",
                    conversationId, turnId, eventSeq, e.getMessage());
        }
    }

    private static Map<String, Object> browserEvent(long conversationId, long turnId,
            int dispatchAttempt, long eventSeq, String eventType, String payloadJson) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("conversationId", conversationId);
        event.put("turnId", turnId);
        event.put("dispatchAttempt", dispatchAttempt);
        event.put("eventSeq", eventSeq);
        event.put("eventType", eventType);
        if (payloadJson != null) {
            // Card question order lives in requestedSchema.properties.
            event.put("payload", JSON.parse(payloadJson, Feature.OrderedField));
        }
        return event;
    }

    /** Already-committed system effects must not register a second afterCommit callback. */
    void publishCommittedServerEvent(long tenantId, long conversationId, long turnId,
            String eventType, String payloadJson) {
        publishCommitted(conversationId, turnId, 0, SERVER_PUSHED_EVENT_SEQ.incrementAndGet(), eventType, payloadJson);
    }

    /**
     * 推送一条轮次状态事件（取消等需要前端立即感知终结态的场景）。
     *
     * <p>信封在这里统一构造，避免每个调用方各自手拼这段 JSON。
     */
    public void publishStatusEvent(long tenantId, long conversationId, long turnId, String status) {
        publishServerEvent(tenantId, conversationId, turnId, "status",
                "{\"type\":\"status\",\"status\":\"" + status + "\"}");
    }

    /** 推送一条服务端直生成、不落库的事件（取消、卡片终态等）。 */
    public void publishServerEvent(long tenantId, long conversationId, long turnId,
            String eventType, String payloadJson) {
        publish(tenantId, conversationId, turnId,
                SERVER_PUSHED_EVENT_SEQ.incrementAndGet(), eventType, payloadJson);
    }

    /** 业务控制消息保留原有完整推送，不迁入可丢弃的展示通知。 */
    public static boolean isBusinessControlType(String eventType) {
        if (eventType == null) {
            return false;
        }
        return "status".equals(eventType) || "error".equals(eventType)
                || "acp_commands".equals(eventType)
                || eventType.startsWith(ConversationElicitationService.EVENT_TYPE_PREFIX);
    }

    /**
     * 有界展示通知：只带引用与状态，客户端按摘要接口串行续读，正文永不走推送通道。
     */
    public void publishDisplayAvailable(long conversationId, long turnId, long eventId,
            long publicationSeq, String state, String preparationStatus, String eventType) {
        if (conversationRealtimePublisher == null) {
            return;
        }
        try {
            Map<String, Object> event = new LinkedHashMap<>();
            event.put("conversationId", conversationId);
            event.put("turnId", turnId);
            event.put("eventId", eventId);
            event.put("revision", publicationSeq);
            event.put("state", state);
            event.put("preparationStatus", preparationStatus);
            event.put("eventType", eventType);
            byte[] encoded = JSON.toJSONString(event).getBytes(java.nio.charset.StandardCharsets.UTF_8);
            if (encoded.length > ConversationEventDisplayBudget.NOTIFICATION_MAX_BYTES) {
                event.remove("eventType");
                encoded = JSON.toJSONString(event).getBytes(java.nio.charset.StandardCharsets.UTF_8);
            }
            if (encoded.length > ConversationEventDisplayBudget.NOTIFICATION_MAX_BYTES) {
                log.warn("display notification dropped conversationId={} turnId={} eventId={} bytes={}",
                        conversationId, turnId, eventId, encoded.length);
                return;
            }
            conversationRealtimePublisher.publish("conversation:" + conversationId,
                    ConversationEventDisplayBudget.DISPLAY_AVAILABLE_TYPE, event);
        } catch (Exception e) {
            log.warn("display notification failed conversationId={} turnId={} eventId={}: {}",
                    conversationId, turnId, eventId, e.getMessage());
        }
    }
}
