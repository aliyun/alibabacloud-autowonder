package com.aliyun.autowonder.insights;

import com.aliyun.autowonder.access.RequireWorkspaceAccess;
import com.aliyun.autowonder.access.WorkspaceAccessLevel;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.common.result.Result;
import com.aliyun.autowonder.context.AutoWonderContext;
import com.aliyun.autowonder.insights.dto.StageDurationPlanVO;
import com.aliyun.autowonder.insights.dto.StageDurationVO;
import com.aliyun.autowonder.insights.dto.InsightWorkerVO;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/api/insights/stage-duration")
@RequireWorkspaceAccess(value = WorkspaceAccessLevel.READ_ONLY, action = "查看阶段耗时", actionKey = "access.action.view_stage_duration")
public class StageDurationController {
    private final StageDurationService service;

    public StageDurationController(StageDurationService service) { this.service = service; }

    @GetMapping("/workers")
    public Result<List<InsightWorkerVO>> workers(@RequestParam(value = "exclude_canceled_workitems", defaultValue = "false") boolean excludeCanceled) {
        Long workspaceId = AutoWonderContext.get().getCurrentWorkspaceId();
        if (workspaceId == null) throw new BizException(ErrorCode.WORKSPACE_NOT_MEMBER);
        return Result.ok(service.workers(workspaceId, excludeCanceled));
    }

    @GetMapping
    public Result<StageDurationVO> get(@RequestParam("start_date") String startDate,
            @RequestParam("end_date") String endDate,
            @RequestParam(value = "squad_id", required = false) Long squadId,
            @RequestParam(value = "sdlc_id", required = false) Long sdlcId,
            @RequestParam(value = "agent_id", required = false) Long agentId,
            @RequestParam(value = "agent_version_id", required = false) Long agentVersionId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "group_by", defaultValue = "stage") String groupBy,
            @RequestParam(value = "max_dispatch_id", required = false) Long maxDispatchId,
            @RequestParam(value = "exclude_canceled_workitems", defaultValue = "false") boolean excludeCanceled) {
        Long workspaceId = AutoWonderContext.get().getCurrentWorkspaceId();
        if (workspaceId == null) throw new BizException(ErrorCode.WORKSPACE_NOT_MEMBER);
        LocalDate start;
        LocalDate end;
        try {
            start = LocalDate.parse(startDate);
            end = LocalDate.parse(endDate);
        } catch (RuntimeException malformed) {
            throw new BizException(ErrorCode.PARAM_INVALID);
        }
        return Result.ok(service.get(workspaceId, start, end, squadId, sdlcId, groupBy, agentId, agentVersionId, status, excludeCanceled, maxDispatchId));
    }

    /** Execution-list-only overview backing sharded workspace loading; inherits the class read-only access. */
    @GetMapping("/plan")
    public Result<StageDurationPlanVO> plan(@RequestParam("start_date") String startDate,
            @RequestParam("end_date") String endDate,
            @RequestParam(value = "squad_id", required = false) Long squadId,
            @RequestParam(value = "sdlc_id", required = false) Long sdlcId,
            @RequestParam(value = "agent_id", required = false) Long agentId,
            @RequestParam(value = "agent_version_id", required = false) Long agentVersionId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "exclude_canceled_workitems", defaultValue = "false") boolean excludeCanceled) {
        Long workspaceId = AutoWonderContext.get().getCurrentWorkspaceId();
        if (workspaceId == null) throw new BizException(ErrorCode.WORKSPACE_NOT_MEMBER);
        LocalDate start;
        LocalDate end;
        try {
            start = LocalDate.parse(startDate);
            end = LocalDate.parse(endDate);
        } catch (RuntimeException malformed) {
            throw new BizException(ErrorCode.PARAM_INVALID);
        }
        return Result.ok(service.plan(workspaceId, start, end, squadId, sdlcId, agentId, agentVersionId, status, excludeCanceled));
    }

    @GetMapping("/versions")
    public Result<List<StageDurationVO.AgentVersion>> versions(@RequestParam("agent_id") long agentId,
            @RequestParam(value = "exclude_canceled_workitems", defaultValue = "false") boolean excludeCanceled) {
        Long workspaceId = AutoWonderContext.get().getCurrentWorkspaceId();
        if (workspaceId == null) throw new BizException(ErrorCode.WORKSPACE_NOT_MEMBER);
        return Result.ok(service.versions(workspaceId, agentId, excludeCanceled));
    }

    @GetMapping("/version-samples")
    public Result<StageDurationVO> versionSamples(@RequestParam("agent_id") long agentId,
            @RequestParam("version_ids") List<Long> versionIds,
            @RequestParam(value = "start_date", required = false) String startDate,
            @RequestParam(value = "end_date", required = false) String endDate,
            @RequestParam(value = "exclude_canceled_workitems", defaultValue = "false") boolean excludeCanceled) {
        Long workspaceId = AutoWonderContext.get().getCurrentWorkspaceId();
        if (workspaceId == null) throw new BizException(ErrorCode.WORKSPACE_NOT_MEMBER);
        LocalDate start = null;
        LocalDate end = null;
        if (startDate != null || endDate != null) {
            try {
                start = LocalDate.parse(startDate);
                end = LocalDate.parse(endDate);
            } catch (RuntimeException malformed) {
                throw new BizException(ErrorCode.PARAM_INVALID);
            }
        }
        return Result.ok(service.versionSamples(workspaceId, agentId, versionIds, start, end, excludeCanceled));
    }

    @PostMapping("/recover-snapshots")
    @RequireWorkspaceAccess(value = WorkspaceAccessLevel.READ_WRITE, action = "恢复历史流程快照", actionKey = "access.action.recover_sdlc_snapshots")
    public Result<StageDurationVO.Recovery> recover(@RequestParam("start_date") String startDate,
            @RequestParam("end_date") String endDate,
            @RequestParam(value = "squad_id", required = false) Long squadId,
            @RequestParam(value = "sdlc_id", required = false) Long sdlcId,
            @RequestParam(value = "before_dispatch_id", required = false) Long beforeDispatchId) {
        Long workspaceId = AutoWonderContext.get().getCurrentWorkspaceId();
        if (workspaceId == null) throw new BizException(ErrorCode.WORKSPACE_NOT_MEMBER);
        LocalDate start;
        LocalDate end;
        try {
            start = LocalDate.parse(startDate);
            end = LocalDate.parse(endDate);
        } catch (RuntimeException malformed) {
            throw new BizException(ErrorCode.PARAM_INVALID);
        }
        return Result.ok(service.recoverSnapshots(workspaceId, start, end, squadId, sdlcId, beforeDispatchId));
    }
}
