package com.aliyun.autowonder.conversation;

import com.aliyun.autowonder.common.error.BizException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.util.HashMap;
import java.util.List;
import java.util.stream.LongStream;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ConversationQuestionHistoryTest {
    @Test void bothDetailContractsExposeOptionalSettledQuestionHistory() {
        assertDoesNotThrow(() -> com.aliyun.autowonder.conversation.dto.PlatformConversationVO.class.getDeclaredField("questionHistory"));
        assertDoesNotThrow(() -> com.aliyun.autowonder.conversation.dto.ClarificationConversationVO.class.getDeclaredField("questionHistory"));
    }
    @Test void settledReadIsBoundedAndDoesNotChangeReliableAnswerProjection() throws Exception {
        var config=new org.apache.ibatis.session.Configuration();
        try(var in=getClass().getResourceAsStream("/mapping/AgentConversationElicitationDao.xml")) {
            new org.apache.ibatis.builder.xml.XMLMapperBuilder(in,config,"mapping/AgentConversationElicitationDao.xml",config.getSqlFragments()).parse();
        }
        String prefix=AgentConversationElicitationDao.class.getName()+".";
        var sql=config.getMappedStatement(prefix+"listQuestionHistory").getBoundSql(java.util.Map.of("tenantId",1L,"conversationId",10L));
        String text=sql.getSql().replaceAll("\\s+"," ");
        assertTrue(text.contains("tenant_id = ? AND conversation_id = ?"));
        assertTrue(text.contains("status IN ('EXPIRED','CANCELED','ANSWERED','DECLINED')"));
        assertTrue(text.contains("ORDER BY id DESC LIMIT 100"));
        String old=config.getMappedStatement(prefix+"listAnswerDeliveries").getBoundSql(java.util.Map.of()).getSql();
        assertTrue(old.contains("answer_id IS NOT NULL AND status IN ('ANSWERED','DECLINED')"));
        assertTrue(old.contains("ORDER BY id DESC LIMIT 100"));
    }
    @Test void settledHistoryPreservesQuestionAndActualAnswerVerbatim() {
        var dao=mock(AgentConversationElicitationDao.class);
        var row=new AgentConversationElicitationDO();row.setRequestId("original");row.setTurnId(12L);
        row.setStatus("EXPIRED");row.setMessage("Original question");row.setSchemaJson("{\"order\":1}");
        row.setAnswerJson("{\"kept\":\"verbatim\"}");
        when(dao.listQuestionHistory(1L,10L)).thenReturn(List.of(row));
        var service=new ConversationElicitationService(dao,null,null,null,null);
        var vo=com.aliyun.autowonder.conversation.dto.ClarificationElicitationVO.fromDelivery(service.listQuestionHistory(1,10).getFirst());
        assertEquals("EXPIRED",vo.getStatus());assertEquals(12L,vo.getTurnId());
        assertEquals(row.getMessage(),vo.getMessage());assertEquals(row.getSchemaJson(),vo.getRequestedSchema());
        assertEquals(row.getAnswerJson(),vo.getAnswerJson());
    }
    @Test void optionalHistoryIsAbsentOnListDtosAndFailuresAreNotEmptyHistory() {
        var mapper=new ObjectMapper();
        assertFalse(mapper.valueToTree(com.aliyun.autowonder.conversation.dto.PlatformConversationVO.builder().build()).has("questionHistory"));
        assertFalse(mapper.valueToTree(com.aliyun.autowonder.conversation.dto.ClarificationConversationVO.builder().build()).has("questionHistory"));
        var dao=mock(AgentConversationElicitationDao.class);
        when(dao.listQuestionHistory(1L,10L)).thenThrow(new IllegalStateException("read failed"));
        assertThrows(IllegalStateException.class,()->new ConversationElicitationService(dao,null,null,null,null).listQuestionHistory(1,10));
    }
    @Test void questionsAreTurnScopedKeysetPagedAndDoNotDropAnOverBudgetRow() throws Exception {
        var dao = mock(AgentConversationElicitationDao.class);
        var rows = LongStream.rangeClosed(1,21).mapToObj(id -> {
            var row = new AgentConversationElicitationDO(); row.setId(id); row.setTurnId(3L);
            row.setRequestId("question-"+id); row.setMessage("\u0001".repeat(256));
            row.setSchemaJson("\u0001".repeat(1024)); row.setAnswerJson("\u0001".repeat(1024));
            row.setHistoryContentHasMore(true); row.setStatus("ANSWERED"); return row;
        }).toList();
        when(dao.listHistoryPage(1L,2L,3L,null,0L,21)).thenReturn(rows);
        var page = ConversationQuestionHistory.page(dao,1L,2L,3L,null,0L);
        assertTrue(page.hasMore()); assertEquals(1L,page.nextBeforeId());
        assertEquals(page.items().getLast().getHistoryId(),page.nextAfterId());
        assertTrue(new ObjectMapper().writeValueAsBytes(page).length <= 240*1024);
        assertTrue(page.items().getFirst().isContentHasMore());
        assertThrows(BizException.class,()->ConversationQuestionHistory.page(dao,1L,2L,3L,4L,0L));
    }
    @Test void contentIsMembershipScopedAndSegmentedWithoutMaterializingFullRow() {
        var dao = mock(AgentConversationElicitationDao.class);
        var part = new ConversationQuestionHistory.Segment(); part.setMessage("question");
        part.setRequestedSchema("schema-part"); part.setAnswerJson("answer-part"); part.setHasMore(true);
        when(dao.findHistoryContentSegment(1L,2L,3L,4L,4097L)).thenReturn(part);
        var actual = ConversationQuestionHistory.content(dao,1L,2L,3L,4L,"1");
        assertEquals("schema-part",actual.getRequestedSchema()); assertEquals("2",actual.getNextCursor());
        assertThrows(BizException.class,()->ConversationQuestionHistory.content(dao,1L,2L,9L,4L,null));
        assertThrows(BizException.class,()->ConversationQuestionHistory.content(dao,1L,2L,3L,4L,"-1"));
        verify(dao,never()).findByRequestId(anyLong(),anyLong(),anyString());
    }
    @Test void sqlBoundsAllLargeFieldsAndPreservesEveryOwnershipPredicate() throws Exception {
        var config = new org.apache.ibatis.session.Configuration();
        try (var stream = org.apache.ibatis.io.Resources.getResourceAsStream("mapping/AgentConversationElicitationDao.xml")) {
            new org.apache.ibatis.builder.xml.XMLMapperBuilder(stream,config,"mapping/AgentConversationElicitationDao.xml",config.getSqlFragments()).parse();
        }
        var params = new HashMap<String,Object>(); params.put("tenantId",1L); params.put("conversationId",2L);
        params.put("turnId",3L); params.put("id",4L); params.put("afterId",0L); params.put("limit",21); params.put("offset",4097L);
        String page = config.getMappedStatement(AgentConversationElicitationDao.class.getName()+".listHistoryPage").getBoundSql(params).getSql().replaceAll("\\s+"," ");
        assertTrue(page.contains("LEFT(message, 256)")); assertTrue(page.contains("OCTET_LENGTH(schema_json) <= 1024"));
        assertTrue(page.contains("tenant_id = ? AND conversation_id = ? AND turn_id = ?"));
        assertTrue(page.contains("id > ?")); assertTrue(page.contains("ASC")); assertTrue(page.contains("LIMIT ?"));
        String content = config.getMappedStatement(AgentConversationElicitationDao.class.getName()+".findHistoryContentSegment").getBoundSql(params).getSql().replaceAll("\\s+"," ");
        assertTrue(content.contains("SUBSTRING(schema_json, ?, 4096)"));
        assertTrue(content.contains("tenant_id = ? AND conversation_id = ? AND turn_id = ? AND id = ?"));
        String status = config.getMappedStatement(AgentConversationElicitationDao.class.getName()+".listActiveAnswerDeliveryStatuses").getBoundSql(params).getSql();
        assertFalse(status.contains("message")); assertFalse(status.contains("schema_json")); assertFalse(status.contains("answer_json"));
    }
}
