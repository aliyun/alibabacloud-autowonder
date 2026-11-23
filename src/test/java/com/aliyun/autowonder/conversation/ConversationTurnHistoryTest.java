package com.aliyun.autowonder.conversation;

import com.aliyun.autowonder.common.error.BizException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.stream.LongStream;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ConversationTurnHistoryTest {
    @Test void forwardPagesKeepTheEarliestItemsWhenTheJsonBudgetShrinksThePage() throws Exception {
        var dao = mock(AgentConversationTurnDao.class);
        when(dao.listHistoryAfterPage(1L,2L,700L,51,false)).thenReturn(
                LongStream.rangeClosed(101,151).mapToObj(i -> row(i*7,"\u0001".repeat(2048))).toList());
        var page = ConversationTurnHistory.page(dao,1L,2L,null,700L,50,false)
                .map(turn -> java.util.Map.of("id",turn.getId(),"content",turn.getContent()));
        assertEquals(707L,page.items().getFirst().get("id")); assertTrue(page.hasMore());
        assertEquals(page.items().getLast().get("id"),page.nextAfterTurnId());
        assertNull(page.nextBeforeTurnId()); assertTrue(new ObjectMapper().writeValueAsBytes(page).length <= 240*1024);
        assertThrows(BizException.class,()->ConversationTurnHistory.page(dao,1L,2L,9L,700L,50,false));
    }
    @Test void historyUsesLimitedKeysetQueryAndCodePointSafeUtf8Previews() {
        var dao = mock(AgentConversationTurnDao.class);
        when(dao.listHistoryPage(1L, 2L, null, 51, false)).thenReturn(
                LongStream.rangeClosed(1, 51).mapToObj(i -> row(52 - i, "😀".repeat(2048))).toList());
        var page = ConversationTurnHistory.page(dao, 1L, 2L, null, 1000, false);
        assertTrue(page.items().size() <= 50);
        assertFalse(page.items().isEmpty());
        assertEquals(51L, page.items().getLast().getId());
        assertEquals(page.items().getFirst().getId(), page.nextBeforeTurnId());
        assertTrue(page.hasMore());
        assertTrue(page.items().stream().allMatch(t -> t.isContentHasMore()
                && t.getContent().getBytes(StandardCharsets.UTF_8).length == 2048));
        verify(dao, never()).listTurnsByConversation(anyLong(), anyLong());
    }

    @Test void JSONBudgetCountsEscapedCharactersAndPreservesOmittedItemsCursor() throws Exception {
        var rows = LongStream.rangeClosed(1, 50).mapToObj(i -> row(i, "\u0001".repeat(2048))).toList();
        var page = ConversationTurnHistory.bounded(new ConversationTurnHistory.Page<>(rows, false, null));
        assertTrue(page.hasMore());
        assertTrue(page.items().size() < 50);
        assertEquals(page.items().getFirst().getId(), page.nextBeforeTurnId());
        assertEquals(50L, page.items().getLast().getId());
        assertTrue(new ObjectMapper().writeValueAsBytes(page).length <= 240 * 1024);
    }

    @Test void contentRequiresMembershipAndReadsOnlyRequestedSqlCharacterBlock() {
        var dao = mock(AgentConversationTurnDao.class);
        var row = row(3L, "😀".repeat(4096)); row.setContentHasMore(true);
        when(dao.findHistoryContentSegment(1L, 2L, 3L, 4097L, true)).thenReturn(row);
        var segment = ConversationTurnHistory.content(dao, 1L, 2L, 3L, "1", true);
        assertEquals(16384, segment.content().getBytes(StandardCharsets.UTF_8).length);
        assertEquals("2", segment.nextCursor());
        assertTrue(segment.hasMore());
        assertThrows(BizException.class, () -> ConversationTurnHistory.content(dao, 1L, 2L, 4L, null, true));
        assertThrows(BizException.class, () -> ConversationTurnHistory.content(dao, 1L, 2L, 3L, "-1", true));
        assertThrows(BizException.class, () -> ConversationTurnHistory.content(dao, 1L, 2L, 3L, "9223372036854775807", true));
        verify(dao, never()).findByConversationTurn(anyLong(), anyLong(), anyLong());
    }

    @Test void absentContentIsPreserved() {
        assertNull(ConversationTurnHistory.preview(null));
        assertEquals("hello", ConversationTurnHistory.preview("hello"));
    }

    @Test void sqlBoundsContentBeforeMappingAndKeepsTenantConversationTurnPredicates() throws Exception {
        var config = new org.apache.ibatis.session.Configuration();
        try (var stream = org.apache.ibatis.io.Resources.getResourceAsStream("mapping/AgentConversationTurnDao.xml")) {
            new org.apache.ibatis.builder.xml.XMLMapperBuilder(stream, config,
                    "mapping/AgentConversationTurnDao.xml", config.getSqlFragments()).parse();
        }
        var params = new java.util.HashMap<String, Object>();
        params.put("tenantId", 1L); params.put("conversationId", 2L); params.put("id", 3L);
        params.put("beforeTurnId", 9L); params.put("limit", 51); params.put("prd", true); params.put("offset", 4097L);
        String pageSql = config.getMappedStatement(AgentConversationTurnDao.class.getName() + ".listHistoryPage")
                .getBoundSql(params).getSql().replaceAll("\\s+", " ");
        assertTrue(pageSql.contains("LEFT(")); assertTrue(pageSql.contains("2048) AS content"));
        assertTrue(pageSql.contains("id < ?")); assertTrue(pageSql.contains("ORDER BY id DESC LIMIT ?"));
        assertTrue(pageSql.contains("$.userMessage")); assertTrue(pageSql.contains("$.element"));
        String segmentSql = config.getMappedStatement(AgentConversationTurnDao.class.getName() + ".findHistoryContentSegment")
                .getBoundSql(params).getSql().replaceAll("\\s+", " ");
        assertTrue(segmentSql.contains("SUBSTRING(")); assertTrue(segmentSql.contains("4096) AS content"));
        assertTrue(segmentSql.contains("tenant_id = ? AND conversation_id = ? AND id = ?"));
        String activeSql = config.getMappedStatement(AgentConversationTurnDao.class.getName() + ".findActiveHistoryTurn")
                .getBoundSql(params).getSql();
        assertFalse(activeSql.contains("content")); assertTrue(activeSql.contains("LIMIT 1"));
    }
    private static AgentConversationTurnDO row(long id, String content) {
        var row = new AgentConversationTurnDO(); row.setId(id); row.setContent(content); return row;
    }
}
