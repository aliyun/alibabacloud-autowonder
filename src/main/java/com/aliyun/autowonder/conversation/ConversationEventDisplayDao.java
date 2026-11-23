package com.aliyun.autowonder.conversation;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Date;
import java.util.List;

@Mapper
public interface ConversationEventDisplayDao {

    int insertTask(ConversationEventDisplayDO row);

    @org.apache.ibatis.annotations.Select("SELECT d.* FROM conversation_event_display d "
            + "WHERE d.tenant_id=#{tenantId} AND d.conversation_id=#{conversationId} AND d.turn_id=#{turnId} "
            + "AND d.status='READY' AND (d.projection_version IS NULL OR d.projection_version='v1') "
            + "AND d.publication_seq > #{afterSeq} "
            + "AND (EXISTS (SELECT 1 FROM agent_conversation_turn_event r WHERE r.tenant_id=d.tenant_id "
            + "AND r.turn_id=d.turn_id AND r.dispatch_attempt=d.dispatch_attempt AND r.event_seq=d.event_seq) "
            + "OR EXISTS (SELECT 1 FROM conversation_event_content_segment s WHERE s.display_id=d.id AND s.projection_version='v1')) "
            + "ORDER BY d.publication_seq LIMIT 20")
    @org.apache.ibatis.annotations.ResultMap("BaseResultMap")
    List<ConversationEventDisplayDO> listLegacyReady(@Param("tenantId") long tenantId,
            @Param("conversationId") long conversationId, @Param("turnId") long turnId,
            @Param("afterSeq") long afterSeq);

    @org.apache.ibatis.annotations.Select("SELECT d.id FROM conversation_event_display d "
            + "WHERE d.tenant_id=#{tenantId} AND d.conversation_id=#{conversationId} AND d.turn_id=#{turnId} "
            + "AND d.status='READY' AND (d.projection_version IS NULL OR d.projection_version='v1') "
            + "AND (EXISTS (SELECT 1 FROM agent_conversation_turn_event r WHERE r.tenant_id=d.tenant_id "
            + "AND r.turn_id=d.turn_id AND r.dispatch_attempt=d.dispatch_attempt AND r.event_seq=d.event_seq) "
            + "OR EXISTS (SELECT 1 FROM conversation_event_content_segment s WHERE s.display_id=d.id AND s.projection_version='v1')) LIMIT 1")
    Long findLegacyReadyId(@Param("tenantId") long tenantId, @Param("conversationId") long conversationId,
            @Param("turnId") long turnId);

    /**
     * Revives a permanently failed row when a legitimate late slice arrives. Published content is
     * never rewritten in place: the retry publishes a higher revision via a new publicationSeq.
     */
    int rearmFailed(@Param("tenantId") long tenantId,
            @Param("conversationId") long conversationId, @Param("turnId") long turnId,
            @Param("dispatchAttempt") int dispatchAttempt, @Param("eventSeq") long eventSeq,
            @Param("now") Date now);

    int wakePending(@Param("tenantId") long tenantId,
            @Param("conversationId") long conversationId, @Param("turnId") long turnId,
            @Param("dispatchAttempt") int dispatchAttempt, @Param("eventSeq") long eventSeq,
            @Param("queueClass") String queueClass, @Param("now") Date now);

    int requeueLarge(@Param("id") long id, @Param("owner") String owner, @Param("now") Date now);

    int markFailedIfCurrent(@Param("id") long id, @Param("publicationSeq") long publicationSeq,
            @Param("failureReason") String failureReason, @Param("expectedAttempt") int expectedAttempt,
            @Param("owner") String owner, @Param("now") Date now);

    List<ConversationEventDisplayDO> listClaimablePage(@Param("now") Date now,
            @Param("queueClass") String queueClass, @Param("afterTurnId") long afterTurnId,
            @Param("afterId") long afterId, @Param("limit") int limit);

    /** Idempotent backfill insert driven by the first raw slice of a logical event. */
    int insertFromFirstRawChunk(@Param("tenantId") long tenantId,
            @Param("conversationId") long conversationId, @Param("turnId") long turnId,
            @Param("dispatchAttempt") int dispatchAttempt, @Param("eventSeq") long eventSeq,
            @Param("projectionVersion") String projectionVersion,
            @Param("queueClass") String queueClass);

    /** Logical keys that exist in the raw table but have no display row yet. */
    List<ConversationEventDisplayDO> listMissingLogicalKeys(@Param("tenantId") long tenantId,
            @Param("conversationId") long conversationId, @Param("turnId") long turnId,
            @Param("limit") int limit, @Param("afterEventSeq") long afterEventSeq,
            @Param("afterAttempt") int afterAttempt);

    /**
     * 只认领指定队列类别的任务：实时与历史由各自的调度器和预算独立推进。
     *
     * <p>{@code rotationBuckets > 0} 时按 {@code MOD(turn_id + rotationOffset, buckets)} 轮转，
     * 让不同轮次/空间在持续新流量下仍能轮到；历史通道传 0，保持索引顺序避免大集合排序。
     */
    List<Long> listClaimableIdsByClass(@Param("now") Date now,
            @Param("classes") List<String> classes, @Param("rotationBuckets") int rotationBuckets,
            @Param("rotationOffset") int rotationOffset, @Param("limit") int limit);

    /** 用户打开一个轮次时把它从后台回填提升为受限交互优先级。 */
    int promoteTurn(@Param("tenantId") long tenantId,
            @Param("conversationId") long conversationId, @Param("turnId") long turnId,
            @Param("fromClass") String fromClass, @Param("toClass") String toClass,
            @Param("now") Date now);

    int countByQueueClass(@Param("queueClass") String queueClass);

    int claim(@Param("id") long id, @Param("now") Date now,
            @Param("leaseUntil") Date leaseUntil, @Param("owner") String owner);

    int releaseLease(@Param("id") long id, @Param("owner") String owner);

    ConversationEventDisplayDO findById(@Param("id") long id);

    ConversationEventDisplayDO findByLogicalKey(@Param("tenantId") long tenantId,
            @Param("conversationId") long conversationId, @Param("turnId") long turnId,
            @Param("dispatchAttempt") int dispatchAttempt, @Param("eventSeq") long eventSeq);

    Long selectMaxPublicationSeq(@Param("tenantId") long tenantId,
            @Param("conversationId") long conversationId, @Param("turnId") long turnId);

    int markReady(@Param("id") long id, @Param("publicationSeq") long publicationSeq,
            @Param("summary") String summary, @Param("contentLength") long contentLength,
            @Param("totalSegments") int totalSegments, @Param("truncated") boolean truncated,
            @Param("detailAvailable") boolean detailAvailable,
            @Param("projectionVersion") String projectionVersion, @Param("now") Date now);

    int markFailed(@Param("id") long id, @Param("publicationSeq") Long publicationSeq,
            @Param("failureReason") String failureReason, @Param("now") Date now);

    int scheduleRetry(@Param("id") long id, @Param("nextRetryAt") Date nextRetryAt,
            @Param("failureReason") String failureReason, @Param("now") Date now);

    int markSourceRemoved(@Param("id") long id);

    List<ConversationEventDisplayDO> listPublishedAfter(@Param("tenantId") long tenantId,
            @Param("conversationId") long conversationId, @Param("turnId") long turnId,
            @Param("afterSeq") long afterSeq, @Param("limit") int limit);

    int countByStatus(@Param("tenantId") long tenantId,
            @Param("conversationId") long conversationId, @Param("turnId") long turnId,
            @Param("status") String status);

    Long maxPublishedSeq(@Param("tenantId") long tenantId,
            @Param("conversationId") long conversationId, @Param("turnId") long turnId);

    List<Long> listExpiredIds(@Param("cutoff") Date cutoff, @Param("limit") int limit);

    int deleteByIds(@Param("ids") List<Long> ids);

    /** 已见过的最高原始主键；小于某轮次的原始主键说明该轮次尚未被后台发现。 */
    Long highWaterRawId();

    /**
     * 该轮是否仍有原始事件没有 display 行；有则返回其一行的主键，没有返回 null。
     *
     * <p>只按租户/会话/轮次走唯一键反连接并 LIMIT 1，用于读取路径的「发现完备性」判定：
     * 比全局扫描水位更精确——实时轮次的原始主键通常超前于后台扫描，用全局水位会误判为未发现。
     */
    Long findMissingLogicalKey(@Param("tenantId") long tenantId,
            @Param("conversationId") long conversationId, @Param("turnId") long turnId);

    Long maxRawIdForTurn(@Param("tenantId") long tenantId,
            @Param("conversationId") long conversationId, @Param("turnId") long turnId);

    ConversationEventDisplayScanDO findScan(@Param("scanKey") String scanKey);

    int insertScanIfAbsent(@Param("scanKey") String scanKey, @Param("now") Date now);

    int advanceScan(@Param("scanKey") String scanKey, @Param("lastRawId") long lastRawId,
            @Param("highWaterRawId") long highWaterRawId, @Param("generation") long generation,
            @Param("quietUntil") Date quietUntil, @Param("now") Date now);
}
