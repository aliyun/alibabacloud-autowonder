package com.aliyun.autowonder.conversation;

import com.aliyun.autowonder.common.error.BizException;
import org.apache.ibatis.io.Resources;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 真实 DAO + 本地数据库的分页与大事件回归夹具（对应工单 70214 小事件 / 7MiB 边界 / ~16.9MB 跨页）。
 *
 * <p>只验证分页重复、字节预算、跨页显式错误与分段全文可重组；不承担 Tomcat 线程与业务 E2E。
 */
class ConversationEventLegacyPagingIntegrationTest {

    static final long TENANT = 1L;
    static final long CONVERSATION = 2L;
    static final String JDBC_URL =
            "jdbc:h2:mem:conversation_event_display_it;MODE=MySQL;DB_CLOSE_DELAY=-1";
    static final int SMALL_EVENTS = 70214;
    static final int BOUNDARY_CHUNK_BYTES = 32512;

    static AgentConversationTurnEventDao eventDao;
    static ConversationEventDisplayDao displayDao;
    static ConversationEventContentSegmentDao segmentDao;
    static ConversationTurnEventService service;
    static ConversationEventDisplayPreparationService preparation;

    @BeforeAll
    static void init() throws Exception {
        try (InputStream in = Resources.getResourceAsStream(
                "mybatis-conversation-event-display-test-config.xml")) {
            SqlSessionFactory factory = new SqlSessionFactoryBuilder().build(in);
            SqlSessionTemplate template = new SqlSessionTemplate(factory);
            eventDao = template.getMapper(AgentConversationTurnEventDao.class);
            displayDao = template.getMapper(ConversationEventDisplayDao.class);
            segmentDao = template.getMapper(ConversationEventContentSegmentDao.class);
        }
        execScript("conversation-event-display-schema-h2.sql");

        var convDao = mock(AgentConversationDao.class);
        var conversation = new AgentConversationDO();
        conversation.setId(CONVERSATION);
        conversation.setChannel("WORKITEM_CLARIFICATION");
        when(convDao.findById(TENANT, CONVERSATION)).thenReturn(conversation);

        var turnDao = mock(AgentConversationTurnDao.class);
        when(turnDao.findByConversationTurn(anyLong(), anyLong(), anyLong())).thenAnswer(invocation -> {
            var turn = new AgentConversationTurnDO();
            turn.setId(invocation.getArgument(2));
            turn.setTenantId(TENANT);
            turn.setConversationId(CONVERSATION);
            turn.setStatus("PROCESSING");
            return turn;
        });
        when(turnDao.findByConversationTurnForUpdate(anyLong(), anyLong(), anyLong()))
                .thenAnswer(invocation -> turnDao.findByConversationTurn(
                        invocation.getArgument(0), invocation.getArgument(1), invocation.getArgument(2)));

        service = new ConversationTurnEventService(eventDao, convDao, turnDao);
        var dataSource = new DriverManagerDataSource(JDBC_URL, "sa", "");
        preparation = new ConversationEventDisplayPreparationService(displayDao, segmentDao, eventDao,
                turnDao, convDao, new DataSourceTransactionManager(dataSource));
    }

    @BeforeEach
    void clean() throws Exception {
        try (Connection connection = DriverManager.getConnection(JDBC_URL, "sa", "");
             Statement statement = connection.createStatement()) {
            statement.execute("DELETE FROM conversation_event_content_segment");
            statement.execute("DELETE FROM conversation_event_display");
            statement.execute("DELETE FROM agent_conversation_turn_event");
        }
    }

    @Test
    void seventyThousandSmallEventsPageWithoutGapsOrDuplicates() throws Exception {
        long turnId = 1001L;
        insertSmallEvents(turnId, SMALL_EVENTS);

        Set<Long> seen = new HashSet<>();
        long cursor = 0L;
        boolean more = true;
        int pages = 0;
        while (more) {
            var page = service.listPlatformEventsByTurnPage(TENANT, CONVERSATION, turnId, cursor, 500);
            assertTrue(ConversationEventDisplayBudget.encodedLength(page.rows())
                    <= ConversationEventDisplayBudget.LEGACY_RESPONSE_BYTES);
            for (var row : page.rows()) {
                assertTrue(seen.add(row.getEventSeq()), "duplicate logical event " + row.getEventSeq());
            }
            more = page.hasMore();
            cursor = page.nextAfterId();
            assertTrue(++pages < 200, "cursor stopped advancing");
        }
        assertEquals(SMALL_EVENTS, seen.size());
    }

    @Test
    void sevenMebibyteBoundaryEventIsExplicitOnLegacyPageAndReadableAsSegments() throws Exception {
        long turnId = 1002L;
        insertSmallEvents(turnId, 499);
        insertSingleLogicalEvent(turnId, 500L, 226, "text");

        var error = assertThrows(BizException.class,
                () -> service.listPlatformEventsByTurnPage(TENANT, CONVERSATION, turnId, 0L, 500));
        assertEquals("42002", error.getCode());

        var bounded = service.listPlatformEventsByTurnPage(TENANT, CONVERSATION, turnId, 0L, 499);
        assertEquals(499, bounded.rows().size());
        assertTrue(bounded.hasMore());

        long displayId = prepare(turnId, 500L);
        var display = displayDao.findById(displayId);
        assertEquals(ConversationEventDisplayDO.STATUS_READY, display.getStatus());
        assertEquals(226L * BOUNDARY_CHUNK_BYTES, display.getContentLength());

        List<ConversationEventContentSegmentDO> segments =
                segmentDao.listSegments(displayId, "v2-semantic", 0, 10_000);
        assertTrue(segments.size() > 1);
        int total = 0;
        for (var segment : segments) {
            assertTrue(segment.getContentBytes()
                    <= ConversationEventDisplayBudget.MAX_SEGMENT_CONTENT_BYTES);
            var frame = com.aliyun.autowonder.json.JSON.parseObject(segment.getContent());
            assertEquals("display_content", frame.getString("type"));
            total += frame.getString("text").getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
        }
        assertEquals(226L * BOUNDARY_CHUNK_BYTES, total);
    }

    @Test
    void sixteenMegabyteCrossPageEventIsReadableAsReassembledSegments() throws Exception {
        long turnId = 1003L;
        insertSingleLogicalEvent(turnId, 1L, 520, "text");

        var error = assertThrows(BizException.class,
                () -> service.listPlatformEventsByTurnPage(TENANT, CONVERSATION, turnId, 0L, 500));
        assertEquals("42002", error.getCode());

        long displayId = prepare(turnId, 1L);
        var display = displayDao.findById(displayId);
        assertEquals(ConversationEventDisplayDO.STATUS_READY, display.getStatus());
        assertEquals(520L * BOUNDARY_CHUNK_BYTES, display.getContentLength());

        long total = 0L;
        int index = 0;
        while (true) {
            List<ConversationEventContentSegmentDO> page = segmentDao.listSegments(displayId, "v2-semantic", index, 200);
            if (page.isEmpty()) {
                break;
            }
            for (var segment : page) {
                assertEquals(index, segment.getSegmentIndex());
                assertTrue(segment.getContentBytes()
                        <= ConversationEventDisplayBudget.MAX_SEGMENT_CONTENT_BYTES);
                var frame = com.aliyun.autowonder.json.JSON.parseObject(segment.getContent());
                assertEquals("display_content", frame.getString("type"));
                total += frame.getString("text").getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
                index++;
            }
        }
        assertEquals(520L * BOUNDARY_CHUNK_BYTES, total);
        assertTrue(index > 1000);
    }

    private long prepare(long turnId, long eventSeq) {
        displayDao.insertFromFirstRawChunk(TENANT, CONVERSATION, turnId, 1, eventSeq,
                ConversationEventDisplayBudget.PROJECTION_VERSION,
                ConversationEventDisplayDO.CLASS_REALTIME);
        var row = displayDao.findByLogicalKey(TENANT, CONVERSATION, turnId, 1, eventSeq);
        preparation.prepare(row.getId());
        return row.getId();
    }

    private void insertSmallEvents(long turnId, int count) throws Exception {
        String payload = "{\"type\":\"log\",\"content\":\"" + "x".repeat(80) + "\"}";
        try (Connection connection = DriverManager.getConnection(JDBC_URL, "sa", "");
             PreparedStatement statement = connection.prepareStatement(
                     "INSERT INTO agent_conversation_turn_event (tenant_id, conversation_id, turn_id,"
                             + " dispatch_attempt, event_seq, chunk_index, chunk_count, event_type,"
                             + " payload_fragment) VALUES (?,?,?,?,?,?,?,?,?)")) {
            for (int i = 1; i <= count; i++) {
                statement.setLong(1, TENANT);
                statement.setLong(2, CONVERSATION);
                statement.setLong(3, turnId);
                statement.setInt(4, 1);
                statement.setLong(5, i);
                statement.setInt(6, 0);
                statement.setInt(7, 1);
                statement.setString(8, "log");
                statement.setString(9, payload);
                statement.addBatch();
                if (i % 2000 == 0) {
                    statement.executeBatch();
                }
            }
            statement.executeBatch();
        }
    }

    private void insertSingleLogicalEvent(long turnId, long eventSeq, int chunkCount,
            String eventType) throws Exception {
        String payload = "x".repeat(BOUNDARY_CHUNK_BYTES);
        try (Connection connection = DriverManager.getConnection(JDBC_URL, "sa", "");
             PreparedStatement statement = connection.prepareStatement(
                     "INSERT INTO agent_conversation_turn_event (tenant_id, conversation_id, turn_id,"
                             + " dispatch_attempt, event_seq, chunk_index, chunk_count, event_type,"
                             + " payload_fragment) VALUES (?,?,?,?,?,?,?,?,?)")) {
            for (int index = 0; index < chunkCount; index++) {
                statement.setLong(1, TENANT);
                statement.setLong(2, CONVERSATION);
                statement.setLong(3, turnId);
                statement.setInt(4, 1);
                statement.setLong(5, eventSeq);
                statement.setInt(6, index);
                statement.setInt(7, chunkCount);
                statement.setString(8, eventType);
                statement.setString(9, payload);
                statement.addBatch();
                if (index % 32 == 0) {
                    statement.executeBatch();
                }
            }
            statement.executeBatch();
        }
    }

    private static void execScript(String resource) throws Exception {
        String sql;
        try (InputStream in = Resources.getResourceAsStream(resource)) {
            sql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        try (Connection connection = DriverManager.getConnection(JDBC_URL, "sa", "");
             Statement statement = connection.createStatement()) {
            for (String stmt : sql.split(";")) {
                if (!stmt.isBlank()) {
                    statement.execute(stmt);
                }
            }
        }
    }
}
