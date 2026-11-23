package com.aliyun.autowonder.conversation;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class ConversationEventDisplayLegacyUpgradeTest {
    @Test
    void unavailableOldRowsDoNotBlockTheNextLegacyPageOrDestroyReadableHistory() {
        var displays = mock(ConversationEventDisplayDao.class);
        var segments = mock(ConversationEventContentSegmentDao.class);
        var events = mock(AgentConversationTurnEventDao.class);
        var turns = mock(AgentConversationTurnDao.class);
        var conversations = mock(AgentConversationDao.class);
        var conversation = new AgentConversationDO(); conversation.setChannel("PRD");
        when(conversations.findById(1L, 2L)).thenReturn(conversation);
        var service = new ConversationEventDisplayPreparationService(displays, segments, events, turns,
                conversations, mock(PlatformTransactionManager.class));
        List<ConversationEventDisplayDO> incomplete = new java.util.ArrayList<>();
        for (long seq = 1; seq <= 20; seq++) {
            var row = new ConversationEventDisplayDO();
            row.setId(seq); row.setTenantId(1L); row.setConversationId(2L); row.setTurnId(3L);
            row.setDispatchAttempt(1); row.setEventSeq(seq); row.setPublicationSeq(seq);
            incomplete.add(row);
        }
        when(displays.listLegacyReady(1, 2, 3, 0)).thenReturn(incomplete);
        var page = service.upgradeLegacyReadyPage(1, 2, 3, 0);
        assertEquals(0, page.upgraded());
        assertEquals(20, page.nextCursor());
        assertTrue(page.hasMore(), "the next page must be scheduled even when this page cannot upgrade");
        verify(displays, never()).markFailed(anyLong(), anyLong(), anyString(), any());
        verify(segments, never()).deleteByDisplay(anyLong(), anyString());
    }

    @Test
    void readyV1ContentIsRepublishedAsIndependentlyReadableV2Segments() {
        var displays = mock(ConversationEventDisplayDao.class);
        var segments = mock(ConversationEventContentSegmentDao.class);
        var events = mock(AgentConversationTurnEventDao.class);
        var turns = mock(AgentConversationTurnDao.class);
        var conversations = mock(AgentConversationDao.class);
        var service = new ConversationEventDisplayPreparationService(displays, segments, events, turns,
                conversations, mock(PlatformTransactionManager.class));
        var row = new ConversationEventDisplayDO();
        row.setId(9L); row.setTenantId(1L); row.setConversationId(2L); row.setTurnId(3L);
        row.setDispatchAttempt(1); row.setEventSeq(4L); row.setEventType("text_delta");
        row.setStatus("READY"); row.setProjectionVersion("v1"); row.setPublicationSeq(8L);
        when(displays.listLegacyReady(1, 2, 3, 0)).thenReturn(List.of(row));
        var conversation = new AgentConversationDO(); conversation.setChannel("PRD");
        when(conversations.findById(1L, 2L)).thenReturn(conversation);
        when(turns.findByConversationTurnForUpdate(1L, 2L, 3L)).thenReturn(new AgentConversationTurnDO());
        when(displays.selectMaxPublicationSeq(1L, 2L, 3L)).thenReturn(8L);
        String raw = com.aliyun.autowonder.json.JSON.toJSONString(java.util.Map.of(
                "type", "text_delta", "content", "历史正文🌏".repeat(5000)));
        var chunk = new AgentConversationTurnEventDO();
        chunk.setChunkIndex(0); chunk.setChunkCount(1); chunk.setPayloadBytes((long) raw.getBytes(java.nio.charset.StandardCharsets.UTF_8).length);
        chunk.setPayloadFragment(raw);
        when(events.listChunkMeta(eq(1L), eq(3L), eq(1), eq(4L), eq(-1), anyInt())).thenReturn(List.of(chunk));
        when(events.listChunkPayloads(eq(1L), eq(3L), eq(1), eq(4L), eq(-1), anyInt(), anyInt())).thenReturn(List.of(chunk));
        assertEquals(1, service.upgradeLegacyReady(1, 2, 3));
        verify(displays).markReady(eq(9L), eq(9L), anyString(), anyLong(), anyInt(),
                anyBoolean(), eq(true), eq("v2-semantic"), any());
        verify(displays, never()).markFailed(anyLong(), anyLong(), anyString(), any());
    }
}
