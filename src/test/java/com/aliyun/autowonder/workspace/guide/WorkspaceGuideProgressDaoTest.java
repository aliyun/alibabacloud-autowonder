package com.aliyun.autowonder.workspace.guide;

import org.apache.ibatis.io.Resources;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.dao.DataAccessException;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * 用 H2 MySQL 模式直接执行生产 WorkspaceGuideProgressDao.xml 的真实 SQL，锁死：
 * 1) 旧空间没有登记记录时查询返回 null，资格判定不依赖账号偏好；
 * 2) uk_workspace_guide 保证重复登记只留一条；
 * 3) 乐观锁版本不匹配时不覆盖新进度；
 * 4) V077 未执行（缺表）时 DAO 直接失败，不会被吞成 eligible=false。
 */
class WorkspaceGuideProgressDaoTest {

    static final String JDBC_URL = "jdbc:h2:mem:workspace_guide_dao_test;MODE=MySQL;DB_CLOSE_DELAY=-1";

    static WorkspaceGuideProgressDao guideDao;

    @BeforeAll
    static void initDb() throws Exception {
        try (InputStream in = Resources.getResourceAsStream("mybatis-workspace-guide-test-config.xml")) {
            SqlSessionFactory factory = new SqlSessionFactoryBuilder().build(in);
            guideDao = new SqlSessionTemplate(factory).getMapper(WorkspaceGuideProgressDao.class);
        }
        execScript("workspace-guide-schema-h2.sql");
    }

    @BeforeEach
    void cleanTable() throws Exception {
        exec("DELETE FROM workspace_guide_progress");
    }

    @Test
    void returnsNullForHistoricalWorkspacesWithoutAnyRecord() {
        assertNull(guideDao.findByWorkspaceAndUser(10L, 7L));
    }

    @Test
    void repeatedRegistrationKeepsOneRowPerWorkspaceAndUser() {
        guideDao.insertIfAbsent(pendingRow(10L, 7L));
        guideDao.insertIfAbsent(pendingRow(10L, 7L));

        WorkspaceGuideProgressDO stored = guideDao.findByWorkspaceAndUser(10L, 7L);
        assertNotNull(stored);
        assertEquals("PENDING", stored.getStatus());
        assertEquals(1, stored.getStage());
        assertEquals(0, stored.getVersion());
        assertNull(guideDao.findByWorkspaceAndUser(10L, 99L));
    }

    @Test
    void staleVersionDoesNotOverwriteNewerProgress() {
        guideDao.insertIfAbsent(pendingRow(10L, 7L));
        WorkspaceGuideProgressDO pending = guideDao.findByWorkspaceAndUser(10L, 7L);
        assertNotNull(pending);

        assertEquals(1, guideDao.updateProgress(pending.getId(), 0, "IN_PROGRESS", 2, 0, null, null, 7L));
        assertEquals(0, guideDao.updateProgress(pending.getId(), 0, "IN_PROGRESS", 3, 0, null, null, 7L));

        WorkspaceGuideProgressDO updated = guideDao.findByWorkspaceAndUser(10L, 7L);
        assertNotNull(updated);
        assertEquals("IN_PROGRESS", updated.getStatus());
        assertEquals(2, updated.getStage());
        assertEquals(1, updated.getVersion());
    }

    /** V077 未执行时必须显式失败，不能伪装成“旧空间没有资格”。 */
    @Test
    void missingMigrationSurfacesAsDataAccessException() throws Exception {
        exec("DROP TABLE workspace_guide_progress");
        try {
            assertThrows(DataAccessException.class, () -> guideDao.findByWorkspaceAndUser(10L, 7L));
        } finally {
            execScript("workspace-guide-schema-h2.sql");
        }
    }

    private static WorkspaceGuideProgressDO pendingRow(long workspaceId, long userId) {
        WorkspaceGuideProgressDO row = new WorkspaceGuideProgressDO();
        row.setWorkspaceId(workspaceId);
        row.setUserId(userId);
        row.setStatus(WorkspaceGuideStatus.PENDING.name());
        row.setStage(1);
        row.setSubstep(0);
        row.setCreatorId(userId);
        row.setModifierId(userId);
        return row;
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

    private static void exec(String sql) throws Exception {
        try (Connection c = DriverManager.getConnection(JDBC_URL, "sa", "");
             Statement st = c.createStatement()) {
            st.execute(sql);
        }
    }
}
