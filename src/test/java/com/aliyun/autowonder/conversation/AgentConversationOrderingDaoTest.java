package com.aliyun.autowonder.conversation;

import org.apache.ibatis.io.Resources;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionTemplate;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * 工单澄清面板的默认会话与列表首项由这条排序决定：有对话记录（last_turn_at 非空）的会话
 * 必须排在新建未发言的空会话之前，否则「新建后没说过话」的会话会抢占默认选中。
 * 排序只体现在 SQL 里，XML 文本无法证明行为，这里用真实 H2 行数据回归。
 */
class AgentConversationOrderingDaoTest {

    private static final long TENANT = 1L;
    private static final long AGENT = 3L;
    private static final long WORKITEM = 10011L;
    private static final String CHANNEL = "WORKITEM_CLARIFICATION";
    private static final String JDBC_URL =
            "jdbc:h2:mem:platform_conversation_test;MODE=MySQL;DB_CLOSE_DELAY=-1";

    private static AgentConversationDao conversationDao;

    @BeforeAll
    static void initDb() throws Exception {
        try (InputStream in = Resources.getResourceAsStream(
                "mybatis-platform-conversation-test-config.xml")) {
            SqlSessionFactory factory = new SqlSessionFactoryBuilder().build(in);
            conversationDao = new SqlSessionTemplate(factory).getMapper(AgentConversationDao.class);
        }
        execScript("platform-conversation-schema-h2.sql");
    }

    @BeforeEach
    void cleanTables() throws Exception {
        exec("DELETE FROM agent_conversation_turn", "DELETE FROM agent_conversation");
    }

    /** AC-2：新建未发言的空会话即使创建时间最新，也不能排在最近对话过的会话之前。 */
    @Test
    void emptyConversationStaysBehindConversedOnesEvenWhenCreatedLater() throws Exception {
        long conversedOlder = insertConversation("conversed-older");
        long conversedNewer = insertConversation("conversed-newer");
        long emptyNewest = insertConversation("empty-newest");
        updateLastTurn(conversedOlder, "2026-01-01 00:00:00");
        updateLastTurn(conversedNewer, "2026-01-02 00:00:00");
        exec("UPDATE agent_conversation SET gmt_create = TIMESTAMP '2026-01-03 00:00:00'"
                + " WHERE id = " + emptyNewest);

        assertEquals(List.of(conversedNewer, conversedOlder, emptyNewest), listedIds());
        assertEquals(Long.valueOf(conversedNewer), latestId());
    }

    /** 全是空会话时退回创建时间倒序：没有对话记录可依，只能按最近创建给出候选。 */
    @Test
    void emptyConversationsFallBackToNewestCreation() throws Exception {
        long emptyOlder = insertConversation("empty-older");
        long emptyNewer = insertConversation("empty-newer");
        exec("UPDATE agent_conversation SET gmt_create = TIMESTAMP '2026-01-01 00:00:00'"
                + " WHERE id = " + emptyOlder,
                "UPDATE agent_conversation SET gmt_create = TIMESTAMP '2026-01-02 00:00:00'"
                        + " WHERE id = " + emptyNewer);

        assertEquals(List.of(emptyNewer, emptyOlder), listedIds());
        assertEquals(Long.valueOf(emptyNewer), latestId());
    }

    /** 活跃时间相同再按 id 倒序，列表首项与 /latest 必须落在同一条。 */
    @Test
    void equalActivityBreaksByConversationIdDescending() throws Exception {
        long first = insertConversation("tie-first");
        long second = insertConversation("tie-second");
        updateLastTurn(first, "2026-02-01 00:00:00");
        updateLastTurn(second, "2026-02-01 00:00:00");

        assertEquals(List.of(second, first), listedIds());
        assertEquals(Long.valueOf(second), latestId());
    }

    /** 刷新活跃时间只改动目标会话，并保证同租户边界。 */
    @Test
    void updateLastTurnAtOnlyTouchesTargetConversation() {
        long target = insertConversation("target");
        long untouched = insertConversation("untouched");

        assertEquals(1, conversationDao.updateLastTurnAt(TENANT, target, new Date()));
        assertEquals(0, conversationDao.updateLastTurnAt(TENANT + 1, untouched, new Date()));

        AgentConversationDO updated = conversationDao.findById(TENANT, target);
        assertNotNull(updated.getLastTurnAt());
        assertEquals(Integer.valueOf(1), updated.getVersion());
        AgentConversationDO other = conversationDao.findById(TENANT, untouched);
        assertNull(other.getLastTurnAt());
        assertEquals(Integer.valueOf(0), other.getVersion());
    }

    private List<Long> listedIds() {
        return conversationDao.listByBizRef(TENANT, CHANNEL, "WORKITEM", WORKITEM, AGENT)
                .stream()
                .map(AgentConversationDO::getId)
                .toList();
    }

    private Long latestId() {
        AgentConversationDO latest = conversationDao.findLatestByBizRefWithoutAgent(
                TENANT, CHANNEL, "WORKITEM", WORKITEM);
        assertNotNull(latest);
        return latest.getId();
    }

    private long insertConversation(String suffix) {
        AgentConversationDO conv = new AgentConversationDO();
        conv.setTenantId(TENANT);
        conv.setAgentId(AGENT);
        conv.setChannel(CHANNEL);
        conv.setBizRefType("WORKITEM");
        conv.setBizRefId(WORKITEM);
        conv.setChannelConversationId("ch-" + suffix);
        conv.setStatus("ACTIVE");
        assertEquals(1, conversationDao.insert(conv));
        return conv.getId();
    }

    private void updateLastTurn(long conversationId, String timestamp) throws Exception {
        exec("UPDATE agent_conversation SET last_turn_at = TIMESTAMP '" + timestamp + "'"
                + " WHERE id = " + conversationId);
    }

    private static void exec(String... statements) throws Exception {
        try (Connection c = DriverManager.getConnection(JDBC_URL, "sa", "");
             Statement st = c.createStatement()) {
            for (String statement : statements) {
                st.execute(statement);
            }
        }
    }

    private static void execScript(String resource) throws Exception {
        String sql;
        try (InputStream in = Resources.getResourceAsStream(resource)) {
            sql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        try (Connection c = DriverManager.getConnection(JDBC_URL, "sa", "");
             Statement st = c.createStatement()) {
            for (String stmt : sql.split(";")) {
                if (!stmt.isBlank()) {
                    st.execute(stmt);
                }
            }
        }
    }
}
