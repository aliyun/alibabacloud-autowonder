package com.aliyun.autowonder.prd;

import org.apache.ibatis.annotations.*;

/** Explicit workspace predicates: this table uses workspace_id, not tenant_id. */
@Mapper
public interface PrdDesignRuntimeDao {
    @Update("UPDATE prd_design_runtime SET executor_id=#{executor},status='STARTING',port=NULL,error=NULL "
            + "WHERE workspace_id=#{ws} AND conversation_id=#{conv}")
    void resetPreparation(@Param("ws") long ws, @Param("conv") long conv, @Param("executor") long executor);

    @Update("UPDATE prd_design_runtime SET status='PREPARED',revision=revision+1 WHERE workspace_id=#{ws} "
            + "AND conversation_id=#{conv} AND executor_id=#{executor} AND status='CONFIGURED'")
    int installed(@Param("ws") long ws, @Param("conv") long conv, @Param("executor") long executor);

    @Select("SELECT workspace_id, workitem_id, conversation_id, executor_id, turn_id, dispatch_attempt, "
            + "source_key, directory, status, port, route, error, revision, report_sequence "
            + "FROM prd_design_runtime WHERE workspace_id=#{workspaceId} AND conversation_id=#{conversationId}")
    PrdDesignRuntimeDO find(@Param("workspaceId") long workspaceId, @Param("conversationId") long conversationId);

    @Select("SELECT workspace_id, workitem_id, conversation_id, executor_id, turn_id, dispatch_attempt, "
            + "source_key, directory, status, port, route, error, revision, report_sequence "
            + "FROM prd_design_runtime WHERE workspace_id=#{workspaceId} AND workitem_id=#{workitemId} "
            + "ORDER BY conversation_id DESC LIMIT 1")
    PrdDesignRuntimeDO findLatestByWorkitem(@Param("workspaceId") long workspaceId,
                                           @Param("workitemId") long workitemId);

    @Insert("INSERT IGNORE INTO prd_design_runtime "
            + "(workspace_id,workitem_id,conversation_id,executor_id,turn_id,dispatch_attempt,source_key,directory,status) "
            + "VALUES (#{workspaceId},#{workitemId},#{conversationId},#{executorId},#{turnId},#{dispatchAttempt},"
            + "#{sourceKey},#{directory},'STARTING')")
    void insert(PrdDesignRuntimeDO row);

    @Update("UPDATE prd_design_runtime SET "
            + "status=CASE WHEN executor_id=#{executorId} AND source_key=#{sourceKey} THEN status ELSE 'STARTING' END, "
            + "port=CASE WHEN executor_id=#{executorId} AND source_key=#{sourceKey} THEN port ELSE NULL END, "
            + "route=CASE WHEN executor_id=#{executorId} AND source_key=#{sourceKey} THEN route ELSE '/' END, "
            + "report_sequence=CASE WHEN turn_id=#{turnId} AND dispatch_attempt=#{dispatchAttempt} THEN report_sequence ELSE 0 END, "
            + "directory=CASE WHEN executor_id=#{executorId} AND source_key=#{sourceKey} THEN directory ELSE #{directory} END, "
            + "executor_id=#{executorId},turn_id=#{turnId},dispatch_attempt=#{dispatchAttempt},"
            + "source_key=#{sourceKey},gmt_modified=CURRENT_TIMESTAMP(3) "
            + "WHERE workspace_id=#{workspaceId} AND conversation_id=#{conversationId} "
            + "AND (turn_id < #{turnId} OR (turn_id=#{turnId} AND dispatch_attempt <= #{dispatchAttempt}))")
    int bind(PrdDesignRuntimeDO row);

    @Update("UPDATE prd_design_runtime SET "
            + "status=CASE WHEN #{status}='PREPARED' AND status='READY' THEN status ELSE #{status} END, "
            + "port=CASE WHEN #{status}='PREPARED' THEN port ELSE #{port} END,route=#{route},directory=#{directory},"
            + "error=#{error},revision=revision+#{revisionDelta},report_sequence=#{sequence},gmt_modified=CURRENT_TIMESTAMP(3) "
            + "WHERE workspace_id=#{workspaceId} AND conversation_id=#{conversationId} AND executor_id=#{executorId} "
            + "AND turn_id=#{turnId} AND dispatch_attempt=#{attempt} AND report_sequence < #{sequence}")
    int report(@Param("workspaceId") long workspaceId, @Param("conversationId") long conversationId,
            @Param("executorId") long executorId, @Param("turnId") long turnId, @Param("attempt") int attempt,
            @Param("sequence") int sequence, @Param("status") String status, @Param("port") Integer port,
            @Param("route") String route, @Param("directory") String directory, @Param("error") String error,
            @Param("revisionDelta") int revisionDelta);

    @Update("UPDATE prd_design_runtime SET status='READY',port=#{port},revision=revision+1,gmt_modified=CURRENT_TIMESTAMP(3) "
            + "WHERE workspace_id=#{scope.workspaceId} AND workitem_id=#{scope.workitemId} "
            + "AND conversation_id=#{scope.conversationId} AND executor_id=#{scope.executorId} AND source_key=#{scope.sourceKey} "
            + "AND status IN ('PREPARED','READY') AND (port IS NULL OR port<>#{port} OR status='PREPARED')")
    int activatePreview(@Param("scope") PrdReviewPreviewProperties.Binding scope, @Param("port") int port);

    @Update("UPDATE prd_design_runtime SET status='READY',port=#{port},revision=revision+1,gmt_modified=CURRENT_TIMESTAMP(3) "
            + "WHERE workspace_id=#{scope.workspaceId} AND workitem_id=#{scope.workitemId} "
            + "AND conversation_id=#{scope.conversationId} AND executor_id=#{scope.executorId} AND source_key=#{scope.sourceKey} "
            + "AND status IN ('PREPARED','READY') AND revision=#{revision}")
    int activateClusterPreview(@Param("scope") PrdReviewPreviewProperties.Binding scope,
                               @Param("port") int port, @Param("revision") long revision);

    @Update("UPDATE prd_design_runtime SET status='PREPARED',directory=#{dir},dispatch_attempt=#{attempt},revision=revision+1 WHERE workspace_id=#{ws}"
            + " AND conversation_id=#{conv} AND executor_id=#{executor} AND turn_id=0 AND status IN ('STARTING','PREPARED')")
    int bootstrapPrepared(@Param("ws") long ws,@Param("conv") long conv,@Param("executor") long executor,@Param("dir") String dir,@Param("attempt") int attempt);
}
