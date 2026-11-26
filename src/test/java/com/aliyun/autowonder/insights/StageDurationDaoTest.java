package com.aliyun.autowonder.insights;

import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

class StageDurationDaoTest {
    @Test
    void filtersWorkspaceSourceDateSquadAndHistoricalFlowInBothSchemas() throws Exception {
        for (String schema : List.of("autowonder-source-aware", "autowonder-legacy")) {
            var ds = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
            var jdbc = new JdbcTemplate(ds);
            jdbc.execute("CREATE TABLE workitem(id BIGINT,tenant_id BIGINT,title VARCHAR,is_deleted INT,status_node_id BIGINT)");
            jdbc.execute("CREATE TABLE status_node(id BIGINT,tenant_id BIGINT,category VARCHAR)");
            jdbc.execute("CREATE TABLE dispatch(id BIGINT,tenant_id BIGINT,workitem_id BIGINT,source_type VARCHAR,sdlc_step_id BIGINT,"
                    + "agent_version_id BIGINT,agent_id BIGINT,status VARCHAR,gmt_create TIMESTAMP,gmt_modified TIMESTAMP,is_deleted INT,package_oss_ref VARCHAR)");
            jdbc.execute("CREATE TABLE sdlc_step(id BIGINT,tenant_id BIGINT,sdlc_id BIGINT,is_deleted INT,name VARCHAR,step_order INT)");
            jdbc.execute("CREATE TABLE agent_version(id BIGINT,tenant_id BIGINT,agent_id BIGINT,sdlc_id BIGINT,version_no INT)");
            jdbc.execute("CREATE TABLE sdlc(id BIGINT,tenant_id BIGINT,name VARCHAR,is_deleted INT)");
            jdbc.execute("CREATE TABLE agent(id BIGINT,tenant_id BIGINT,name VARCHAR,online_version_id BIGINT)");
            jdbc.execute("CREATE TABLE squad(id BIGINT,tenant_id BIGINT,is_deleted INT)");
            jdbc.execute("CREATE TABLE squad_member(squad_id BIGINT,tenant_id BIGINT,agent_id BIGINT)");
            jdbc.execute("CREATE TABLE dispatch_runtime_event(id BIGINT,tenant_id BIGINT,dispatch_id BIGINT,step_id BIGINT,step_key VARCHAR,"
                    + "step_order INT,step_name VARCHAR,event_type VARCHAR,event_time TIMESTAMP,gmt_create TIMESTAMP,detail_json VARCHAR,error VARCHAR)");
            String insertEvent = "INSERT INTO dispatch_runtime_event (id,tenant_id,dispatch_id,step_id,step_key,step_order,step_name,"
                    + "event_type,event_time,gmt_create,detail_json) VALUES";
            jdbc.execute("CREATE TABLE sdlc_execution_snapshot(id BIGINT,workspace_id BIGINT,sdlc_id BIGINT,content_hash VARCHAR,configuration_json VARCHAR,gmt_create TIMESTAMP)");
            jdbc.execute("CREATE TABLE dispatch_sdlc_snapshot(workspace_id BIGINT,dispatch_id BIGINT,snapshot_id BIGINT,source VARCHAR)");
            jdbc.execute("INSERT INTO workitem VALUES (100,9,'Original 标题',0,NULL),(101,99,'Other workspace',0,NULL),(102,9,'Deleted',1,NULL)");
            jdbc.execute("INSERT INTO sdlc_step VALUES (10,9,5,1,'Existing stage',1),(11,99,6,0,'Other tenant stage',1)");
            jdbc.execute("INSERT INTO agent_version VALUES (1,9,7,6,1),(2,9,7,6,2),(3,99,7,6,99),(4,9,8,6,99)");
            jdbc.execute("INSERT INTO sdlc VALUES (5,9,'Historical workflow',0),(6,9,'Later workflow',0)");
            jdbc.execute("INSERT INTO agent VALUES (7,9,'User name',2)");
            jdbc.execute("INSERT INTO squad VALUES (8,9,0),(9,99,0)");
            jdbc.execute("INSERT INTO squad_member VALUES (8,9,7),(9,99,7)");
            for (int id = 1; id <= 7; id++) {
                long tenant = id == 3 ? 99 : 9, workitem = id == 3 ? 101 : id == 4 ? 102 : 100;
                String source = id == 2 ? "SCHEDULED_TASK_RUN" : "WORKITEM";
                String created = id == 5 ? "2026-01-08 00:00:00" : "2026-01-01 00:00:00";
                jdbc.update("INSERT INTO dispatch VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)", id, tenant, workitem, source,
                        id == 7 ? null : 10, id == 7 ? 2 : 1, 7, "SUCCEEDED", Timestamp.valueOf(created), Timestamp.valueOf(created), id == 6 ? 1 : 0);
            }
            jdbc.execute(insertEvent
                    + "(1,9,1,10,NULL,1,'Recorded stage','step.started',NULL,'2026-01-01 00:00:00',NULL),"
                    + "(2,99,1,10,NULL,1,'Other tenant','step.completed',NULL,'2026-01-01 00:01:00',NULL),"
                    + "(3,9,1,10,NULL,1,'Noise','tool.completed',NULL,'2026-01-01 00:01:00',NULL),"
                    + "(4,9,7,10,NULL,1,NULL,'step.started',NULL,'2026-01-01 00:00:00',NULL),"
                    + "(5,9,7,11,NULL,2,NULL,'step.completed',NULL,'2026-01-01 00:00:01',NULL),"
                    + "(6,9,1,10,NULL,1,NULL,'step.completed',NULL,'2026-01-01 00:00:02',NULL)");
            var config = new Configuration(new Environment("test", new JdbcTransactionFactory(), ds));
            config.setMapUnderscoreToCamelCase(true); config.setDatabaseId(schema);
            for (String name : List.of("DashboardDao", "StageDurationDao")) {
                try (var stream = Files.newInputStream(Path.of("src/main/resources/mapping/" + name + ".xml"))) {
                    new XMLMapperBuilder(stream, config, name, config.getSqlFragments()).parse();
                }
            }
            try (var session = new SqlSessionFactoryBuilder().build(config).openSession()) {
                var dao = session.getMapper(StageDurationDao.class);
                var start = Timestamp.valueOf("2026-01-01 00:00:00"); var end = Timestamp.valueOf("2026-01-08 00:00:00");
                var rows = dao.listExecutions(9, start, end, 8L, 5L, null, null, null, 5001, false, null);
                assertEquals(schema.endsWith("source-aware") ? 1 : 2, rows.size());
                assertEquals("Historical workflow", rows.getFirst().getSdlcName());
                assertEquals("Original 标题", rows.getFirst().getTitle());
                assertEquals(7L, rows.getFirst().getAgentId());
                assertEquals(10L, rows.getFirst().getSdlcStepId(), "Historical package recovery must verify the original entry step");
                assertEquals(1L, rows.getFirst().getAgentVersionId());
                assertEquals(1, rows.getFirst().getAgentVersionNo());
                assertFalse(rows.getFirst().isCurrentAgentVersion());
                assertEquals(0, dao.listExecutions(9, start, end, 9L, null, null, null, null, 5001, false, null).size());
                assertEquals(1, dao.listExecutions(9, start, end, 8L, 6L, null, null, null, 5001, false, null).size());
                var current = dao.listExecutions(9, start, end, 8L, 6L, null, null, null, 5001, false, null).getFirst();
                assertEquals(2L, current.getAgentVersionId());
                assertEquals(2, current.getAgentVersionNo());
                assertTrue(current.isCurrentAgentVersion());
                assertEquals(1, dao.listExecutions(9, start, end, null, null, null, null, null, 1, false, null).size());
                assertNotNull(dao.lastActivities(9, List.of(1L)).getFirst().getEventTime());
                assertTrue(dao.listEvents(9, List.of()).isEmpty());
                var events = dao.listEvents(9, List.of(1L));
                assertEquals(2, events.size());
                assertEquals("Recorded stage", events.getFirst().getStepName());
                assertNull(events.getFirst().getEventTime());
                assertNotNull(events.getFirst().getGmtCreate());
                assertEquals("Existing stage", events.getLast().getFallbackStepName());
                assertNull(events.getLast().getStepName());
                var both = dao.listEvents(9, List.of(7L, 1L));
                assertEquals(List.of(1L, 6L, 4L, 5L), both.stream().map(StageDurationService.Event::getId).toList());
                assertNull(both.getLast().getFallbackStepName());
                assertEquals(rows.size(), dao.listExecutions(9, start, end, 8L, 5L, 7L, 1L, "SUCCEEDED", 5001, false, null).size());
                assertTrue(dao.listExecutions(9, start, end, 8L, 5L, 7L, 2L, "SUCCEEDED", 5001, false, null).isEmpty());
                assertTrue(dao.listExecutions(9, start, end, 8L, 5L, 8L, 1L, "SUCCEEDED", 5001, false, null).isEmpty());
                assertTrue(dao.listExecutions(9, start, end, 8L, 5L, 7L, 1L, "FAILED", 5001, false, null).isEmpty());
                jdbc.execute(insertEvent + " (7,9,1,10,NULL,1,NULL,'step.timing',NULL,'2026-01-01 00:00:03','{\"timing\":{\"version\":1}}'),"
                        + "(8,9,1,NULL,NULL,NULL,NULL,'session.interrupted',NULL,'2026-01-01 00:00:04',NULL)");
                jdbc.execute("UPDATE dispatch_runtime_event SET detail_json = '{\"stepAttempt\":2}' WHERE id = 1");
                session.clearCache();
                jdbc.execute("UPDATE dispatch_runtime_event SET error = 'fixture failure' WHERE id = 8");
                var boundaries = dao.listEvents(9, List.of(1L));
                assertEquals(List.of("step.started", "step.completed", "step.timing", "session.interrupted"),
                        boundaries.stream().map(StageDurationService.Event::getEventType).toList());
                assertEquals("{\"stepAttempt\":2}", boundaries.getFirst().getDetailJson(),
                        "step.started keeps stepAttempt so a pause followed by a new attempt is not counted as work");
                assertNull(boundaries.get(1).getDetailJson(), "Only step.timing and step.started keep detail_json");
                assertNotNull(boundaries.get(2).getDetailJson());
                assertEquals("fixture failure", boundaries.getLast().getError());
                jdbc.execute(insertEvent + " (90,9,1,10,NULL,1,NULL,'step.timing',NULL,'2026-01-01 12:00:00',NULL),"
                        + "(91,9,1,10,NULL,1,NULL,'skill.invoked',NULL,'2026-01-01 00:00:06',NULL)");
                session.clearCache();
                var observed = dao.lastActivities(9, List.of(1L)).getFirst();
                assertEquals(Timestamp.valueOf("2026-01-01 00:00:06").getTime(), observed.getEventTime().getTime());
                jdbc.execute(insertEvent + " (92,9,1,10,NULL,1,NULL,'context.compact_completed',NULL,'2026-01-01 00:00:08',NULL)");
                session.clearCache();
                assertEquals(Timestamp.valueOf("2026-01-01 00:00:08").getTime(), dao.lastActivities(9, List.of(1L)).getFirst().getEventTime().getTime());
                jdbc.execute(insertEvent + " (94,9,1,10,NULL,1,NULL,'runtime.failed',NULL,'2026-01-01 00:00:09',NULL)");
                session.clearCache();
                assertEquals(Timestamp.valueOf("2026-01-01 00:00:09").getTime(), dao.lastActivities(9, List.of(1L)).getFirst().getEventTime().getTime());
                jdbc.execute("DELETE FROM dispatch_runtime_event WHERE id=94");
                jdbc.execute(insertEvent + " (93,9,1,NULL,NULL,NULL,NULL,'dispatch.executor_failover',NULL,'2026-01-01 00:00:10',NULL)");
                session.clearCache();
                assertEquals("dispatch.executor_failover", dao.listEvents(9, List.of(1L)).getLast().getEventType());
                assertEquals(Timestamp.valueOf("2026-01-01 00:00:10").getTime(), dao.lastActivities(9, List.of(1L)).getFirst().getEventTime().getTime());
                jdbc.execute("DELETE FROM dispatch_runtime_event WHERE id=93");
                session.clearCache();
                assertEquals(List.of("7"), dao.listWorkers(9, false).stream().map(com.aliyun.autowonder.insights.dto.InsightWorkerVO::getId).toList());
                jdbc.execute("DELETE FROM agent WHERE id=7 AND tenant_id=9");
                session.clearCache();
                assertEquals(List.of("7"), dao.listWorkers(9, false).stream().map(com.aliyun.autowonder.insights.dto.InsightWorkerVO::getId).toList());
                assertNull(dao.listWorkers(9, false).getFirst().getName());
                assertTrue(dao.listWorkers(88, false).isEmpty());
                jdbc.execute("INSERT INTO agent VALUES (7,9,'User name',2)");
                session.clearCache();
                for (Long versionId : java.util.Arrays.asList(3L, 4L, 999L, null)) {
                    jdbc.update("UPDATE dispatch SET agent_version_id = ? WHERE id = 1", versionId);
                    session.clearCache();
                    var historical = dao.listExecutions(9, start, end, 8L, 5L, null, null, null, 5001, false, null).stream()
                            .filter(e -> e.getId() == 1L).findFirst().orElseThrow();
                    assertEquals(versionId, historical.getAgentVersionId());
                    assertNull(historical.getAgentVersionNo(), "Must not borrow another tenant/worker's or the current version");
                    assertFalse(historical.isCurrentAgentVersion());
                }
                jdbc.execute("INSERT INTO status_node VALUES (20,9,'IN_PROGRESS'),(21,9,'CANCELED'),(22,9,'canceled'),(23,99,'CANCELED')");
                jdbc.execute("INSERT INTO workitem VALUES (103,9,'Canceled after completion',0,21),(104,9,'Another canceled workitem',0,22)");
                jdbc.execute("UPDATE workitem SET status_node_id = 23 WHERE id = 100");
                jdbc.execute("UPDATE dispatch SET agent_version_id = 1, status = 'CANCELED' WHERE id = 1");
                for (int id = 8; id <= 10; id++) {
                    jdbc.update("INSERT INTO dispatch VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)", id, 9, id == 10 ? 104 : 103,
                            "WORKITEM", 10, id == 9 ? 2 : 1, 7, "SUCCEEDED",
                            Timestamp.valueOf("2026-01-02 00:00:00"), Timestamp.valueOf("2026-01-02 00:01:00"), 0);
                    jdbc.update(insertEvent + " (?,?,?,?,?,?,?,?,?,?,NULL)", id * 2, 9, id, 10, null,
                            1, "Recorded stage", "step.started", null, Timestamp.valueOf("2026-01-02 00:00:00"));
                    jdbc.update(insertEvent + " (?,?,?,?,?,?,?,?,?,?,NULL)", id * 2 + 1, 9, id, 10, null,
                            1, "Recorded stage", "step.completed", null, Timestamp.valueOf("2026-01-02 00:01:00"));
                }
                session.clearCache();
                assertEquals(schema.endsWith("source-aware") ? 1L : 2L,
                        dao.listExecutions(9, start, end, 8L, 5L, null, null, null, 1, true, null).getFirst().getId(),
                        "Canceled workitems must be excluded before the sample limit");
                var service = new StageDurationService(dao);
                var inclusive = service.get(9, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 7), 8L, 5L, "stage", null);
                assertEquals(182000, inclusive.getTotalDurationMs(), "Workspace totals retain work already done on canceled items");
                assertEquals(10L, dao.listExecutions(9, start, end, 8L, 5L, null, null, null, 1, false, null).getFirst().getId());
                assertEquals(10L, dao.listVersionExecutions(9, 7, 1, start, end, 1, false).getFirst().getId());
                assertEquals(schema.endsWith("source-aware") ? 1L : 2L, dao.listVersionExecutions(9, 7, 1, start, end, 1, true).getFirst().getId());
                for (String groupBy : List.of("stage", "agent_version")) {
                    var report = service.get(9, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 7), 8L, 5L, groupBy, null, null, null, true);
                    assertEquals(schema.endsWith("source-aware") ? 1 : 2, report.getExecutionCount());
                    assertEquals(1, report.getWorkitemCount());
                    assertEquals(1, report.getMeasuredExecutionCount());
                    assertEquals(2000, report.getTotalDurationMs());
                    assertEquals(1, report.getStages().size());
                    var stage = report.getStages().getFirst();
                    assertEquals(1, stage.getSampleCount());
                    assertEquals(2000, stage.getTotalDurationMs());
                    assertEquals(2000L, stage.getAverageDurationMs());
                    assertEquals(2000L, stage.getMedianDurationMs());
                    assertEquals(2000L, stage.getP90DurationMs());
                    assertEquals(List.of(1L), stage.getSlowest().stream().map(s -> s.getDispatchId()).toList(),
                            "Canceling an attempt alone must not exclude a workitem or borrow another tenant's status");
                }
                jdbc.execute("UPDATE workitem SET status_node_id = 20 WHERE id = 103");
                session.clearCache();
                var reopened = service.get(9, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 7), 8L, 5L, "agent_version", null, null, null, true);
                assertEquals(122000, reopened.getTotalDurationMs(), "Reopened workitems use their existing timing history");
                assertEquals(2, reopened.getStages().size());
                jdbc.execute("INSERT INTO sdlc_execution_snapshot VALUES (40,9,5,'own','{}','2026-01-01 00:00:00'),(41,99,6,'foreign','{}','2026-01-01 00:00:00')");
                jdbc.execute("INSERT INTO dispatch_sdlc_snapshot VALUES (9,7,40,'CAPTURED'),(99,1,41,'CAPTURED')");
                jdbc.execute("INSERT INTO sdlc_step VALUES (12,9,5,0,'Current stage',2),(13,9,6,0,'Removed flow stage',1)");
                jdbc.execute("UPDATE sdlc SET is_deleted=1 WHERE id=6 AND tenant_id=9");
                session.clearCache();
                var captured = dao.listExecutions(9, start, end, 8L, 5L, null, null, null, 5001, false, null).stream().filter(row -> row.getId() == 7L).findFirst().orElseThrow();
                assertEquals(40L, captured.getSnapshotId(), "Frozen flow identity wins over a later agent-version binding");
                assertEquals("CAPTURED", captured.getSnapshotSource());
                jdbc.execute("UPDATE dispatch_sdlc_snapshot SET source='RECOVERED_FROZEN' WHERE workspace_id=9 AND dispatch_id=7");
                session.clearCache();
                var recovered = dao.listExecutions(9, start, end, 8L, 5L, null, null, null, 5001, false, null).stream().filter(row -> row.getId() == 7L).findFirst().orElseThrow();
                assertEquals(40L, recovered.getSnapshotId());
                assertEquals("RECOVERED", recovered.getSnapshotSource());
                assertEquals(List.of(40L), dao.listSnapshots(9, List.of(40L, 41L)).stream().map(com.aliyun.autowonder.sdlc.SdlcExecutionSnapshot::getId).toList());
                assertEquals(List.of(12L), dao.listCurrentSteps(9, List.of(5L, 6L)).stream().map(com.aliyun.autowonder.sdlc.SdlcStepDO::getId).toList());
                assertEquals(2, dao.firstEvents(9, List.of(1L, 7L)).size());
                jdbc.execute("UPDATE dispatch_runtime_event SET event_time='2025-12-31 23:59:59' WHERE id=1");
                jdbc.execute("UPDATE dispatch_runtime_event SET event_time='2026-01-02 00:00:00' WHERE id=4");
                session.clearCache();
                var first = dao.firstEvents(9, List.of(1L, 7L));
                assertEquals(Timestamp.valueOf("2025-12-31 23:59:59").getTime(), first.stream().filter(e -> e.getDispatchId() == 1).findFirst().orElseThrow().getGmtCreate().getTime());
                assertEquals(start.getTime(), first.stream().filter(e -> e.getDispatchId() == 7).findFirst().orElseThrow().getGmtCreate().getTime());
                jdbc.execute("UPDATE dispatch_sdlc_snapshot SET snapshot_id=41 WHERE workspace_id=9 AND dispatch_id=7");
                session.clearCache();
                assertNull(dao.listExecutions(9, start, end, 8L, 6L, null, null, null, 5001, false, null).getFirst().getSnapshotId(), "Cross-tenant snapshots cannot be read through a foreign binding");
                jdbc.execute("INSERT INTO agent_version VALUES (777,9,7,5,77)");
                for (int id = 1000; id < 1035; id++) {
                    jdbc.update("INSERT INTO dispatch VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)", id, 9, 100, "WORKITEM", 10,
                            777, 7, "FAILED", Timestamp.valueOf("2020-01-01 00:00:00"), Timestamp.valueOf("2020-01-01 00:00:01"), 0);
                }
                jdbc.execute("INSERT INTO dispatch VALUES (9999,9,104,'WORKITEM',10,777,7,'SUCCEEDED','2026-01-01','2026-01-01',0,NULL),"
                        + "(9998,9,100,'WORKITEM',10,777,8,'SUCCEEDED','2026-01-01','2026-01-01',0,NULL),"
                        + "(9997,99,101,'WORKITEM',10,777,7,'SUCCEEDED','2026-01-01','2026-01-01',0,NULL)");
                session.clearCache();
                assertEquals(9999L, dao.listVersionExecutions(9, 7, 777, null, null, 30, false).getFirst().getId());
                assertEquals(36, dao.listAgentVersions(9, 7, false).stream().filter(v -> v.getAgentVersionId() == 777L).findFirst().orElseThrow().getExecutionCount());
                var cohort = dao.listVersionExecutions(9, 7, 777, null, null, 30, true);
                assertEquals(30, cohort.size(), "Take the most recent executions before deciding which stages are measurable");
                assertEquals(1034L, cohort.getFirst().getId());
                assertEquals(1005L, cohort.getLast().getId(), "Same-time executions use stable descending IDs");
                assertTrue(cohort.stream().allMatch(row -> row.getStatus().equals("FAILED")));
                assertEquals(35, dao.listAgentVersions(9, 7, true).stream().filter(v -> v.getAgentVersionId() == 777L)
                        .findFirst().orElseThrow().getExecutionCount());
                assertTrue(dao.listVersionExecutions(9, 7, 777, start, end, 30, true).isEmpty(),
                        "Dates must not fall back to out-of-range executions");
                for (int id = 2000; id < 2035; id++) {
                    jdbc.update("INSERT INTO dispatch VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)", id, 9, 100, "WORKITEM", 10,
                            777, 7, "FAILED", Timestamp.valueOf("2026-01-01 00:00:00"), Timestamp.valueOf("2026-01-01 00:00:01"), 0);
                }
                jdbc.execute("INSERT INTO dispatch VALUES (3000,9,100,'WORKITEM',10,777,7,'SUCCEEDED','2026-01-08','2026-01-08',0,NULL)");
                session.clearCache();
                var scoped = dao.listVersionExecutions(9, 7, 777, start, end, 30, true);
                assertEquals(30, scoped.size());
                assertEquals(2034L, scoped.getFirst().getId(), "Exclude the upper boundary before LIMIT");
                assertEquals(2005L, scoped.getLast().getId(), "Include the lower boundary with stable descending IDs");
                assertEquals(List.of(3000L), dao.listVersionExecutions(9, 7, 777, end, Timestamp.valueOf("2026-01-09 00:00:00"), 30, true)
                        .stream().map(StageDurationService.Execution::getId).toList());
                assertTrue(dao.listVersionExecutions(9, 7, 999, null, null, 30, true).isEmpty());
                assertTrue(dao.listExecutions(9, start, end, null, null, 999L, null, null, 5001, false, null).isEmpty());
                // Thousands of newer ineligible executions must not hide older recoverable packages.
                jdbc.execute("UPDATE dispatch SET package_oss_ref='bucket/9/100/archive.zip' WHERE id BETWEEN 2000 AND 2034");
                jdbc.execute("INSERT INTO dispatch SELECT X+20000,9,100,'WORKITEM',10,777,7,'RUNNING','2026-01-07','2026-01-07',0,NULL FROM SYSTEM_RANGE(1,5002)");
                jdbc.execute("INSERT INTO dispatch_sdlc_snapshot VALUES (9,2034,40,'CAPTURED'),(9,2033,40,'RECOVERED'),(9,2032,NULL,'UNAVAILABLE')");
                jdbc.execute("ALTER TABLE dispatch ADD version INT DEFAULT 3");
                session.clearCache();
                var recovery = dao.listRecoverableExecutions(9, start, end, 8L, 5L, null);
                assertEquals(20, recovery.size());
                assertEquals(2033L, recovery.getFirst().getId());
                assertEquals(3, recovery.getFirst().getVersion());
                assertEquals(2014L, recovery.getLast().getId());
                assertEquals(34, dao.countRecoverableExecutions(9, start, end, 8L, 5L, null));
                var older = dao.listRecoverableExecutions(9, start, end, 8L, 5L, 2014L);
                assertEquals(14, older.size());
                assertEquals(2013L, older.getFirst().getId());
                assertEquals(2000L, older.getLast().getId());
                assertEquals(0, dao.countRecoverableExecutions(99, start, end, 8L, 5L, null));

            }
        }
    }
}
