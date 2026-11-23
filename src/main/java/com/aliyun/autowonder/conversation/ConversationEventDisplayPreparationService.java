package com.aliyun.autowonder.conversation;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Marks logical events for display preparation and prepares them in a bounded background worker.
 *
 * <p>Raw slices are never modified. A logical event is published only after every slice is present
 * and the whole payload stays inside the configured byte budget.
 */
@Service
public class ConversationEventDisplayPreparationService {

    private static final Logger log =
            LoggerFactory.getLogger(ConversationEventDisplayPreparationService.class);

    private final ConversationEventDisplayDao displayDao;
    private final ConversationEventContentSegmentDao segmentDao;
    private final AgentConversationTurnEventDao eventDao;
    private final AgentConversationTurnDao turnDao;
    private final AgentConversationDao conversationDao;
    private final TransactionTemplate required;
    private final TransactionTemplate nestedMark;
    private org.springframework.beans.factory.ObjectProvider<ConversationEventDisplayRecovery> recoveryProvider;
    private final String instanceId = UUID.randomUUID().toString();
    /** 最近新建的原始事件仍属于实时通道；更早的历史由后台批次按最低优先级处理。 */
    static final long RECENT_REALTIME_WINDOW_MS = 30L * 60L * 1000L;
    /** 完整扫描无补建时顺延的时长：避免 3.56M 规模下每 2 秒重扫一遍主键范围。 */
    static final long QUIET_SCAN_MS = 60_000L;
    /** 实时认领按轮次取模轮转的桶数；每 tick 偏移一位，跨空间/轮次都能轮到。 */
    static final int REALTIME_ROTATION_BUCKETS = 8;
    static final String CLASS_LARGE = "LARGE";
    private static final String SCAN_KEY = ConversationEventDisplayScanDO.SCAN_KEY_RAW;
    private final java.util.concurrent.atomic.AtomicInteger rotationOffset =
            new java.util.concurrent.atomic.AtomicInteger();
    private final java.util.concurrent.atomic.AtomicLong inboundRevision = new java.util.concurrent.atomic.AtomicLong();
    private volatile long realtimeRevision = -1L;
    private volatile long largeRevision = -1L;
    private volatile long realtimeIdleUntil;
    private volatile long largeIdleUntil;
    private volatile long realtimeFailureUntil;
    private volatile long largeFailureUntil;
    private final java.util.concurrent.Semaphore largeProjection = new java.util.concurrent.Semaphore(1);
    private record ClaimCursor(long turnId, long id) { }
    private final java.util.Map<String, ClaimCursor> claimCursors = new java.util.concurrent.ConcurrentHashMap<>();
    private ConversationBrowserEventPublisher publisher;

    public ConversationEventDisplayPreparationService(ConversationEventDisplayDao displayDao,
            ConversationEventContentSegmentDao segmentDao, AgentConversationTurnEventDao eventDao,
            AgentConversationTurnDao turnDao, AgentConversationDao conversationDao,
            PlatformTransactionManager transactionManager) {
        this.displayDao = displayDao;
        this.segmentDao = segmentDao;
        this.eventDao = eventDao;
        this.turnDao = turnDao;
        this.conversationDao = conversationDao;
        this.required = new TransactionTemplate(transactionManager);
        this.required.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRED);
        this.required.setTimeout(5);
        this.nestedMark = new TransactionTemplate(transactionManager);
        this.nestedMark.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
        this.nestedMark.setTimeout(5);
    }

    @Autowired(required = false)
    public void setPublisher(ConversationBrowserEventPublisher publisher) {
        this.publisher = publisher;
    }

    @Autowired
    public void setRecoveryProvider(
            org.springframework.beans.factory.ObjectProvider<ConversationEventDisplayRecovery> recoveryProvider) {
        this.recoveryProvider = recoveryProvider;
    }

    public boolean tryAcquireLargeProjection() {
        return largeProjection.tryAcquire();
    }

    public void releaseLargeProjection() {
        largeProjection.release();
    }

    /**
     * Light idempotent mark only. A derived-data failure must never change the reliable inbound
     * business transaction, so callers swallow the exception; the compensating scan recovers it.
     */
    public void markDirty(long tenantId, long conversationId, long turnId, int dispatchAttempt,
            long eventSeq, String eventType) {
        markDirty(tenantId, conversationId, turnId, dispatchAttempt, eventSeq, eventType, false, true);
    }

    public void markDirty(long tenantId, long conversationId, long turnId, int dispatchAttempt,
            long eventSeq, String eventType, boolean large, boolean newSlice) {
        try {
            nestedMark.executeWithoutResult(status -> writeDirty(tenantId, conversationId, turnId,
                    dispatchAttempt, eventSeq, eventType, large, newSlice));
        } catch (org.springframework.transaction.NestedTransactionNotSupportedException unsupported) {
            // A different transaction manager may lack savepoints. Defer to the existing bounded
            // recovery queue after the raw inbound transaction has released its connection.
            Runnable recover = () -> {
                ConversationEventDisplayRecovery recovery = recoveryProvider == null ? null : recoveryProvider.getIfAvailable();
                if (recovery != null) recovery.request(tenantId, conversationId, turnId);
            };
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override public void afterCompletion(int status) {
                        if (status == STATUS_COMMITTED) recover.run();
                    }
                });
            } else {
                recover.run();
            }
        }
    }

    private void writeDirty(long tenantId, long conversationId, long turnId, int dispatchAttempt,
            long eventSeq, String eventType, boolean large, boolean newSlice) {
        ConversationEventDisplayDO row = new ConversationEventDisplayDO();
        row.setTenantId(tenantId);
        row.setConversationId(conversationId);
        row.setTurnId(turnId);
        row.setDispatchAttempt(dispatchAttempt);
        row.setEventSeq(eventSeq);
        row.setEventType(eventType == null ? "unknown" : eventType);
        row.setStatus(ConversationEventDisplayDO.STATUS_PREPARING);
        row.setQueueClass(large ? CLASS_LARGE : ConversationEventDisplayDO.CLASS_REALTIME);
        row.setProjectionVersion(ConversationEventDisplayBudget.PROJECTION_VERSION);
        row.setGmtCreate(new Date());
        // The savepoint isolates a derived failure while using the inbound connection.
        displayDao.insertTask(row);
        if (newSlice) {
            displayDao.rearmFailed(tenantId, conversationId, turnId, dispatchAttempt, eventSeq, new Date());
            displayDao.wakePending(tenantId, conversationId, turnId, dispatchAttempt, eventSeq,
                    row.getQueueClass(), new Date());
            if (TransactionSynchronizationManager.isActualTransactionActive()
                    && TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override public void afterCommit() { inboundRevision.incrementAndGet(); }
                });
            } else {
                inboundRevision.incrementAndGet();
            }
        }
    }

    /** Creates missing display rows for one turn, bounded per call. */
    public int backfillTurn(long tenantId, long conversationId, long turnId) {
        int created = 0;
        int afterAttempt = -1;
        long afterEventSeq = -1L;
        int guard = 0;
        while (guard++ < ConversationEventDisplayBudget.WORKER_BATCH) {
            List<ConversationEventDisplayDO> keys = displayDao.listMissingLogicalKeys(
                    tenantId, conversationId, turnId, 1, afterEventSeq, afterAttempt);
            if (keys.isEmpty()) {
                break;
            }
            ConversationEventDisplayDO key = keys.get(0);
            try {
                created += displayDao.insertFromFirstRawChunk(tenantId, conversationId, turnId,
                        key.getDispatchAttempt() == null ? 0 : key.getDispatchAttempt(),
                        key.getEventSeq() == null ? 0L : key.getEventSeq(),
                        ConversationEventDisplayBudget.PROJECTION_VERSION,
                        ConversationEventDisplayDO.CLASS_INTERACTIVE);
            } catch (RuntimeException e) {
                log.warn("display backfill insert failed turnId={} attempt={} seq={}: {}",
                        turnId, key.getDispatchAttempt(), key.getEventSeq(), e.getMessage());
                break;
            }
            afterAttempt = key.getDispatchAttempt() == null ? 0 : key.getDispatchAttempt();
            afterEventSeq = key.getEventSeq() == null ? 0L : key.getEventSeq();
        }
        return created;
    }

    /**
     * 后台历史发现：按原始主键范围推进的持久 checkpoint 扫描。
     *
     * <p>不 JOIN 派生表、不 GROUP BY、不读 payload：每批只受行数与时间预算约束。
     * 扫到末尾后回卷到 0 并递增 generation，迟到提交的低 ID 在下一轮有界核对中被补上；
     * highWater 只增不减，用于区分「尚未发现」与「确实没有可见事件」。
     */
    public int scanHistoryBatch(int rowLimit, long timeBudgetMs) {
        int limit = Math.max(1, Math.min(1000, rowLimit));
        long deadline = System.currentTimeMillis() + Math.max(1L, timeBudgetMs);
        ConversationEventDisplayScanDO scan = displayDao.findScan(SCAN_KEY);
        if (scan == null) {
            displayDao.insertScanIfAbsent(SCAN_KEY, new Date());
            scan = displayDao.findScan(SCAN_KEY);
        }
        long cursor = scan == null || scan.getLastRawId() == null ? 0L : scan.getLastRawId();
        long highWater = scan == null || scan.getHighWaterRawId() == null
                ? 0L : scan.getHighWaterRawId();
        long generation = scan == null || scan.getGeneration() == null ? 0L : scan.getGeneration();
        Date now = new Date();
        if (scan != null && scan.getQuietUntil() != null && scan.getQuietUntil().after(now)) {
            // 上一轮完整扫描没有发现任何待补建行：顺延到 quietUntil，避免空转重扫。
            return 0;
        }
        int created = 0;
        boolean scannedAny = false;
        while (System.currentTimeMillis() < deadline) {
            List<AgentConversationTurnEventDO> rows = eventDao.listRawKeysAfter(cursor, limit);
            if (rows.isEmpty()) {
                if (scannedAny) {
                    cursor = 0L;
                    generation += 1L;
                }
                break;
            }
            Set<String> batchKeys = new LinkedHashSet<>();
            for (AgentConversationTurnEventDO row : rows) {
                long rawId = row.getId() == null ? 0L : row.getId();
                highWater = Math.max(highWater, rawId);
                String logicalKey = row.getTurnId() + ":" + row.getDispatchAttempt()
                        + ":" + row.getEventSeq();
                if (!batchKeys.add(logicalKey)) {
                    continue;
                }
                try {
                    created += displayDao.insertFromFirstRawChunk(row.getTenantId(),
                            row.getConversationId(), row.getTurnId(),
                            row.getDispatchAttempt() == null ? 0 : row.getDispatchAttempt(),
                            row.getEventSeq() == null ? 0L : row.getEventSeq(),
                            ConversationEventDisplayBudget.PROJECTION_VERSION, classFor(row, now));
                } catch (RuntimeException e) {
                    log.warn("display history scan insert failed turnId={} attempt={} seq={}: {}",
                            row.getTurnId(), row.getDispatchAttempt(), row.getEventSeq(),
                            e.getMessage());
                }
            }
            scannedAny = true;
            cursor = rows.get(rows.size() - 1).getId() == null
                    ? cursor : rows.get(rows.size() - 1).getId();
            if (rows.size() < limit) {
                // 已到末尾：本批次完成一轮，下一轮从 0 开始做有界核对。
                cursor = 0L;
                generation += 1L;
                break;
            }
        }
        if (scannedAny) {
            Date quietUntil = created == 0 && generation > 0
                    ? new Date(System.currentTimeMillis() + QUIET_SCAN_MS) : null;
            displayDao.advanceScan(SCAN_KEY, cursor, highWater, generation, quietUntil,
                    new Date());
        }
        return created;
    }

    /** 实时通道：只认领实时与受限交互队列，永不等待历史扫描或历史失败。 */
    public int processRealtimeDue(int limit) {
        if (System.currentTimeMillis() < realtimeFailureUntil) return 0;
        long revision = inboundRevision.get();
        if (revision == realtimeRevision && System.currentTimeMillis() < realtimeIdleUntil) return 0;
        int offset = Math.floorMod(rotationOffset.getAndIncrement(), REALTIME_ROTATION_BUCKETS);
        int processed;
        try {
            processed = claimAndPrepare(List.of(ConversationEventDisplayDO.CLASS_REALTIME,
                ConversationEventDisplayDO.CLASS_INTERACTIVE), REALTIME_ROTATION_BUCKETS,
                offset, limit);
        } catch (RuntimeException failure) {
            realtimeFailureUntil = System.currentTimeMillis() + 1000;
            throw failure;
        }
        realtimeRevision = revision;
        realtimeIdleUntil = processed == 0 ? System.currentTimeMillis() + 1000 : 0;
        return processed;
    }

    /** 历史通道：只认领后台回填队列，使用独立调度与独立预算。 */
    public int processHistoryDue(int limit) {
        return claimAndPrepare(List.of(ConversationEventDisplayDO.CLASS_HISTORY), 0, 0, limit);
    }

    /** Large logical events cannot occupy the small-event preparation lane. */
    public int processLargeDue(int limit) {
        if (System.currentTimeMillis() < largeFailureUntil) return 0;
        long revision = inboundRevision.get();
        if (revision == largeRevision && System.currentTimeMillis() < largeIdleUntil) return 0;
        int processed;
        try {
            processed = claimAndPrepare(List.of(CLASS_LARGE), 0, 0, limit);
        } catch (RuntimeException failure) {
            largeFailureUntil = System.currentTimeMillis() + 1000;
            throw failure;
        }
        largeRevision = revision;
        largeIdleUntil = processed == 0 ? System.currentTimeMillis() + 1000 : 0;
        return processed;
    }

    private int claimAndPrepare(List<String> classes, int rotationBuckets, int rotationOffsetValue,
            int limit) {
        Date now = new Date();
        Date leaseUntil = new Date(now.getTime() + ConversationEventDisplayBudget.LEASE_MS);
        int processed = 0;
        java.util.Map<Long, ConversationEventDisplayDO> page = new java.util.LinkedHashMap<>();
        int pageSize = Math.max(1, Math.min(100, limit));
        for (String queueClass : classes) {
            ClaimCursor cursor = claimCursors.getOrDefault(queueClass, new ClaimCursor(0, 0));
            List<ConversationEventDisplayDO> rows = displayDao.listClaimablePage(now, queueClass,
                    cursor.turnId(), cursor.id(), pageSize);
            if (rows.isEmpty() && cursor.id() != 0) {
                rows = displayDao.listClaimablePage(now, queueClass, 0, 0, pageSize);
            }
            if (rows.isEmpty()) {
                claimCursors.put(queueClass, new ClaimCursor(0, 0));
            } else {
                ConversationEventDisplayDO last = rows.get(rows.size() - 1);
                claimCursors.put(queueClass, new ClaimCursor(last.getTurnId(), last.getId()));
                for (ConversationEventDisplayDO row : rows) page.put(row.getId(), row);
            }
        }
        List<Long> candidates = new ArrayList<>(page.keySet());
        // Bounded keyset pages advance across the backlog; rotation never sorts the full queue.
        for (int i = 0; i < candidates.size(); i++) {
            Long id = candidates.get(Math.floorMod(i + rotationOffsetValue, candidates.size()));
            if (processed >= limit) break;
            if (displayDao.claim(id, now, leaseUntil, instanceId) != 1) {
                continue;
            }
            processed++;
            try {
                prepare(id);
            } catch (RuntimeException e) {
                log.warn("display preparation crashed id={}: {}", id, e.getMessage());
                displayDao.releaseLease(id, instanceId);
            }
        }
        return processed;
    }

    /** 只含计数，不含正文或凭证；用于观察实时/历史积压与扫描进度。 */
    public String queueSnapshot() {
        ConversationEventDisplayScanDO scan = displayDao.findScan(SCAN_KEY);
        return "realtime=" + displayDao.countByQueueClass(ConversationEventDisplayDO.CLASS_REALTIME)
                + " interactive=" + displayDao.countByQueueClass(
                        ConversationEventDisplayDO.CLASS_INTERACTIVE)
                + " history=" + displayDao.countByQueueClass(ConversationEventDisplayDO.CLASS_HISTORY)
                + " rawCursor=" + (scan == null || scan.getLastRawId() == null
                        ? 0L : scan.getLastRawId())
                + " rawHighWater=" + (scan == null || scan.getHighWaterRawId() == null
                        ? 0L : scan.getHighWaterRawId());
    }

    private static String classFor(AgentConversationTurnEventDO row, Date now) {
        if (row.getChunkCount() != null && row.getChunkCount() > 1) return CLASS_LARGE;
        Date created = row.getGmtCreate();
        if (created != null && now.getTime() - created.getTime() <= RECENT_REALTIME_WINDOW_MS) {
            return ConversationEventDisplayDO.CLASS_REALTIME;
        }
        return ConversationEventDisplayDO.CLASS_HISTORY;
    }

    void prepare(long displayId) {
        ConversationEventDisplayDO display = displayDao.findById(displayId);
        if (display == null || !ConversationEventDisplayDO.STATUS_PREPARING.equals(display.getStatus())) {
            return;
        }
        if (!CLASS_LARGE.equals(display.getQueueClass())) {
            List<AgentConversationTurnEventDO> first = eventDao.listChunkMeta(display.getTenantId(),
                    display.getTurnId(), display.getDispatchAttempt(), display.getEventSeq(), -1, 1);
            if (!first.isEmpty() && ((first.get(0).getChunkCount() != null && first.get(0).getChunkCount() > 1)
                    || (first.get(0).getPayloadBytes() != null
                    && first.get(0).getPayloadBytes() > ConversationBrowserEventPublisher.MAX_REALTIME_FRAME_BYTES))) {
                displayDao.requeueLarge(displayId, instanceId, new Date());
                return;
            }
        }
        boolean large = CLASS_LARGE.equals(display.getQueueClass());
        if (large && !tryAcquireLargeProjection()) {
            // Waiting for the shared large-projection permit is not a failed preparation attempt.
            displayDao.requeueLarge(displayId, instanceId, new Date());
            return;
        }
        try {
            prepareClaimed(display);
        } finally {
            if (large) releaseLargeProjection();
        }
    }

    private void prepareClaimed(ConversationEventDisplayDO display) {
        long displayId = display.getId();
        AgentConversationTurnDO turn = turnDao.findByConversationTurn(display.getTenantId(),
                display.getConversationId(), display.getTurnId());
        if (turn == null) {
            displayDao.markSourceRemoved(displayId);
            return;
        }
        AgentConversationDO conversation = conversationDao.findById(display.getTenantId(),
                display.getConversationId());
        if (conversation == null) {
            displayDao.markSourceRemoved(displayId);
            return;
        }

        SliceScan scan;
        try {
            scan = scanSlices(display);
        } catch (HardRejection e) {
            publishFailed(display, e.getMessage());
            return;
        }
        if (!scan.complete()) {
            retryOrFail(display, turn, "incomplete slices expected=" + scan.expectedCount()
                    + " actual=" + scan.foundCount());
            return;
        }

        ConversationEventDisplayProjection.Prepared prepared;
        try {
            prepared = project(conversation.getChannel(), display.getEventType(), scan.payload());
        } catch (ConversationEventDisplayProjection.RejectedException e) {
            log.warn("display projection rejected id={} reason={}", displayId, e.getRejection());
            publishFailed(display, "projection rejected: " + e.getRejection());
            return;
        } catch (RuntimeException e) {
            retryOrFail(display, turn, "projection failed: " + e.getMessage());
            return;
        }
        publishReady(display, prepared);
    }

    /** Upgrade readable legacy rows without ever replacing valid history with a failed task. */
    public int upgradeLegacyReady(long tenantId, long conversationId, long turnId) {
        return upgradeLegacyReadyPage(tenantId, conversationId, turnId, 0).upgraded();
    }

    public record LegacyUpgradePage(int upgraded, long nextCursor, boolean hasMore) { }

    public LegacyUpgradePage upgradeLegacyReadyPage(long tenantId, long conversationId, long turnId,
            long afterSeq) {
        AgentConversationDO conversation = conversationDao.findById(tenantId, conversationId);
        if (conversation == null) return new LegacyUpgradePage(0, afterSeq, false);
        int upgraded = 0;
        var rows = displayDao.listLegacyReady(tenantId, conversationId, turnId, afterSeq);
        long next = afterSeq;
        boolean deferred = false;
        for (ConversationEventDisplayDO row : rows) {
            try {
                if (!tryAcquireLargeProjection()) {
                    deferred = true;
                    break;
                }
                next = Math.max(next, row.getPublicationSeq());
                try {
                SliceScan scan = scanSlices(row);
                String body = scan.complete() ? scan.payload() : legacyProjectionBody(row);
                if (body == null) continue;
                var prepared = project(conversation.getChannel(), row.getEventType(), body);
                publishReady(row, prepared);
                upgraded++;
                } finally {
                    releaseLargeProjection();
                }
            } catch (RuntimeException unavailableSource) {
                // Raw retention or an invalid old payload must not destroy the existing v1 body.
                log.debug("legacy display upgrade deferred id={} reason={}", row.getId(),
                        unavailableSource.getClass().getSimpleName());
            }
        }
        return new LegacyUpgradePage(upgraded, next, deferred || rows.size() == 20);
    }

    private String legacyProjectionBody(ConversationEventDisplayDO row) {
        int total = row.getTotalSegments() == null ? 0 : row.getTotalSegments();
        if (total < 1 || total > ConversationEventDisplayBudget.MAX_CHUNKS) return null;
        StringBuilder body = new StringBuilder();
        long bytes = 0;
        int next = 0;
        while (next < total) {
            var page = segmentDao.listSegments(row.getId(), "v1", next,
                    ConversationEventDisplayBudget.CHUNK_BATCH);
            if (page.isEmpty()) return null;
            for (var segment : page) {
                if (segment.getSegmentIndex() != next || segment.getContent() == null) return null;
                bytes += ConversationEventDisplayBudget.utf8Length(segment.getContent());
                if (bytes > ConversationEventDisplayBudget.MAX_EVENT_BYTES) return null;
                body.append(segment.getContent());
                next++;
            }
        }
        return next == total ? body.toString() : null;
    }

    /** Seam for the projection step so failures are testable without a static mock. */
    ConversationEventDisplayProjection.Prepared project(String channel, String eventType, String raw) {
        return ConversationEventDisplayProjection.prepare(channel, eventType, raw);
    }

    private SliceScan scanSlices(ConversationEventDisplayDO display) {
        int expected = -1;
        int afterIndex = -1;
        long totalBytes = 0;
        List<AgentConversationTurnEventDO> metas = new ArrayList<>();
        while (true) {
            List<AgentConversationTurnEventDO> page = eventDao.listChunkMeta(display.getTenantId(),
                    display.getTurnId(), display.getDispatchAttempt(), display.getEventSeq(),
                    afterIndex, ConversationEventDisplayBudget.CHUNK_BATCH);
            if (page.isEmpty()) {
                break;
            }
            for (AgentConversationTurnEventDO meta : page) {
                int chunkCount = meta.getChunkCount() == null ? 0 : meta.getChunkCount();
                int chunkIndex = meta.getChunkIndex() == null ? -1 : meta.getChunkIndex();
                if (chunkCount < 1) {
                    throw new HardRejection("invalid slice count " + chunkCount);
                }
                if (expected < 0) {
                    expected = chunkCount;
                } else if (expected != chunkCount) {
                    throw new HardRejection("slice count mismatch expected=" + expected + " got=" + chunkCount);
                }
                if (chunkIndex != afterIndex + 1) {
                    // A gap is out-of-order delivery, not corrupted structure: retry until the
                    // missing slice arrives and only fail on the terminal/time/attempt rules.
                    return new SliceScan(expected, metas.size(), null);
                }
                afterIndex = chunkIndex;
                totalBytes += meta.getPayloadBytes() == null ? 0L : meta.getPayloadBytes();
                if (totalBytes > ConversationEventDisplayBudget.MAX_EVENT_BYTES) {
                    throw new HardRejection("raw event exceeds 32MiB");
                }
                metas.add(meta);
                if (metas.size() > ConversationEventDisplayBudget.MAX_CHUNKS) {
                    throw new HardRejection("slice count exceeds limit");
                }
            }
            if (expected >= 0 && metas.size() >= expected) {
                break;
            }
        }
        if (expected < 0 || metas.size() != expected) {
            return new SliceScan(expected, metas.size(), null);
        }

        StringBuilder payload = new StringBuilder((int) Math.min(totalBytes, 8L * 1024 * 1024));
        afterIndex = -1;
        int maxChars = (int) Math.min((long) Integer.MAX_VALUE - 8,
                ConversationEventDisplayBudget.MAX_EVENT_BYTES + 16);
        while (afterIndex + 1 < expected) {
            List<AgentConversationTurnEventDO> page = eventDao.listChunkPayloads(display.getTenantId(),
                    display.getTurnId(), display.getDispatchAttempt(), display.getEventSeq(),
                    afterIndex, ConversationEventDisplayBudget.CHUNK_BATCH, maxChars);
            if (page.isEmpty()) {
                break;
            }
            for (AgentConversationTurnEventDO chunk : page) {
                payload.append(chunk.getPayloadFragment() == null ? "" : chunk.getPayloadFragment());
                afterIndex = chunk.getChunkIndex() == null ? afterIndex + 1 : chunk.getChunkIndex();
            }
        }
        if (afterIndex + 1 != expected) {
            return new SliceScan(expected, afterIndex + 1, null);
        }
        String raw = payload.toString();
        if (ConversationEventDisplayBudget.utf8Length(raw) > ConversationEventDisplayBudget.MAX_EVENT_BYTES) {
            throw new HardRejection("raw event exceeds 32MiB after reassembly");
        }
        return new SliceScan(expected, expected, raw);
    }

    private void publishReady(ConversationEventDisplayDO display,
            ConversationEventDisplayProjection.Prepared prepared) {
        String version = ConversationEventDisplayBudget.PROJECTION_VERSION;
        required.executeWithoutResult(status -> {
            AgentConversationTurnDO locked = turnDao.findByConversationTurnForUpdate(
                    display.getTenantId(), display.getConversationId(), display.getTurnId());
            if (locked == null) {
                displayDao.markSourceRemoved(display.getId());
                return;
            }
            Long max = displayDao.selectMaxPublicationSeq(display.getTenantId(),
                    display.getConversationId(), display.getTurnId());
            long seq = (max == null ? 0L : max) + 1L;
            Date now = new Date();
            List<ConversationEventContentSegmentDO> segments = new ArrayList<>(prepared.segments().size());
            int index = 0;
            for (String content : prepared.segments()) {
                ConversationEventContentSegmentDO segment = new ConversationEventContentSegmentDO();
                segment.setDisplayId(display.getId());
                segment.setProjectionVersion(version);
                segment.setSegmentIndex(index++);
                segment.setContent(content);
                segment.setContentBytes(ConversationEventDisplayBudget.utf8Length(content));
                segments.add(segment);
            }
            segmentDao.deleteByDisplay(display.getId(), version);
            // A 32MiB projection can produce thousands of slices; keep each statement bounded.
            for (int start = 0; start < segments.size(); start += 100) {
                segmentDao.insertBatch(segments.subList(start, Math.min(segments.size(), start + 100)));
            }
            displayDao.markReady(display.getId(), seq, prepared.summary(), prepared.bytes(),
                    segments.size(), prepared.truncated(), prepared.detailAvailable(), version, now);
            int pending = displayDao.countByStatus(display.getTenantId(),
                    display.getConversationId(), display.getTurnId(),
                    ConversationEventDisplayDO.STATUS_PREPARING);
            String preparationStatus = pending > 0 ? "PARTIAL" : "READY";
            notifyAfterCommit(display, seq, "READY", preparationStatus);
        });
    }

    private void publishFailed(ConversationEventDisplayDO display, String reason) {
        required.executeWithoutResult(status -> {
            AgentConversationTurnDO locked = turnDao.findByConversationTurnForUpdate(
                    display.getTenantId(), display.getConversationId(), display.getTurnId());
            if (locked == null) {
                displayDao.markSourceRemoved(display.getId());
                return;
            }
            Long max = displayDao.selectMaxPublicationSeq(display.getTenantId(),
                    display.getConversationId(), display.getTurnId());
            long seq = (max == null ? 0L : max) + 1L;
            int expected = display.getAttemptCount() == null ? 0 : display.getAttemptCount();
            if (displayDao.markFailedIfCurrent(display.getId(), seq, trimReason(reason), expected, instanceId, new Date()) == 1) {
                notifyAfterCommit(display, seq, "UNAVAILABLE", "UNAVAILABLE");
            } else {
                displayDao.releaseLease(display.getId(), instanceId);
            }
        });
    }

    private void notifyAfterCommit(ConversationEventDisplayDO display, long seq, String state,
            String preparationStatus) {
        if (publisher == null || ConversationBrowserEventPublisher.isBusinessControlType(display.getEventType())) {
            return;
        }
        Runnable notification = () -> publisher.publishDisplayAvailable(display.getConversationId(),
                display.getTurnId(), display.getId(), seq, state, preparationStatus, display.getEventType());
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    notification.run();
                }
            });
        } else {
            notification.run();
        }
    }

    private void retryOrFail(ConversationEventDisplayDO display, AgentConversationTurnDO turn,
            String reason) {
        int attempts = display.getAttemptCount() == null ? 0 : display.getAttemptCount();
        boolean terminal = turn.getStatus() != null && !"PROCESSING".equals(turn.getStatus());
        long age = display.getGmtCreate() == null ? 0L
                : System.currentTimeMillis() - display.getGmtCreate().getTime();
        boolean missingLongEnough = terminal
                && age >= ConversationEventDisplayBudget.MISSING_CHUNK_FAILED_MS;
        if (attempts >= ConversationEventDisplayBudget.MAX_PREPARE_ATTEMPTS || missingLongEnough) {
            publishFailed(display, reason);
            return;
        }
        Date next = new Date(System.currentTimeMillis() + ConversationEventDisplayBudget.RETRY_DELAY_MS);
        if (displayDao.scheduleRetry(display.getId(), next, trimReason(reason), new Date()) == 0) {
            // A slice committed during this scan reset the attempt counter: re-read immediately
            // rather than overwriting its wakeup with the stale scan's thirty-second backoff.
            displayDao.releaseLease(display.getId(), instanceId);
        }
        log.info("display preparation retry id={} attempt={} reason={}", display.getId(), attempts, reason);
    }

    /** Removes derived rows whose source turn no longer exists. */
    public int cleanupExpired(int retentionDays, int batchSize) {
        Date cutoff = new Date(System.currentTimeMillis() - retentionDays * 24L * 60L * 60L * 1000L);
        List<Long> ids = displayDao.listExpiredIds(cutoff, batchSize);
        if (ids.isEmpty()) {
            return 0;
        }
        segmentDao.deleteByDisplayIds(ids);
        return displayDao.deleteByIds(ids);
    }

    private static String trimReason(String reason) {
        if (reason == null) {
            return null;
        }
        return reason.length() > 250 ? reason.substring(0, 250) : reason;
    }

    private record SliceScan(int expectedCount, int foundCount, String payload) {
        boolean complete() {
            return payload != null && expectedCount > 0 && foundCount == expectedCount;
        }
    }

    private static final class HardRejection extends RuntimeException {
        HardRejection(String message) {
            super(message);
        }
    }
}
