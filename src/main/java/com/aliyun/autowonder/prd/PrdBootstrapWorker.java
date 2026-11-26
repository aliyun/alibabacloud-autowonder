package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.ai.AiSessionDO;
import com.aliyun.autowonder.context.AutoWonderContext;
import com.aliyun.autowonder.conversation.*;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.redis.RedisManager;
import com.aliyun.autowonder.repo.RepoDao;
import com.aliyun.autowonder.websocket.*;

import lombok.RequiredArgsConstructor;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.*;

@Service
@RequiredArgsConstructor
public class PrdBootstrapWorker {
    private final WorkitemLaunchDao launches;
    private final WorkitemLaunchAccess access;
    private final AgentConversationDao conversations;
    private final com.aliyun.autowonder.conversation.AgentConversationTurnDao turns;
    private final PrdDesignRuntimeDao runtimes;
    private final PrdReviewPreviewProperties preview;
    private final PrdPreviewRecovery recovery;
    private final PrdDesignTemplateService templates;
    private final PrdDesignDao designs;
    private final RepoDao repos;
    private final PresenceManager presence;
    private final SessionRegistry sessions;
    private final RedisManager redis;
    private final ObjectProvider<AgentConversationService> execution;
    private final PrdDesignAdapter prompts;
    private final ObjectProvider<PrdReviewService> reviews;
    private final TransactionTemplate transaction;
    private static final List<String> STEPS =
            List.of("QUEUED", "PREPARING", "CONFIGURING", "INSTALLING", "STARTING");

    @Scheduled(fixedDelay = 2000)
    public void tick() {
        for (var row : launches.due()) {
            if (launches.claim(row) == 0) continue;
            var previous = AutoWonderContext.get();
            AutoWonderContext.destroy();
            try {
                AutoWonderContext.get().setCurrentWorkspaceId(row.workspaceId());
                AutoWonderContext.get().setUserId(row.creatorId());
                process(row);
            } catch (Exception error) {
                org.slf4j.LoggerFactory.getLogger(getClass())
                        .warn(
                                "Design bootstrap pending conversation={} reason={}",
                                row.conversationId(),
                                error.getClass().getSimpleName());
                if (launches.age(row) >= 600) fail(row);
            } finally {
                AutoWonderContext.setContext(previous);
            }
        }
    }

    private void fail(WorkitemLaunchDao.Launch row) {
        launches.advance(row, "FAILED_" + row.phase());
    }

    private void process(WorkitemLaunchDao.Launch row) throws java.io.IOException {
        var runtime = runtimes.find(row.workspaceId(), row.conversationId());
        var binding = preview.forRuntime(runtime);
        var conv = conversations.findById(row.workspaceId(), row.conversationId());
        if (binding == null
                || !binding.isAutomatic()
                || conv == null
                || !Objects.equals(conv.getExecutorId(), runtime.getExecutorId())) {
            fail(row);
            return;
        }
        if (!reviews.getObject().canManage(row.workspaceId(), row.creatorId())) {
            launches.advance(row, "FAILED_PERMISSION");
            return;
        }
        try {
            access.checkItem(row.workspaceId(), row.workitemId(), false);
            access.requireConversationRepo(conv);
        } catch (com.aliyun.autowonder.common.error.BizException denied) {
            launches.advance(row, "FAILED_PERMISSION");
            return;
        }
        if ("READY".equals(runtime.getStatus())) {
            transaction.executeWithoutResult(ignored -> startDesign(row, conv, runtime));
            return;
        }
        if (!"CONFIGURING".equals(row.phase()) && launches.age(row) >= 600) {
            fail(row);
            return;
        }
        if ("STARTING".equals(row.phase())) {
            recovery.ensure(binding, runtime);
            return;
        }
        var design = designs.findByWorkitem(row.workspaceId(), row.workitemId());
        boolean configure = PrdDesignService.managedTarget(design);
        if ("CONFIGURING".equals(row.phase())) {
            if ("FAILED".equals(runtime.getStatus())) { fail(row); return; }
            if (!"CONFIGURED".equals(runtime.getStatus())
                    || turns.findActiveHistoryTurn(row.workspaceId(), row.conversationId()) != null) return;
            launches.advance(row, "INSTALLING");
            return;
        }
        String session = presence.currentSessionId(runtime.getExecutorId());
        if (session == null) return;
        var frame = PrdPreviewRecovery.frame(binding, runtime);
        frame.put("type", "PRD_PREVIEW_BOOTSTRAP");
        frame.put("executorId", runtime.getExecutorId());
        frame.put("sessionId", session);
        frame.put("attempt", row.attempt());
        if (configure && "INSTALLING".equals(row.phase())) {
            frame.put("step", "INSTALL");
        } else if (row.repoId() == null) {
            var download = templates.download();
            frame.put("templateUrl", download.url());
            frame.put("templateSha256", download.sha256());
        } else {
            var repo = repos.findById(row.repoId());
            frame.put("repoUrl", repo.getUrl());
            var source = JSON.parseObject(design.getTargetConfigJson(), PrdProjectSnapshot.class);
            frame.put("branch", source.getBranch());
            frame.put("designBranch", PrdDesignRepository.designBranch(row.workitemId(), runtime.getSourceKey()));
            frame.put("appRoot", source.getAppRoot());
            if (configure) {
                var download = templates.download();
                frame.put("step", "PREPARE");
                frame.put("templateUrl", download.url());
                frame.put("templateSha256", download.sha256());
            }
        }
        var local = sessions.findByExecutorId(runtime.getExecutorId());
        if (local != null
                && session.equals(local.getSession().getId())
                && local.getTenantId() == row.workspaceId()) {
            local.sendText(JSON.toJSONString(frame));
        } else {
            redis.publish(WsDispatchTransport.BROADCAST_CHANNEL, JSON.toJSONString(frame));
        }
    }

    private void startDesign(
            WorkitemLaunchDao.Launch row, AgentConversationDO conv, PrdDesignRuntimeDO runtime) {
        if (launches.advance(row, "ACTIVE") == 0) return;
        var context = new AiSessionDO();
        context.setTenantId(row.workspaceId());
        context.setBizRefId(row.workitemId());
        String request = "根据工单需求和澄清结果完成首版设计。";
        String prompt =
                prompts.managedConversationPrompt()
                        + "\n"
                        + prompts.buildUserPrompt(context, request)
                        + "\n执行器已准备好可预览的工程，请直接修改 "
                        + runtime.getDirectory()
                        + " 中的前端。沿用已运行的服务。";
        execution
                .getObject()
                .submitTurn(
                        row.workspaceId(),
                        row.agentId(),
                        conv.getChannel(),
                        conv.getChannelConversationId(),
                        prompt,
                        "prd-initial-design:" + row.conversationId(),
                        JSON.toJSONString(Map.of("userMessage", request)),
                        row.creatorId());
    }

    @Transactional
    public void progress(
            long workspace, long executor, long conversation, int attempt, String step) {
        var row = launches.find(workspace, conversation);
        var runtime = runtimes.find(workspace, conversation);
        if (row == null
                || runtime == null
                || !Objects.equals(runtime.getExecutorId(), executor)
                || !"DESIGN".equals(row.activity())
                || row.attempt() != attempt
                || !STEPS.contains(row.phase())) return;
        if (step == null) return;
        if (step.startsWith("FAILED_")) {
            String failedAt = step.substring(7);
            if (STEPS.contains(failedAt) && STEPS.indexOf(failedAt) >= STEPS.indexOf(row.phase()))
                launches.advance(row, step);
            return;
        }
        if (STEPS.indexOf(step) <= STEPS.indexOf(row.phase()) || launches.advance(row, step) == 0)
            return;
        if ("CONFIGURING".equals(step)) {
            var conv = conversations.findById(workspace, conversation);
            var project = designs.findByWorkitem(workspace, row.workitemId());
            String dir = "design-demo/" + row.workitemId() + "/" + runtime.getSourceKey();
            var source = JSON.parseObject(project.getTargetConfigJson(), PrdProjectSnapshot.class);
            String prompt = PrdPrompts.PREPARE + "\n工作目录：" + dir + "\n指定应用目录："
                    + Objects.toString(source.getPreferredAppRoot(), "未指定")
                    + "\n基线分支：" + source.getBranch();
            org.slf4j.LoggerFactory.getLogger(getClass()).info("PRD setup queued conversation={} attempt={} promptVersion={}",
                    conversation, attempt, PrdPrompts.VERSION);
            execution.getObject().submitTurn(workspace, row.agentId(), conv.getChannel(), conv.getChannelConversationId(),
                    prompt, "prd-prepare:" + conversation + ":" + attempt,
                    JSON.toJSONString(Map.of("userMessage", "检查设计工程并准备预览配置。")), row.creatorId());
        }
        if ("STARTING".equals(step)) {
            if ("CONFIGURED".equals(runtime.getStatus())) {
                runtimes.installed(workspace, conversation, executor);
                return;
            }
            var design = designs.findByWorkitem(workspace, row.workitemId());
            String dir = "design-demo/" + row.workitemId() + "/" + runtime.getSourceKey();
            String root = design.getTargetAppRoot();
            if (row.repoId() != null && root != null && !root.equals(".")) dir += "/" + root;
            runtimes.bootstrapPrepared(workspace, conversation, executor, dir, attempt);
        }
    }
}
