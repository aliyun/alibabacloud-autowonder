package com.aliyun.autowonder.aiusage;

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
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * {@code DispatchAiUsageDao.upsert} runs on H2 in MySQL mode so the cumulative
 * merge semantics are verified against real SQL: replays and late (older)
 * snapshots must never shrink a fuller usage row.
 */
class DispatchAiUsageDaoUpsertTest {

    @Test
    void staleSnapshotDoesNotOverwriteFullerUsage() throws Exception {
        DriverManagerDataSource ds = newDataSource();
        try (SqlSession session = openSession(ds)) {
            DispatchAiUsageDao dao = session.getMapper(DispatchAiUsageDao.class);
            dao.upsert(entry(20, 20, new BigDecimal("9.0000"), 40, "{\"v\":3}", "2026-01-03 00:00:00"));
            dao.upsert(entry(5, 5, new BigDecimal("1.0000"), 10, "{\"v\":1}", "2026-01-01 00:00:00"));
            session.commit();
        }

        Map<String, Object> row = new JdbcTemplate(ds).queryForMap(
                "SELECT input_tokens, output_tokens, credits, total_tokens, raw_json, usage_at FROM dispatch_ai_usage");
        assertEquals(20L, row.get("input_tokens"));
        assertEquals(20L, row.get("output_tokens"));
        assertEquals(0, new BigDecimal("9.0000").compareTo((BigDecimal) row.get("credits")));
        assertEquals(40L, row.get("total_tokens"));
        assertEquals("{\"v\":3}", row.get("raw_json"));
        assertEquals(Timestamp.valueOf("2026-01-03 00:00:00"), row.get("usage_at"));
    }

    @Test
    void nullCreditsMergeKeepsWhicheverSnapshotReportedCredits() throws Exception {
        DriverManagerDataSource ds = newDataSource();
        try (SqlSession session = openSession(ds)) {
            DispatchAiUsageDao dao = session.getMapper(DispatchAiUsageDao.class);
            dao.upsert(entry(5, 5, null, 10, "{\"v\":1}", "2026-01-01 00:00:00"));
            dao.upsert(entry(10, 10, new BigDecimal("2.5000"), 20, "{\"v\":2}", "2026-01-02 00:00:00"));
            dao.upsert(entry(1, 1, null, 2, "{\"v\":0}", "2026-01-04 00:00:00"));
            session.commit();
        }

        Map<String, Object> row = new JdbcTemplate(ds).queryForMap(
                "SELECT credits, total_tokens, raw_json FROM dispatch_ai_usage");
        assertEquals(0, new BigDecimal("2.5000").compareTo((BigDecimal) row.get("credits")));
        assertEquals(20L, row.get("total_tokens"));
        assertEquals("{\"v\":2}", row.get("raw_json"));
    }

    @Test
    void replayOfTheSameSnapshotStaysSingleRow() throws Exception {
        DriverManagerDataSource ds = newDataSource();
        try (SqlSession session = openSession(ds)) {
            DispatchAiUsageDao dao = session.getMapper(DispatchAiUsageDao.class);
            dao.upsert(entry(10, 10, new BigDecimal("3.0000"), 20, "{\"v\":2}", "2026-01-02 00:00:00"));
            dao.upsert(entry(10, 10, new BigDecimal("3.0000"), 20, "{\"v\":2}", "2026-01-02 00:00:00"));
            session.commit();
        }

        JdbcTemplate jdbc = new JdbcTemplate(ds);
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM dispatch_ai_usage", Integer.class));
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT input_tokens, credits, total_tokens, usage_at FROM dispatch_ai_usage");
        assertEquals(10L, row.get("input_tokens"));
        assertEquals(0, new BigDecimal("3.0000").compareTo((BigDecimal) row.get("credits")));
        assertEquals(20L, row.get("total_tokens"));
        assertEquals(Timestamp.valueOf("2026-01-02 00:00:00"), row.get("usage_at"));
    }

    @Test
    void missingCreditsStayNullWhenNeitherSnapshotReportsThem() throws Exception {
        DriverManagerDataSource ds = newDataSource();
        try (SqlSession session = openSession(ds)) {
            DispatchAiUsageDao dao = session.getMapper(DispatchAiUsageDao.class);
            dao.upsert(entry(1, 1, null, 2, null, "2026-01-01 00:00:00"));
            dao.upsert(entry(2, 2, null, 4, null, "2026-01-02 00:00:00"));
            session.commit();
        }

        Map<String, Object> row = new JdbcTemplate(ds).queryForMap(
                "SELECT credits, total_tokens FROM dispatch_ai_usage");
        assertNull(row.get("credits"));
        assertEquals(4L, row.get("total_tokens"));
    }

    private DispatchAiUsageDO entry(long inputTokens, long outputTokens, BigDecimal credits,
                                    long totalTokens, String rawJson, String usageAt) {
        DispatchAiUsageDO usage = new DispatchAiUsageDO();
        usage.setTenantId(10L);
        usage.setWorkitemId(20L);
        usage.setDispatchId(99L);
        usage.setAgentId(30L);
        usage.setExecutorId(40L);
        usage.setStepId("400165");
        usage.setProvider("qoder");
        usage.setModel("auto");
        usage.setInputTokens(inputTokens);
        usage.setOutputTokens(outputTokens);
        usage.setCacheReadTokens(0L);
        usage.setCacheWriteTokens(0L);
        usage.setReasoningTokens(0L);
        usage.setCredits(credits);
        usage.setTotalTokens(totalTokens);
        usage.setRawJson(rawJson);
        usage.setUsageAt(Timestamp.valueOf(usageAt));
        return usage;
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
