package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.access.*;
import com.aliyun.autowonder.common.result.Result;
import com.aliyun.autowonder.context.AutoWonderContext;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.util.Objects;

@RestController
@RequestMapping("/api/workitems/{workitemId}/prd/review")
@RequireWorkspaceAccess(value=WorkspaceAccessLevel.READ_ONLY,action="查看设计评审",actionKey="access.action.view_prd_review")
public class PrdReviewController {
    private final PrdReviewService reviews;
    private final PrdDesignService designs;
    private final PrdReviewPreviewService previews;
    private final PrdReviewPreviewProperties previewProperties;
    private final PrdPreviewRecovery recovery;
    public PrdReviewController(PrdReviewService reviews, PrdDesignService designs, PrdReviewPreviewService previews,
                               PrdReviewPreviewProperties previewProperties, PrdPreviewRecovery recovery) {
        this.reviews=reviews; this.designs=designs; this.previews=previews;
        this.previewProperties = previewProperties;
        this.recovery = recovery;
    }
    private long workspace(long workitemId) { long workspace=AutoWonderContext.get().getCurrentWorkspaceId(); designs.get(workspace,workitemId); return workspace; }
    private long actor() { return AutoWonderContext.get().getUserId(); }
    @GetMapping
    public Result<PrdReviewService.Context> context(@PathVariable long workitemId,@RequestParam(required=false) Long agentId) {
        return Result.ok(reviews.context(workspace(workitemId),workitemId,agentId,actor()));
    }
    @GetMapping("/preview-status")
    public Result<PrdReviewPreviewService.Status> previewStatus(@PathVariable long workitemId,@RequestParam(required=false) Long agentId) {
        return Result.ok(previews.status(reviews.runtime(workspace(workitemId),workitemId,agentId)));
    }
    @PostMapping("/preview-recovery")
    public Result<PrdReviewPreviewService.Status> recoverPreview(@PathVariable long workitemId,
            @RequestParam(required = false) Long agentId) {
        var runtime = reviews.runtime(workspace(workitemId), workitemId, agentId);
        var status = previews.status(runtime);
        var binding = previewProperties.forRuntime(runtime);
        if (binding == null || !binding.isAutomatic() || "READY".equals(status.status())
                || !"RECOVERY_REQUIRED".equals(status.reason())) return Result.ok(status);
        var current = reviews.requireMemberRuntime(binding, actor());
        var currentStatus = previews.status(current);
        if (!"RECOVERY_REQUIRED".equals(currentStatus.reason())) return Result.ok(currentStatus);
        String reason = recovery.ensure(binding, current);
        return Result.ok(new PrdReviewPreviewService.Status("OFFLINE", null, null, reason));
    }
    @PostMapping("/preview-session")
    public Result<PrdReviewPreviewService.Entry> previewSession(@PathVariable long workitemId,@RequestParam(required=false) Long agentId,
            @RequestParam(defaultValue="false") boolean direct,HttpServletRequest request,HttpServletResponse response) {
        var runtime=reviews.runtime(workspace(workitemId),workitemId,agentId);
        String origin=previewProperties.getPlatformOrigin();
        if(!direct || origin==null || !Objects.equals(origin,request.getHeader("Origin")))
            return Result.ok(previews.memberEntry(runtime,actor()));
        response.setHeader("Cache-Control","no-store");
        var session=previews.memberSession(runtime,actor());
        if(session.cookie()!=null) PrdReviewPreviewGateway.setCookie(response,session.entry().basePath(),origin,session.cookie());
        return Result.ok(session.entry());
    }
    public record ShareView(PrdReviewShareDO share, boolean configured, String preferredIdentifier, String slug,
                            boolean nameWasShared) {}
    public record NameInput(String slug) {}

    @GetMapping("/share/name")
    public Result<PrdReviewService.NameView> name(@PathVariable long workitemId) {
        long workspace = workspace(workitemId);
        return Result.ok(new PrdReviewService.NameView(reviews.name(workspace, workitemId), reviews.canManage(workspace, actor())));
    }

    @PutMapping("/share/name")
    @RequireWorkspaceAccess(value=WorkspaceAccessLevel.READ_WRITE,action="分享设计",actionKey="access.action.share_prd_design")
    public Result<PrdReviewService.NameView> saveName(@PathVariable long workitemId,
            @RequestParam(required=false) Long agentId, @RequestBody NameInput input) {
        return Result.ok(reviews.saveName(workspace(workitemId), workitemId, agentId, actor(), input.slug()));
    }

    private ShareView shareView(long workspace, long workitemId, Long agentId, PrdReviewShareDO share) {
        return new ShareView(share, previews.configured(reviews.runtime(workspace, workitemId, agentId)),
                reviews.preferredIdentifier(share), reviews.name(workspace, workitemId), reviews.nameWasShared(workspace, workitemId));
    }
    @GetMapping("/share")
    public Result<ShareView> share(@PathVariable long workitemId,@RequestParam(required=false) Long agentId) {
        long workspace=workspace(workitemId);
        return Result.ok(shareView(workspace, workitemId, agentId, reviews.share(workspace, workitemId, agentId)));
    }
    @PostMapping("/share")
    @RequireWorkspaceAccess(value=WorkspaceAccessLevel.READ_WRITE,action="分享设计",actionKey="access.action.share_prd_design")
    public Result<ShareView> enable(@PathVariable long workitemId, @RequestParam(required=false) Long agentId,
            @RequestParam(defaultValue="false") boolean rotate, @RequestParam(defaultValue="false") boolean confirmNamed) {
        long workspace=workspace(workitemId);
        return Result.ok(shareView(workspace, workitemId, agentId, reviews.enable(workspace, workitemId, agentId, actor(), rotate, confirmNamed)));
    }
    @DeleteMapping("/share")
    @RequireWorkspaceAccess(value=WorkspaceAccessLevel.READ_WRITE,action="关闭设计分享",actionKey="access.action.revoke_prd_design_share")
    public Result<Void> revoke(@PathVariable long workitemId,@RequestParam(required=false) Long agentId) {
        reviews.revoke(workspace(workitemId),workitemId,agentId,actor()); return Result.ok(null);
    }
    @PostMapping("/comments")
    public Result<PrdReviewService.CommentView> create(@PathVariable long workitemId,@RequestParam(required=false) Long agentId,@RequestBody PrdReviewService.CommentInput input) {
        return Result.ok(reviews.create(reviews.runtime(workspace(workitemId),workitemId,agentId),actor(),input));
    }
    @PatchMapping("/comments/{id}")
    public Result<PrdReviewService.CommentView> update(@PathVariable long workitemId,@PathVariable long id,@RequestParam(required=false) Long agentId,@RequestBody PrdReviewService.CommentUpdate input) {
        return Result.ok(reviews.update(reviews.runtime(workspace(workitemId),workitemId,agentId),actor(),id,input,false));
    }
    @DeleteMapping("/comments/{id}")
    public Result<Void> delete(@PathVariable long workitemId,@PathVariable long id,@RequestParam(required=false) Long agentId,@RequestParam int version) {
        reviews.update(reviews.runtime(workspace(workitemId),workitemId,agentId),actor(),id,new PrdReviewService.CommentUpdate(null,null,version),true); return Result.ok(null);
    }
}
