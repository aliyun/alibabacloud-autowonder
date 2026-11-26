package com.aliyun.autowonder.prd;

import lombok.Data;
import org.apache.ibatis.annotations.*;

import java.util.Date;
import java.util.List;

@Mapper
public interface PrdDesignHandoffDao {
    @Data
    class Review {
        private Long id;
        private long workspaceId;
        private long workitemId;
        private long conversationId;
        private long executorId;
        private String sourceKey;
        private long versionId;
        private String designDigest;
        private long repoId;
        private String repoUrl;
        private String branch;
        private String reviewersJson;
        private String markdown;
        private long creatorId;
        private Long decidedBy;
        private java.time.LocalDateTime decisionAt;
        private String decisionReason;
        private PrdDesignHandoffStatus status;
        private String commitSha;
        private Long attachmentId;
        private int attempt;
        private Boolean expired;

        public String attachmentFilename() {
            return "prd-" + workitemId + "-review-" + id + ".md";
        }
    }

    String COLUMNS = """
            id,workspace_id,workitem_id,conversation_id,executor_id,source_key,version_id,
            design_digest,repo_id,repo_url,branch,reviewers_json,markdown,creator_id,decided_by,
            decision_at,decision_reason,status,commit_sha,attachment_id,attempt,
            (deadline <= CURRENT_TIMESTAMP(3)) AS expired
            """;
    String LOCKED = "('SNAPSHOTTING','IN_REVIEW','PUSHING','PUSH_FAILED','ATTACHING','ATTACHMENT_FAILED')";
    String MATCH = " WHERE id=#{id} AND workspace_id=#{workspaceId} AND status=#{status} AND attempt=#{attempt}";

    @Select("SELECT " + COLUMNS + """
             FROM prd_design_handoff WHERE workspace_id=#{workspace} AND workitem_id=#{item}
             ORDER BY id DESC LIMIT 1
            """)
    Review latest(@Param("workspace") long workspace, @Param("item") long item);

    @Select("SELECT COUNT(*) FROM prd_design_handoff WHERE workspace_id=#{workspace} AND workitem_id=#{item}"
            + " AND status IN " + LOCKED)
    int frozen(@Param("workspace") long workspace, @Param("item") long item);

    @Select("SELECT id FROM prd_design_handoff WHERE workspace_id=#{workspace} AND workitem_id=#{item}"
            + " AND status IN " + LOCKED + " ORDER BY id DESC LIMIT 1 FOR UPDATE")
    Long lockActive(@Param("workspace") long workspace, @Param("item") long item);

    @Select("SELECT markdown FROM prd_design_handoff WHERE workspace_id=#{workspace} AND workitem_id=#{item}"
            + " AND version_id=#{version} AND (status='COMPLETED' OR status IN " + LOCKED + ") ORDER BY id DESC LIMIT 1")
    String frozenDocument(@Param("workspace") long workspace, @Param("item") long item, @Param("version") long version);

    @Select("SELECT " + COLUMNS + """
             FROM prd_design_handoff WHERE workspace_id=#{workspace} AND workitem_id=#{item}
             AND status='COMPLETED' ORDER BY id DESC LIMIT 1
            """)
    Review completed(@Param("workspace") long workspace, @Param("item") long item);

    // Completion sets next_check, and the scheduler leaves terminal reviews unchanged.
    @Select("SELECT " + COLUMNS + """
             FROM prd_design_handoff WHERE workspace_id=#{workspace} AND workitem_id=#{item}
             AND status='COMPLETED' AND next_check <= #{deliveryStart}
             ORDER BY id DESC LIMIT 1
            """)
    Review completedForDelivery(@Param("workspace") long workspace, @Param("item") long item,
                                @Param("deliveryStart") Date deliveryStart);

    @Select("SELECT " + COLUMNS + " FROM prd_design_handoff WHERE workspace_id=#{workspace} AND id=#{id} FOR UPDATE")
    Review lock(@Param("workspace") long workspace, @Param("id") long id);

    @Insert("""
            INSERT INTO prd_design_handoff
              (workspace_id,workitem_id,conversation_id,executor_id,source_key,version_id,design_digest,
               repo_id,repo_url,branch,reviewers_json,markdown,creator_id,status)
            VALUES (#{workspaceId},#{workitemId},#{conversationId},#{executorId},#{sourceKey},#{versionId},
                    #{designDigest},#{repoId},#{repoUrl},#{branch},#{reviewersJson},#{markdown},#{creatorId},'SNAPSHOTTING')
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    void insert(Review review);

    @Select("""
            SELECT id,workspace_id,workitem_id,status,attempt,commit_sha FROM prd_design_handoff
            WHERE status IN ('SNAPSHOTTING','PUSHING','ATTACHING') AND next_check<=CURRENT_TIMESTAMP(3)
            ORDER BY next_check LIMIT 32
            """)
    List<Review> due();

    @Update("UPDATE prd_design_handoff SET next_check=TIMESTAMPADD(SECOND,12,CURRENT_TIMESTAMP(3))"
            + MATCH + " AND next_check<=CURRENT_TIMESTAMP(3)")
    int claim(Review review);

    @Update("UPDATE prd_design_handoff SET deadline=COALESCE(deadline,TIMESTAMPADD(SECOND,115,CURRENT_TIMESTAMP(3)))"
            + MATCH)
    void dispatched(Review review);

    @Update("UPDATE prd_design_handoff SET status='IN_REVIEW',commit_sha=#{commit},branch=#{branch},"
            + "next_check=CURRENT_TIMESTAMP(3),deadline=NULL"
            + " WHERE id=#{row.id} AND workspace_id=#{row.workspaceId} AND status='SNAPSHOTTING'"
            + " AND attempt=#{row.attempt} AND (commit_sha IS NULL OR commit_sha=#{commit})")
    int recordSnapshot(@Param("row") Review row, @Param("commit") String commit, @Param("branch") String branch);

    @Update("UPDATE prd_design_handoff SET status='ATTACHING',branch=#{branch},next_check=CURRENT_TIMESTAMP(3),deadline=NULL"
            + " WHERE id=#{row.id} AND workspace_id=#{row.workspaceId} AND status='PUSHING' AND attempt=#{row.attempt}")
    int recoverPublishing(@Param("row") Review row, @Param("branch") String branch);

    @Update("""
            UPDATE prd_design_handoff SET status=#{next},commit_sha=COALESCE(#{commit},commit_sha),
            attachment_id=COALESCE(#{attachment},attachment_id),next_check=CURRENT_TIMESTAMP(3),deadline=NULL
            WHERE id=#{row.id} AND workspace_id=#{row.workspaceId} AND status=#{row.status} AND attempt=#{row.attempt}
            """)
    int advance(@Param("row") Review row, @Param("next") PrdDesignHandoffStatus next, @Param("commit") String commit,
                @Param("attachment") Long attachment);

    @Update("""
            UPDATE prd_design_handoff SET status=#{next},branch=#{branch},decided_by=#{actor},decision_reason=#{reason},
            decision_at=CURRENT_TIMESTAMP(3),next_check=CURRENT_TIMESTAMP(3),deadline=NULL
            WHERE id=#{row.id} AND workspace_id=#{row.workspaceId} AND status='IN_REVIEW' AND attempt=#{row.attempt}
            """)
    int decide(@Param("row") Review row, @Param("next") PrdDesignHandoffStatus next,
               @Param("actor") long actor, @Param("reason") String reason, @Param("branch") String branch);

    @Update("""
            UPDATE prd_design_handoff SET status='ATTACHING',branch=#{branch},attempt=attempt+1,
            next_check=CURRENT_TIMESTAMP(3),deadline=NULL
            WHERE id=#{row.id} AND workspace_id=#{row.workspaceId} AND status=#{row.status} AND attempt=#{row.attempt}
            """)
    int retryAttachment(@Param("row") Review row, @Param("branch") String branch);
}
