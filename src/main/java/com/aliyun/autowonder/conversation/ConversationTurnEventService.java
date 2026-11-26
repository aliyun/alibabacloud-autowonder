package com.aliyun.autowonder.conversation;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.websocket.ConversationRealtimePublisher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class ConversationTurnEventService {

    private static final Logger log = LoggerFactory.getLogger(ConversationTurnEventService.class);
    /** 按轮次取事件的硬上限。一轮 token 级 chunk 可达数千行，不能裸查。 */
    static final int MAX_TURN_EVENTS = 5000;

    private final AgentConversationTurnEventDao eventDao;
    private final AgentConversationDao convDao;
    private final AgentConversationTurnDao turnDao;
    private ConversationBrowserEventPublisher browserEventPublisher;
    private ConversationElicitationService conversationElicitationService;
    private ConversationEventDisplayPreparationService displayPreparationService;

    public ConversationTurnEventService(AgentConversationTurnEventDao eventDao,
            AgentConversationDao convDao, AgentConversationTurnDao turnDao) {
        this.eventDao = eventDao;
        this.convDao = convDao;
        this.turnDao = turnDao;
    }

    @Autowired(required = false)
    public void setBrowserEventPublisher(ConversationBrowserEventPublisher browserEventPublisher) {
        this.browserEventPublisher = browserEventPublisher;
    }

    @Autowired(required = false)
    public void setConversationElicitationService(
            ConversationElicitationService conversationElicitationService) {
        this.conversationElicitationService = conversationElicitationService;
    }

    @Autowired(required = false)
    public void setDisplayPreparationService(
            ConversationEventDisplayPreparationService displayPreparationService) {
        this.displayPreparationService = displayPreparationService;
    }

    @org.springframework.transaction.annotation.Transactional
    public void persistReliableEvent(long tenantId, long executorId, long conversationId,
            long turnId, int dispatchAttempt, long eventSeq, int chunkIndex, int chunkCount,
            String eventType, String payloadFragment) {
        // Serialize critical side effects against cancellation/re-dispatch of this turn.
        AgentConversationTurnDO turn = turnDao.findByConversationTurnForUpdate(tenantId, conversationId, turnId);
        if (turn == null || !"PROCESSING".equals(turn.getStatus())
                || dispatchAttempt <= 0 || !Integer.valueOf(dispatchAttempt).equals(turn.getDispatchAttempt())) return;
        persistEvent(tenantId, executorId, conversationId, turnId, dispatchAttempt, eventSeq,
                chunkIndex, chunkCount, eventType, payloadFragment, true);
    }

    @org.springframework.transaction.annotation.Transactional
    public void persistEvent(long tenantId, long executorId, long conversationId,
            long turnId, int dispatchAttempt, long eventSeq, int chunkIndex, int chunkCount,
            String eventType, String payloadFragment) {
        persistEvent(tenantId, executorId, conversationId, turnId, dispatchAttempt, eventSeq,
                chunkIndex, chunkCount, eventType, payloadFragment, false);
    }

    private void persistEvent(long tenantId, long executorId, long conversationId,
            long turnId, int dispatchAttempt, long eventSeq, int chunkIndex, int chunkCount,
            String eventType, String payloadFragment, boolean reliable) {
        AgentConversationDO conv = convDao.findById(tenantId, conversationId);
        if (conv == null || conv.getExecutorId() == null
                || conv.getExecutorId() != executorId) {
            log.warn("conversation event rejected: executor mismatch tenantId={} conversationId={} "
                    + "executorId={} expectedExecutorId={}",
                    tenantId, conversationId, executorId,
                    conv != null ? conv.getExecutorId() : null);
            return;
        }
        AgentConversationTurnDO turn = turnDao.findProcessingInbound(tenantId, conversationId);
        if (turn == null || turn.getId() != turnId) {
            log.warn("conversation event rejected: no active turn tenantId={} conversationId={} turnId={}",
                    tenantId, conversationId, turnId);
            return;
        }

        // Old runtimes omit attempt (0); keep their existing behavior during rolling upgrades.
        if (dispatchAttempt > 0 && turn.getDispatchAttempt() != null
                && turn.getDispatchAttempt() > 0 && dispatchAttempt != turn.getDispatchAttempt()) {
            log.warn("conversation event rejected: stale attempt conversationId={} turnId={} attempt={}",
                    conversationId, turnId, dispatchAttempt);
            return;
        }

        AgentConversationTurnEventDO event = new AgentConversationTurnEventDO();
        event.setTenantId(tenantId);
        event.setConversationId(conversationId);
        event.setTurnId(turnId);
        event.setDispatchAttempt(dispatchAttempt);
        event.setEventSeq(eventSeq);
        event.setChunkIndex(chunkIndex);
        event.setChunkCount(chunkCount);
        event.setEventType(eventType);
        event.setPayloadFragment(payloadFragment);
        int inserted = eventDao.insertChunkIfAbsent(event);
        boolean large = chunkCount > 1 || ConversationEventDisplayBudget.utf8Length(payloadFragment)
                > ConversationBrowserEventPublisher.MAX_REALTIME_FRAME_BYTES;
        markDisplayDirty(tenantId, conversationId, turnId, dispatchAttempt, eventSeq, eventType, large,
                inserted > 0);

        if (!ConversationBrowserEventPublisher.isBusinessControlType(eventType)) {
            // Ordinary slices are assembled once by the bounded preparation lane, never per arrival.
            if (chunkCount <= 1 && !large && browserEventPublisher != null) {
                try {
                    var prepared = ConversationEventDisplayProjection.prepare(conv.getChannel(), eventType, payloadFragment);
                    // Use exactly the durable projection. Multi-frame events use automatic durable
                    // replay, so a full fast-push queue cannot leave a partially pushed event.
                    if (prepared.segments().size() == 1) {
                        browserEventPublisher.publishDisplay(tenantId, conversationId, turnId, dispatchAttempt,
                                eventSeq, eventType, prepared.segments().get(0));
                    }
                } catch (RuntimeException rejectedProjection) {
                    log.warn("display fast projection rejected conversationId={} turnId={} eventSeq={}",
                            conversationId, turnId, eventSeq);
                }
            }
            return;
        }

        if (chunkCount <= 1 || allChunksPresent(tenantId, turnId, dispatchAttempt, eventSeq, chunkCount)) {
            String assembled = chunkCount <= 1 ? payloadFragment
                    : assemblePayload(eventDao.listLogicalEventChunks(tenantId, turnId, dispatchAttempt, eventSeq));
            if ("status".equals(eventType) && assembled != null) {
                updateCliSessionRefIfPresent(tenantId, conversationId, assembled);
            }
            String questionStatus;
            if (reliable && conversationElicitationService != null && assembled != null
                    && eventType != null && eventType.startsWith(ConversationElicitationService.EVENT_TYPE_PREFIX)) {
                // Database failures must roll back and suppress the receiver ACK, allowing retry.
                questionStatus = conversationElicitationService.onEvent(tenantId, conversationId, turnId, eventType, assembled);
            } else {
                questionStatus = dispatchElicitationEvent(tenantId, conversationId, turnId, eventType, assembled);
            }
            // A late question is retained as settled; do not reopen it after the resolved push.
            if ("acp_elicitation".equals(eventType) && "CANCELED".equals(questionStatus)) return;
            String publicPayload=PlatformConversationChannel.CHANNEL.equals(conv.getChannel())
                    ? PlatformEventProjection.payload(eventType,assembled):assembled;
            String publicType=PlatformConversationChannel.CHANNEL.equals(conv.getChannel())
                    && ("thinking".equals(eventType)||"thinking_delta".equals(eventType))?"status":eventType;
            if (ConversationBrowserEventPublisher.isBusinessControlType(publicType)) {
                publishToBrowser(tenantId, conversationId, turnId, dispatchAttempt, eventSeq, publicType, publicPayload);
            }
        }
    }

    /** Derived mark only: a failure here must not change the reliable inbound business transaction. */
    private void markDisplayDirty(long tenantId, long conversationId, long turnId, int dispatchAttempt,
            long eventSeq, String eventType, boolean large, boolean newSlice) {
        if (displayPreparationService == null) {
            return;
        }
        try {
            displayPreparationService.markDirty(tenantId, conversationId, turnId, dispatchAttempt,
                    eventSeq, eventType, large, newSlice);
        } catch (RuntimeException e) {
            log.warn("conversation event display mark failed conversationId={} turnId={} eventSeq={}: {}",
                    conversationId, turnId, eventSeq, e.getMessage());
        }
    }

    /**
     * 只拦 {@code acp_elicitation*} 前缀：卡片需要可变状态与幂等约束，必须落挂起表；
     * 而 plan 与 commands 是纯展示数据，事件表本身就是它们的持久化载体。
     *
     * <p>分派失败只记 warn —— 卡片落库出问题不该让整条事件流断掉，浏览器仍要收到这条事件。
     */
    private String dispatchElicitationEvent(long tenantId, long conversationId, long turnId,
            String eventType, String assembled) {
        if (conversationElicitationService == null || assembled == null || eventType == null
                || !eventType.startsWith(ConversationElicitationService.EVENT_TYPE_PREFIX)) {
            return null;
        }
        try {
            return conversationElicitationService.onEvent(tenantId, conversationId, turnId, eventType,
                    assembled);
        } catch (RuntimeException e) {
            log.warn("acp elicitation event handling failed conversationId={} turnId={} type={}: {}",
                    conversationId, turnId, eventType, e.getMessage());
        }
        return null;
    }

    public List<AgentConversationTurnEventDO> listEventsAfter(long tenantId, long conversationId,
            long afterId, int limit) {
        return eventDao.listCompletedAfter(tenantId, conversationId, afterId, limit);
    }

    /**
     * 取某一轮次的全部事件，供历史轮次「查看执行详情」按需加载。
     *
     * <p>现有 {@link #listEventsAfter} 只支持 afterId 且被调用方限到 200 条，无法
     * 按轮次取全。这里的上限刻意设得高但有限：执行器逐条转发、一个 token 级
     * chunk 就是一行记录，一轮数百至数千行是常态。
     */
    public List<AgentConversationTurnEventDO> listEventsByTurn(long tenantId, long conversationId,
            long turnId) {
        return eventDao.listByTurn(tenantId, conversationId, turnId, MAX_TURN_EVENTS);
    }

    /**
     * Rebuilds the business reply already shown in the browser when a canceled runtime omits
     * {@code replyMarkdown} from its terminal ACK. Tool and thinking events remain execution
     * details; only the same {@code text} events used for the live reply are retained.
     */
    public String streamedReplyText(long tenantId, long conversationId, long turnId,
            Integer dispatchAttempt) {
        StringBuilder reply = new StringBuilder();
        long replyBytes = 0;
        for (AgentConversationTurnEventDO event : assembleVerbatim(
                eventDao.listByTurn(tenantId, conversationId, turnId, MAX_TURN_EVENTS))) {
            if (!"text".equals(event.getEventType())
                    || dispatchAttempt != null && dispatchAttempt > 0
                    && !dispatchAttempt.equals(event.getDispatchAttempt())) continue;
            try {
                String content = JSON.parseObject(event.getPayloadFragment()).getString("content");
                if (content == null || content.isEmpty()) continue;
                long remaining = ConversationEventDisplayBudget.MAX_EVENT_BYTES - replyBytes;
                if (remaining <= 0) break;
                String retained = ConversationEventDisplayBudget.truncateUtf8(content,
                        (int) Math.min(Integer.MAX_VALUE, remaining));
                reply.append(retained);
                replyBytes += ConversationEventDisplayBudget.utf8Length(retained);
            } catch (RuntimeException invalidPayload) {
                log.debug("ignored invalid text event while preserving canceled reply turnId={} eventSeq={}",
                        turnId, event.getEventSeq());
            }
        }
        return reply.toString();
    }

    public record EventPage(List<AgentConversationTurnEventDO> rows, long nextAfterId, boolean hasMore) {}

    public EventPage listEventsByTurnPage(long tenantId, long conversationId, long turnId,
            long afterId, int requestedLimit) {
        int limit = Math.max(1, Math.min(500, requestedLimit));
        long cursor = Math.max(0, afterId);
        List<AgentConversationTurnEventDO> rows = eventDao.listByTurnAfter(
                tenantId, conversationId, turnId, cursor, limit + 1);
        boolean more = rows.size() > limit;
        List<AgentConversationTurnEventDO> page = List.copyOf(rows.subList(0, Math.min(rows.size(), limit)));
        return new EventPage(page, page.isEmpty() ? cursor : page.get(page.size() - 1).getId(), more);
    }

    public EventPage listPlatformEventsByTurnPage(long tenantId, long conversationId, long turnId,
            long afterId, int limit) {
        int boundedLimit = Math.max(1, Math.min(500, limit));
        long cursor = Math.max(0, afterId);
        List<AgentConversationTurnEventDO> metas = eventDao.listByTurnAfterMeta(
                tenantId, conversationId, turnId, cursor, boundedLimit + 1);
        boolean more = metas.size() > boundedLimit;
        List<AgentConversationTurnEventDO> page = new ArrayList<>(
                metas.subList(0, Math.min(metas.size(), boundedLimit)));
        // Cursor follows raw rows, not projected ids: a fragmented event may straddle pages.
        long next = page.isEmpty() ? cursor : page.get(page.size() - 1).getId();
        return new EventPage(assembleBoundedLegacy(page, channelOf(tenantId, conversationId)), next, more);
    }

    /** Legacy conversation-wide read: bounded bytes, no unbounded completion query. */
    public List<AgentConversationTurnEventDO> listEventsAfterBounded(long tenantId, long conversationId,
            long afterId, int limit) {
        int boundedLimit = Math.max(1, Math.min(500, limit));
        return assembleBoundedLegacy(eventDao.listCompletedAfterMeta(
                tenantId, conversationId, Math.max(0, afterId), boundedLimit),
                channelOf(tenantId, conversationId));
    }

    /** Legacy per-turn read for historical details, bounded the same way. */
    public List<AgentConversationTurnEventDO> listEventsByTurnBounded(long tenantId, long conversationId,
            long turnId) {
        return assembleBoundedLegacy(eventDao.listByTurnMeta(
                tenantId, conversationId, turnId, MAX_TURN_EVENTS),
                channelOf(tenantId, conversationId));
    }

    private String channelOf(long tenantId, long conversationId) {
        AgentConversationDO conversation = convDao.findById(tenantId, conversationId);
        return conversation == null ? null : conversation.getChannel();
    }

    /**
     * Assembles a legacy response only while every logical event is complete inside the page and
     * the whole array stays inside the byte budget. Anything else returns an explicit error rather
     * than a silently truncated array or an unbounded completion query.
     *
     * <p>Content policy is per channel: only the platform assistant is projected through
     * {@link PlatformEventProjection}; clarification and PRD keep their authorised raw text.
     */
    private List<AgentConversationTurnEventDO> assembleBoundedLegacy(
            List<AgentConversationTurnEventDO> metas, String channel) {
        if (metas.isEmpty()) {
            return List.of();
        }
        Map<String, List<AgentConversationTurnEventDO>> groups = new LinkedHashMap<>();
        for (AgentConversationTurnEventDO meta : metas) {
            String key = meta.getTurnId() + ":" + meta.getDispatchAttempt() + ":" + meta.getEventSeq();
            groups.computeIfAbsent(key, ignored -> new ArrayList<>()).add(meta);
        }
        long totalBytes = 0;
        for (List<AgentConversationTurnEventDO> chunks : groups.values()) {
            int expected = chunks.get(0).getChunkCount() == null ? 1 : chunks.get(0).getChunkCount();
            if (chunks.size() < expected) {
                throw new BizException(ErrorCode.CONVERSATION_EVENT_DETAIL_RETRY_LATER);
            }
            for (AgentConversationTurnEventDO chunk : chunks) {
                totalBytes += chunk.getPayloadBytes() == null ? 0L : chunk.getPayloadBytes();
                if (totalBytes > ConversationEventDisplayBudget.LEGACY_RESPONSE_BYTES) {
                    throw new BizException(ErrorCode.CONVERSATION_EVENT_DETAIL_TOO_LARGE);
                }
            }
        }
        List<Long> ids = new ArrayList<>(metas.size());
        for (AgentConversationTurnEventDO meta : metas) {
            ids.add(meta.getId());
        }
        Map<Long, String> payloads = new LinkedHashMap<>();
        for (AgentConversationTurnEventDO payload : eventDao.listPayloadsByIds(
                ids, ConversationEventDisplayBudget.LEGACY_RESPONSE_BYTES)) {
            payloads.put(payload.getId(), payload.getPayloadFragment());
        }
        List<AgentConversationTurnEventDO> hydrated = new ArrayList<>(metas.size());
        for (AgentConversationTurnEventDO meta : metas) {
            AgentConversationTurnEventDO row = new AgentConversationTurnEventDO();
            row.setId(meta.getId());
            row.setTenantId(meta.getTenantId());
            row.setConversationId(meta.getConversationId());
            row.setTurnId(meta.getTurnId());
            row.setDispatchAttempt(meta.getDispatchAttempt());
            row.setEventSeq(meta.getEventSeq());
            row.setChunkIndex(meta.getChunkIndex());
            row.setChunkCount(meta.getChunkCount());
            row.setEventType(meta.getEventType());
            row.setGmtCreate(meta.getGmtCreate());
            row.setPayloadFragment(payloads.get(meta.getId()));
            hydrated.add(row);
        }
        List<AgentConversationTurnEventDO> projected = projectLegacy(hydrated, channel);
        if (ConversationEventDisplayBudget.encodedLength(projected)
                > ConversationEventDisplayBudget.LEGACY_RESPONSE_BYTES) {
            throw new BizException(ErrorCode.CONVERSATION_EVENT_DETAIL_TOO_LARGE);
        }
        return projected;
    }

    private List<AgentConversationTurnEventDO> projectLegacy(
            List<AgentConversationTurnEventDO> hydrated, String channel) {
        return PlatformConversationChannel.CHANNEL.equals(channel)
                ? PlatformEventProjection.events(hydrated)
                : assembleVerbatim(hydrated);
    }

    /** Merges slices without touching content: clarification/PRD keep their authorised raw text. */
    static List<AgentConversationTurnEventDO> assembleVerbatim(
            List<AgentConversationTurnEventDO> rows) {
        Map<String, List<AgentConversationTurnEventDO>> groups = new LinkedHashMap<>();
        for (AgentConversationTurnEventDO row : rows) {
            String key = row.getTurnId() + ":" + row.getDispatchAttempt() + ":" + row.getEventSeq();
            groups.computeIfAbsent(key, ignored -> new ArrayList<>()).add(row);
        }
        List<AgentConversationTurnEventDO> result = new ArrayList<>();
        for (List<AgentConversationTurnEventDO> chunks : groups.values()) {
            chunks.sort(java.util.Comparator.comparing(AgentConversationTurnEventDO::getChunkIndex));
            AgentConversationTurnEventDO head = chunks.get(0);
            int expected = head.getChunkCount() == null ? 1 : head.getChunkCount();
            if (chunks.size() < expected) {
                continue;
            }
            StringBuilder payload = new StringBuilder();
            for (AgentConversationTurnEventDO chunk : chunks) {
                if (chunk.getPayloadFragment() != null) {
                    payload.append(chunk.getPayloadFragment());
                }
            }
            AgentConversationTurnEventDO projected = new AgentConversationTurnEventDO();
            projected.setId(chunks.stream().map(AgentConversationTurnEventDO::getId)
                    .max(Long::compare).orElse(head.getId()));
            projected.setTenantId(head.getTenantId());
            projected.setConversationId(head.getConversationId());
            projected.setTurnId(head.getTurnId());
            projected.setDispatchAttempt(head.getDispatchAttempt());
            projected.setEventSeq(head.getEventSeq());
            projected.setChunkCount(1);
            projected.setChunkIndex(0);
            projected.setEventType(head.getEventType());
            projected.setGmtCreate(head.getGmtCreate());
            projected.setPayloadFragment(payload.toString());
            result.add(projected);
        }
        result.sort(java.util.Comparator.comparing(AgentConversationTurnEventDO::getId));
        return result;
    }

    private boolean allChunksPresent(long tenantId, long turnId, int dispatchAttempt,
            long eventSeq, int expectedCount) {
        List<AgentConversationTurnEventDO> chunks = eventDao.listLogicalEventChunks(
                tenantId, turnId, dispatchAttempt, eventSeq);
        if (chunks.size() != expectedCount) {
            return false;
        }
        String assembled = assemblePayload(chunks);
        try {
            JSON.parse(assembled);
            return true;
        } catch (Exception e) {
            log.warn("conversation event chunk reassembly produced invalid JSON turnId={} eventSeq={}",
                    turnId, eventSeq);
            return false;
        }
    }

    private String assemblePayload(List<AgentConversationTurnEventDO> chunks) {
        StringBuilder sb = new StringBuilder();
        for (AgentConversationTurnEventDO chunk : chunks) {
            sb.append(chunk.getPayloadFragment());
        }
        return sb.toString();
    }

    private void updateCliSessionRefIfPresent(long tenantId, long conversationId, String payload) {
        try {
            com.aliyun.autowonder.json.JSONObject json = JSON.parseObject(payload);
            String sessionId = json.getString("sessionId");
            if (sessionId != null && !sessionId.isBlank()) {
                convDao.updateCliSessionRef(tenantId, conversationId, sessionId);
            }
        } catch (Exception e) {
            // non-fatal: session ref update is best-effort
        }
    }

    private void publishToBrowser(long tenantId, long conversationId, long turnId,
            int dispatchAttempt, long eventSeq, String eventType, String payloadJson) {
        if (browserEventPublisher == null) {
            return;
        }
        browserEventPublisher.publish(tenantId, conversationId, turnId, dispatchAttempt, eventSeq,
                eventType, payloadJson);
    }
}
