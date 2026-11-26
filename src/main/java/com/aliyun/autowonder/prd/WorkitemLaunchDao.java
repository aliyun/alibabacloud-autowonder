package com.aliyun.autowonder.prd;

import org.apache.ibatis.annotations.*;

import java.util.List;

@Mapper
public interface WorkitemLaunchDao {
    record Launch(
            long workspaceId,
            long workitemId,
            long conversationId,
            String activity,
            long squadId,
            long agentId,
            Long repoId,
            long creatorId,
            String phase,
            int attempt) {}

    String COLUMNS =
            "workspace_id,workitem_id,conversation_id,activity,squad_id,agent_id,repo_id,creator_id,phase,attempt";

    @Insert(
            "INSERT INTO workitem_activity_launch ("
                    + COLUMNS
                    + ") VALUES (#{workspaceId},#{workitemId},"
                    + "#{conversationId},#{activity},#{squadId},#{agentId},#{repoId},#{creatorId},#{phase},#{attempt})")
    void insert(Launch launch);

    @Select(
            "SELECT "
                    + COLUMNS
                    + " FROM workitem_activity_launch WHERE workspace_id=#{workspace} AND"
                    + " conversation_id=#{conversation}")
    Launch find(@Param("workspace") long workspace, @Param("conversation") long conversation);

    @Select(
            "SELECT "
                    + COLUMNS
                    + " FROM workitem_activity_launch WHERE workspace_id=#{workspace} AND"
                    + " workitem_id=#{workitem} AND activity=#{activity} ORDER BY conversation_id"
                    + " DESC LIMIT 1")
    Launch latest(
            @Param("workspace") long workspace,
            @Param("workitem") long workitem,
            @Param("activity") String activity);

    @Select(
            "SELECT "
                    + COLUMNS
                    + " FROM workitem_activity_launch WHERE phase IN"
                    + " ('QUEUED','PREPARING','CONFIGURING','INSTALLING','STARTING') AND"
                    + " next_check<=CURRENT_TIMESTAMP(3) ORDER BY next_check LIMIT 32")
    List<Launch> due();

    @Update(
            "UPDATE workitem_activity_launch SET"
                + " next_check=TIMESTAMPADD(SECOND,12,CURRENT_TIMESTAMP(3)) WHERE"
                + " workspace_id=#{workspaceId} AND conversation_id=#{conversationId} AND"
                + " attempt=#{attempt} AND phase=#{phase} AND next_check<=CURRENT_TIMESTAMP(3)")
    int claim(Launch launch);

    @Select(
            "SELECT TIMESTAMPDIFF(SECOND,started_at,CURRENT_TIMESTAMP(3)) FROM"
                + " workitem_activity_launch WHERE workspace_id=#{workspaceId} AND"
                + " conversation_id=#{conversationId}")
    int age(Launch launch);

    @Update(
            "UPDATE workitem_activity_launch SET phase=#{next},next_check=CURRENT_TIMESTAMP(3),"
                + " started_at=IF(#{next}='INSTALLING',CURRENT_TIMESTAMP(3),started_at)"
                + " WHERE workspace_id=#{row.workspaceId} AND conversation_id=#{row.conversationId}"
                + " AND attempt=#{row.attempt} AND phase=#{row.phase}")
    int advance(@Param("row") Launch row, @Param("next") String next);

    @Update(
            "UPDATE workitem_activity_launch SET"
                + " phase='QUEUED',attempt=attempt+1,started_at=CURRENT_TIMESTAMP(3),next_check=CURRENT_TIMESTAMP(3)"
                + " WHERE workspace_id=#{workspaceId} AND conversation_id=#{conversationId} AND"
                + " attempt=#{attempt} AND phase LIKE 'FAILED%'")
    int retry(Launch launch);
}
