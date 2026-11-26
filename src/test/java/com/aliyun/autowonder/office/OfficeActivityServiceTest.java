package com.aliyun.autowonder.office;

import com.aliyun.autowonder.dispatch.DispatchStatus;
import com.aliyun.autowonder.executor.ExecutorDao;
import com.aliyun.autowonder.executor.ExecutorRegistry;
import org.junit.jupiter.api.Test;
import org.mockito.stubbing.Answer;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Timestamp;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class OfficeActivityServiceTest {

    @Test
    void prioritizesHumanDecisionOverRuntimeWork() {
        assertEquals("WAITING", OfficeActivityService.classify(true,
                Set.of(DispatchStatus.RUNNING), true, true, true, false));
    }

    @Test
    void reflectsTheRealDispatchLifecycle() {
        assertEquals("PREPARING", OfficeActivityService.classify(false,
                Set.of(DispatchStatus.PACKAGING), false, true, true, false));
        assertEquals("WORKING", OfficeActivityService.classify(false,
                Set.of(DispatchStatus.RUNNING), false, true, true, false));
        assertEquals("PAUSED", OfficeActivityService.classify(false,
                Set.of(DispatchStatus.PAUSED), false, true, true, false));
        assertEquals("WORKING", OfficeActivityService.classify(false,
                Set.of(DispatchStatus.PAUSE_FAILED), false, true, true, false));
    }

    @Test
    void callsAnAgentRestingOnlyWhenTheOnlineInventoryProvesItIsEmpty() {
        assertEquals("IDLE", OfficeActivityService.classify(false,
                Set.of(), false, true, true, false));
        assertEquals("UNKNOWN", OfficeActivityService.classify(false,
                Set.of(), false, true, false, false));
        assertEquals("UNKNOWN", OfficeActivityService.classify(false,
                Set.of(), false, true, true, true));
        assertEquals("UNKNOWN", OfficeActivityService.classify(false,
                Set.of(), false, false, true, false));
    }

    @Test
    void runtimeInventoryCanProveWorkBeforeTheDatabaseStatusRefreshes() {
        assertEquals("WORKING", OfficeActivityService.classify(false,
                Set.of(), true, true, true, false));
    }

    @Test
    void projectsDurableBusinessRowsIntoExactOfficeEvents() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExecutorDao executors = mock(ExecutorDao.class);
        when(executors.listAll(2048L, null)).thenReturn(List.of());
        long base = System.currentTimeMillis() - 10_000;
        Timestamp createdAt = new Timestamp(base + 1_000);
        Timestamp assignedAt = new Timestamp(base + 2_000);
        Timestamp startedAt = new Timestamp(base + 3_000);
        Timestamp requestedAt = new Timestamp(base + 4_000);
        Timestamp resolvedAt = new Timestamp(base + 5_000);
        Timestamp deliveredAt = new Timestamp(base + 6_000);
        Answer<List<Map<String, Object>>> queryRows = invocation -> {
            String sql = invocation.getArgument(0);
            if (sql.contains("FROM workitem_event")) {
                return List.of(
                        row("id", 1L, "workitem_id", 21L, "title", "New request",
                                "event_type", "CREATE", "actor_type", "HUMAN", "actor_ref", 7L,
                                "gmt_create", createdAt),
                        row("id", 2L, "workitem_id", 21L, "title", "New request",
                                "event_type", "ASSIGN", "from_val", "11", "to_val", "12",
                                "detail_json", "{\"fromType\":\"AGENT\",\"toType\":\"AGENT\"}",
                                "actor_type", "HUMAN", "actor_ref", 7L, "gmt_create", assignedAt),
                        row("id", 3L, "workitem_id", 21L, "title", "New request",
                                "event_type", "STATUS_CHANGE", "to_val", "released",
                                "target_category", "DONE", "actor_type", "AGENT", "actor_ref", 12L,
                                "gmt_create", deliveredAt));
            }
            if (sql.startsWith("SELECT d.id,d.workitem_id")) {
                return List.of(row("id", 31L, "workitem_id", 21L, "title", "New request",
                        "agent_id", 12L, "status", DispatchStatus.RUNNING,
                        "started_at", startedAt, "gmt_modified", startedAt));
            }
            if (sql.startsWith("SELECT r.id,r.dispatch_id")) {
                return List.of(row("id", 41L, "dispatch_id", 31L, "workitem_id", 21L,
                        "title", "New request", "agent_id", 12L, "status", "RESOLVED",
                        "gmt_create", requestedAt, "gmt_modified", resolvedAt));
            }
            return List.of();
        };
        when(jdbc.queryForList(anyString(), anyLong(), any(Timestamp.class))).thenAnswer(queryRows);
        when(jdbc.queryForList(anyString(), anyLong(), any(Timestamp.class), any(Timestamp.class)))
                .thenAnswer(queryRows);

        OfficeActivitySnapshotVO snapshot = new OfficeActivityService(
                jdbc, executors, mock(ExecutorRegistry.class)).snapshot(2048L);

        assertEquals(List.of("WORKITEM_CREATED", "AGENT_HANDOFF", "DISPATCH_STARTED",
                        "HITL_REQUESTED", "HITL_RESOLVED", "WORKITEM_DELIVERED"),
                snapshot.events().stream().map(OfficeActivityEventVO::type).toList());
        OfficeActivityEventVO handoff = snapshot.events().get(1);
        assertEquals(11L, handoff.sourceAgentId());
        assertEquals(12L, handoff.targetAgentId());
        assertEquals("workitem-event:2", handoff.id());
    }

    private static Map<String, Object> row(Object... values) {
        Map<String, Object> row = new HashMap<>();
        for (int index = 0; index < values.length; index += 2) {
            row.put(String.valueOf(values[index]), values[index + 1]);
        }
        return row;
    }
}
