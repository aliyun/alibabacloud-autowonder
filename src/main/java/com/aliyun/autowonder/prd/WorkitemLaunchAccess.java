package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.agent.*;
import com.aliyun.autowonder.common.error.*;
import com.aliyun.autowonder.conversation.*;
import com.aliyun.autowonder.repo.RepoDao;
import com.aliyun.autowonder.squad.SquadMemberDao;
import com.aliyun.autowonder.websocket.PresenceManager;
import com.aliyun.autowonder.workitem.WorkitemDao;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;

import java.util.Objects;

@Service
@RequiredArgsConstructor
public class WorkitemLaunchAccess {
    private final WorkitemDao workitems;
    private final SquadMemberDao members;
    private final AgentDao agents;
    private final RepoDao repos;
    private final AgentRepoPermDao permissions;
    private final ConversationExecutorRouter router;
    private final PresenceManager presence;
    private final WorkitemLaunchDao launches;
    private final PrdReviewPreviewProperties preview;
    @org.springframework.beans.factory.annotation.Autowired
    private PrdDesignHandoffDao handoffs;

    public record Choice(Long squadId, Long agentId, String source, Long repoId, String appRoot) {}

    public boolean usesDesignBase(long workspace, Choice choice) {
        if (choice == null || choice.repoId() == null) return false;
        var repo = repos.findById(choice.repoId());
        return repo != null && Objects.equals(repo.getTenantId(), workspace)
                && repo.getDesignBaseBranch() != null && !repo.getDesignBaseBranch().isBlank();
    }

    public void checkItem(long workspace, long item, boolean lock) {
        var row = lock ? workitems.findByIdForUpdate(item, workspace) : workitems.findById(item);
        if (row == null || !Objects.equals(row.getTenantId(), workspace))
            throw new BizException(ErrorCode.WORKITEM_NOT_FOUND);
    }

    public long check(long ws, boolean design, Choice choice, AgentConversationDO conversation) {
        return check(ws, design, choice, conversation, false);
    }

    long check(long ws, boolean design, Choice choice, AgentConversationDO conversation, boolean replaceDesignOwner) {
        if (choice == null || choice.squadId() == null || choice.agentId() == null)
            throw new BizException(ErrorCode.PARAM_INVALID);
        if (design && !(choice.repoId() == null ? "NEW" : "REPO").equals(choice.source()))
            throw new BizException(ErrorCode.PARAM_INVALID);
        var member = members.findBySquadAndAgent(choice.squadId(), choice.agentId());
        var agent = agents.findById(choice.agentId());
        if (member == null
                || !Objects.equals(member.getTenantId(), ws)
                || agent == null
                || !Objects.equals(agent.getTenantId(), ws))
            throw new BizException(ErrorCode.PARAM_INVALID);
        if (agent.getOnlineVersionId() == null) {
            throw BizException.keyed(ErrorCode.AGENT_NOT_ONLINE, "workitem.launch.agent_unpublished", null,
                    "Employee has no published configuration version");
        }
        long version =
                conversation == null
                        ? agent.getOnlineVersionId()
                        : conversation.getAgentVersionId();
        requireRepo(ws, version, choice.repoId(), design);
        if (version != agent.getOnlineVersionId())
            requireRepo(ws, agent.getOnlineVersionId(), choice.repoId(), design);
        Long preferred = conversation == null ? null : conversation.getExecutorId();
        Long executor = replaceDesignOwner
                ? router.selectDesignPreparationReplacement(ws, agent.getId(), version, preferred) : null;
        if (executor == null) {
            executor = design ? router.selectDesign(ws, agent.getId(), version, preferred)
                    : router.select(ws, agent.getId(), version, preferred);
        }
        if (executor == null || !presence.isExecutorOnline(executor)) {
            throw new BizException(ErrorCode.CLARIFICATION_EXECUTOR_OFFLINE);
        }
        if (design && preview.getPlatformOrigin() == null) throw failure("preview_origin");
        return executor;
    }

    public void requireRepo(long ws, long version, Long id, boolean write) {
        if (id == null) return;
        var repo = repos.findById(id);
        if (repo == null || !Objects.equals(repo.getTenantId(), ws))
            throw new BizException(ErrorCode.REPO_NOT_FOUND);
        var grant =
                permissions.listByVersion(version).stream()
                        .filter(
                                p ->
                                        id.equals(p.getRepoId())
                                                && Objects.equals(ws, p.getTenantId()))
                        .findFirst();
        if (grant.isEmpty()) throw failure("no_repo");
        String level = grant.get().getPermLevel();
        if (!"WRITE".equalsIgnoreCase(level) && (write || !"READ".equalsIgnoreCase(level)))
            throw failure(write ? "write_required" : "no_repo");
    }

    public void requireConversationRepo(AgentConversationDO conversation) {
        var launch = launches.find(conversation.getTenantId(), conversation.getId());
        if (launch != null)
            requireRepo(
                    launch.workspaceId(),
                    conversation.getAgentVersionId(),
                    launch.repoId(),
                    "DESIGN".equals(launch.activity()));
    }

    public java.util.List<java.util.Map<String, Object>> boundRepositories(
            AgentConversationDO conversation, java.util.List<java.util.Map<String, Object>> repos) {
        var launch = launches.find(conversation.getTenantId(), conversation.getId());
        if (launch == null) return repos;
        if (launch.repoId() == null) return java.util.List.of();
        boolean design = "DESIGN".equals(launch.activity());
        requireRepo(
                launch.workspaceId(), conversation.getAgentVersionId(), launch.repoId(), design);
        var selected =
                repos.stream()
                        .filter(
                                repo ->
                                        repo.get("repoId") instanceof Number id
                                                && id.longValue() == launch.repoId())
                        .findFirst()
                        .orElseThrow(() -> failure("no_repo"));
        // Design has its own isolated checkout. Sending an eager repository capability would clone
        // it again.
        if (design) return java.util.List.of();
        var scoped = new java.util.LinkedHashMap<>(selected);
        scoped.put("allowCommit", false);
        scoped.put("allowPush", false);
        return java.util.List.of(scoped);
    }

    public String referencePrompt(AgentConversationDO conversation) {
        var row = launches.find(conversation.getTenantId(), conversation.getId());
        String repo = row == null || row.repoId() == null ? ""
                : "本次需求澄清选用了空间仓库 #" + row.repoId() + " 作为参考。需要查证实现时，只读查看本轮提供的仓库。";
        var complete = handoffs == null || conversation.getBizRefId() == null ? null
                : handoffs.completed(conversation.getTenantId(), conversation.getBizRefId());
        if (complete == null) return repo.isEmpty() ? null : repo;
        return repo + """

                【已交付的产品与交互设计】
                空间仓库编号：%d
                交互设计分支：%s
                已评审提交：%s
                需求说明附件编号：%d
                需求说明仓库路径：docs/uxer/prd-%d.md
                通过 autowonder.list_workitem_documents 核对附件，再用 autowonder.workitem_cli_download_token 提供的命令下载并阅读。
                以该交付为需求澄清的起点，继续核对未明确的事项。
                """.formatted(complete.getRepoId(), complete.getBranch(), complete.getCommitSha(),
                complete.getAttachmentId(), complete.getWorkitemId());
    }

    public static BizException failure(String reason) {
        return BizException.keyed(
                "no_repo".equals(reason) || "write_required".equals(reason)
                        ? ErrorCode.NO_PERMISSION : ErrorCode.CONFLICT,
                "workitem.launch." + reason,
                null,
                "Work item launch: " + reason);
    }
}
