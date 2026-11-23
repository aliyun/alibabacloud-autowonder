package com.aliyun.autowonder.conversation;

import org.apache.ibatis.io.Resources;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import com.aliyun.autowonder.conversation.dto.ConversationEventDisplayDtos.SummaryPage;

import java.io.InputStream;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 真实 DAO + 本地数据库验证 V083 引入的队列/checkpoint SQL。
 *
 * <p>覆盖 Mockito 桩覆盖不到的部分：按类别认领与轮转排序、promoteTurn、
 * checkpoint 回卷与静默顺延、高水位/单轮最大原始主键。
 */
class ConversationEventDisplayQueueIntegrationTest {

    static final long TENANT = 1L;
    static final long CONVERSATION = 2L;
    /** 必须与 mybatis-conversation-event-display-test-config.xml 的 URL 一致，否则 DAO 与夹具在不同库。 */
    static final String JDBC_URL =
            "jdbc:h2:mem:conversation_event_display_it;MODE=MySQL;DB_CLOSE_DELAY=-1";

    static ConversationEventDisplayDao displayDao;
    static ConversationEventDisplayPreparationService preparation;
    static ConversationEventDisplayReadService readService;

    @BeforeAll
    static void init() throws Exception {
        try (InputStream in = Resources.getResourceAsStream(
                "mybatis-conversation-event-display-test-config.xml")) {
            SqlSessionFactory factory = new SqlSessionFactoryBuilder().build(in);
            SqlSessionTemplate template = new SqlSessionTemplate(factory);
            displayDao = template.getMapper(ConversationEventDisplayDao.class);
            var eventDao = template.getMapper(AgentConversationTurnEventDao.class);
            var segmentDao = template.getMapper(ConversationEventContentSegmentDao.class);
            preparation = new ConversationEventDisplayPreparationService(displayDao, segmentDao,
                    eventDao, mock(AgentConversationTurnDao.class), mock(AgentConversationDao.class),
                    new DataSourceTransactionManager(new DriverManagerDataSource(JDBC_URL, "sa", "")));
            var turnDao = mock(AgentConversationTurnDao.class);
            when(turnDao.findByConversationTurn(anyLong(), anyLong(), anyLong())).thenAnswer(inv -> {
                var turn = new AgentConversationTurnDO();
                turn.setTenantId(inv.getArgument(0));
                turn.setConversationId(inv.getArgument(1));
                turn.setId(inv.getArgument(2));
                turn.setStatus("COMPLETED");
                return turn;
            });
            readService = new ConversationEventDisplayReadService(displayDao, segmentDao, turnDao,
                    mock(ConversationEventDisplayRecovery.class));
        }
        execScript("conversation-event-display-schema-h2.sql");
    }

    @BeforeEach
    void clean() throws Exception {
        try (Connection connection = DriverManager.getConnection(JDBC_URL, "sa", "");
             Statement statement = connection.createStatement()) {
            statement.execute("DELETE FROM conversation_event_display_scan");
            statement.execute("DELETE FROM conversation_event_display");
            statement.execute("DELETE FROM agent_conversation_turn_event");
        }
    }

    @Test
    void claimsAnIndexedBoundedPageWithoutSortingTheWholeQueueByRotation() throws Exception {
        long turn15 = insertDisplay(15L, "REALTIME");
        long turn16 = insertDisplay(16L, "REALTIME");
        long history = insertDisplay(17L, "HISTORY");
        insertDisplay(18L, "HISTORY", "READY");

        java.util.Date now = new java.util.Date();
        List<String> realtimeClasses = List.of(ConversationEventDisplayDO.CLASS_REALTIME,
                ConversationEventDisplayDO.CLASS_INTERACTIVE);

        assertEquals(List.of(turn16, turn15),
                displayDao.listClaimableIdsByClass(now, realtimeClasses, 8, 0, 10));
        // Rotation happens in the bounded Java page, never through a MOD sort over the backlog.
        assertEquals(List.of(turn16, turn15),
                displayDao.listClaimableIdsByClass(now, realtimeClasses, 8, 1, 10));
        assertEquals(List.of(turn16),
                displayDao.listClaimableIdsByClass(now, realtimeClasses, 8, 1, 1));
        assertEquals(List.of(history), displayDao.listClaimableIdsByClass(now,
                List.of(ConversationEventDisplayDO.CLASS_HISTORY), 0, 0, 10));
    }

    @Test
    void promoteTurnOnlyRequeuesPreparingHistoryRows() throws Exception {
        long preparing = insertDisplay(20L, "HISTORY");
        long ready = insertDisplay(21L, "HISTORY", "READY");

        int promoted = displayDao.promoteTurn(TENANT, CONVERSATION, 20L,
                ConversationEventDisplayDO.CLASS_HISTORY,
                ConversationEventDisplayDO.CLASS_INTERACTIVE, new java.util.Date());
        displayDao.promoteTurn(TENANT, CONVERSATION, 21L,
                ConversationEventDisplayDO.CLASS_HISTORY,
                ConversationEventDisplayDO.CLASS_INTERACTIVE, new java.util.Date());

        assertEquals(1, promoted);
        assertEquals(ConversationEventDisplayDO.CLASS_INTERACTIVE,
                displayDao.findById(preparing).getQueueClass());
        assertEquals(ConversationEventDisplayDO.CLASS_HISTORY,
                displayDao.findById(ready).getQueueClass());
    }

    @Test
    void legacyUpgradeSelectionKeepsTenantScopeAndAdvancesPastUnavailablePages() throws Exception {
        long id = insertDisplay(80L, "HISTORY", "READY");
        insertRaw(80L, 1L, new Timestamp(System.currentTimeMillis()));
        try (Connection connection = DriverManager.getConnection(JDBC_URL, "sa", "");
             Statement statement = connection.createStatement()) {
            statement.execute("UPDATE conversation_event_display SET projection_version='v1', publication_seq=5 WHERE id=" + id);
        }
        var rows = displayDao.listLegacyReady(TENANT, CONVERSATION, 80L, 0);
        assertEquals(1, rows.size());
        assertEquals(id, rows.get(0).getId());
        assertEquals(id, displayDao.findLegacyReadyId(TENANT, CONVERSATION, 80L));
        assertEquals(List.of(), displayDao.listLegacyReady(TENANT, CONVERSATION, 80L, 5));
        assertEquals(List.of(), displayDao.listLegacyReady(99L, CONVERSATION, 80L, 0));
        assertNull(displayDao.findLegacyReadyId(99L, CONVERSATION, 80L));
    }

    @Test
    void rearmingAFailedEventRetainsThePublishedWatermark() throws Exception {
        long id = insertDisplay(20L, "REALTIME");
        displayDao.markFailed(id, 7L, "missing slice", new java.util.Date());

        ConversationEventDisplayDO row = displayDao.findById(id);
        displayDao.rearmFailed(TENANT, CONVERSATION, 20L, row.getDispatchAttempt(),
                row.getEventSeq(), new java.util.Date());

        assertEquals(7L, displayDao.selectMaxPublicationSeq(TENANT, CONVERSATION, 20L));
        assertEquals("PREPARING", displayDao.findById(id).getStatus());
    }

    @Test
    void aSliceArrivingDuringPreparationCannotBeOverwrittenByAnIncompleteRetry() throws Exception {
        long id = insertDisplay(20L, "LARGE");
        java.util.Date now = new java.util.Date();
        assertEquals(1, displayDao.claim(id, now, new java.util.Date(now.getTime() + 120000), "worker"));
        var row = displayDao.findById(id);
        displayDao.wakePending(TENANT, CONVERSATION, 20L, row.getDispatchAttempt(), row.getEventSeq(),
                "LARGE", now);

        assertEquals(0, displayDao.scheduleRetry(id, new java.util.Date(now.getTime() + 30000),
                "incomplete scan before new slice", now));
        assertEquals(0, displayDao.markFailedIfCurrent(id, 9L, "stale third attempt", 1, "worker", now));
        int previousWake = displayDao.findById(id).getAttemptCount();
        displayDao.wakePending(TENANT, CONVERSATION, 20L, row.getDispatchAttempt(), row.getEventSeq(), "LARGE", now);
        assertEquals(0, displayDao.markFailedIfCurrent(id, 10L, "stale scan after second wake", previousWake, "worker", now));
        assertEquals("PREPARING", displayDao.findById(id).getStatus());
        displayDao.releaseLease(id, "worker");
        assertEquals(List.of(id), displayDao.listClaimableIdsByClass(now, List.of("LARGE"), 0, 0, 1));
        assertEquals(1, displayDao.claim(id, now, new java.util.Date(now.getTime() + 120000), "new-worker"));
        assertEquals(0, displayDao.markFailedIfCurrent(id, 11L, "old worker", 1, "worker", now));
        assertEquals(0, displayDao.markFailedIfCurrent(id, 11L, "expired scan", 1, "new-worker",
                new java.util.Date(now.getTime() + 120001)));
    }

    @Test
    void indexedClaimPagesAdvanceWhileNewerTurnsContinueToArrive() throws Exception {
        long first = insertDisplay(15L, "REALTIME");
        long second = insertDisplay(16L, "REALTIME");
        java.util.Date now = new java.util.Date();
        var page = displayDao.listClaimablePage(now, "REALTIME", 0, 0, 1);
        assertEquals(first, page.get(0).getId());
        insertDisplay(17L, "REALTIME");
        var next = displayDao.listClaimablePage(now, "REALTIME", 15L, first, 1);
        assertEquals(second, next.get(0).getId());
    }

    @Test
    void historyScanUsesThePersistedCheckpointAndDefersQuietRounds() throws Exception {
        long now = System.currentTimeMillis();
        insertRaw(7L, 1L, new Timestamp(now));
        insertRaw(8L, 1L, new Timestamp(now - 2L * 60L * 60L * 1000L));
        // 共享内存库的自增 id 不会因 DELETE 归零，期望值按实际最大主键取值。
        Long expectedHighWater = displayDao.maxRawIdForTurn(TENANT, CONVERSATION, 8L);

        assertEquals(2, preparation.scanHistoryBatch(200, 500L));

        assertEquals(ConversationEventDisplayDO.CLASS_REALTIME,
                displayDao.findByLogicalKey(TENANT, CONVERSATION, 7L, 1, 1L).getQueueClass());
        assertEquals(ConversationEventDisplayDO.CLASS_HISTORY,
                displayDao.findByLogicalKey(TENANT, CONVERSATION, 8L, 1, 1L).getQueueClass());
        assertEquals(expectedHighWater, displayDao.highWaterRawId());
        assertEquals(expectedHighWater, displayDao.maxRawIdForTurn(TENANT, CONVERSATION, 8L));

        ConversationEventDisplayScanDO scan = displayDao.findScan(
                ConversationEventDisplayScanDO.SCAN_KEY_RAW);
        assertNotNull(scan);
        assertEquals(0L, scan.getLastRawId());
        assertNull(scan.getQuietUntil());

        // 第二轮：无新增可补建 → 回卷后写入 quiet_until。
        assertEquals(0, preparation.scanHistoryBatch(200, 500L));
        scan = displayDao.findScan(ConversationEventDisplayScanDO.SCAN_KEY_RAW);
        assertNotNull(scan.getQuietUntil());
        // 第三轮在静默窗口内直接返回，不再扫描主键范围。
        assertEquals(0, preparation.scanHistoryBatch(200, 500L));
    }

    /**
     * CR-11：部分发现的历史轮次补建 20 行后仍必须是非终态，剩余事件全部发布后才 READY。
     */
    @Test
    void partiallyDiscoveredTurnStaysNonTerminalUntilEveryRawEventIsPublished() throws Exception {
        long turnId = 30L;
        Timestamp old = new Timestamp(System.currentTimeMillis() - 2L * 60L * 60L * 1000L);
        for (int seq = 1; seq <= 23; seq++) {
            insertRaw(turnId, seq, old);
        }

        SummaryPage first = readService.readSummaries(TENANT, CONVERSATION, turnId, null, 100);
        assertEquals("PREPARING", first.preparationStatus());
        assertEquals(0, countDisplayRows(turnId), "读取不能在请求线程补建");
        try (var recovery = new ConversationEventDisplayRecovery(preparation, displayDao)) {
            recovery.request(TENANT, CONVERSATION, turnId);
            long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
            while (countDisplayRows(turnId) < 23 && System.nanoTime() < deadline) Thread.sleep(10);
            assertEquals(23, countDisplayRows(turnId), "后台应自动继续有界批次直到发现完整");
        }

        markAllReady(turnId);
        SummaryPage second = readService.readSummaries(TENANT, CONVERSATION, turnId, null, 100);
        assertEquals("READY", second.preparationStatus(), "全部后台补建并发布后应追平");
        assertEquals(23, countDisplayRows(turnId), "再次读取继续补建剩余逻辑键");

        markAllReady(turnId);
        SummaryPage third = readService.readSummaries(TENANT, CONVERSATION, turnId, null, 100);
        assertEquals("READY", third.preparationStatus());
    }

    private int countDisplayRows(long turnId) throws Exception {
        try (Connection connection = DriverManager.getConnection(JDBC_URL, "sa", "");
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT COUNT(*) FROM conversation_event_display "
                             + "WHERE tenant_id = ? AND conversation_id = ? AND turn_id = ?")) {
            statement.setLong(1, TENANT);
            statement.setLong(2, CONVERSATION);
            statement.setLong(3, turnId);
            try (var rows = statement.executeQuery()) {
                rows.next();
                return rows.getInt(1);
            }
        }
    }

    private void markAllReady(long turnId) throws Exception {
        try (Connection connection = DriverManager.getConnection(JDBC_URL, "sa", "");
             PreparedStatement statement = connection.prepareStatement(
                     "UPDATE conversation_event_display SET status = 'READY', "
                             + "publication_seq = id, summary = 's', content_length = 1, "
                             + "total_segments = 0, detail_available = 0, truncated = 0 "
                             + "WHERE tenant_id = ? AND conversation_id = ? AND turn_id = ? "
                             + "AND status = 'PREPARING'")) {
            statement.setLong(1, TENANT);
            statement.setLong(2, CONVERSATION);
            statement.setLong(3, turnId);
            statement.executeUpdate();
        }
    }

    private long insertDisplay(long turnId, String queueClass) throws Exception {
        return insertDisplay(turnId, queueClass, "PREPARING");
    }

    private long insertDisplay(long turnId, String queueClass, String status) throws Exception {
        String sql = "INSERT INTO conversation_event_display "
                + "(tenant_id, conversation_id, turn_id, dispatch_attempt, event_seq, event_type, "
                + "status, queue_class, projection_version) VALUES (?,?,?,?,?,?,?,?,?)";
        try (Connection connection = DriverManager.getConnection(JDBC_URL, "sa", "");
             PreparedStatement statement = connection.prepareStatement(sql,
                     Statement.RETURN_GENERATED_KEYS)) {
            statement.setLong(1, TENANT);
            statement.setLong(2, CONVERSATION);
            statement.setLong(3, turnId);
            statement.setInt(4, 1);
            statement.setLong(5, 1L);
            statement.setString(6, "text");
            statement.setString(7, status);
            statement.setString(8, queueClass);
            statement.setString(9, ConversationEventDisplayBudget.PROJECTION_VERSION);
            statement.executeUpdate();
            try (var keys = statement.getGeneratedKeys()) {
                keys.next();
                return keys.getLong(1);
            }
        }
    }

    private void insertRaw(long turnId, long eventSeq, Timestamp createdAt) throws Exception {
        String sql = "INSERT INTO agent_conversation_turn_event "
                + "(tenant_id, conversation_id, turn_id, dispatch_attempt, event_seq, chunk_index, "
                + "chunk_count, event_type, payload_fragment, gmt_create) VALUES (?,?,?,?,?,?,?,?,?,?)";
        try (Connection connection = DriverManager.getConnection(JDBC_URL, "sa", "");
             PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setLong(1, TENANT);
            statement.setLong(2, CONVERSATION);
            statement.setLong(3, turnId);
            statement.setInt(4, 1);
            statement.setLong(5, eventSeq);
            statement.setInt(6, 0);
            statement.setInt(7, 1);
            statement.setString(8, "text");
            statement.setString(9, "{\"type\":\"text\",\"content\":\"hi\"}");
            statement.setTimestamp(10, createdAt);
            statement.executeUpdate();
        }
    }

    private static void execScript(String resource) throws Exception {
        try (InputStream in = Resources.getResourceAsStream(resource);
             Connection connection = DriverManager.getConnection(JDBC_URL, "sa", "")) {
            String script = new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            try (Statement statement = connection.createStatement()) {
                for (String line : script.split(";")) {
                    String trimmed = line.trim();
                    if (!trimmed.isEmpty()) {
                        statement.execute(trimmed);
                    }
                }
            }
        }
    }
}
