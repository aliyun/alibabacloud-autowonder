package com.aliyun.autowonder.office;

import com.aliyun.autowonder.access.RequireWorkspaceAccess;
import com.aliyun.autowonder.access.WorkspaceAccessLevel;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.common.result.Result;
import com.aliyun.autowonder.context.AutoWonderContext;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/office")
@RequireWorkspaceAccess(value = WorkspaceAccessLevel.READ_ONLY,
        action = "查看黑灯工厂", actionKey = "access.action.view_office_activity")
public class OfficeActivityController {
    private final OfficeActivityService service;

    public OfficeActivityController(OfficeActivityService service) {
        this.service = service;
    }

    @GetMapping("/activity")
    public Result<OfficeActivitySnapshotVO> activity() {
        Long workspaceId = AutoWonderContext.get().getCurrentWorkspaceId();
        if (workspaceId == null || workspaceId <= 0) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        return Result.ok(service.snapshot(workspaceId));
    }
}
