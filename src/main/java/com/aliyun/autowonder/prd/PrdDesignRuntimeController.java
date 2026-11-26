package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.access.RequireWorkspaceAccess;
import com.aliyun.autowonder.access.WorkspaceAccessLevel;
import com.aliyun.autowonder.common.result.Result;
import com.aliyun.autowonder.context.AutoWonderContext;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/workitems/{workitemId}/prd/runtime")
@RequireWorkspaceAccess(value = WorkspaceAccessLevel.READ_ONLY, action = "查看 PRD 设计", actionKey = "access.action.view_prd_design")
public class PrdDesignRuntimeController {
    private final PrdDesignService designs;
    private final PrdDesignRuntimeService runtimes;
    public PrdDesignRuntimeController(PrdDesignService designs, PrdDesignRuntimeService runtimes) {
        this.designs = designs; this.runtimes = runtimes;
    }
    @GetMapping
    public Result<PrdDesignRuntimeDO> get(@PathVariable long workitemId, @RequestParam(required = false) Long agentId) {
        long workspaceId = AutoWonderContext.get().getCurrentWorkspaceId();
        designs.get(workspaceId, workitemId);
        return Result.ok(runtimes.get(workspaceId, workitemId, agentId));
    }
}
