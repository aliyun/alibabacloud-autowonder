package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.access.*;
import com.aliyun.autowonder.agent.*;
import com.aliyun.autowonder.ai.AiSessionDO;
import com.aliyun.autowonder.common.error.*;
import com.aliyun.autowonder.common.result.Result;
import com.aliyun.autowonder.common.web.ConversationEventBoundedResponse;
import com.aliyun.autowonder.context.AutoWonderContext;
import com.aliyun.autowonder.conversation.*;
import com.aliyun.autowonder.conversation.dto.ClarificationElicitationVO;
import com.aliyun.autowonder.conversation.dto.ConversationEventDisplayDtos;
import com.aliyun.autowonder.conversation.dto.ElicitationReplyRequest;
import com.aliyun.autowonder.prd.dto.SaveDesignRequest;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.*;

/** PRD conversations use the existing client executor protocol, never the platform CLI. */
@RestController
@RequestMapping("/api/workitems/{workitemId}/prd/conversation")
@RequireWorkspaceAccess(value = WorkspaceAccessLevel.READ_WRITE, action = "设计 PRD", actionKey = "access.action.design_prd")
public class PrdConversationController {
    static final String CHANNEL = "WORKITEM_PRD";
    private final PrdDesignService designs;
    private final PrdDesignAdapter prompts;
    private final AgentDao agents;
    private final AgentConversationDao conversations;
    private final AgentConversationTurnDao turns;
    private final AgentConversationService execution;
    private final ConversationExecutorRouter router;
    @org.springframework.beans.factory.annotation.Autowired private ConversationTurnEventService events;
    @org.springframework.beans.factory.annotation.Autowired(required = false) private ConversationElicitationService elicitations;
    @org.springframework.beans.factory.annotation.Autowired(required = false) private ConversationRuntimePresence runtimePresence;
    private final ConversationEventDisplayReadService displayReadService;
    private final ConversationEventBoundedResponse boundedResponse;
    @org.springframework.beans.factory.annotation.Autowired private ClarificationAttachmentService attachments;
    @org.springframework.beans.factory.annotation.Autowired private com.aliyun.autowonder.user.UserDao users;
    @org.springframework.beans.factory.annotation.Autowired private com.aliyun.autowonder.workitem.WorkitemDao workitems;
    @org.springframework.beans.factory.annotation.Autowired private com.aliyun.autowonder.squad.SquadMemberDao squadMembers;

    public PrdConversationController(PrdDesignService designs, PrdDesignAdapter prompts, AgentDao agents,
            AgentConversationDao conversations, AgentConversationTurnDao turns,
            AgentConversationService execution, ConversationExecutorRouter router,
            ConversationEventDisplayReadService displayReadService,
            ConversationEventBoundedResponse boundedResponse) {
        this.designs = designs; this.prompts = prompts; this.agents = agents;
        this.conversations = conversations; this.turns = turns; this.execution = execution; this.router = router;
        this.displayReadService = displayReadService; this.boundedResponse = boundedResponse;
    }
    @org.springframework.beans.factory.annotation.Autowired private PrdBrowserService browsers;
    @org.springframework.beans.factory.annotation.Autowired private PrdReviewService reviews;
    @org.springframework.beans.factory.annotation.Autowired private com.aliyun.autowonder.skill.SkillConnectionTestService browserTests;
    public record BrowserCheck(Long executorId, com.aliyun.autowonder.skill.dto.SkillConnectionTestVO result) {}
    @PostMapping("/browser-check")
    public Result<BrowserCheck> checkBrowser(@PathVariable long workitemId, @RequestBody Input input) {
        designs.get(workspace(), workitemId);
        var selection = browsers.validate(input.browser(), workspace());
        if (selection.codeOnly() || input.agentId() == null) throw new BizException(ErrorCode.PARAM_INVALID);
        var agent = agents.findById(input.agentId());
        if (agent == null || !Objects.equals(agent.getTenantId(), workspace()) || agent.getOnlineVersionId() == null)
            throw new BizException(ErrorCode.PARAM_INVALID);
        var c = find(workitemId, input.agentId());
        Long executor = router.select(workspace(), agent.getId(), agent.getOnlineVersionId(), c == null ? null : c.getExecutorId());
        if (executor == null) throw new BizException(ErrorCode.CLARIFICATION_EXECUTOR_OFFLINE);
        return Result.ok(new BrowserCheck(executor, browserTests.test(selection.skillId(), workspace(), executor)));
    }
    public record Input(Long agentId, String content, String clientMessageId, List<Long> attachmentIds,
                        PrdBrowserService.Selection browser, PrdPrototypeSelection.Element element,
                        List<Long> commentIds, String runtimeAction) {
        public Input(Long agentId,String content,String clientMessageId,List<Long> attachmentIds,PrdBrowserService.Selection browser,PrdPrototypeSelection.Element element) {
            this(agentId,content,clientMessageId,attachmentIds,browser,element,List.of(),null);
        }
        public Input(Long agentId,String content,String clientMessageId,List<Long> attachmentIds,
                PrdBrowserService.Selection browser,PrdPrototypeSelection.Element element,List<Long> commentIds) {
            this(agentId,content,clientMessageId,attachmentIds,browser,element,commentIds,null);
        }
        public Input(Long agentId, String content, String clientMessageId) { this(agentId, content, clientMessageId, List.of(), null, null, List.of(), null); }
        public Input(Long agentId, String content, String clientMessageId, List<Long> attachmentIds) { this(agentId, content, clientMessageId, attachmentIds, null, null, List.of(), null); }
    }
    public record History(Long id, List<AgentConversationTurnDO> turns, Map<Long, String> participants,
            Map<Long, List<com.aliyun.autowonder.conversation.dto.ClarificationAttachmentVO>> attachments,
            boolean turnsHasMore, Long nextBeforeTurnId, Long processingTurnId, String processingStatus,
            boolean executorOnline, boolean cancelSupported, boolean acpInteractionSupported,
            List<ClarificationElicitationVO> pendingElicitations,
            List<ClarificationElicitationVO> questionHistory, boolean questionHistoryPaged,
            List<ClarificationElicitationVO> answerDeliveries) {
        public History(Long id, List<AgentConversationTurnDO> turns, Map<Long, String> participants,
                Map<Long, List<com.aliyun.autowonder.conversation.dto.ClarificationAttachmentVO>> attachments) {
            this(id, turns, participants, attachments, false, null, null, null, false, false, false,
                    List.of(), List.of(), true, List.of());
        }
    }
    @org.springframework.beans.factory.annotation.Autowired private WorkitemLaunchDao launchStore;
    @org.springframework.beans.factory.annotation.Autowired private WorkitemLaunchAccess launchAccess;
    public record Selection(Long agentId, Long squadId) {}
    public record TurnPage(List<AgentConversationTurnDO> items, boolean hasMore, Long nextBeforeTurnId,
            Map<Long, String> participants,
            Map<Long, List<com.aliyun.autowonder.conversation.dto.ClarificationAttachmentVO>> attachments) {}
    @GetMapping("/selection")
    public Result<Selection> selection(@PathVariable long workitemId) {
        designs.get(workspace(), workitemId);
        var c = conversations.findLatestByWorkitemChannel(workspace(), CHANNEL, workitemId);
        if (c == null) return Result.ok(null);
        var launch = launchStore == null ? null : launchStore.find(workspace(), c.getId());
        if (launch != null) return Result.ok(new Selection(launch.agentId(), launch.squadId()));
        var member = squadMembers.listByAgent(c.getAgentId()).stream()
                .filter(m -> Objects.equals(m.getTenantId(), workspace())).findFirst();
        return Result.ok(member.map(m -> new Selection(c.getAgentId(), m.getSquadId())).orElse(null));
    }
    private long workspace() { return AutoWonderContext.get().getCurrentWorkspaceId(); }
    private long user() { return AutoWonderContext.get().getUserId(); }
    private AgentConversationDO find(long workitemId, long agentId) {
        designs.get(workspace(), workitemId);
        return conversations.findLatestByBizRef(workspace(), CHANNEL, "WORKITEM", workitemId, agentId);
    }
    @GetMapping
    public void historyBounded(@PathVariable long workitemId, @RequestParam long agentId,
            HttpServletRequest request, HttpServletResponse response) throws IOException {
        boundedResponse.write(request, response, history(workitemId, agentId));
    }

    public Result<History> history(@PathVariable long workitemId, @RequestParam long agentId) {
        var c = find(workitemId, agentId);
        // Read independently before history: an older processing turn may be outside the page,
        // while all fifty visible inbound turns are queued behind it.
        var active = c == null ? null : turns.findActiveHistoryTurn(workspace(), c.getId());
        var page = c == null ? new ConversationTurnHistory.Page<AgentConversationTurnDO>(List.of(), false, null)
                : ConversationTurnHistory.page(turns, workspace(), c.getId(), null, 50, true);
        var rows = page.items();
        Map<Long, String> participants = new HashMap<>();
        for (var row : rows) if (row.getSubmittedUserId() != null && !participants.containsKey(row.getSubmittedUserId())) {
            var u = users.findById(row.getSubmittedUserId());
            if (u != null) participants.put(u.getId(), participantName(u));
        }
        var attachmentRows = c == null ? Map.<Long, List<com.aliyun.autowonder.conversation.dto.ClarificationAttachmentVO>>of()
                : attachments.listByTurnIds(workspace(), c.getId(), rows.stream().map(AgentConversationTurnDO::getId).toList());
        var pending = c == null || elicitations == null ? List.<ClarificationElicitationVO>of()
                : elicitations.listPending(workspace(), c.getId()).stream().map(PrdConversationController::pendingElicitation).toList();
        var deliveries = c == null || elicitations == null ? List.<ClarificationElicitationVO>of()
                : elicitations.listActiveAnswerDeliveryStatuses(workspace(), c.getId()).stream()
                        .map(ClarificationElicitationVO::fromDelivery).toList();
        boolean executorOnline = c != null && c.getExecutorId() != null && runtimePresence != null
                && runtimePresence.isExecutorOnline(c.getExecutorId());
        boolean cancelSupported = executorOnline && runtimePresence.supportsProtocolFeature(
                c.getExecutorId(), ConversationProtocolFeatures.TURN_CANCEL);
        boolean acpInteractionSupported = executorOnline && runtimePresence.supportsProtocolFeature(
                c.getExecutorId(), ConversationProtocolFeatures.ACP_INTERACTION);
        return Result.ok(ConversationTurnHistory.envelope(page, p -> new History(c == null ? null : c.getId(),
                p.items(), participantSubset(p.items(), participants), attachmentSubset(p.items(), attachmentRows),
                p.hasMore(), p.nextBeforeTurnId(), active == null ? null : active.getId(),
                active == null ? null : active.getStatus(), executorOnline, cancelSupported,
                acpInteractionSupported, pending, List.of(), true, deliveries)));
    }

    private static ClarificationElicitationVO pendingElicitation(AgentConversationElicitationDO record) {
        return ClarificationElicitationVO.builder()
                .requestId(record.getRequestId()).turnId(record.getTurnId()).mode(record.getMode())
                .message(record.getMessage()).requestedSchema(record.getSchemaJson())
                .status(record.getStatus()).gmtCreate(record.getGmtCreate()).build();
    }

    private static Map<Long, String> participantSubset(List<AgentConversationTurnDO> rows, Map<Long, String> all) {
        Map<Long, String> result = new HashMap<>();
        for (var row : rows) if (all.containsKey(row.getSubmittedUserId()))
            result.put(row.getSubmittedUserId(), all.get(row.getSubmittedUserId()));
        return result;
    }

    private static String participantName(com.aliyun.autowonder.user.UserDO user) {
        if (user.getNickname() != null && !user.getNickname().isBlank()) return user.getNickname();
        return user.getUsername() == null || user.getUsername().isBlank()
                ? String.valueOf(user.getId()) : user.getUsername();
    }
    private static Map<Long, List<com.aliyun.autowonder.conversation.dto.ClarificationAttachmentVO>> attachmentSubset(
            List<AgentConversationTurnDO> rows, Map<Long, List<com.aliyun.autowonder.conversation.dto.ClarificationAttachmentVO>> all) {
        Map<Long, List<com.aliyun.autowonder.conversation.dto.ClarificationAttachmentVO>> result = new HashMap<>();
        for (var row : rows) if (all.containsKey(row.getId())) result.put(row.getId(), all.get(row.getId()));
        return result;
    }
    @PostMapping
    @Transactional
    public Result<Void> send(@PathVariable long workitemId, @RequestBody Input input) {
        if (input.agentId() == null || ((input.content() == null || input.content().isBlank()) && (input.attachmentIds() == null || input.attachmentIds().isEmpty()) && (input.commentIds()==null || input.commentIds().isEmpty()))
                || input.clientMessageId() == null || input.clientMessageId().isBlank())
            throw new BizException(ErrorCode.PARAM_INVALID);
        var c = ensureConversation(workitemId, input.agentId());
        if (launchStore != null && input.runtimeAction() != null && launchStore.find(workspace(),c.getId()) != null) {
            throw WorkitemLaunchAccess.failure("managed_preview");
        }
        var agent = agents.findById(input.agentId());
        String externalId = "web-prd:" + c.getId() + ":" + user() + ":" + input.clientMessageId();
        var existing = turns.findByExternalMsgId(workspace(), externalId);
        if (existing != null) {
            if (!Objects.equals(existing.getConversationId(), c.getId()) || !Objects.equals(existing.getSubmittedUserId(), user())
                    || !"IN".equals(existing.getDirection())) throw new BizException(ErrorCode.CONFLICT);
            if (input.attachmentIds() != null && !input.attachmentIds().isEmpty()) {
                var unbound = attachments.verifyReplay(workspace(), c.getId(), user(), input.attachmentIds(), existing.getId());
                attachments.bindToTurn(workspace(), c.getId(), user(), unbound, existing.getId());
            }
            return Result.ok(null);
        }
        PrdDesignHandoffService.requireEditable(handoffs, workspace(), workitemId);
        var ids = input.attachmentIds() == null || input.attachmentIds().isEmpty() ? List.<Long>of()
                : attachments.requireBindableIds(workspace(), c.getId(), user(), input.attachmentIds());
        AiSessionDO context = new AiSessionDO(); context.setTenantId(workspace()); context.setBizRefId(workitemId);
        var currentLaunch = launchStore == null ? null : launchStore.find(workspace(), c.getId());
        boolean configuring = currentLaunch != null && "CONFIGURING".equals(currentLaunch.phase());
        String instructions = currentLaunch != null ? prompts.managedConversationPrompt() : prompts.buildConversationSystemPrompt();
        String prompt = configuring ? PrdPrompts.PREPARE + "\n用户补充：" + input.content()
                : instructions + "\n" + prompts.buildUserPrompt(context, input.content());
        var browser = browsers.validate(input.browser(), workspace());
        var element = PrdPrototypeSelection.validate(input.element());
        var comments=input.commentIds()==null || input.commentIds().isEmpty() ? List.<PrdReviewService.CommentSnapshot>of()
                : reviews.references(workspace(),workitemId,c.getId(),input.commentIds());
        prompt += browsers.prompt(browser);
        prompt += PrdPrototypeSelection.prompt(element);
        if(!comments.isEmpty()) prompt += "\n【用户选取的设计评审意见】\n" + com.aliyun.autowonder.json.JSON.toJSONString(comments.stream().map(comment -> Map.of(
                "id",comment.getId(),"commentText",comment.getCommentText(),"routePath",comment.getRoutePath(),
                "element",com.aliyun.autowonder.json.JSON.parseObject(comment.getElementJson()),"sourceKey",comment.getSourceKey(),"runtimeRevision",comment.getRuntimeRevision())).toList());
        Map<String, Object> turnContext = new LinkedHashMap<>();
        turnContext.put("userMessage", input.content() == null ? "" : input.content());
        turnContext.put("browser", browser);
        if (input.runtimeAction() != null) {
            if (!Set.of("PREPARE", "RECOVER").contains(input.runtimeAction())) {
                throw new BizException(ErrorCode.PARAM_INVALID);
            }
            turnContext.put("runtimeAction", input.runtimeAction());
        }
        if (element != null) turnContext.put("element", element.normalized());
        if(!comments.isEmpty()) turnContext.put("reviewComments",comments.stream().map(comment -> Map.of(
                "id",comment.getId(),"commentText",comment.getCommentText(),"routePath",comment.getRoutePath(),
                "element",com.aliyun.autowonder.json.JSON.parseObject(comment.getElementJson()),"version",comment.getVersion(),"sourceKey",comment.getSourceKey(),"runtimeRevision",comment.getRuntimeRevision())).toList());
        if(!comments.isEmpty()) turnContext.put("reviewCommentsDisplay",PrdReviewService.historyReferences(comments));
        execution.submitTurn(workspace(), agent.getId(), CHANNEL, c.getChannelConversationId(), prompt,
                externalId, com.aliyun.autowonder.json.JSON.toJSONString(turnContext), user());
        var inbound = turns.findByExternalMsgId(workspace(), externalId);
        if(!comments.isEmpty() && inbound!=null) reviews.sent(workspace(),comments,inbound.getId());
        if (!ids.isEmpty()) attachments.bindToTurn(workspace(), c.getId(), user(), ids, inbound.getId());
        return Result.ok(null);
    }
    @PostMapping("/prepare")
    @Transactional
    public Result<History> prepare(@PathVariable long workitemId, @RequestBody Input input) {
        if (input.agentId() == null) throw new BizException(ErrorCode.PARAM_INVALID);
        var c = ensureConversation(workitemId, input.agentId());
        return Result.ok(new History(c.getId(), List.of(), Map.of(), Map.of()));
    }
    @org.springframework.beans.factory.annotation.Autowired
    private PrdDesignHandoffDao handoffs;

    private AgentConversationDO ensureConversation(long workitemId, long agentId) {
        designs.get(workspace(), workitemId);
        // Serialize initial creation so participants opening the same employee share one conversation.
        workitems.findByIdForUpdate(workitemId, workspace());
        var c = find(workitemId, agentId);
        var launch = launchStore == null ? null : launchStore.latest(workspace(), workitemId, "DESIGN");
        if (launch != null && (launch.agentId() != agentId
                || !Set.of("ACTIVE", "CONFIGURING").contains(launch.phase()))) throw WorkitemLaunchAccess.failure("not_ready");
        if (launchStore != null && launch == null && !legacyDesign(workitemId,c)) throw WorkitemLaunchAccess.failure("select_source");
        if (c != null && launchAccess != null) launchAccess.requireConversationRepo(c);
        var agent = agents.findById(agentId);
        if (agent == null || !Objects.equals(agent.getTenantId(), workspace()) || agent.getOnlineVersionId() == null)
            throw new BizException(ErrorCode.PARAM_INVALID);
        if (launch != null && c != null) {
            if (!router.canQueueDesignOnOwner(workspace(), agent.getId(), agent.getOnlineVersionId(), c.getExecutorId()))
                throw new BizException(ErrorCode.CLARIFICATION_EXECUTOR_OFFLINE);
            return c;
        }
        Long executor = router.select(workspace(), agent.getId(), agent.getOnlineVersionId(), c == null ? null : c.getExecutorId());
        if (executor == null) throw new BizException(ErrorCode.CLARIFICATION_EXECUTOR_OFFLINE);
        if (c == null) {
            c = new AgentConversationDO();
            c.setTenantId(workspace()); c.setAgentId(agent.getId()); c.setAgentVersionId(agent.getOnlineVersionId());
            c.setChannel(CHANNEL); c.setBizRefType("WORKITEM"); c.setBizRefId(workitemId);
            c.setChannelConversationId(UUID.randomUUID().toString()); c.setExecutorId(executor);
            c.setStatus("ACTIVE"); c.setLastTurnAt(new Date()); conversations.insert(c);
        }
        return c;
    }
    @org.springframework.beans.factory.annotation.Autowired private PrdDesignRuntimeDao runtimeRows;
    private boolean legacyDesign(long item,AgentConversationDO conversation) {
        return runtimeRows.findLatestByWorkitem(workspace(),item) != null || designs.get(workspace(),item).getLatestVersionNo() > 0
                || conversation != null && !ConversationTurnHistory.page(turns,workspace(),conversation.getId(),null,1,true).items().isEmpty();
    }
    private AgentConversationDO requireConversation(long workitemId, long conversationId) {
        designs.get(workspace(), workitemId);
        var c = conversations.findById(workspace(), conversationId);
        if (c == null || !CHANNEL.equals(c.getChannel()) || !Objects.equals(c.getBizRefId(), workitemId))
            throw new BizException(ErrorCode.PARAM_INVALID);
        return c;
    }
    @GetMapping("/{conversationId}/turns/page")
    public void turnPage(@PathVariable long workitemId, @PathVariable long conversationId,
            @RequestParam(required = false) Long beforeTurnId,
            @RequestParam(required = false) Long afterTurnId,
            @RequestParam(required = false) Integer limit,
            HttpServletRequest request, HttpServletResponse response) throws IOException {
        requireConversation(workitemId, conversationId);
        var page = ConversationTurnHistory.page(turns, workspace(), conversationId, beforeTurnId, afterTurnId, limit, true);
        Map<Long, String> participants = new HashMap<>();
        for (var row : page.items()) if (row.getSubmittedUserId() != null && !participants.containsKey(row.getSubmittedUserId())) {
            var u = users.findById(row.getSubmittedUserId());
            if (u != null) participants.put(u.getId(), participantName(u));
        }
        var attachmentRows = attachments.listByTurnIds(workspace(), conversationId,
                page.items().stream().map(AgentConversationTurnDO::getId).toList());
        boundedResponse.write(request, response, Result.ok(ConversationTurnHistory.envelope(page,
                p -> new TurnPage(p.items(), p.hasMore(), p.nextBeforeTurnId(), participantSubset(p.items(), participants),
                        attachmentSubset(p.items(), attachmentRows)))));
    }

    @GetMapping("/{conversationId}/turns/{turnId}/content")
    public void turnContent(@PathVariable long workitemId, @PathVariable long conversationId,
            @PathVariable long turnId, @RequestParam(required = false) String cursor,
            HttpServletRequest request, HttpServletResponse response) throws IOException {
        requireConversation(workitemId, conversationId);
        boundedResponse.write(request, response, Result.ok(ConversationTurnHistory.content(
                turns, workspace(), conversationId, turnId, cursor, true)));
    }

    @GetMapping("/{conversationId}/turns/{turnId}/questions/page")
    public void questionPage(@PathVariable long workitemId, @PathVariable long conversationId,
            @PathVariable long turnId, @RequestParam(required = false) Long beforeId,
            @RequestParam(required = false) Long afterId,
            HttpServletRequest request, HttpServletResponse response) throws IOException {
        requireConversation(workitemId, conversationId);
        boundedResponse.write(request, response, Result.ok(
                elicitations.questionPage(workspace(), conversationId, turnId, beforeId, afterId)));
    }

    @GetMapping("/{conversationId}/turns/{turnId}/questions/{id}/content")
    public void questionContent(@PathVariable long workitemId, @PathVariable long conversationId,
            @PathVariable long turnId, @PathVariable long id, @RequestParam(required = false) String cursor,
            HttpServletRequest request, HttpServletResponse response) throws IOException {
        requireConversation(workitemId, conversationId);
        boundedResponse.write(request, response, Result.ok(
                elicitations.questionContent(workspace(), conversationId, turnId, id, cursor)));
    }

    @PostMapping("/{conversationId}/elicitations/{requestId}/reply")
    public Result<Void> replyElicitation(@PathVariable long workitemId, @PathVariable long conversationId,
            @PathVariable String requestId, @RequestBody ElicitationReplyRequest request) {
        requireConversation(workitemId, conversationId);
        elicitations.reply(workspace(), conversationId, requestId, request.getAction(), request.getContent(), user());
        return Result.ok(null);
    }

    @PostMapping("/{conversationId}/turns/{turnId}/cancel")
    public Result<Void> cancelTurn(@PathVariable long workitemId, @PathVariable long conversationId,
            @PathVariable long turnId) {
        requireConversation(workitemId, conversationId);
        execution.requestTurnCancel(workspace(), conversationId, turnId);
        return Result.ok(null);
    }

    @GetMapping("/{conversationId}/events")
    public void events(@PathVariable long workitemId, @PathVariable long conversationId,
            @RequestParam(defaultValue="0") long afterId,
            HttpServletRequest request, HttpServletResponse response) throws IOException {
        requireConversation(workitemId, conversationId);
        boundedResponse.write(request, response, Result.ok(
                events.listEventsAfterBounded(workspace(), conversationId, afterId, 200)));
    }

    /** 当前轮次的有界摘要：PRD 只展示当前轮次，不新建历史浏览器。 */
    @GetMapping("/{conversationId}/turns/{turnId}/event-summaries")
    public void eventSummaries(@PathVariable long workitemId, @PathVariable long conversationId,
            @PathVariable long turnId,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit,
            HttpServletRequest request, HttpServletResponse response) throws IOException {
        requireConversation(workitemId, conversationId);
        ConversationEventDisplayDtos.SummaryPage page = displayReadService.readSummaries(
                workspace(), conversationId, turnId, cursor, limit);
        boundedResponse.write(request, response, Result.ok(page));
    }

    /** 分段全文：PRD 业务正文与日志详情走同一有界接口，但各自维护游标。 */
    @GetMapping("/{conversationId}/turns/{turnId}/event-summaries/{eventId}/content")
    public void eventContent(@PathVariable long workitemId, @PathVariable long conversationId,
            @PathVariable long turnId, @PathVariable long eventId,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) String projectionVersion,
            HttpServletRequest request, HttpServletResponse response) throws IOException {
        requireConversation(workitemId, conversationId);
        ConversationEventDisplayDtos.ContentSegment segment = displayReadService.readContentSegment(
                workspace(), conversationId, turnId, eventId, cursor, projectionVersion);
        boundedResponse.write(request, response, Result.ok(segment));
    }
    @PostMapping("/{conversationId}/attachments")
    public Result<?> upload(@PathVariable long workitemId, @PathVariable long conversationId,
            @RequestParam("file") org.springframework.web.multipart.MultipartFile file) {
        requireConversation(workitemId, conversationId);
        return Result.ok(attachments.upload(workspace(), workitemId, conversationId, user(), file));
    }
    @PostMapping("/preview")
    public Result<String> preview(@PathVariable long workitemId, @RequestBody SaveDesignRequest request) {
        designs.get(workspace(), workitemId);
        return Result.ok(PrdHtmlRenderer.render(PrdDesignCodec.parse(request.getDesignJson())));
    }
    @GetMapping("/{conversationId}/attachments/{attachmentId}/preview")
    public org.springframework.http.ResponseEntity<byte[]> previewAttachment(@PathVariable long workitemId,
            @PathVariable long conversationId, @PathVariable long attachmentId) {
        requireConversation(workitemId, conversationId);
        var content = attachments.read(workspace(), workitemId, conversationId, attachmentId);
        if (!Objects.equals(content.attachment().getPreviewable(), 1)) throw new BizException(ErrorCode.NOT_FOUND);
        return org.springframework.http.ResponseEntity.ok()
                .contentType(org.springframework.http.MediaType.valueOf(content.attachment().getContentType()))
                .header("X-Content-Type-Options", "nosniff").header("Content-Security-Policy", "sandbox")
                .header("Cache-Control", "private, max-age=300").body(content.bytes());
    }
    @PostMapping("/{conversationId}/turns/{turnId}/save")
    public Result<?> save(@PathVariable long workitemId, @PathVariable long conversationId, @PathVariable long turnId) {
        designs.get(workspace(), workitemId);
        var c = conversations.findById(workspace(), conversationId);
        if (c == null || !CHANNEL.equals(c.getChannel()) || !Objects.equals(c.getBizRefId(), workitemId))
            throw new BizException(ErrorCode.PARAM_INVALID);
        var turn = turns.findByConversationTurn(workspace(), conversationId, turnId);
        if (turn == null || !"OUT".equals(turn.getDirection())) throw new BizException(ErrorCode.PARAM_INVALID);
        String content = turn.getContent().trim();
        if (content.startsWith("```")) content = content.substring(content.indexOf('\n') + 1).replaceFirst("\\s*```\\s*$", "");
        SaveDesignRequest request = new SaveDesignRequest(); request.setDesignJson(content);
        return Result.ok(designs.saveDraft(workspace(), workitemId, request, user()));
    }
}
