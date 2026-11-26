package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.conversation.AgentConversationDao;
import com.aliyun.autowonder.mcp.ConversationMcpTokenService;
import com.aliyun.autowonder.mcp.McpAccessTokenService;
import com.aliyun.autowonder.prd.dto.PrdDesignVersionVO;
import com.aliyun.autowonder.prd.dto.SaveDesignRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;

/**
 * Persists the PRD artifact produced by an active PRD conversation turn.
 *
 * <p>The artifact is deliberately separate from the assistant's reply: the conversation stores
 * readable prose, while this service updates the version consumed by the requirement-document
 * surface. Repeated reports rewrite the current draft instead of appending duplicate versions.
 */
@Service
public class PrdDesignArtifactService {
    public static final String TOOL = "autowonder.report_prd_design";

    private final AgentConversationDao conversations;
    private final ConversationMcpTokenService tokens;
    private final PrdDesignService designs;
    private final PrdDesignDao designDao;
    private final PrdDesignVersionDao versions;

    public PrdDesignArtifactService(AgentConversationDao conversations,
            ConversationMcpTokenService tokens, PrdDesignService designs,
            PrdDesignDao designDao, PrdDesignVersionDao versions) {
        this.conversations = conversations;
        this.tokens = tokens;
        this.designs = designs;
        this.designDao = designDao;
        this.versions = versions;
    }

    @Transactional
    public PrdDesignVersionVO report(McpAccessTokenService.Principal principal,
            String designJson, String changeSummary) {
        if (principal == null || principal.workspaceId() == null || principal.executionScope() == null
                || principal.credentialType() != McpAccessTokenService.CredentialType.CONVERSATION) {
            throw new BizException(ErrorCode.NO_PERMISSION);
        }
        var scope = principal.executionScope();
        tokens.validateExecution(principal.userId(), principal.workspaceId(), scope);
        var conversation = conversations.findById(principal.workspaceId(), scope.conversationId());
        if (conversation == null || !"WORKITEM_PRD".equals(conversation.getChannel())
                || conversation.getBizRefId() == null
                || !Objects.equals(conversation.getExecutorId(), scope.executorId())) {
            throw new BizException(ErrorCode.NO_PERMISSION);
        }
        if (designJson == null || designJson.isBlank()) {
            throw new BizException(ErrorCode.PARAM_INVALID);
        }

        var design = designDao.findByWorkitem(principal.workspaceId(), conversation.getBizRefId());
        if (design == null) {
            throw new BizException(ErrorCode.PRD_DESIGN_NOT_FOUND);
        }
        var latest = versions.findLatestByDesign(principal.workspaceId(), design.getId());
        SaveDesignRequest request = new SaveDesignRequest();
        request.setDesignJson(designJson);
        request.setChangeSummary(changeSummary);
        // A live draft is the mutable working document. Review/confirmed versions remain immutable,
        // so the next report appends a fresh draft instead.
        if (latest != null && PrdVersionStatus.DRAFT.equals(latest.getStatus())) {
            request.setVersionId(latest.getId());
            request.setExpectedVersion(latest.getVersion());
        }
        return designs.saveDraft(principal.workspaceId(), conversation.getBizRefId(), request,
                principal.userId());
    }
}
