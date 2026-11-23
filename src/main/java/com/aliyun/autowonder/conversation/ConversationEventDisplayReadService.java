package com.aliyun.autowonder.conversation;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.conversation.dto.ConversationEventDisplayDtos.ContentSegment;
import com.aliyun.autowonder.conversation.dto.ConversationEventDisplayDtos.SummaryItem;
import com.aliyun.autowonder.conversation.dto.ConversationEventDisplayDtos.SummaryPage;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/** Reads publication-ordered summaries and UTF-8 bounded content segments. */
@Service
public class ConversationEventDisplayReadService {

    public static final String STATE_READY = "READY";
    public static final String STATE_PREPARING = "PREPARING";
    public static final String STATE_UNAVAILABLE = "UNAVAILABLE";

    public static final String PREPARATION_EMPTY = "EMPTY";
    public static final String PREPARATION_PREPARING = "PREPARING";
    public static final String PREPARATION_PARTIAL = "PARTIAL";
    public static final String PREPARATION_READY = "READY";
    public static final String PREPARATION_UNAVAILABLE = "UNAVAILABLE";

    private static final long PREPARING_RETRY_MS = 3000L;
    /** 按需补建一轮没有任何进展时的退避：避免永久失败的逻辑键以 3s 节奏持续打库。 */
    private static final long PREPARING_NO_PROGRESS_MS = 30_000L;

    private final ConversationEventDisplayDao displayDao;
    private final ConversationEventContentSegmentDao segmentDao;
    private final AgentConversationTurnDao turnDao;
    private final ConversationEventDisplayRecovery recovery;

    public ConversationEventDisplayReadService(ConversationEventDisplayDao displayDao,
            ConversationEventContentSegmentDao segmentDao, AgentConversationTurnDao turnDao,
            ConversationEventDisplayRecovery recovery) {
        this.displayDao = displayDao;
        this.segmentDao = segmentDao;
        this.turnDao = turnDao;
        this.recovery = recovery;
    }

    /** Ownership is validated before anything is read; the event id is not an authorisation token. */
    public void requireTurn(long tenantId, long conversationId, long turnId) {
        if (turnDao.findByConversationTurn(tenantId, conversationId, turnId) == null) {
            throw new BizException(ErrorCode.CONVERSATION_EVENT_TURN_MISMATCH);
        }
    }

    public SummaryPage readSummaries(long tenantId, long conversationId, long turnId,
            String cursor, Integer requestedLimit) {
        requireTurn(tenantId, conversationId, turnId);
        long afterSeq = parseCursor(cursor);
        int limit = requestedLimit == null ? ConversationEventDisplayBudget.MAX_LIST_ITEMS
                : Math.max(1, Math.min(ConversationEventDisplayBudget.MAX_LIST_ITEMS, requestedLimit));
        List<ConversationEventDisplayDO> rows = displayDao.listPublishedAfter(
                tenantId, conversationId, turnId, afterSeq, limit + 1);

        List<SummaryItem> items = new ArrayList<>();
        boolean legacy = false;
        int used = ConversationEventDisplayBudget.MAX_STATUS_RESPONSE_BYTES;
        boolean more = false;
        Long nextCursor = null;
        for (int i = 0; i < rows.size(); i++) {
            ConversationEventDisplayDO row = rows.get(i);
            if (items.size() >= limit) {
                more = true;
                break;
            }
            SummaryItem item = toItem(row);
            legacy |= item.detailAvailable() && "v1".equals(item.projectionVersion());
            int size = ConversationEventDisplayBudget.encodedLength(item);
            if (used + size > ConversationEventDisplayBudget.MAX_LIST_RESPONSE_BYTES && !items.isEmpty()) {
                more = true;
                break;
            }
            items.add(item);
            used += size;
            nextCursor = row.getPublicationSeq();
        }

        int ready = displayDao.countByStatus(tenantId, conversationId, turnId,
                ConversationEventDisplayDO.STATUS_READY);
        int failed = displayDao.countByStatus(tenantId, conversationId, turnId,
                ConversationEventDisplayDO.STATUS_FAILED);
        int pending = displayDao.countByStatus(tenantId, conversationId, turnId,
                ConversationEventDisplayDO.STATUS_PREPARING);
        if (pending > 0 || legacy || (items.isEmpty() && afterSeq > 0
                && displayDao.findLegacyReadyId(tenantId, conversationId, turnId) != null)) {
            recovery.request(tenantId, conversationId, turnId);
        }
        String preparationStatus = preparationStatus(ready, failed, pending);
        int onDemandCreated = 0;
        if (pending == 0) {
            // 发现完备性对所有 pending==0 的候选终态生效：该轮仍有原始事件没有 display 行时，
            // 已发布的 20 行不能代表整轮，必须继续报告 PARTIAL/PREPARING 让客户端继续补偿。
            onDemandCreated = resolveUndiscoveredTurn(tenantId, conversationId, turnId);
            if (onDemandCreated >= 0) {
                preparationStatus = ready + failed > 0
                        ? PREPARATION_PARTIAL : PREPARATION_PREPARING;
            }
        }
        boolean syncing = PREPARATION_PREPARING.equals(preparationStatus)
                || PREPARATION_PARTIAL.equals(preparationStatus) || pending > 0;
        Long retryAfterMs = null;
        if (syncing) {
            retryAfterMs = pending == 0 && onDemandCreated == 0
                    ? PREPARING_NO_PROGRESS_MS : PREPARING_RETRY_MS;
        }
        Long watermark = displayDao.maxPublishedSeq(tenantId, conversationId, turnId);
        return new SummaryPage(items, nextCursor, more, preparationStatus,
                ConversationEventDisplayBudget.PROJECTION_VERSION, pending, failed, retryAfterMs,
                watermark);
    }

    /**
     * 把「发现完备性」判定从仅 EMPTY 扩展到所有 pending==0 的候选终态。
     *
     * <p>该轮仍有原始事件没有 display 行时：已有 ready/failed 行则报 PARTIAL，否则报
     * PREPARING，并继续做一次有界按需补建（≤WORKER_BATCH 个逻辑键），直到该轮全部
     * 授权事件都建行并发布后才允许 READY/EMPTY。
     *
     * <p>判定按轮次做唯一键反连接（LIMIT 1），而不是比较全局扫描水位：实时轮次的原始
     * 主键通常超前于后台扫描，用水位会把正常轮次长期误判为未发现并导致无限补偿。
     *
     * @return 发现完备时返回 -1；否则返回本次按需补建新建的行数（0 表示本轮没有进展）
     */
    private int resolveUndiscoveredTurn(long tenantId, long conversationId, long turnId) {
        if (displayDao.findMissingLogicalKey(tenantId, conversationId, turnId) == null) {
            return -1;
        }
        recovery.request(tenantId, conversationId, turnId);
        return 1;
    }

    public ContentSegment readContentSegment(long tenantId, long conversationId, long turnId,
            long eventId, String cursor, String projectionVersion) {
        requireTurn(tenantId, conversationId, turnId);
        ConversationEventDisplayDO display = displayDao.findById(eventId);
        if (display == null
                || display.getTenantId() == null || display.getTenantId() != tenantId
                || display.getConversationId() == null || display.getConversationId() != conversationId
                || display.getTurnId() == null || display.getTurnId() != turnId) {
            throw new BizException(ErrorCode.CONVERSATION_EVENT_TURN_MISMATCH);
        }
        String version = display.getProjectionVersion() == null
                ? "v1" : display.getProjectionVersion();
        if (projectionVersion != null && !projectionVersion.isBlank()
                && !version.equals(projectionVersion)) {
            throw new BizException(ErrorCode.CONVERSATION_EVENT_PROJECTION_STALE);
        }
        if (ConversationEventDisplayDO.STATUS_PREPARING.equals(display.getStatus())) {
            return new ContentSegment(eventId, null, 0, null, null, false, version,
                    STATE_PREPARING, PREPARING_RETRY_MS);
        }
        if (!ConversationEventDisplayDO.STATUS_READY.equals(display.getStatus())) {
            return new ContentSegment(eventId, null, 0, null, null, false, version,
                    STATE_UNAVAILABLE, null);
        }
        int segmentIndex = (int) parseCursor(cursor);
        int total = display.getTotalSegments() == null ? 0 : display.getTotalSegments();
        if (total <= 0) {
            return new ContentSegment(eventId, "", 0, null, null, false, version, STATE_READY, null);
        }
        if (segmentIndex < 0 || segmentIndex >= total) {
            throw new BizException(ErrorCode.PARAM_INVALID);
        }
        ConversationEventContentSegmentDO segment = segmentDao.findSegment(eventId, version, segmentIndex);
        if (segment == null) {
            throw new BizException(ErrorCode.CONVERSATION_EVENT_DISPLAY_PREPARING);
        }
        boolean hasMore = segmentIndex + 1 < total;
        Long previousCursor = segmentIndex > 0 ? (long) (segmentIndex - 1) : null;
        Long nextCursor = hasMore ? (long) (segmentIndex + 1) : null;
        return new ContentSegment(eventId, segment.getContent(), segmentIndex, previousCursor,
                nextCursor, hasMore, version, STATE_READY, null);
    }

    private SummaryItem toItem(ConversationEventDisplayDO row) {
        boolean failed = ConversationEventDisplayDO.STATUS_FAILED.equals(row.getStatus());
        boolean detail = row.getDetailAvailable() != null && row.getDetailAvailable() != 0;
        String state = failed ? STATE_UNAVAILABLE : STATE_READY;
        // Small events carry their exact text in payload only; large ones carry the summary only.
        String summary = failed || !detail ? null : row.getSummary();
        String payload = failed || detail ? null : row.getSummary();
        return new SummaryItem(row.getId(), row.getEventType(),
                row.getDispatchAttempt() == null ? 0 : row.getDispatchAttempt(),
                row.getEventSeq() == null ? 0L : row.getEventSeq(),
                iso(row.getGmtCreate()), state,
                row.getTruncated() != null && row.getTruncated() != 0, detail,
                summary, row.getContentLength(),
                row.getTotalSegments(), payload,
                row.getProjectionVersion() == null ? "v1" : row.getProjectionVersion(),
                row.getPublicationSeq());
    }

    static String preparationStatus(int ready, int failed, int pending) {
        if (pending > 0) {
            return ready + failed > 0 ? PREPARATION_PARTIAL : PREPARATION_PREPARING;
        }
        if (ready > 0) {
            return PREPARATION_READY;
        }
        if (failed > 0) {
            return PREPARATION_UNAVAILABLE;
        }
        return PREPARATION_EMPTY;
    }

    private static long parseCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return 0L;
        }
        try {
            long value = Long.parseLong(cursor.trim());
            if (value < 0) {
                throw new NumberFormatException("negative cursor");
            }
            return value;
        } catch (NumberFormatException e) {
            throw new BizException(ErrorCode.PARAM_INVALID);
        }
    }

    private static String iso(Date date) {
        return date == null ? null : Instant.ofEpochMilli(date.getTime()).toString();
    }
}
