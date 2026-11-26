package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.common.result.Result;
import com.aliyun.autowonder.context.AutoWonderContext;
import org.springframework.web.bind.annotation.*;

/** Login-only boundary: the share grants this design alone, never workspace membership. */
@RestController
@RequestMapping("/api/design-reviews/{token}")
public class PrdSharedReviewController {
    private final PrdReviewService reviews;
    private final PrdReviewPreviewService previews;
    public PrdSharedReviewController(PrdReviewService reviews,PrdReviewPreviewService previews) { this.reviews=reviews; this.previews=previews; }
    private long actor() { return AutoWonderContext.get().getUserId(); }
    @GetMapping
    public Result<PrdReviewService.Context> context(@PathVariable String token) { return Result.ok(reviews.sharedContext(token,actor())); }
    @GetMapping("/preview-status")
    public Result<PrdReviewPreviewService.Status> status(@PathVariable String token) { return Result.ok(previews.status(reviews.requireShare(token))); }
    @PostMapping("/preview-session")
    public Result<PrdReviewPreviewService.Entry> preview(@PathVariable String token) { return Result.ok(previews.entry(reviews.requireShare(token),actor())); }
    @PostMapping("/comments")
    public Result<PrdReviewService.CommentView> create(@PathVariable String token,@RequestBody PrdReviewService.CommentInput input) {
        return Result.ok(reviews.create(reviews.requireRuntime(reviews.requireShare(token)),actor(),input));
    }
    @PatchMapping("/comments/{id}")
    public Result<PrdReviewService.CommentView> update(@PathVariable String token,@PathVariable long id,@RequestBody PrdReviewService.CommentUpdate input) {
        return Result.ok(reviews.update(reviews.requireRuntime(reviews.requireShare(token)),actor(),id,input,false));
    }
    @DeleteMapping("/comments/{id}")
    public Result<Void> delete(@PathVariable String token,@PathVariable long id,@RequestParam int version) {
        reviews.update(reviews.requireRuntime(reviews.requireShare(token)),actor(),id,new PrdReviewService.CommentUpdate(null,null,version),true); return Result.ok(null);
    }
}
