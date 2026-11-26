package com.aliyun.autowonder.office;

import com.aliyun.autowonder.dispatch.DispatchStatus;
import com.aliyun.autowonder.executor.ExecutorDO;
import com.aliyun.autowonder.executor.ExecutorDao;
import com.aliyun.autowonder.executor.ExecutorDispatchSnapshot;
import com.aliyun.autowonder.executor.ExecutorRegistry;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.json.JSONObject;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * Projects the office from durable business records. Redis is consulted only for current executor
 * presence/inventory; it is never the event source, so reconnects and multi-node delivery cannot
 * make a real assignment, handoff or delivery disappear.
 */
@Service
public class OfficeActivityService {
    private static final long HISTORY_MILLIS = Duration.ofHours(24).toMillis();
    private static final int HISTORY_LIMIT = 200;
    private static final Set<String> WORKING = Set.of(
            DispatchStatus.RUNNING, DispatchStatus.PAUSING, DispatchStatus.WAITING_FOR_PAUSE,
            DispatchStatus.PAUSE_FAILED);
    private static final Set<String> PREPARING = Set.of(
            DispatchStatus.PENDING, DispatchStatus.PACKAGING, DispatchStatus.DISPATCHED, DispatchStatus.ACKED);
    private static final Set<String> PAUSED = Set.of(DispatchStatus.PAUSED);
    private final JdbcTemplate jdbc;
    private final ExecutorDao executors;
    private final ExecutorRegistry registry;

    public OfficeActivityService(JdbcTemplate jdbc, ExecutorDao executors, ExecutorRegistry registry) {
        this.jdbc = jdbc;
        this.executors = executors;
        this.registry = registry;
    }

    public OfficeActivitySnapshotVO snapshot(long workspaceId) {
        long now = System.currentTimeMillis();
        Timestamp cutoff = new Timestamp(now - HISTORY_MILLIS);
        List<OfficeActivityEventVO> events = new ArrayList<>();
        events.addAll(workitemEvents(workspaceId, cutoff));
        events.addAll(dispatchEvents(workspaceId, cutoff));
        events.addAll(requestEvents(workspaceId, cutoff));
        events.sort(Comparator.comparingLong(OfficeActivityEventVO::occurredAt)
                .thenComparing(OfficeActivityEventVO::id));
        if (events.size() > HISTORY_LIMIT) {
            events = new ArrayList<>(events.subList(events.size() - HISTORY_LIMIT, events.size()));
        }
        return new OfficeActivitySnapshotVO(now, List.copyOf(events), agentStates(workspaceId));
    }

    private List<OfficeActivityEventVO> workitemEvents(long workspaceId, Timestamp cutoff) {
        String sql = "SELECT e.id,e.workitem_id,w.title,e.event_type,e.from_val,e.to_val,"
                + "e.actor_type,e.actor_ref,e.detail_json,e.gmt_create,sn.category target_category "
                + "FROM workitem_event e JOIN workitem w ON w.id=e.workitem_id AND w.tenant_id=e.tenant_id "
                + "LEFT JOIN status_node sn ON sn.tenant_id=e.tenant_id AND sn.template_id=w.template_id "
                + "AND sn.code=e.to_val WHERE e.tenant_id=? AND w.is_deleted=0 AND e.gmt_create>=? "
                + "AND e.event_type IN ('CREATE','ASSIGN','STATUS_CHANGE') ORDER BY e.id DESC LIMIT "
                + HISTORY_LIMIT;
        List<OfficeActivityEventVO> result = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList(sql, workspaceId, cutoff)) {
            long eventId = number(row.get("id")).longValue();
            long workitemId = number(row.get("workitem_id")).longValue();
            String eventType = string(row.get("event_type"));
            String actorType = string(row.get("actor_type"));
            Long actorRef = longOrNull(row.get("actor_ref"));
            long occurredAt = epoch(row.get("gmt_create"));
            String title = string(row.get("title"));
            if ("CREATE".equals(eventType)) {
                result.add(event("workitem-event:" + eventId, "WORKITEM_CREATED", workitemId, title,
                        null, null, null, actorType, actorRef, null, occurredAt));
                continue;
            }
            if ("ASSIGN".equals(eventType)) {
                JSONObject detail = parseObject(row.get("detail_json"));
                String fromType = detail == null ? null : detail.getString("fromType");
                String toType = detail == null ? null : detail.getString("toType");
                Long sourceAgentId = "AGENT".equals(fromType) ? parseLong(row.get("from_val")) : null;
                Long targetAgentId = "AGENT".equals(toType) ? parseLong(row.get("to_val")) : null;
                if (targetAgentId != null) {
                    boolean handoff = sourceAgentId != null && !Objects.equals(sourceAgentId, targetAgentId);
                    result.add(event("workitem-event:" + eventId,
                            handoff ? "AGENT_HANDOFF" : "AGENT_ASSIGNED", workitemId, title,
                            null, sourceAgentId, targetAgentId, actorType, actorRef, null, occurredAt));
                }
                continue;
            }
            if ("STATUS_CHANGE".equals(eventType)
                    && "DONE".equalsIgnoreCase(string(row.get("target_category")))) {
                result.add(event("workitem-event:" + eventId, "WORKITEM_DELIVERED", workitemId, title,
                        null, "AGENT".equals(actorType) ? actorRef : null, null,
                        actorType, actorRef, string(row.get("to_val")), occurredAt));
            }
        }
        return result;
    }

    private List<OfficeActivityEventVO> dispatchEvents(long workspaceId, Timestamp cutoff) {
        String sql = "SELECT d.id,d.workitem_id,w.title,d.agent_id,d.status,d.gmt_modified,"
                + "(SELECT MIN(COALESCE(re.event_time,re.gmt_create)) FROM dispatch_runtime_event re "
                + "WHERE re.tenant_id=d.tenant_id AND re.dispatch_id=d.id) started_at "
                + "FROM dispatch d JOIN workitem w ON w.id=d.workitem_id AND w.tenant_id=d.tenant_id "
                + "WHERE d.tenant_id=? AND d.is_deleted=0 AND (d.source_type='WORKITEM' OR d.source_type IS NULL) "
                + "AND d.gmt_modified>=? ORDER BY d.gmt_modified DESC LIMIT " + HISTORY_LIMIT;
        List<OfficeActivityEventVO> result = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList(sql, workspaceId, cutoff)) {
            long dispatchId = number(row.get("id")).longValue();
            long workitemId = number(row.get("workitem_id")).longValue();
            Long agentId = longOrNull(row.get("agent_id"));
            String status = string(row.get("status"));
            Object started = row.get("started_at");
            if (started != null || dispatchStarted(status)) {
                result.add(event("dispatch:" + dispatchId + ":started", "DISPATCH_STARTED",
                        workitemId, string(row.get("title")), dispatchId, null, agentId,
                        "AGENT", agentId, status, epoch(started != null ? started : row.get("gmt_modified"))));
            }
            if (DispatchStatus.SUCCEEDED.equals(status)) {
                result.add(event("dispatch:" + dispatchId + ":succeeded", "STEP_COMPLETED",
                        workitemId, string(row.get("title")), dispatchId, agentId, null,
                        "AGENT", agentId, status, epoch(row.get("gmt_modified"))));
            }
        }
        return result;
    }

    private List<OfficeActivityEventVO> requestEvents(long workspaceId, Timestamp cutoff) {
        String sql = "SELECT r.id,r.dispatch_id,r.status,r.gmt_create,r.gmt_modified,"
                + "d.workitem_id,d.agent_id,w.title FROM dispatch_request r "
                + "JOIN dispatch d ON d.id=r.dispatch_id AND d.tenant_id=r.tenant_id "
                + "JOIN workitem w ON w.id=d.workitem_id AND w.tenant_id=d.tenant_id "
                + "WHERE r.tenant_id=? AND r.kind IN ('INPUT','APPROVAL') AND d.is_deleted=0 "
                + "AND (r.gmt_create>=? OR r.gmt_modified>=?) ORDER BY r.id DESC LIMIT " + HISTORY_LIMIT;
        List<OfficeActivityEventVO> result = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList(sql, workspaceId, cutoff, cutoff)) {
            long requestId = number(row.get("id")).longValue();
            long dispatchId = number(row.get("dispatch_id")).longValue();
            long workitemId = number(row.get("workitem_id")).longValue();
            Long agentId = longOrNull(row.get("agent_id"));
            String status = string(row.get("status"));
            result.add(event("request:" + requestId + ":requested", "HITL_REQUESTED",
                    workitemId, string(row.get("title")), dispatchId, agentId, null,
                    "AGENT", agentId, "PENDING", epoch(row.get("gmt_create"))));
            if (!"PENDING".equals(status)) {
                result.add(event("request:" + requestId + ":" + status.toLowerCase(Locale.ROOT),
                        "HITL_RESOLVED", workitemId, string(row.get("title")), dispatchId,
                        agentId, null, "HUMAN", null, status, epoch(row.get("gmt_modified"))));
            }
        }
        return result;
    }

    private List<OfficeAgentStateVO> agentStates(long workspaceId) {
        Map<Long, AgentFacts> facts = new LinkedHashMap<>();
        for (ExecutorDO executor : executors.listAll(workspaceId, null)) {
            if (executor.getAgentId() == null || executor.getId() == null) continue;
            AgentFacts agent = facts.computeIfAbsent(executor.getAgentId(), ignored -> new AgentFacts());
            Optional<ExecutorDispatchSnapshot> snapshot = registry.currentDispatchSnapshot(executor.getId());
            boolean online = registry.isOnline(executor.getId()) && snapshot.isPresent();
            agent.online |= online;
            if (!online) continue;
            ExecutorDispatchSnapshot inventory = snapshot.orElseThrow();
            boolean ready = inventory.authoritativeInventory() && inventory.inventoryReady()
                    && inventory.inventoryError() == null;
            agent.inventoryKnown |= ready;
            agent.inventoryUnknown |= !ready;
            if (!inventory.runningDispatchIds().isEmpty() || !inventory.ownedDispatchIds().isEmpty()
                    || !inventory.runningConversationTurnIds().isEmpty()) {
                agent.runtimeBusy = true;
            }
        }

        String activeSql = "SELECT d.id,d.agent_id,d.workitem_id,d.status FROM dispatch d "
                + "WHERE d.tenant_id=? AND d.is_deleted=0 AND (d.source_type='WORKITEM' OR d.source_type IS NULL) "
                + "AND d.status IN ('PENDING','PACKAGING','DISPATCHED','ACKED','RUNNING','PAUSING',"
                + "'WAITING_FOR_PAUSE','PAUSED','PAUSE_FAILED')";
        for (Map<String, Object> row : jdbc.queryForList(activeSql, workspaceId)) {
            Long agentId = longOrNull(row.get("agent_id"));
            if (agentId == null) continue;
            AgentFacts agent = facts.computeIfAbsent(agentId, ignored -> new AgentFacts());
            String status = string(row.get("status"));
            agent.statuses.add(status);
            Long workitemId = longOrNull(row.get("workitem_id"));
            if (workitemId != null) agent.workitemIds.add(workitemId);
        }

        String waitingSql = "SELECT DISTINCT d.agent_id,d.workitem_id FROM dispatch_request r "
                + "JOIN dispatch d ON d.id=r.dispatch_id AND d.tenant_id=r.tenant_id "
                + "WHERE r.tenant_id=? AND r.kind IN ('INPUT','APPROVAL') AND r.status='PENDING' "
                + "AND (r.expires_at IS NULL OR r.expires_at>NOW()) AND d.is_deleted=0 "
                + "AND d.status IN ('ACKED','RUNNING')";
        for (Map<String, Object> row : jdbc.queryForList(waitingSql, workspaceId)) {
            Long agentId = longOrNull(row.get("agent_id"));
            if (agentId == null) continue;
            AgentFacts agent = facts.computeIfAbsent(agentId, ignored -> new AgentFacts());
            agent.waiting = true;
            Long workitemId = longOrNull(row.get("workitem_id"));
            if (workitemId != null) agent.workitemIds.add(workitemId);
        }

        return facts.entrySet().stream().map(entry -> {
            AgentFacts agent = entry.getValue();
            String state = classify(agent.waiting, agent.statuses, agent.runtimeBusy,
                    agent.online, agent.inventoryKnown, agent.inventoryUnknown);
            int runningTasks = ("WORKING".equals(state) || "WAITING".equals(state))
                    ? agent.workitemIds.size() : 0;
            if (agent.runtimeBusy && runningTasks == 0) runningTasks = 1;
            return new OfficeAgentStateVO(entry.getKey(), state, agent.online, runningTasks,
                    List.copyOf(agent.workitemIds));
        }).sorted(Comparator.comparingLong(OfficeAgentStateVO::agentId)).toList();
    }

    static String classify(boolean waiting, Set<String> statuses, boolean runtimeBusy,
            boolean online, boolean inventoryKnown, boolean inventoryUnknown) {
        if (waiting) return "WAITING";
        if (runtimeBusy || statuses.stream().anyMatch(WORKING::contains)) return "WORKING";
        if (statuses.stream().anyMatch(PREPARING::contains)) return "PREPARING";
        if (statuses.stream().anyMatch(PAUSED::contains)) return "PAUSED";
        if (online && inventoryKnown && !inventoryUnknown) return "IDLE";
        return "UNKNOWN";
    }

    private static boolean dispatchStarted(String status) {
        return status != null && !DispatchStatus.PENDING.equals(status)
                && !DispatchStatus.PACKAGING.equals(status) && !DispatchStatus.DISPATCHED.equals(status)
                && !DispatchStatus.ACKED.equals(status);
    }

    private static OfficeActivityEventVO event(String id, String type, long workitemId, String title,
            Long dispatchId, Long sourceAgentId, Long targetAgentId, String actorType, Long actorRef,
            String status, long occurredAt) {
        return new OfficeActivityEventVO(id, type, workitemId, title, dispatchId, sourceAgentId,
                targetAgentId, actorType, actorRef, status, occurredAt);
    }

    private static JSONObject parseObject(Object value) {
        if (value == null) return null;
        try { return JSON.parseObject(String.valueOf(value)); }
        catch (RuntimeException ignored) { return null; }
    }

    private static Long parseLong(Object value) {
        if (value == null) return null;
        try { return Long.parseLong(String.valueOf(value)); }
        catch (RuntimeException ignored) { return null; }
    }

    private static Number number(Object value) {
        if (value instanceof Number number) return number;
        return Long.parseLong(String.valueOf(value));
    }

    private static Long longOrNull(Object value) {
        return value == null ? null : number(value).longValue();
    }

    private static String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static long epoch(Object value) {
        if (value instanceof Date date) return date.getTime();
        if (value instanceof Number number) return number.longValue();
        return 0L;
    }

    private static final class AgentFacts {
        private boolean online;
        private boolean inventoryKnown;
        private boolean inventoryUnknown;
        private boolean runtimeBusy;
        private boolean waiting;
        private final Set<String> statuses = new LinkedHashSet<>();
        private final Set<Long> workitemIds = new LinkedHashSet<>();
    }
}
