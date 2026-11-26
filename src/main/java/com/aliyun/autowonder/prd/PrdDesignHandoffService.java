package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.artifact.RequirementDocumentService;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.common.i18n.SystemMessages;
import com.aliyun.autowonder.context.AutoWonderContext;
import com.aliyun.autowonder.conversation.AgentConversationDao;
import com.aliyun.autowonder.conversation.AgentConversationTurnDao;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.json.JSONObject;
import com.aliyun.autowonder.notification.NotificationDO;
import com.aliyun.autowonder.notification.NotificationDao;
import com.aliyun.autowonder.prd.PrdDesignHandoffDao.Review;
import com.aliyun.autowonder.prd.dto.ConfirmVersionRequest;
import com.aliyun.autowonder.redis.RedisManager;
import com.aliyun.autowonder.repo.RepoDao;
import com.aliyun.autowonder.user.UserDao;
import com.aliyun.autowonder.user.UserSettingService;
import com.aliyun.autowonder.websocket.PresenceManager;
import com.aliyun.autowonder.websocket.SessionRegistry;
import com.aliyun.autowonder.websocket.WsDispatchTransport;
import com.aliyun.autowonder.workitem.WorkitemDao;
import com.aliyun.autowonder.workspace.WorkspaceMemberDao;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

import static com.aliyun.autowonder.prd.PrdDesignHandoffStatus.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class PrdDesignHandoffService {
    private static final Pattern SHA = Pattern.compile("(?:[0-9a-f]{40}|[0-9a-f]{64})");
    private final PrdDesignHandoffDao handoffs;
    private final PrdDesignService designs;
    private final PrdDesignDao designRows;
    private final PrdDesignRuntimeService runtimeService;
    private final PrdDesignRuntimeDao runtimes;
    private final PrdReviewService share;
    private final WorkitemDao workitems;
    private final WorkitemLaunchDao launches;
    private final WorkitemLaunchAccess launchAccess;
    private final RepoDao repos;
    private final WorkspaceMemberDao members;
    private final UserDao users;
    private final UserSettingService userSettings;
    private final AgentConversationDao conversations;
    private final AgentConversationTurnDao turns;
    private final RequirementDocumentService documents;
    private final NotificationDao notifications;
    private final PrdReviewPreviewProperties preview;
    private final PresenceManager presence;
    private final SessionRegistry sessions;
    private final RedisManager redis;
    private final TransactionTemplate transactions;
    private final PrdDesignRepository repositories;

    public record Document(long versionId, String fileName, String markdown) {}
    public record Reviewer(long id, String name) {}
    public record Submission(long agentId, long versionId, String expectedDigest, List<Long> reviewerIds) {}
    public record Decision(String action, String reason) {}
    public record View(Long id, long versionId, PrdDesignHandoffStatus status, long repoId, String repoUrl, String branch,
                       List<Long> reviewerIds, long creatorId, Long decidedBy, LocalDateTime decisionAt,
                       String decisionReason, String commit, Long attachmentId, String attachmentName,
                       boolean canDecide, boolean canWithdraw, boolean canRetry) {}
    public record State(boolean canSubmit, boolean managed, View review, View completed) {}

    public State state(long workspace, long item, long actor) {
        var design = designs.peek(workspace, item);
        if (design == null) return new State(false, false, null, null);
        boolean managed = PrdDesignService.managedTarget(designRows.findByWorkitem(workspace, item));
        Review latest = handoffs.latest(workspace, item);
        Review complete = latest != null && latest.getStatus() == COMPLETED
                ? latest : handoffs.completed(workspace, item);
        boolean write = eligible(workspace, actor);
        return new State(write && handoffs.frozen(workspace, item) == 0, managed,
                view(latest, actor, write), view(complete, actor, write));
    }

    public Document document(long workspace, long item, long versionId) {
        var version = designs.getVersion(workspace, versionId);
        if (!Objects.equals(designs.get(workspace, item).getId(), version.getDesignId())) {
            throw new BizException(ErrorCode.PRD_VERSION_NOT_FOUND);
        }
        String frozen = handoffs.frozenDocument(workspace, item, versionId);
        return new Document(versionId, "prd-" + item + ".md", frozen == null ? PrdMarkdown.render(version.getDesignJson()) : frozen);
    }

    public List<Reviewer> reviewers(long workspace, long item, long actor) {
        requireEligible(workspace, actor);
        designs.get(workspace, item);
        return members.listByTenant(workspace).stream().map(member -> users.findById(member.getUserId()))
                .filter(Objects::nonNull).filter(user -> eligible(workspace, user.getId()))
                .map(user -> new Reviewer(user.getId(), user.getNickname() == null || user.getNickname().isBlank()
                        ? user.getUsername() : user.getNickname())).toList();
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public View submit(long workspace, long item, long actor, Submission input) {
        requireEligible(workspace, actor);
        lockWorkitem(workspace, item);
        requireEditable(handoffs, workspace, item);
        if (input == null || input.reviewerIds() == null || input.reviewerIds().isEmpty()
                || input.reviewerIds().size() > 100) throw failure("reviewers");
        var reviewerIds = new LinkedHashSet<>(input.reviewerIds());
        if (reviewerIds.stream().anyMatch(id -> id == null || !eligible(workspace, id))) throw failure("reviewers");

        var design = designs.get(workspace, item);
        if (!PrdDesignService.managedTarget(designRows.findByWorkitem(workspace, item))) throw failure("checkout");
        var version = designs.getVersion(workspace, input.versionId());
        if (!Objects.equals(design.getId(), version.getDesignId())
                || !Objects.equals(version.getVersionNo(), design.getLatestVersionNo())) {
            throw new BizException(ErrorCode.PRD_VERSION_CONFLICT);
        }
        if (!Objects.equals(version.getDesignSha256(), input.expectedDigest())) throw new BizException(ErrorCode.PRD_DIGEST_MISMATCH);
        var prior = handoffs.completed(workspace, item);
        if (prior != null && prior.getVersionId() == input.versionId()) throw failure("already_completed");
        designs.validateHandoff(workspace, item, input.versionId());
        String markdown = PrdMarkdown.render(version.getDesignJson());
        if (markdown.getBytes(StandardCharsets.UTF_8).length > 512 * 1024) throw failure("document_size");

        var runtime = runtimeService.get(workspace, item, input.agentId());
        if (runtime == null) throw failure("checkout");
        var launch = launches.find(workspace, runtime.getConversationId());
        if (launch == null || launch.repoId() == null || !"ACTIVE".equals(launch.phase())
                || !Objects.equals(launch.repoId(), design.getTargetRepoId())) throw failure("checkout");
        var binding = preview.forRuntime(runtime);
        if (binding == null || !binding.isAutomatic()) throw failure("checkout");
        var repo = repos.findById(launch.repoId());
        if (repo == null || !Objects.equals(repo.getTenantId(), workspace)) throw failure("checkout");
        if (!repositories.supportsRepository(repo.getUrl())) throw failure("repository");
        var conversation = conversations.findById(workspace, runtime.getConversationId());
        if (conversation == null) throw failure("checkout");
        launchAccess.requireConversationRepo(conversation);
        if (turns.findActiveHistoryTurn(workspace, runtime.getConversationId()) != null) throw failure("turn_active");

        var row = new Review();
        row.setWorkspaceId(workspace);
        row.setWorkitemId(item);
        row.setConversationId(runtime.getConversationId());
        row.setExecutorId(runtime.getExecutorId());
        row.setSourceKey(runtime.getSourceKey());
        row.setVersionId(version.getId());
        row.setDesignDigest(version.getDesignSha256());
        row.setRepoId(repo.getId());
        row.setRepoUrl(repo.getUrl());
        row.setBranch(PrdDesignRepository.designBranch(item, runtime.getSourceKey()));
        row.setReviewersJson(JSON.toJSONString(reviewerIds));
        row.setMarkdown(markdown);
        row.setCreatorId(actor);
        handoffs.insert(row);
        return view(handoffs.lock(workspace, row.getId()), actor, true);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public View decide(long workspace, long item, long id, long actor, Decision input) {
        requireEligible(workspace, actor);
        lockWorkitem(workspace, item);
        var row = handoffs.lock(workspace, id);
        if (row == null || row.getWorkitemId() != item || input == null || input.action() == null) throw failure("stale");
        switch (input.action()) {
            case "APPROVE", "RETURN" -> {
                if (row.getStatus() != IN_REVIEW || !reviewerIds(row).contains(actor)) throw failure("stale");
                boolean approve = "APPROVE".equals(input.action());
                String reason = input.reason() == null ? null : input.reason().strip();
                if (!approve && (reason == null || reason.isEmpty() || reason.length() > 2000)) throw failure("return_reason");
                String branch = approve ? PrdDesignRepository.reviewBranch(row) : row.getBranch();
                handoffs.decide(row, approve ? ATTACHING : RETURNED, actor, approve ? null : reason, branch);
                if (!approve) notify(row, row.getCreatorId(), "returned", reason);
            }
            case "WITHDRAW" -> {
                if (actor != row.getCreatorId() || !withdrawable(row.getStatus())) throw failure("stale");
                handoffs.advance(row, WITHDRAWN, null, null);
            }
            case "RETRY" -> {
                if (actor != row.getCreatorId() && !Objects.equals(row.getDecidedBy(), actor)) throw failure("stale");
                String branch = switch (row.getStatus()) {
                    case PUSH_FAILED -> PrdDesignRepository.reviewBranch(row);
                    case ATTACHMENT_FAILED -> row.getBranch();
                    default -> throw failure("stale");
                };
                handoffs.retryAttachment(row, branch);
            }
            default -> throw failure("stale");
        }
        return view(handoffs.lock(workspace, id), actor, true);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void receive(long workspace, long executor, JSONObject message) {
        var row = handoffs.lock(workspace, message.getLongValue("reviewId"));
        if (row == null || row.getExecutorId() != executor || row.getAttempt() != message.getIntValue("attempt")
                || row.getConversationId() != message.getLongValue("conversationId")) return;
        String action = message.getString("action");
        String commit = message.getString("commit");
        boolean success = Boolean.TRUE.equals(message.getBoolean("success")) && commit != null && SHA.matcher(commit).matches();
        if (row.getStatus() == SNAPSHOTTING && row.getCommitSha() == null && "SNAPSHOT".equals(action)) {
            if (!success) handoffs.advance(row, SNAPSHOT_FAILED, null, null);
            else acceptSnapshot(row, commit);
        }
    }

    @Scheduled(fixedDelay = 2000)
    public void tick() {
        for (var due : handoffs.due()) {
            if (handoffs.claim(due) == 0) continue;
            var previous = AutoWonderContext.get();
            AutoWonderContext.destroy();
            try {
                AutoWonderContext.get().setCurrentWorkspaceId(due.getWorkspaceId());
                var command = transactions.execute(status -> process(due));
                if (command != null) send(command);
            } catch (RuntimeException | java.io.IOException ex) {
                log.warn("PRD handoff {} step {} failed", due.getId(), due.getStatus(), ex);
                if (due.getStatus() == ATTACHING) handoffs.advance(due, ATTACHMENT_FAILED, null, null);
            } finally {
                AutoWonderContext.setContext(previous);
            }
        }
    }

    private record Dispatch(long executor, long workspace, String session, String payload) {}

    private void acceptSnapshot(Review row, String commit) {
        if (handoffs.recordSnapshot(row, commit, PrdDesignRepository.reviewBranch(row)) == 0) return;
        for (long reviewer : reviewerIds(row)) {
            if (eligible(row.getWorkspaceId(), reviewer)) notify(row, reviewer, "requested", null);
        }
    }

    private Review currentReview(Review due) {
        var row = handoffs.lock(due.getWorkspaceId(), due.getId());
        return row != null && row.getAttempt() == due.getAttempt() && row.getStatus() == due.getStatus()
                ? row : null;
    }

    private Dispatch process(Review due) {
        if (due.getStatus() == ATTACHING) lockWorkitem(due.getWorkspaceId(), due.getWorkitemId());
        var row = currentReview(due);
        if (row == null) return null;
        if (row.getStatus() == ATTACHING) {
            finish(row);
            return null;
        }
        // Older versions persisted the acknowledged snapshot before a separate Git job.
        if (row.getStatus() == PUSHING) {
            handoffs.recoverPublishing(row, PrdDesignRepository.reviewBranch(row));
            return null;
        }
        if (row.getCommitSha() != null) {
            acceptSnapshot(row, row.getCommitSha());
            return null;
        }
        var repo = repos.findById(row.getRepoId());
        var runtime = runtimes.find(row.getWorkspaceId(), row.getConversationId());
        var conversation = conversations.findById(row.getWorkspaceId(), row.getConversationId());
        if (repo == null || !Objects.equals(repo.getTenantId(), row.getWorkspaceId())
                || !Objects.equals(repo.getUrl(), row.getRepoUrl()) || conversation == null
                || runtime == null || !Objects.equals(runtime.getExecutorId(), row.getExecutorId())
                || !Objects.equals(runtime.getSourceKey(), row.getSourceKey()) || Boolean.TRUE.equals(row.getExpired())) {
            handoffs.advance(row, SNAPSHOT_FAILED, null, null);
            return null;
        }
        try {
            launchAccess.requireConversationRepo(conversation);
        } catch (BizException ex) {
            handoffs.advance(row, SNAPSHOT_FAILED, null, null);
            return null;
        }
        handoffs.dispatched(row);
        String session = presence.currentSessionId(row.getExecutorId());
        if (session == null) return null;
        var binding = preview.forRuntime(runtime);
        if (binding == null || !binding.isAutomatic()) {
            handoffs.advance(row, SNAPSHOT_FAILED, null, null);
            return null;
        }
        var frame = PrdPreviewRecovery.frame(binding, runtime);
        frame.put("type", "PRD_DESIGN_HANDOFF");
        frame.put("executorId", row.getExecutorId());
        frame.put("sessionId", session);
        frame.put("reviewId", row.getId());
        frame.put("attempt", row.getAttempt());
        frame.put("action", "SNAPSHOT");
        frame.put("repoUrl", row.getRepoUrl());
        frame.put("designBranch", row.getBranch());
        frame.put("reviewRef", "refs/heads/" + PrdDesignRepository.reviewBranch(row));
        frame.put("markdown", row.getMarkdown());
        return new Dispatch(row.getExecutorId(), row.getWorkspaceId(), session, JSON.toJSONString(frame));
    }

    private void send(Dispatch command) throws java.io.IOException {
        var local = sessions.findByExecutorId(command.executor());
        if (local != null && command.session().equals(local.getSession().getId()) && local.getTenantId() == command.workspace()) {
            local.sendText(command.payload());
        } else redis.publish(WsDispatchTransport.BROADCAST_CHANNEL, command.payload());
    }

    private void finish(Review row) {
        var version = designs.getVersion(row.getWorkspaceId(), row.getVersionId());
        if (!Objects.equals(version.getDesignSha256(), row.getDesignDigest())) throw new BizException(ErrorCode.PRD_DIGEST_MISMATCH);
        if (!"CONFIRMED".equals(version.getStatus())) {
            var confirmation = new ConfirmVersionRequest();
            confirmation.setVersionId(row.getVersionId());
            confirmation.setExpectedDigest(row.getDesignDigest());
            designs.confirmHandoff(row.getWorkspaceId(), row.getWorkitemId(), confirmation, row.getDecidedBy());
        }
        var attachment = documents.uploadMcp(row.getWorkitemId(), row.attachmentFilename(),
                row.getMarkdown().getBytes(StandardCharsets.UTF_8), row.getWorkspaceId(), row.getDecidedBy(),
                "docs/uxer/prd-" + row.getWorkitemId() + ".md");
        handoffs.advance(row, COMPLETED, null, attachment.getId());
        notify(row, row.getCreatorId(), "completed", null);
    }

    private void notify(Review row, long recipient, String event, String reason) {
        var locale = userSettings.recipientLocale(recipient);
        String key = "prd.handoff.notification." + event;
        var notification = new NotificationDO();
        notification.setTenantId(row.getWorkspaceId());
        notification.setRecipientId(recipient);
        notification.setType("PRD_DESIGN_REVIEW");
        notification.setTitle(SystemMessages.render(key + ".title", null, "", locale));
        notification.setContent(reason == null ? SystemMessages.render(key + ".body", null, "", locale) : reason);
        notification.setLink("/workitems/" + row.getWorkitemId() + "/design?prdDocument=" + row.getVersionId());
        notification.setRefType("WORKITEM");
        notification.setRefId(row.getWorkitemId());
        notification.setStatus("UNREAD");
        notification.setChannelsJson("[]");
        notifications.insert(notification);
    }

    private void lockWorkitem(long workspace, long item) {
        if (workitems.findByIdForUpdate(item, workspace) == null) throw new BizException(ErrorCode.PRD_DESIGN_NOT_FOUND);
    }

    private View view(Review row, long actor, boolean write) {
        if (row == null) return null;
        var reviewers = reviewerIds(row);
        return new View(row.getId(), row.getVersionId(), row.getStatus(), row.getRepoId(), row.getRepoUrl(), row.getBranch(),
                reviewers, row.getCreatorId(), row.getDecidedBy(), row.getDecisionAt(), row.getDecisionReason(),
                row.getCommitSha(), row.getAttachmentId(), row.getAttachmentId() == null ? null : row.attachmentFilename(),
                write && row.getStatus() == IN_REVIEW && reviewers.contains(actor),
                write && row.getCreatorId() == actor && withdrawable(row.getStatus()),
                write && (row.getCreatorId() == actor || Objects.equals(row.getDecidedBy(), actor))
                        && (row.getStatus() == PUSH_FAILED || row.getStatus() == ATTACHMENT_FAILED));
    }

    private static List<Long> reviewerIds(Review row) {
        return JSON.parseArray(row.getReviewersJson(), Long.class);
    }

    private static boolean withdrawable(PrdDesignHandoffStatus status) {
        return status == IN_REVIEW;
    }

    private boolean eligible(long workspace, long actor) {
        var user = users.findById(actor);
        return user != null && Integer.valueOf(0).equals(user.getStatus()) && share.canManage(workspace, actor);
    }

    private void requireEligible(long workspace, long actor) {
        if (!eligible(workspace, actor)) throw new BizException(ErrorCode.NO_PERMISSION);
    }

    static void requireEditable(PrdDesignHandoffDao handoffs, long workspace, long item) {
        if (handoffs != null && handoffs.lockActive(workspace, item) != null) throw failure("frozen");
    }

    static BizException failure(String reason) {
        return BizException.keyed(ErrorCode.CONFLICT, "prd.handoff." + reason, new Object[]{}, reason);
    }
}
