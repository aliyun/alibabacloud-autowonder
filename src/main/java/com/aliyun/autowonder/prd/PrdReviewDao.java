package com.aliyun.autowonder.prd;

import org.apache.ibatis.annotations.*;
import java.util.List;

@Mapper
public interface PrdReviewDao {
    @Select("SELECT review_slug FROM prd_design WHERE workspace_id=#{workspace} AND workitem_id=#{item}")
    String name(@Param("workspace") long workspace, @Param("item") long item);

    @Select("SELECT review_share_id FROM prd_design WHERE workspace_id=#{workspace} AND workitem_id=#{item}")
    Long namedShare(@Param("workspace") long workspace, @Param("item") long item);

    @Select("SELECT review_slug FROM prd_design WHERE workspace_id=#{workspace} AND workitem_id=#{item}"
            + " AND review_share_id=#{shareId}")
    String boundName(@Param("workspace") long workspace, @Param("item") long item, @Param("shareId") long shareId);

    @Insert("INSERT INTO prd_design(workspace_id,workitem_id,creator_id) VALUES(#{workspace},#{item},#{actor})"
            + " ON DUPLICATE KEY UPDATE id=id")
    void ensureDesignForName(@Param("workspace") long workspace, @Param("item") long item, @Param("actor") long actor);

    @Update("UPDATE prd_design SET review_slug=#{slug} WHERE workspace_id=#{workspace} AND workitem_id=#{item}"
            + " AND review_slug IS NULL")
    int setName(@Param("workspace") long workspace, @Param("item") long item, @Param("slug") String slug);

    @Update("UPDATE prd_design SET review_share_id=#{shareId} WHERE workspace_id=#{workspace} AND workitem_id=#{item}"
            + " AND review_slug IS NOT NULL")
    void bindName(@Param("workspace") long workspace, @Param("item") long item, @Param("shareId") long shareId);

    @Select("SELECT s.* FROM prd_design d JOIN prd_review_share s ON s.id=d.review_share_id"
            + " AND s.workspace_id=d.workspace_id AND s.workitem_id=d.workitem_id"
            + " WHERE d.review_slug=#{slug} AND s.enabled=1")
    PrdReviewShareDO byName(String slug);

    @Select("SELECT * FROM prd_review_share WHERE workspace_id=#{workspaceId} AND conversation_id=#{conversationId} AND source_key=#{sourceKey}")
    PrdReviewShareDO share(@Param("workspaceId") long workspaceId, @Param("conversationId") long conversationId, @Param("sourceKey") String sourceKey);

    @Select("SELECT * FROM prd_review_share WHERE token=#{token} AND enabled=1")
    PrdReviewShareDO byToken(String token);

    @Select("SELECT * FROM prd_review_share WHERE id=#{id} AND enabled=1")
    PrdReviewShareDO shareById(long id);

    @Insert("INSERT INTO prd_review_share(workspace_id,workitem_id,conversation_id,source_key,token,enabled,version,creator_id) "
            + "VALUES(#{workspaceId},#{workitemId},#{conversationId},#{sourceKey},#{token},1,1,#{creatorId}) "
            + "ON DUPLICATE KEY UPDATE token=VALUES(token),enabled=1,version=version+1")
    void enable(PrdReviewShareDO row);

    @Update("UPDATE prd_review_share SET enabled=0,version=version+1 WHERE workspace_id=#{workspaceId} AND id=#{id}")
    int revoke(@Param("workspaceId") long workspaceId, @Param("id") long id);

    @Select("SELECT * FROM prd_review_comment WHERE workspace_id=#{workspaceId} AND workitem_id=#{workitemId} AND conversation_id=#{conversationId} AND is_deleted=0 ORDER BY id DESC LIMIT 1000")
    List<PrdReviewCommentDO> comments(@Param("workspaceId") long workspaceId, @Param("workitemId") long workitemId, @Param("conversationId") long conversationId);

    @Select("SELECT * FROM prd_review_comment WHERE workspace_id=#{workspaceId} AND id=#{id} AND is_deleted=0")
    PrdReviewCommentDO comment(@Param("workspaceId") long workspaceId, @Param("id") long id);

    @Select("SELECT * FROM prd_review_comment WHERE workspace_id=#{workspaceId} AND conversation_id=#{conversationId} AND source_key=#{sourceKey} AND creator_id=#{creatorId} AND client_id=#{clientId}")
    PrdReviewCommentDO replay(PrdReviewCommentDO row);

    @Insert("INSERT IGNORE INTO prd_review_comment(workspace_id,workitem_id,conversation_id,source_key,runtime_revision,route_path,selector,element_json,comment_text,status,creator_id,client_id) "
            + "VALUES(#{workspaceId},#{workitemId},#{conversationId},#{sourceKey},#{runtimeRevision},#{routePath},#{selector},#{elementJson},#{commentText},'open',#{creatorId},#{clientId})")
    @Options(useGeneratedKeys=true, keyProperty="id")
    void insert(PrdReviewCommentDO row);

    @Update("UPDATE prd_review_comment SET comment_text=#{commentText},status=#{status},is_deleted=#{isDeleted},version=version+1,gmt_modified=CURRENT_TIMESTAMP(3) "
            + "WHERE workspace_id=#{workspaceId} AND id=#{id} AND version=#{version} AND is_deleted=0")
    int update(PrdReviewCommentDO row);

    @Update("UPDATE prd_review_comment SET last_sent_turn_id=#{turnId} WHERE workspace_id=#{workspaceId} AND id=#{id} AND is_deleted=0")
    void sent(@Param("workspaceId") long workspaceId, @Param("id") long id, @Param("turnId") long turnId);
}
