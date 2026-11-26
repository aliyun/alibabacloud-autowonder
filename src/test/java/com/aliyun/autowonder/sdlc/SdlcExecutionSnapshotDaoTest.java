package com.aliyun.autowonder.sdlc;

import com.aliyun.autowonder.dispatch.DispatchDO;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class SdlcExecutionSnapshotDaoTest {
    @Test
    void deduplicatesWithinOneTenantAndWorkflowAndNeverLetsRecoveryOverwriteCapture() {
        var ds = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
        var jdbc = new JdbcTemplate(ds);
        jdbc.execute("CREATE TABLE sdlc_execution_snapshot(id BIGINT AUTO_INCREMENT PRIMARY KEY,workspace_id BIGINT,sdlc_id BIGINT,"
                + "content_hash VARCHAR(64),configuration_json VARCHAR,gmt_create TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(workspace_id,sdlc_id,content_hash))");
        jdbc.execute("CREATE TABLE dispatch_sdlc_snapshot(workspace_id BIGINT,dispatch_id BIGINT,snapshot_id BIGINT,package_sha256 VARCHAR,source VARCHAR,PRIMARY KEY(workspace_id,dispatch_id))");
        jdbc.execute("CREATE TABLE dispatch(id BIGINT,tenant_id BIGINT,status VARCHAR,version INT,package_oss_ref VARCHAR,is_deleted INT)");
        jdbc.execute("INSERT INTO dispatch VALUES (1,9,'SUCCEEDED',3,'package-ref',0)");
        var dispatch = new DispatchDO();
        dispatch.setId(1L); dispatch.setTenantId(9L); dispatch.setVersion(3);
        dispatch.setWorkitemId(100L);
        jdbc.execute("CREATE TABLE dispatch_workflow_snapshot(tenant_id BIGINT,dispatch_id BIGINT,workitem_id BIGINT,snapshot_sha256 VARCHAR,gmt_create TIMESTAMP)");
        jdbc.execute("INSERT INTO dispatch_workflow_snapshot VALUES (9,1,100,'frozen','2026-10-22 10:00:00')");
        dispatch.setStatus("SUCCEEDED"); dispatch.setPackageOssRef("package-ref");
        var config = new Configuration(new Environment("test", new JdbcTransactionFactory(), ds));
        config.setMapUnderscoreToCamelCase(true); config.addMapper(SdlcExecutionSnapshotDao.class);
        try (var session = new SqlSessionFactoryBuilder().build(config).openSession(true)) {
            var dao = session.getMapper(SdlcExecutionSnapshotDao.class);
            assertEquals("frozen", dao.frozenWorkflowHash(dispatch, java.sql.Timestamp.valueOf("2026-10-22 10:00:01")));
            assertNull(dao.frozenWorkflowHash(dispatch, java.sql.Timestamp.valueOf("2026-10-22 09:59:59")));
            var snapshot = SdlcExecutionSnapshot.from(9, 5, Map.of("steps", List.of(Map.of("id", "10", "name", "用户内容"))));
            var measured = SdlcExecutionSnapshot.from(9, 5, Map.of("stageTimingEnabled", true,
                    "steps", List.of(Map.of("id", "10", "name", "用户内容"))));
            assertEquals(snapshot.getContentHash(), measured.getContentHash());
            dao.insert(snapshot); dao.insert(measured);
            var saved = dao.find(9, 5, snapshot.getContentHash());
            assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM sdlc_execution_snapshot", Integer.class));
            assertEquals(snapshot.getConfigurationJson(), saved.getConfigurationJson());
            assertNotNull(saved.getGmtCreate());
            assertNull(dao.find(99, 5, snapshot.getContentHash()));
            assertNull(dao.find(9, 6, snapshot.getContentHash()));
            for (String changed : List.of("version=4", "package_oss_ref='new-ref'", "status='FAILED'", "status='RUNNING'", "is_deleted=1")) {
                jdbc.execute("UPDATE dispatch SET " + changed);
                assertEquals(0, dao.recover(dispatch, saved.getId(), "stale", "RECOVERED_FROZEN"), changed);
                jdbc.execute("UPDATE dispatch SET version=3,package_oss_ref='package-ref',status='SUCCEEDED',is_deleted=0");
            }
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM dispatch_sdlc_snapshot", Integer.class));
            jdbc.execute("INSERT INTO dispatch_sdlc_snapshot VALUES (9,1,99,'previous','RECOVERED')");
            assertFalse(dao.hasVerifiedBinding(9, 1));
            dao.recover(dispatch, null, null, "UNVERIFIED");
            assertNull(jdbc.queryForObject("SELECT snapshot_id FROM dispatch_sdlc_snapshot", Long.class));
            dao.recover(dispatch, saved.getId(), "restored", "RECOVERED_FROZEN");
            assertEquals("RECOVERED_FROZEN", jdbc.queryForObject("SELECT source FROM dispatch_sdlc_snapshot WHERE workspace_id=9 AND dispatch_id=1", String.class));
            assertEquals(saved.getId(), jdbc.queryForObject("SELECT snapshot_id FROM dispatch_sdlc_snapshot WHERE workspace_id=9 AND dispatch_id=1", Long.class));
            jdbc.execute("UPDATE dispatch SET status='DISPATCHED'");
            dao.capture(9, 1, saved.getId(), "captured", 3, "package-ref");
            assertTrue(dao.hasVerifiedBinding(9, 1));
            assertFalse(dao.hasVerifiedBinding(99, 1));
            assertEquals(0, dao.capture(9, 1, saved.getId() + 1, "loser", 2, "package-ref"));
            assertEquals(0, dao.capture(9, 1, saved.getId() + 1, "wrong-package", 3, "other-ref"));
            jdbc.execute("UPDATE dispatch SET status='RUNNING'");
            assertEquals(0, dao.capture(9, 1, saved.getId() + 1, "late", 3, "package-ref"));
            jdbc.execute("UPDATE dispatch SET status='SUCCEEDED'");
            dao.recover(dispatch, null, null, "UNVERIFIED");
            dao.recover(dispatch, saved.getId() + 1, "late-recovery", "RECOVERED_FROZEN");
            var binding = jdbc.queryForMap("SELECT * FROM dispatch_sdlc_snapshot WHERE workspace_id=9 AND dispatch_id=1");
            assertEquals(saved.getId(), binding.get("SNAPSHOT_ID"));
            assertEquals("CAPTURED", binding.get("SOURCE"));
            assertEquals("captured", binding.get("PACKAGE_SHA256"));
            dispatch.setTenantId(99L);
            assertEquals(0, dao.recover(dispatch, null, null, "UNAVAILABLE"));
            assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM dispatch_sdlc_snapshot", Integer.class));
        }
    }
}
