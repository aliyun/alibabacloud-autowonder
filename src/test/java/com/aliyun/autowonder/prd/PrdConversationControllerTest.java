package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.agent.*;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.context.AutoWonderContext;
import com.aliyun.autowonder.conversation.*;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class PrdConversationControllerTest {
    final PrdDesignService designs = mock(PrdDesignService.class);
    final PrdDesignAdapter prompts = mock(PrdDesignAdapter.class);
    final AgentDao agents = mock(AgentDao.class);
    final AgentConversationDao conversations = mock(AgentConversationDao.class);
    final AgentConversationTurnDao turns = mock(AgentConversationTurnDao.class);
    final AgentConversationService execution = mock(AgentConversationService.class);
    final ConversationExecutorRouter router = mock(ConversationExecutorRouter.class);
    final ClarificationAttachmentService attachments = mock(ClarificationAttachmentService.class);
    final ConversationTurnEventService events = mock(ConversationTurnEventService.class);
    final ConversationEventDisplayReadService displayReads = mock(ConversationEventDisplayReadService.class);
    final com.aliyun.autowonder.common.web.ConversationEventBoundedResponse bounded =
            mock(com.aliyun.autowonder.common.web.ConversationEventBoundedResponse.class);
    final PrdConversationController controller = new PrdConversationController(designs, prompts, agents, conversations, turns, execution, router, displayReads, bounded);
    @BeforeEach void setup() {
        var browsers = mock(PrdBrowserService.class);
        when(browsers.validate(any(), anyLong())).thenReturn(new PrdBrowserService.Selection(null, null, true));
        when(browsers.prompt(any())).thenReturn("");
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "browsers", browsers);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "workitems", mock(com.aliyun.autowonder.workitem.WorkitemDao.class));
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "attachments", attachments);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "events", events);
        AutoWonderContext.get().setCurrentWorkspaceId(1L); AutoWonderContext.get().setUserId(7L);
        AgentDO agent = new AgentDO(); agent.setId(3L); agent.setTenantId(1L); agent.setOnlineVersionId(4L);
        when(agents.findById(3L)).thenReturn(agent);
        when(prompts.buildSystemPrompt(any())).thenReturn("system");
        when(prompts.buildUserPrompt(any(), anyString())).thenReturn("design");
        doAnswer(i -> { ((AgentConversationDO)i.getArgument(0)).setId(5L); return 1; }).when(conversations).insert(any());
    }
    @AfterEach void clear() { AutoWonderContext.destroy(); }
    @Test void historyReportsProcessingOutsideLatestFiftyQueuedTurnsWithoutChangingThePage() {
        var conversation = new AgentConversationDO(); conversation.setId(5L);
        when(conversations.findLatestByBizRef(1L, "WORKITEM_PRD", "WORKITEM", 10L, 3L))
                .thenReturn(conversation);
        var processing = new AgentConversationTurnDO(); processing.setId(1L);
        processing.setDirection("IN"); processing.setStatus("PROCESSING");
        when(turns.findActiveHistoryTurn(1L, 5L)).thenReturn(processing);
        var queued = java.util.stream.LongStream.rangeClosed(2, 52).mapToObj(id -> {
            var row = new AgentConversationTurnDO(); row.setId(id); row.setDirection("IN");
            row.setStatus("QUEUED"); row.setContent("queued"); return row;
        }).toList();
        when(turns.listHistoryPage(1L, 5L, null, 51, true)).thenReturn(queued);
        var history = controller.history(10L, 3L).getData();
        assertEquals(1L, history.processingTurnId());
        assertEquals("PROCESSING", history.processingStatus());
        assertEquals(50, history.turns().size());
        assertEquals(3L, history.turns().getFirst().getId());
        assertEquals(52L, history.turns().getLast().getId());
        assertEquals(3L, history.nextBeforeTurnId());
        assertTrue(history.turnsHasMore());
        assertTrue(history.turns().stream().allMatch(t -> "QUEUED".equals(t.getStatus())));
        var order = inOrder(turns);
        order.verify(turns).findActiveHistoryTurn(1L, 5L);
        order.verify(turns).listHistoryPage(1L, 5L, null, 51, true);
        verify(turns, never()).listTurnsByConversation(anyLong(), anyLong());
        verify(turns, never()).findProcessingInbound(anyLong(), anyLong());
    }

    @Test void routesThroughEmployeeExecutorWithActorAndSeparateChannel() {
        when(router.select(1L, 3L, 4L, null)).thenReturn(9L);
        controller.send(10L, new PrdConversationController.Input(3L, "design", "message-1"));
        verify(execution).submitTurn(eq(1L), eq(3L), eq("WORKITEM_PRD"), anyString(),
                eq("system\ndesign"), eq("web-prd:5:7:message-1"), contains("userMessage"), eq(7L));
    }
    @Test void offlineExecutorDoesNotFallBackOrCreateConversation() {
        when(router.select(1L, 3L, 4L, null)).thenReturn(null);
        assertThrows(BizException.class, () -> controller.send(10L, new PrdConversationController.Input(3L, "design", "message-1")));
        verifyNoInteractions(execution); verify(conversations, never()).insert(any());
    }
    @Test void cannotImportReplyFromAnotherWorkitem() {
        AgentConversationDO c = new AgentConversationDO(); c.setChannel("WORKITEM_PRD"); c.setBizRefId(11L);
        when(conversations.findById(1L, 5L)).thenReturn(c);
        assertThrows(BizException.class, () -> controller.save(10L, 5L, 6L));
        verify(designs, never()).saveDraft(anyLong(), anyLong(), any(), anyLong());
    }
    @Test void cannotReadEventsOrUploadToAnotherWorkitem() {
        AgentConversationDO c = new AgentConversationDO(); c.setChannel("WORKITEM_PRD"); c.setBizRefId(11L);
        when(conversations.findById(1L, 5L)).thenReturn(c);
        var request = mock(javax.servlet.http.HttpServletRequest.class);
        var response = mock(javax.servlet.http.HttpServletResponse.class);
        assertThrows(BizException.class, () -> controller.events(10L, 5L, 0, request, response));
        assertThrows(BizException.class, () -> controller.upload(10L, 5L, null));
        assertThrows(BizException.class, () -> controller.turnPage(10L, 5L, null, null, 50, request, response));
        assertThrows(BizException.class, () -> controller.turnContent(10L, 5L, 6L, null, request, response));
        verifyNoInteractions(events, attachments);
    }

    @Test void readsBoundedTimelineAndSummariesForThePrdTurn() throws Exception {
        AgentConversationDO c = new AgentConversationDO(); c.setChannel("WORKITEM_PRD"); c.setBizRefId(10L);
        when(conversations.findById(1L, 5L)).thenReturn(c);
        when(events.listEventsAfterBounded(1L, 5L, 3L, 200)).thenReturn(java.util.List.of());
        var page = new com.aliyun.autowonder.conversation.dto.ConversationEventDisplayDtos.SummaryPage(
                java.util.List.of(), 0L, false, "READY", "v1", 0, 0, null, 0L);
        when(displayReads.readSummaries(1L, 5L, 6L, null, 100)).thenReturn(page);
        var content = new com.aliyun.autowonder.conversation.dto.ConversationEventDisplayDtos.ContentSegment(
                9L, "body", 0, null, null, false, "v1", "READY", null);
        when(displayReads.readContentSegment(1L, 5L, 6L, 9L, "0", "v1")).thenReturn(content);
        var request = mock(javax.servlet.http.HttpServletRequest.class);
        var response = mock(javax.servlet.http.HttpServletResponse.class);

        controller.events(10L, 5L, 3L, request, response);
        controller.eventSummaries(10L, 5L, 6L, null, 100, request, response);
        controller.eventContent(10L, 5L, 6L, 9L, "0", "v1", request, response);

        verify(events).listEventsAfterBounded(1L, 5L, 3L, 200);
        verify(displayReads).readSummaries(1L, 5L, 6L, null, 100);
        verify(displayReads).readContentSegment(1L, 5L, 6L, 9L, "0", "v1");
        verify(bounded, times(3)).write(any(), any(), any());
    }

    @Test void summariesRejectAnotherWorkitemsConversation() {
        AgentConversationDO c = new AgentConversationDO(); c.setChannel("WORKITEM_PRD"); c.setBizRefId(11L);
        when(conversations.findById(1L, 5L)).thenReturn(c);
        var request = mock(javax.servlet.http.HttpServletRequest.class);
        var response = mock(javax.servlet.http.HttpServletResponse.class);

        assertThrows(BizException.class, () -> controller.eventSummaries(10L, 5L, 6L, null, 100, request, response));
        assertThrows(BizException.class, () -> controller.eventContent(10L, 5L, 6L, 9L, null, null, request, response));
        verifyNoInteractions(displayReads, bounded);
    }
    @Test void screenshotOnlyMessageBindsToSubmittedTurn() {
        when(router.select(1L, 3L, 4L, null)).thenReturn(9L);
        when(attachments.requireBindableIds(1L, 5L, 7L, java.util.List.of(90L))).thenReturn(java.util.List.of(90L));
        var inbound = new AgentConversationTurnDO(); inbound.setId(6L);
        when(turns.findByExternalMsgId(1L, "web-prd:5:7:message-1")).thenReturn(null, inbound);
        controller.send(10L, new PrdConversationController.Input(3L, "", "message-1", java.util.List.of(90L)));
        verify(attachments).bindToTurn(1L, 5L, 7L, java.util.List.of(90L), 6L);
    }
    @Test void retryWithBoundScreenshotDoesNotQueueAnotherTurn() {
        when(router.select(1L, 3L, 4L, null)).thenReturn(9L);
        var inbound = new AgentConversationTurnDO(); inbound.setId(6L); inbound.setConversationId(5L);
        inbound.setSubmittedUserId(7L); inbound.setDirection("IN");
        when(turns.findByExternalMsgId(1L, "web-prd:5:7:message-1")).thenReturn(inbound);
        when(attachments.verifyReplay(1L, 5L, 7L, java.util.List.of(90L), 6L)).thenReturn(java.util.List.of());
        controller.send(10L, new PrdConversationController.Input(3L, "", "message-1", java.util.List.of(90L)));
        verify(attachments).verifyReplay(1L, 5L, 7L, java.util.List.of(90L), 6L);
        verifyNoInteractions(execution);
    }
    @Test void sendsTheSelectedPrototypeElementWithTheTurn() {
        when(router.select(1L, 3L, 4L, null)).thenReturn(9L);
        var element = new PrdPrototypeSelection.Element("Home", "#save", "body > button",
                "/html[1]/body[1]/button[1]", "button", "Save");
        controller.send(10L, new PrdConversationController.Input(3L, "make it blue", "message-2", null, null, element));
        verify(execution).submitTurn(eq(1L), eq(3L), eq("WORKITEM_PRD"), anyString(),
                argThat(prompt -> prompt.contains("【用户选中的原型元素】") && prompt.contains("#save")),
                eq("web-prd:5:7:message-2"),
                argThat(context -> context.contains("\"element\"") && context.contains("\"selector\":\"#save\"")), eq(7L));
    }
    @Test void rejectsAnInvalidElementBeforeSubmittingTheTurn() {
        when(router.select(1L, 3L, 4L, null)).thenReturn(9L);
        assertThrows(BizException.class, () -> controller.send(10L, new PrdConversationController.Input(3L, "change",
                "message-3", null, null, new PrdPrototypeSelection.Element(null, " ", null, null, null, null))));
        verifyNoInteractions(execution);
    }
    @Test void previewDoesNotSaveAVersion() {
        var request = new com.aliyun.autowonder.prd.dto.SaveDesignRequest();
        request.setDesignJson("{\"title\":\"Live preview\",\"pages\":[{\"mockHtml\":\"<h1>Prototype</h1>\"}]}");
        assertNotNull(controller.preview(10L, request));
        verify(designs, never()).saveDraft(anyLong(), anyLong(), any(), anyLong());
    }
}
