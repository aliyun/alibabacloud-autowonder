package com.aliyun.autowonder.prd;
import org.apache.ibatis.annotations.*;
@Mapper
public interface PrdReviewPreviewDao {
    @Insert("INSERT INTO prd_review_preview_grant(token_hash,kind,share_id,share_version,user_id,binding_id,expires_at,consumed) VALUES(#{tokenHash},#{kind},#{shareId},#{shareVersion},#{userId},#{bindingId},#{expiresAt},0)")
    void grant(PrdReviewGrantDO row);
    @Select("SELECT * FROM prd_review_preview_grant WHERE token_hash=#{hash} AND expires_at>CURRENT_TIMESTAMP(3) AND consumed=0")
    PrdReviewGrantDO find(String hash);
    @Update("UPDATE prd_review_preview_grant SET consumed=1 WHERE token_hash=#{hash} AND kind IN ('ENTRY','MEMBER_ENTRY') AND consumed=0 AND expires_at>CURRENT_TIMESTAMP(3)")
    int consume(String hash);
    @Update("UPDATE prd_review_preview_grant SET expires_at=#{expiresAt} WHERE token_hash=#{hash} AND kind IN ('SESSION','MEMBER_SESSION') AND consumed=0 AND expires_at>CURRENT_TIMESTAMP(3)")
    int renew(@Param("hash") String hash,@Param("expiresAt") java.util.Date expiresAt);
    @Delete("DELETE FROM prd_review_preview_grant WHERE expires_at<CURRENT_TIMESTAMP(3)")
    void purge();
    @Select("SELECT * FROM prd_review_tunnel WHERE workspace_id=#{workspaceId} AND conversation_id=#{conversationId}")
    PrdReviewTunnelDO tunnel(@Param("workspaceId") long workspaceId,@Param("conversationId") long conversationId);
    @Insert("INSERT INTO prd_review_tunnel(workspace_id,conversation_id,executor_id,turn_id,dispatch_attempt,report_sequence,binding_id,status) "
            + "VALUES(#{workspaceId},#{conversationId},#{executorId},#{turnId},#{dispatchAttempt},#{reportSequence},#{bindingId},#{status}) "
            + "ON DUPLICATE KEY UPDATE executor_id=VALUES(executor_id),turn_id=VALUES(turn_id),dispatch_attempt=VALUES(dispatch_attempt),report_sequence=VALUES(report_sequence),binding_id=VALUES(binding_id),status=VALUES(status)")
    void report(PrdReviewTunnelDO row);
}
