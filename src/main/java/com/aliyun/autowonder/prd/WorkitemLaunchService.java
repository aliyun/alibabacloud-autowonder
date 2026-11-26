package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.agent.AgentDao;
import com.aliyun.autowonder.common.error.*;
import com.aliyun.autowonder.conversation.*;
import com.aliyun.autowonder.prd.dto.SelectTargetRequest;
import com.aliyun.autowonder.squad.SquadMemberDao;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
@RequiredArgsConstructor
public class WorkitemLaunchService {
    private final WorkitemLaunchDao launches;
    private final WorkitemLaunchAccess access;
    private final PrdDesignDao designs;
    private final PrdDesignService designService;
    private final PrdDesignRuntimeDao runtimes;
    private final AgentConversationDao conversations;
    private final AgentConversationTurnDao turns;
    private final AgentDao agents;
    private final SquadMemberDao members;
    private final WorkitemClarificationConversationService clarification;
    @org.springframework.beans.factory.annotation.Autowired
    private PrdDesignHandoffDao handoffs;

    public record State(
            Long conversationId,
            Long agentId,
            Long squadId,
            Long repoId,
            String phase,
            boolean managed) {}

    private String channel(boolean design) {
        return design ? "WORKITEM_PRD" : "WORKITEM_CLARIFICATION";
    }

    private State state(WorkitemLaunchDao.Launch row) {
        return new State(
                row.conversationId(),
                row.agentId(),
                row.squadId(),
                row.repoId(),
                row.phase(),
                true);
    }

    public State read(long ws, long item, boolean design) {
        access.checkItem(ws, item, false);
        var row = launches.latest(ws, item, design ? "DESIGN" : "CLARIFY");
        var target = designs.findByWorkitem(ws, item);
        var conv = conversations.findLatestByWorkitemChannel(ws, channel(design), item);
        if (row != null && (design || conv == null || row.conversationId() == conv.getId()))
            return state(row);
        var runtime = design ? runtimes.findLatestByWorkitem(ws, item) : null;
        Long repo = target == null ? null : target.getTargetRepoId();
        if (design && runtime != null)
            conv = conversations.findById(ws, runtime.getConversationId());
        boolean history =
                design
                        && conv != null
                        && runtime == null
                        && !ConversationTurnHistory.page(turns, ws, conv.getId(), null, 1, true)
                                .items()
                                .isEmpty();
        if (conv != null
                && (!design
                        || runtime != null
                        || history
                        || target != null && target.getLatestVersionNo() > 0)) {
            Long squad =
                    members.listByAgent(conv.getAgentId()).stream()
                            .filter(m -> Objects.equals(m.getTenantId(), ws))
                            .map(m -> m.getSquadId())
                            .findFirst()
                            .orElse(null);
            return new State(
                    conv.getId(), conv.getAgentId(), squad, design ? repo : null, "ACTIVE", false);
        }
        if (design && target != null && target.getLatestVersionNo() > 0)
            return new State(null, null, null, repo, "ACTIVE", false);
        var reference = launches.latest(ws, item, "CLARIFY");
        if (design && repo == null && reference != null) repo = reference.repoId();
        if (!design && handoffs != null) {
            var complete = handoffs.completed(ws, item);
            if (complete != null) repo = complete.getRepoId();
        }
        return new State(null, null, null, repo, "NEW", false);
    }

    public void check(long ws, long item, boolean design, WorkitemLaunchAccess.Choice choice) {
        access.checkItem(ws, item, false);
        access.check(ws, design, choice, previous(ws, item, design, choice));
    }

    private AgentConversationDO previous(
            long ws, long item, boolean design, WorkitemLaunchAccess.Choice choice) {
        return choice == null || choice.agentId() == null
                ? null
                : conversations.findLatestByBizRef(
                        ws, channel(design), "WORKITEM", item, choice.agentId());
    }

    @Transactional
    public State start(
            long ws, long item, long user, boolean design, WorkitemLaunchAccess.Choice choice) {
        access.checkItem(ws, item, true);
        var existing = read(ws, item, design);
        if (!"NEW".equals(existing.phase())) return existing;
        var conv = previous(ws, item, design, choice);
        long executor = access.check(ws, design, choice, conv);
        if (design) {
            boolean usesDesignBase = access.usesDesignBase(ws, choice);
            var target = designService.getOrCreate(ws, item, user);
            if (choice.repoId() != null) {
                var selection = new SelectTargetRequest();
                selection.setRepoId(choice.repoId());
                selection.setAppRoot(choice.appRoot());
                selection.setUseDesignBase(usesDesignBase);
                designService.selectTarget(ws, item, selection, user);
            } else if (target.getTargetRepoId() != null
                    && designs.updateManualTarget(
                                    target.getId(), ws, null, null, null, target.getVersion(), user)
                            != 1) {
                throw new BizException(ErrorCode.PRD_VERSION_CONFLICT);
            }
            if (conv == null) {
                conv = new AgentConversationDO();
                conv.setTenantId(ws);
                conv.setAgentId(choice.agentId());
                conv.setAgentVersionId(agents.findById(choice.agentId()).getOnlineVersionId());
                conv.setChannel(channel(true));
                conv.setBizRefType("WORKITEM");
                conv.setBizRefId(item);
                conv.setChannelConversationId(UUID.randomUUID().toString());
                conv.setExecutorId(executor);
                conv.setStatus("ACTIVE");
                conv.setLastTurnAt(new Date());
                conversations.insert(conv);
            } else if (!Objects.equals(conv.getExecutorId(), executor)) {
                conversations.updateExecutor(ws, conv.getId(), executor);
            }
            var runtime = new PrdDesignRuntimeDO();
            String key = PrdDesignRuntimeService.sourceKey(designs.findByWorkitem(ws, item));
            runtime.setWorkspaceId(ws);
            runtime.setWorkitemId(item);
            runtime.setConversationId(conv.getId());
            runtime.setExecutorId(executor);
            runtime.setTurnId(0L);
            runtime.setDispatchAttempt(1);
            runtime.setSourceKey(key);
            runtime.setDirectory("design-demo/" + item + "/" + key);
            runtimes.insert(runtime);
        } else {
            var result = clarification.getOrCreateConversation(ws, item, choice.agentId());
            conv = conversations.findById(ws, result.getId());
        }
        var row =
                new WorkitemLaunchDao.Launch(
                        ws,
                        item,
                        conv.getId(),
                        design ? "DESIGN" : "CLARIFY",
                        choice.squadId(),
                        choice.agentId(),
                        choice.repoId(),
                        user,
                        design ? "QUEUED" : "ACTIVE",
                        1);
        launches.insert(row);
        return state(row);
    }

    @Transactional
    public State retry(long ws, long item) {
        access.checkItem(ws, item, true);
        var row = launches.latest(ws, item, "DESIGN");
        if (row == null) throw new BizException(ErrorCode.PARAM_INVALID);
        if (row.phase().startsWith("FAILED")) {
            var conv = conversations.findById(ws, row.conversationId());
            var runtime = runtimes.find(ws, row.conversationId());
            if (conv == null || runtime == null) throw WorkitemLaunchAccess.failure("design_owner_unavailable");
            // A failed initial checkout has no design turns to move. Later retries must keep the local draft.
            boolean replaceOwner = "FAILED_PREPARING".equals(row.phase()) && Long.valueOf(0).equals(runtime.getTurnId());
            var choice =
                    new WorkitemLaunchAccess.Choice(
                            row.squadId(),
                            row.agentId(),
                            row.repoId() == null ? "NEW" : "REPO",
                            row.repoId(),
                            null);
            long executor = access.check(ws, true, choice, conv, replaceOwner);
            if (!replaceOwner && !Objects.equals(conv.getExecutorId(), executor))
                throw WorkitemLaunchAccess.failure("design_owner_unavailable");
            if (launches.retry(row) != 0) {
                if (!Objects.equals(conv.getExecutorId(), executor)) conversations.updateExecutor(ws, conv.getId(), executor);
                runtimes.resetPreparation(ws, row.conversationId(), executor);
            }
        }
        return read(ws, item, true);
    }
}
