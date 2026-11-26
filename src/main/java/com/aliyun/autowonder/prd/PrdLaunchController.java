package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.access.*;
import com.aliyun.autowonder.common.result.Result;
import com.aliyun.autowonder.context.AutoWonderContext;

import lombok.RequiredArgsConstructor;

import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/workitems/{item}/prd/launch")
@RequireWorkspaceAccess(value = WorkspaceAccessLevel.READ_ONLY,
        action = "查看 PRD 设计", actionKey = "access.action.view_prd_design")
public class PrdLaunchController {
    private final WorkitemLaunchService launches;

    private long ws() {
        return AutoWonderContext.get().getCurrentWorkspaceId();
    }

    @GetMapping
    public Result<WorkitemLaunchService.State> read(@PathVariable long item) {
        return Result.ok(launches.read(ws(), item, true));
    }

    @PostMapping("/check")
    @RequireWorkspaceAccess(value = WorkspaceAccessLevel.READ_WRITE,
            action = "设计 PRD", actionKey = "access.action.design_prd")
    public Result<Void> check(
            @PathVariable long item, @RequestBody WorkitemLaunchAccess.Choice choice) {
        launches.check(ws(), item, true, choice);
        return Result.ok(null);
    }

    @PostMapping
    @RequireWorkspaceAccess(value = WorkspaceAccessLevel.READ_WRITE,
            action = "设计 PRD", actionKey = "access.action.design_prd")
    public Result<WorkitemLaunchService.State> start(
            @PathVariable long item, @RequestBody WorkitemLaunchAccess.Choice choice) {
        return Result.ok(
                launches.start(ws(), item, AutoWonderContext.get().getUserId(), true, choice));
    }

    @PostMapping("/retry")
    @RequireWorkspaceAccess(value = WorkspaceAccessLevel.READ_WRITE,
            action = "设计 PRD", actionKey = "access.action.design_prd")
    public Result<WorkitemLaunchService.State> retry(@PathVariable long item) {
        return Result.ok(launches.retry(ws(), item));
    }
}
