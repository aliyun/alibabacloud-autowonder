package com.aliyun.autowonder.insights;

import com.aliyun.autowonder.sdlc.SdlcExecutionSnapshot;
import com.aliyun.autowonder.sdlc.SdlcStepDO;
import com.aliyun.autowonder.insights.dto.StageDurationVO;
import com.aliyun.autowonder.insights.dto.InsightWorkerVO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.Date;
import java.util.List;

@Mapper
public interface StageDurationDao {
    List<InsightWorkerVO> listWorkers(@Param("tenantId") long tenantId, @Param("excludeCanceled") boolean excludeCanceled);

    List<StageDurationService.Execution> listExecutions(@Param("tenantId") long tenantId,
            @Param("start") Date start, @Param("end") Date end,
            @Param("squadId") Long squadId, @Param("sdlcId") Long sdlcId,
            @Param("agentId") Long agentId, @Param("agentVersionId") Long agentVersionId,
            @Param("status") String status, @Param("limit") int limit, @Param("excludeCanceled") boolean excludeCanceled,
            @Param("maxDispatchId") Long maxDispatchId);

    List<StageDurationService.Execution> listRecoverableExecutions(@Param("tenantId") long tenantId,
            @Param("start") Date start, @Param("end") Date end,
            @Param("squadId") Long squadId, @Param("sdlcId") Long sdlcId, @Param("beforeDispatchId") Long beforeDispatchId);

    int countRecoverableExecutions(@Param("tenantId") long tenantId,
            @Param("start") Date start, @Param("end") Date end,
            @Param("squadId") Long squadId, @Param("sdlcId") Long sdlcId, @Param("beforeDispatchId") Long beforeDispatchId);

    List<StageDurationVO.AgentVersion> listAgentVersions(@Param("tenantId") long tenantId,
            @Param("agentId") long agentId, @Param("excludeCanceled") boolean excludeCanceled);

    List<StageDurationService.Execution> listVersionExecutions(@Param("tenantId") long tenantId,
            @Param("agentId") long agentId, @Param("versionId") long versionId,
            @Param("start") Date start, @Param("end") Date end, @Param("limit") int limit, @Param("excludeCanceled") boolean excludeCanceled);

    List<StageDurationService.Event> listEvents(@Param("tenantId") long tenantId,
            @Param("dispatchIds") List<Long> dispatchIds);

    List<SdlcExecutionSnapshot> listSnapshots(@Param("tenantId") long tenantId,
            @Param("snapshotIds") List<Long> snapshotIds);

    List<SdlcStepDO> listCurrentSteps(@Param("tenantId") long tenantId,
            @Param("sdlcIds") List<Long> sdlcIds);

    List<StageDurationService.Event> lastActivities(@Param("tenantId") long tenantId,
            @Param("dispatchIds") List<Long> dispatchIds);

    List<StageDurationService.Event> firstEvents(@Param("tenantId") long tenantId,
            @Param("dispatchIds") List<Long> dispatchIds);
}
