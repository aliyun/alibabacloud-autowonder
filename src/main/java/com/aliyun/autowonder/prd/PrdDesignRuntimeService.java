package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.conversation.AgentConversationDO;
import com.aliyun.autowonder.conversation.AgentConversationDao;
import com.aliyun.autowonder.mcp.ConversationMcpTokenService;
import com.aliyun.autowonder.mcp.McpAccessTokenService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.BooleanSupplier;

@Service
public class PrdDesignRuntimeService {
    public static final String TOOL = "autowonder.report_prd_design_runtime";
    private final PrdDesignRuntimeDao runtimes;
    private final AgentConversationDao conversations;
    private final PrdDesignDao designs;
    private final ConversationMcpTokenService tokens;
    private final PrdDesignTemplateService templates;
    private com.aliyun.autowonder.repo.RepoDao repoDao;
    @org.springframework.beans.factory.annotation.Autowired
    private org.springframework.beans.factory.ObjectProvider<PrdReviewPreviewService> previews;
    @org.springframework.beans.factory.annotation.Autowired
    private PrdReviewPreviewProperties previewProperties;
    @org.springframework.beans.factory.annotation.Autowired
    private PrdPreviewRecovery previewRecovery;

    public PrdDesignRuntimeService(PrdDesignRuntimeDao runtimes, AgentConversationDao conversations,
            PrdDesignDao designs, ConversationMcpTokenService tokens, PrdDesignTemplateService templates) {
        this.runtimes = runtimes; this.conversations = conversations; this.designs = designs;
        this.tokens = tokens; this.templates = templates;
    }

    @org.springframework.beans.factory.annotation.Autowired
    public void setRepoDao(com.aliyun.autowonder.repo.RepoDao repoDao) {
        this.repoDao = repoDao;
    }

    @org.springframework.beans.factory.annotation.Autowired private WorkitemLaunchDao launches;

    public String managedWorkspacePrompt(AgentConversationDO conversation) {
        var row = launches == null ? null : launches.find(conversation.getTenantId(),conversation.getId());
        if (row == null) return null;
        var runtime = runtimes.find(row.workspaceId(),row.conversationId());
        if (runtime == null || !Objects.equals(conversation.getExecutorId(),runtime.getExecutorId())) throw WorkitemLaunchAccess.failure("not_ready");
        if ("CONFIGURING".equals(row.phase())) {
            return "独立工程根目录：" + runtime.getDirectory() + "。执行器将在配置上报后安装依赖和启动服务。";
        }
        return "执行器托管此工单的预览。直接编辑已准备好的目录 " + runtime.getDirectory()
                + "，保留同一工程和前端服务。无需再次复制、安装、启动或上报预览状态。";
    }

    public void requireAuthorizedRepository(AgentConversationDO conversation, List<Map<String, Object>> repos) {
        var design = designs.findByWorkitem(conversation.getTenantId(), conversation.getBizRefId());
        if (design == null || design.getTargetRepoId() == null) return;
        long repoId = design.getTargetRepoId();
        if (repos == null || repos.stream().noneMatch(repo ->
                repo.get("repoId") instanceof Number id && id.longValue() == repoId)) {
            throw BizException.keyed(ErrorCode.NO_PERMISSION, "prd.target.repo_not_granted",
                    new Object[]{repoId}, "Selected PRD repository is not granted to the active agent version: " + repoId);
        }
    }

    public PrdDesignRuntimeDO get(long workspaceId, long workitemId, Long agentId) {
        var conversation = agentId == null
                ? conversations.findLatestByWorkitemChannel(workspaceId, "WORKITEM_PRD", workitemId)
                : conversations.findLatestByBizRef(workspaceId, "WORKITEM_PRD", "WORKITEM", workitemId, agentId);
        if (conversation == null) return null;
        var row = runtimes.find(workspaceId, conversation.getId());
        // A moved executor cannot serve the previous machine's localhost.
        if (row == null || !Objects.equals(row.getExecutorId(), conversation.getExecutorId())
                || !Objects.equals(row.getSourceKey(), sourceKey(designs.findByWorkitem(workspaceId, workitemId)))) return null;
        return row;
    }

    boolean current(PrdDesignRuntimeDO runtime) {
        var conversation=conversations.findById(runtime.getWorkspaceId(),runtime.getConversationId());
        return conversation!=null && "WORKITEM_PRD".equals(conversation.getChannel())
                && Objects.equals(conversation.getBizRefId(),runtime.getWorkitemId())
                && Objects.equals(conversation.getExecutorId(),runtime.getExecutorId())
                && Objects.equals(runtime.getSourceKey(),sourceKey(designs.findByWorkitem(runtime.getWorkspaceId(),runtime.getWorkitemId())));
    }

    boolean activatePreview(PrdReviewPreviewProperties.Binding binding, int port) {
        if (!binding.isAutomatic() || port < 1024 || port > 65535) return false;
        var runtime = runtimes.find(binding.getWorkspaceId(), binding.getConversationId());
        if (!binding.matches(runtime) || !current(runtime)) return false;
        if (runtimes.activatePreview(binding, port) == 1) return true;
        runtime = runtimes.find(binding.getWorkspaceId(), binding.getConversationId());
        return binding.matches(runtime) && "READY".equals(runtime.getStatus()) && Objects.equals(runtime.getPort(), port)
                && current(runtime);
    }

    boolean activateClusterPreview(PrdReviewPreviewProperties.Binding binding, int port, BooleanSupplier stillOwner) {
        if (!binding.isAutomatic() || port < 1024 || port > 65535) return false;
        var runtime = runtimes.find(binding.getWorkspaceId(), binding.getConversationId());
        if (!binding.matches(runtime) || !current(runtime) || runtime.getRevision() == null || !stillOwner.getAsBoolean()) return false;
        // Bump the revision even after a reconnect to the same port. An older owner
        // delayed between its lease check and UPDATE then cannot overwrite this registration.
        return runtimes.activateClusterPreview(binding, port, runtime.getRevision()) == 1;
    }

    boolean acceptsLegacyPreview(PrdReviewPreviewProperties.Binding binding) {
        if (previewRecovery.supports(binding.getExecutorId())) return false;
        var runtime = runtimes.find(binding.getWorkspaceId(), binding.getConversationId());
        return binding.matches(runtime) && "READY".equals(runtime.getStatus()) && runtime.getPort() != null && current(runtime);
    }

    private PrdReviewPreviewProperties.Binding managedBinding(PrdDesignRuntimeDO runtime) {
        var binding = previewProperties == null ? null : previewProperties.forRuntime(runtime);
        return binding != null && binding.isAutomatic() && previewRecovery.supports(binding.getExecutorId()) ? binding : null;
    }

    /** Called during actual dispatch, so queued/retried turns receive fresh links and ownership. */
    @Transactional
    public void bindTurn(AgentConversationDO conversation, long turnId, int attempt) {
        var design = designs.findByWorkitem(conversation.getTenantId(), conversation.getBizRefId());
        bindRuntime(conversation, turnId, attempt, sourceKey(design));
    }

    /** Bind this turn and build trusted runtime context only for an explicit prepare/recover action. */
    @Transactional
    public String runtimePrompt(AgentConversationDO conversation, long turnId, int attempt, String action) {
        if (!Set.of("PREPARE", "RECOVER").contains(action)) {
            throw new IllegalArgumentException("unsupported PRD runtime action: " + action);
        }
        var design = designs.findByWorkitem(conversation.getTenantId(), conversation.getBizRefId());
        String key = sourceKey(design);
        var bound = bindRuntime(conversation, turnId, attempt, key);
        var managed = managedBinding(bound);
        String branch = "autowonder-design/" + conversation.getBizRefId() + "-" + key;
        String preview = managed == null
                ? "使用工程已有的 dev:autowonder 启动预览；就绪后通过运行状态工具上报实际状态。"
                : "按工程已有的 dev:autowonder 契约准备预览；工程就绪后通过运行状态工具上报 PREPARED，directory 填实际应用根目录。";
        if ("RECOVER".equals(action)) {
            return """
                    【AutoWonder runtime: RECOVER】
                    复用独立工程目录：%s
                    工作分支：%s
                    检查并恢复现有预览。%s
                    """.formatted(bound.getDirectory(), branch, preview);
        }
        String source = design != null && design.getTargetRepoId() != null
                ? "从本轮仓库能力读取目标仓库和应用目录。"
                : "使用本轮提供的工程来源。";
        return """
                【AutoWonder runtime: PREPARE】
                独立工程目录：%s
                创建或复用工作分支：%s
                %s
                %s
                """.formatted(bound.getDirectory(), branch, source, preview);
    }

    private PrdDesignRuntimeDO bindRuntime(AgentConversationDO conversation, long turnId, int attempt, String key) {
        var row = new PrdDesignRuntimeDO();
        row.setWorkspaceId(conversation.getTenantId()); row.setWorkitemId(conversation.getBizRefId());
        row.setConversationId(conversation.getId()); row.setExecutorId(conversation.getExecutorId());
        row.setTurnId(turnId); row.setDispatchAttempt(attempt); row.setSourceKey(key);
        row.setDirectory("design-demo/" + conversation.getBizRefId() + "/" + key);
        runtimes.insert(row);
        if (runtimes.bind(row) == 0) throw new BizException(ErrorCode.CONFLICT);
        return runtimes.find(conversation.getTenantId(), conversation.getId());
    }

    @Transactional
    public PrdDesignRuntimeDO report(McpAccessTokenService.Principal principal, String status, Integer port,
            String route, String directory, String error, int sequence) {
        return report(principal,status,port,route,directory,error,sequence,null,null);
    }

    @Transactional
    public PrdDesignRuntimeDO report(McpAccessTokenService.Principal principal, String status, Integer port,
            String route, String directory, String error, int sequence,String previewBindingId,String tunnelStatus) {
        if (principal == null || principal.executionScope() == null || principal.workspaceId() == null
                || principal.credentialType() != McpAccessTokenService.CredentialType.CONVERSATION)
            throw new BizException(ErrorCode.NO_PERMISSION);
        var scope = principal.executionScope();
        tokens.validateExecution(principal.userId(), principal.workspaceId(), scope);
        var conversation = conversations.findById(principal.workspaceId(), scope.conversationId());
        if (conversation == null || !"WORKITEM_PRD".equals(conversation.getChannel()))
            throw new BizException(ErrorCode.NO_PERMISSION);
        if (status == null || !Set.of("STARTING", "PREPARED", "READY", "UPDATED", "FAILED").contains(status)
                || sequence <= 0 || (port != null && (port < 1 || port > 65535))
                || (("READY".equals(status) || "UPDATED".equals(status)) && port == null)) throw invalid();
        String path = route == null ? "/" : route;
        if (!path.startsWith("/") || path.startsWith("//") || path.contains("\\") || path.length() > 2048
                || path.chars().anyMatch(Character::isISOControl)) throw invalid();
        if (directory == null || directory.isBlank() || directory.length() > 1024
                || directory.chars().anyMatch(Character::isISOControl)
                || (error != null && (error.length() > 2048 || error.indexOf('\0') >= 0))) throw invalid();
        var current = runtimes.find(principal.workspaceId(), scope.conversationId());
        if (current == null || !Objects.equals(current.getExecutorId(), scope.executorId())
                || !Objects.equals(current.getTurnId(), scope.turnId())
                || !Objects.equals(current.getDispatchAttempt(), scope.dispatchAttempt()))
            throw new BizException(ErrorCode.CONFLICT);
        var managed = managedBinding(current);
        boolean prepared = "PREPARED".equals(status);
        var launch = launches == null ? null : launches.find(principal.workspaceId(), scope.conversationId());
        boolean configuring = launch != null && "CONFIGURING".equals(launch.phase());
        if (configuring && prepared) {
            String root = "design-demo/" + current.getWorkitemId() + "/" + current.getSourceKey();
            if (!directory.equals(root) && !directory.startsWith(root + "/")) throw invalid();
            if (directory.contains("\\") || java.util.Arrays.asList(directory.split("/")).contains("..")) throw invalid();
        }
        if ((prepared && (managed == null || port != null || previewBindingId != null || tunnelStatus != null))
                || (managed != null && ("READY".equals(status) || "UPDATED".equals(status)))) throw invalid();
        int changed = runtimes.report(principal.workspaceId(), scope.conversationId(), scope.executorId(), scope.turnId(),
                scope.dispatchAttempt(), sequence, configuring && prepared ? "CONFIGURED" : "UPDATED".equals(status) ? "READY" : status,
                port, path, directory, "FAILED".equals(status) ? error : null,
                "READY".equals(status) || "UPDATED".equals(status) || prepared ? 1 : 0);
        if (changed == 0 && sequence > current.getReportSequence()) throw new BizException(ErrorCode.CONFLICT);
        var result=runtimes.find(principal.workspaceId(), scope.conversationId());
        if (changed>0 && previews!=null) previews.getObject().report(result,previewBindingId,tunnelStatus);
        if (changed > 0 && prepared && !configuring && !"READY".equals(result.getStatus())) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() {
                    previewRecovery.ensure(managed, result);
                }
            });
        }
        return result;
    }

    private static BizException invalid() {
        return BizException.keyed(ErrorCode.PARAM_INVALID, "prd.runtime.invalid", null,
                "Invalid design runtime report: status, port, local route, directory and sequence are required");
    }

    private static String source(PrdDesignDO design) {
        return design == null || design.getTargetRepoId() == null ? "template"
                : design.getTargetRepoId() + ":" + Objects.toString(design.getTargetAppRoot(), ".");
    }

    static String sourceKey(PrdDesignDO design) {
        return PrdDesignTemplateService.digest(source(design).getBytes(StandardCharsets.UTF_8)).substring(0, 12);
    }
}
