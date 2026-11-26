package com.aliyun.autowonder.aiusage;

import com.aliyun.autowonder.aiusage.dto.TaskUsageReportRequest;
import com.aliyun.autowonder.artifact.ArtifactDao;
import com.aliyun.autowonder.dispatch.DispatchDO;
import com.aliyun.autowonder.dispatch.DispatchDao;
import com.aliyun.autowonder.storage.ObjectStorage;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * End-of-run reconciliation for a forced-cancelled dispatch: the usage-only
 * report goes through the real upsert, and a replay plus a late older snapshot
 * still reconcile to the credits the executor collected.
 */
class DispatchUsageReportIntegrationTest {

    @Test
    void replayAndLateSnapshotReconcileToCollectedCredits() throws Exception {
        DriverManagerDataSource ds = newDataSource();
        try (SqlSession session = openSession(ds)) {
            DispatchDao dispatchDao = mock(DispatchDao.class);
            when(dispatchDao.findById(23564L)).thenReturn(dispatch());
            DispatchAiUsageService service = new DispatchAiUsageService(
                    session.getMapper(DispatchAiUsageDao.class), dispatchDao,
                    mock(ArtifactDao.class), mock(ObjectStorage.class));

            List<TaskUsageReportRequest.TaskUsageEntry> collected = List.of(
                    entry("390001", 100L, "6.000000"),
                    entry("390002", 50L, "3.8774"));
            List<TaskUsageReportRequest.TaskUsageEntry> lateSnapshot = List.of(
                    entry("390001", 40L, "2.000000"),
                    entry("390002", 20L, "1.000000"));

            assertEquals(2, service.recordUsage(10L, 23564L, collected));
            assertEquals(2, service.recordUsage(10L, 23564L, collected));
            assertEquals(2, service.recordUsage(10L, 23564L, lateSnapshot));
            session.commit();
        }

        JdbcTemplate jdbc = new JdbcTemplate(ds);
        assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM dispatch_ai_usage", Integer.class));
        BigDecimal credits = jdbc.queryForObject(
                "SELECT SUM(credits) FROM dispatch_ai_usage WHERE tenant_id=10 AND workitem_id=60057",
                BigDecimal.class);
        assertEquals(0, new BigDecimal("9.8774").compareTo(credits));
        Long staleStepTokens = jdbc.queryForObject(
                "SELECT input_tokens FROM dispatch_ai_usage WHERE step_id='390001'", Long.class);
        assertEquals(100L, staleStepTokens);
    }

    /**
     * CR-B1 的 "timed_out + 上传成功 + 多 step 同 model" 交错：TIMEOUT 不被 fence，
     * usage.json 已按 artifact 入库；随后到达的仅用量补发必须复用同一批 per-step 行。
     */
    @Test
    void artifactDeliveryKeepsPerStepRowsAndInterleavedUsageReportAddsNoRows() throws Exception {
        DriverManagerDataSource ds = newDataSource();
        try (SqlSession session = openSession(ds)) {
            DispatchAiUsageService service = service(session);
            service.ingestArtifact(10L, 60057L, 23564L, 77L, "observability/usage.json", null,
                    collectedUsageJson().getBytes(StandardCharsets.UTF_8));
            session.commit();

            JdbcTemplate jdbc = new JdbcTemplate(ds);
            assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM dispatch_ai_usage", Integer.class));
            assertEquals(0, new BigDecimal("9.8774").compareTo(sumCredits(jdbc)));
            assertEquals(2, jdbc.queryForObject(
                    "SELECT COUNT(*) FROM dispatch_ai_usage WHERE artifact_id=77", Integer.class));
            assertEquals(List.of("390001", "390002"), jdbc.queryForList(
                    "SELECT step_id FROM dispatch_ai_usage ORDER BY step_id", String.class));

            // The same credits replayed through the usage-only endpoint (e.g. an
            // interleaved or late delivery) must reuse the same per-step rows.
            service.recordUsage(10L, 23564L, collectedEntries());
            session.commit();

            assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM dispatch_ai_usage", Integer.class));
            assertEquals(0, new BigDecimal("9.8774").compareTo(sumCredits(jdbc)));
            assertEquals(2, jdbc.queryForObject(
                    "SELECT COUNT(*) FROM dispatch_ai_usage WHERE artifact_id=77", Integer.class));
        }
    }

    /** 先经仅用量端点、后收到 artifact 入库时，仍保持每个 step 单行且合计不变。 */
    @Test
    void usageReportBeforeArtifactDeliveryKeepsSingleRowPerStep() throws Exception {
        DriverManagerDataSource ds = newDataSource();
        try (SqlSession session = openSession(ds)) {
            DispatchAiUsageService service = service(session);
            service.recordUsage(10L, 23564L, collectedEntries());
            session.commit();
            service.ingestArtifact(10L, 60057L, 23564L, 77L, "observability/usage.json", null,
                    collectedUsageJson().getBytes(StandardCharsets.UTF_8));
            session.commit();
        }

        JdbcTemplate jdbc = new JdbcTemplate(ds);
        assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM dispatch_ai_usage", Integer.class));
        assertEquals(0, new BigDecimal("9.8774").compareTo(sumCredits(jdbc)));
        assertEquals(2, jdbc.queryForObject(
                "SELECT COUNT(*) FROM dispatch_ai_usage WHERE artifact_id=77", Integer.class));
        assertEquals(List.of("390001", "390002"), jdbc.queryForList(
                "SELECT step_id FROM dispatch_ai_usage ORDER BY step_id", String.class));
    }

    private DispatchAiUsageService service(SqlSession session) {
        DispatchDao dispatchDao = mock(DispatchDao.class);
        when(dispatchDao.findById(23564L)).thenReturn(dispatch());
        return new DispatchAiUsageService(session.getMapper(DispatchAiUsageDao.class), dispatchDao,
                mock(ArtifactDao.class), mock(ObjectStorage.class));
    }

    private BigDecimal sumCredits(JdbcTemplate jdbc) {
        return jdbc.queryForObject(
                "SELECT SUM(credits) FROM dispatch_ai_usage WHERE tenant_id=10 AND workitem_id=60057",
                BigDecimal.class);
    }

    private String collectedUsageJson() {
        return "{\"usage\":["
                + "{\"provider\":\"qoder\",\"model\":\"auto\",\"step_id\":\"390001\",\"input_tokens\":100,\"credits\":6.0},"
                + "{\"provider\":\"qoder\",\"model\":\"auto\",\"step_id\":\"390002\",\"input_tokens\":50,\"credits\":3.8774}"
                + "]}";
    }

    private List<TaskUsageReportRequest.TaskUsageEntry> collectedEntries() {
        return List.of(entry("390001", 100L, "6.0000"), entry("390002", 50L, "3.8774"));
    }

    private DispatchDO dispatch() {
        DispatchDO dispatch = new DispatchDO();
        dispatch.setId(23564L);
        dispatch.setTenantId(10L);
        dispatch.setWorkitemId(60057L);
        dispatch.setAgentId(30L);
        dispatch.setExecutorId(40L);
        return dispatch;
    }

    private TaskUsageReportRequest.TaskUsageEntry entry(String stepId, long inputTokens, String credits) {
        TaskUsageReportRequest.TaskUsageEntry entry = new TaskUsageReportRequest.TaskUsageEntry();
        entry.setProvider("qoder");
        entry.setModel("auto");
        entry.setStepId(stepId);
        entry.setInputTokens(inputTokens);
        entry.setCredits(Double.valueOf(credits));
        return entry;
    }

    private DriverManagerDataSource newDataSource() {
        DriverManagerDataSource ds = new DriverManagerDataSource(
                "jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
                "sa", "");
        new JdbcTemplate(ds).execute("CREATE TABLE dispatch_ai_usage("
                + "id BIGINT AUTO_INCREMENT PRIMARY KEY,"
                + "tenant_id BIGINT NOT NULL,"
                + "workitem_id BIGINT NOT NULL,"
                + "dispatch_id BIGINT NOT NULL,"
                + "agent_id BIGINT,"
                + "executor_id BIGINT,"
                + "artifact_id BIGINT,"
                + "step_id VARCHAR(64) NOT NULL DEFAULT '',"
                + "provider VARCHAR(64) NOT NULL,"
                + "model VARCHAR(128) NOT NULL,"
                + "input_tokens BIGINT NOT NULL DEFAULT 0,"
                + "output_tokens BIGINT NOT NULL DEFAULT 0,"
                + "cache_read_tokens BIGINT NOT NULL DEFAULT 0,"
                + "cache_write_tokens BIGINT NOT NULL DEFAULT 0,"
                + "reasoning_tokens BIGINT NOT NULL DEFAULT 0,"
                + "credits DECIMAL(12,4),"
                + "total_tokens BIGINT NOT NULL DEFAULT 0,"
                + "raw_json VARCHAR(2000),"
                + "usage_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),"
                + "gmt_create TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),"
                + "gmt_modified TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),"
                + "CONSTRAINT uk_dispatch_step_provider_model UNIQUE (tenant_id, dispatch_id, step_id, provider, model))");
        return ds;
    }

    private SqlSession openSession(DriverManagerDataSource ds) throws Exception {
        Configuration config = new Configuration(new Environment("test", new JdbcTransactionFactory(), ds));
        try (var stream = Files.newInputStream(Path.of("src/main/resources/mapping/DispatchAiUsageDao.xml"))) {
            new XMLMapperBuilder(stream, config, "DispatchAiUsageDao", config.getSqlFragments()).parse();
        }
        return new SqlSessionFactoryBuilder().build(config).openSession();
    }
}
