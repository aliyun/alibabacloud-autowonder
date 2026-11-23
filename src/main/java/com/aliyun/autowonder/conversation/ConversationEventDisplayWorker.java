package com.aliyun.autowonder.conversation;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Display preparation worker.
 *
 * <p>实时与历史使用各自独立的调度、single-flight 标记和批次预算：历史扫描变慢或抛错
 * 不会推迟当前会话的实时消费，实时流量也不会被历史积压占满。
 */
@Component
public class ConversationEventDisplayWorker implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(ConversationEventDisplayWorker.class);

    private final ConversationEventDisplayPreparationService preparationService;
    private ConversationDisplayWorkAdmission admission = new ConversationDisplayWorkAdmission();
    private final AtomicBoolean realtimeRunning = new AtomicBoolean(false);
    private final AtomicBoolean historyRunning = new AtomicBoolean(false);
    private final AtomicInteger historyTickCount = new AtomicInteger();
    private volatile ScheduledExecutorService realtimeScheduler;
    private volatile ScheduledExecutorService largeScheduler;
    private volatile ScheduledExecutorService historyScheduler;
    /** 队列快照每 15 个历史 tick（约 30s）采样一次，避免每 2s 三次计数查询。 */
    static final int OBSERVABILITY_EVERY_TICKS = 15;

    @Value("${autowonder.conversation.event-display.enabled:true}")
    private boolean enabled;

    @Value("${autowonder.conversation.event-display.realtime-batch:20}")
    private int realtimeBatch;

    @Value("${autowonder.conversation.event-display.history-batch:20}")
    private int historyBatch;

    @Value("${autowonder.conversation.event-display.history-scan-rows:200}")
    private int historyScanRows;

    @Value("${autowonder.conversation.event-display.history-time-budget-ms:300}")
    private long historyTimeBudgetMs;

    @Value("${autowonder.conversation.events.retention-days:30}")
    private int retentionDays;

    @Value("${autowonder.conversation.event-display.cleanup-batch:500}")
    private int cleanupBatch;

    @Value("${autowonder.conversation.event-display.realtime-delay-ms:10}")
    private long realtimeDelayMs = 10;
    @Value("${autowonder.conversation.event-display.history-delay-ms:2000}")
    private long historyDelayMs = 2000;
    @Value("${autowonder.conversation.event-display.cleanup-delay-ms:3600000}")
    private long cleanupDelayMs = 3600000;

    public ConversationEventDisplayWorker(ConversationEventDisplayPreparationService preparationService) {
        this.preparationService = preparationService;
    }

    @org.springframework.beans.factory.annotation.Autowired
    public void setAdmission(ConversationDisplayWorkAdmission admission) {
        this.admission = admission;
    }

    /** 实时通道：只看实时/交互队列，独立于历史发现。 */
    public void realtimeTick() {
        if (!enabled || !realtimeRunning.compareAndSet(false, true)) {
            return;
        }
        if (!admission.tryAcquire()) {
            realtimeRunning.set(false);
            return;
        }
        try {
            preparationService.processRealtimeDue(realtimeBatch);
        } catch (RuntimeException e) {
            log.warn("display realtime tick failed: {}", e.getMessage());
        } finally {
            admission.release();
            realtimeRunning.set(false);
        }
    }

    /** 历史通道：有界扫描 + 后台回填，失败只影响自身。 */
    public void historyTick() {
        if (!enabled || !historyRunning.compareAndSet(false, true)) {
            return;
        }
        if (!admission.tryAcquire()) {
            historyRunning.set(false);
            return;
        }
        try {
            int created = 0;
            try {
                created = preparationService.scanHistoryBatch(historyScanRows, historyTimeBudgetMs);
            } catch (RuntimeException e) {
                log.warn("display history scan failed: {}", e.getMessage());
            }
            try {
                preparationService.processHistoryDue(historyBatch);
            } catch (RuntimeException e) {
                log.warn("display history preparation failed: {}", e.getMessage());
            }
            if (historyTickCount.incrementAndGet() % OBSERVABILITY_EVERY_TICKS == 0) {
                log.info("display history created={} {}", created,
                        preparationService.queueSnapshot());
            }
        } finally {
            admission.release();
            historyRunning.set(false);
        }
    }

    public void cleanup() {
        if (!enabled || !admission.tryAcquire()) {
            return;
        }
        try {
            int deleted = preparationService.cleanupExpired(retentionDays, cleanupBatch);
            if (deleted > 0) {
                log.info("conversation event display cleanup deleted={}", deleted);
            }
        } catch (RuntimeException e) {
            log.warn("display cleanup failed: {}", e.getMessage());
        } finally {
            admission.release();
        }
    }

    @Override
    public synchronized void start() {
        if (!enabled || isRunning()) return;
        realtimeScheduler = scheduler("conversation-display-realtime");
        largeScheduler = scheduler("conversation-display-large");
        historyScheduler = scheduler("conversation-display-history");
        realtimeScheduler.scheduleWithFixedDelay(this::realtimeTick, 0,
                Math.max(10, realtimeDelayMs), TimeUnit.MILLISECONDS);
        largeScheduler.scheduleWithFixedDelay(() -> {
            if (!admission.tryAcquire()) return;
            try {
                preparationService.processLargeDue(1);
            } catch (RuntimeException failure) {
                log.warn("display large preparation failed: {}", failure.getMessage());
            } finally {
                admission.release();
            }
        }, 0, 50, TimeUnit.MILLISECONDS);
        historyScheduler.scheduleWithFixedDelay(this::historyTick, 0,
                Math.max(100, historyDelayMs), TimeUnit.MILLISECONDS);
        historyScheduler.scheduleWithFixedDelay(this::cleanup, Math.max(1000, cleanupDelayMs),
                Math.max(1000, cleanupDelayMs), TimeUnit.MILLISECONDS);
    }

    private static ScheduledExecutorService scheduler(String name) {
        // Only fixed periodic tasks are registered: no unbounded submission queue.
        return Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, name);
            thread.setDaemon(true);
            return thread;
        });
    }

    @Override
    public synchronized void stop() {
        if (realtimeScheduler != null) realtimeScheduler.shutdownNow();
        if (largeScheduler != null) largeScheduler.shutdownNow();
        if (historyScheduler != null) historyScheduler.shutdownNow();
        realtimeScheduler = null;
        largeScheduler = null;
        historyScheduler = null;
    }

    @Override
    public boolean isRunning() {
        return realtimeScheduler != null;
    }
}
