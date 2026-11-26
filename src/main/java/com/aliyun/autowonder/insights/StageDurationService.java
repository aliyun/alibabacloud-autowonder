package com.aliyun.autowonder.insights;

import com.aliyun.autowonder.common.error.KeyedIllegalArgumentException;
import com.aliyun.autowonder.dispatch.DispatchDO;
import com.aliyun.autowonder.dispatch.DispatchRuntimeEventDO;
import com.aliyun.autowonder.dispatch.DispatchStatus;
import com.aliyun.autowonder.insights.dto.StageDurationPlanVO;
import com.aliyun.autowonder.insights.dto.StageDurationVO;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.sdlc.SdlcExecutionSnapshot;
import com.aliyun.autowonder.sdlc.SdlcExecutionSnapshotService;
import com.aliyun.autowonder.sdlc.SdlcStepDO;
import com.aliyun.autowonder.workitem.DispatchStepTimings;
import com.aliyun.autowonder.workitem.dto.StepTimingVO;
import lombok.Getter;
import lombok.Setter;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
public class StageDurationService {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(StageDurationService.class);
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    // shortcut: aggregate at most 5000 executions in memory; use persisted facts when larger ranges are needed.
    private static final int MAX_EXECUTIONS = 5000;
    private static final int EVENT_BATCH_SIZE = 100;
    private static final int VERSION_SAMPLE_LIMIT = 30;
    // Below this size one request finishes comfortably, so splitting only multiplies round trips.
    private static final int SINGLE_REQUEST_EXECUTIONS = 200;
    // Marked, never split: stage percentages cannot be merged across shards.
    private static final int OVERSIZED_SHARD_EXECUTIONS = 500;
    private static final Set<String> STATUS_FILTERS = Set.of("PENDING", "PACKAGING", "DISPATCHED", "ACKED", "RUNNING",
            "PAUSING", "PAUSED", "PAUSE_FAILED", "WAITING_FOR_PAUSE", "SUCCEEDED", "FAILED", "TIMEOUT", "CANCELED");
    private final StageDurationDao dao;
    @org.springframework.beans.factory.annotation.Autowired
    private SdlcExecutionSnapshotService snapshotService;

    public StageDurationService(StageDurationDao dao) { this.dao = dao; }

    @Getter
    @Setter
    public static class Execution extends DispatchDO {
        private String title;
        private Long sdlcId;
        private String sdlcName;
        private String agentName;
        private Integer agentVersionNo;
        private boolean currentAgentVersion;
        private Long snapshotId;
        private String snapshotSource;
    }

    @Getter
    @Setter
    public static class Event extends DispatchRuntimeEventDO {
        private String fallbackStepName;
    }

    public StageDurationVO get(long tenantId, LocalDate start, LocalDate end, Long squadId, Long sdlcId, String groupBy, Long agentId) {
        return get(tenantId, start, end, squadId, sdlcId, groupBy, agentId, null, null, false);
    }

    public StageDurationVO get(long tenantId, LocalDate start, LocalDate end, Long squadId, Long sdlcId,
                               String groupBy, Long agentId, Long agentVersionId, String statusFilter, boolean excludeCanceled) {
        return get(tenantId, start, end, squadId, sdlcId, groupBy, agentId, agentVersionId, statusFilter, excludeCanceled, null);
    }

    public StageDurationVO get(long tenantId, LocalDate start, LocalDate end, Long squadId, Long sdlcId,
                               String groupBy, Long agentId, Long agentVersionId, String statusFilter, boolean excludeCanceled,
                               Long maxDispatchId) {
        validate(start, end, squadId, sdlcId);
        if (agentId != null) validateAgent(agentId);
        validateFilters(agentVersionId, statusFilter);
        if (!"stage".equals(groupBy) && !"agent_version".equals(groupBy) && !"sdlc_snapshot".equals(groupBy)) {
            throw new KeyedIllegalArgumentException("error.param_invalid", null, "Unknown stage duration grouping: " + groupBy);
        }
        StageDurationVO report = aggregate(tenantId, loadExecutions(tenantId, start, end, squadId, sdlcId, agentId,
                agentVersionId, statusFilter, excludeCanceled, maxDispatchId), groupBy);
        report.setStartDate(start.toString());
        report.setEndDate(end.toString());
        return report;
    }

    /**
     * Execution-list-only overview: the shard plan, the snapshot anchor and every count that cannot be summed
     * across flows (workitems and flows are many-to-many). It never reads events.
     */
    public StageDurationPlanVO plan(long tenantId, LocalDate start, LocalDate end, Long squadId, Long sdlcId,
                                    Long agentId, Long agentVersionId, String statusFilter, boolean excludeCanceled) {
        validate(start, end, squadId, sdlcId);
        if (agentId != null) validateAgent(agentId);
        validateFilters(agentVersionId, statusFilter);
        List<Execution> executions = loadExecutions(tenantId, start, end, squadId, sdlcId, agentId, agentVersionId,
                statusFilter, excludeCanceled, null);
        Date calculatedAt = new Date();
        Map<Long, StageDurationPlanVO.Shard> bySdlc = new LinkedHashMap<>();
        int notApplicable = 0;
        for (Execution execution : executions) {
            if (execution.getSdlcId() == null) {
                notApplicable++;
                continue;
            }
            StageDurationPlanVO.Shard shard = bySdlc.computeIfAbsent(execution.getSdlcId(), ignored -> new StageDurationPlanVO.Shard());
            shard.setSdlcId(execution.getSdlcId());
            if (shard.getSdlcName() == null) shard.setSdlcName(execution.getSdlcName());
            shard.setExecutionCount(shard.getExecutionCount() + 1);
        }
        List<StageDurationPlanVO.Shard> shards = new ArrayList<>(bySdlc.values());
        for (StageDurationPlanVO.Shard shard : shards) shard.setOversized(shard.getExecutionCount() > OVERSIZED_SHARD_EXECUTIONS);
        shards.sort(Comparator.comparingInt(StageDurationPlanVO.Shard::getExecutionCount).reversed()
                .thenComparing(StageDurationPlanVO.Shard::getSdlcId));
        StageDurationPlanVO.Snapshot snapshot = new StageDurationPlanVO.Snapshot();
        snapshot.setMaxDispatchId(executions.stream().map(Execution::getId).filter(Objects::nonNull)
                .max(Long::compareTo).orElse(null));
        snapshot.setCalculatedAt(calculatedAt.toInstant().toString());
        StageDurationPlanVO plan = new StageDurationPlanVO();
        plan.setSnapshot(snapshot);
        plan.setMode(sdlcId != null || shards.size() <= 1 || executions.size() <= SINGLE_REQUEST_EXECUTIONS
                ? "single" : "sharded");
        plan.setExecutionCount(executions.size());
        plan.setWorkitemCount(executions.stream().map(Execution::getWorkitemId).distinct().count());
        plan.setNotApplicableExecutionCount(notApplicable);
        plan.setRecoverableSnapshotCount((int) executions.stream().filter(StageDurationService::recoverable).count());
        plan.setFirstExecutionDate(executionDates(executions).min(Comparator.naturalOrder()).map(LocalDate::toString).orElse(""));
        plan.setLastExecutionDate(executionDates(executions).max(Comparator.naturalOrder()).map(LocalDate::toString).orElse(""));
        plan.setShards(shards);
        return plan;
    }

    public List<com.aliyun.autowonder.insights.dto.InsightWorkerVO> workers(long tenantId, boolean excludeCanceled) {
        return dao.listWorkers(tenantId, excludeCanceled);
    }

    public List<StageDurationVO.AgentVersion> versions(long tenantId, long agentId, boolean excludeCanceled) {
        validateAgent(agentId);
        return dao.listAgentVersions(tenantId, agentId, excludeCanceled);
    }

    public StageDurationVO versionSamples(long tenantId, long agentId, List<Long> versionIds, LocalDate start, LocalDate end, boolean excludeCanceled) {
        validateAgent(agentId);
        if (start != null || end != null) validate(start, end, null, null);
        if (versionIds == null || versionIds.isEmpty() || versionIds.size() > 2
                || versionIds.stream().anyMatch(id -> id == null || id <= 0)
                || new HashSet<>(versionIds).size() != versionIds.size()) {
            throw new KeyedIllegalArgumentException("error.param_invalid", null, "Select one or two distinct employee version ids");
        }
        List<Execution> executions = new ArrayList<>();
        for (long versionId : versionIds) {
            executions.addAll(dao.listVersionExecutions(tenantId, agentId, versionId,
                    start == null ? null : Date.from(start.atStartOfDay(ZONE).toInstant()),
                    end == null ? null : Date.from(end.plusDays(1).atStartOfDay(ZONE).toInstant()), VERSION_SAMPLE_LIMIT, excludeCanceled));
        }
        StageDurationVO report = aggregate(tenantId, executions, "agent_version");
        report.setSampleLimit(VERSION_SAMPLE_LIMIT);
        if (start != null) {
            report.setStartDate(start.toString());
            report.setEndDate(end.toString());
        }
        return report;
    }

    private static void validateAgent(long agentId) {
        if (agentId <= 0) throw new KeyedIllegalArgumentException("error.param_invalid", null, "Employee id must be positive");
    }

    private StageDurationVO aggregate(long tenantId, List<Execution> executions, String groupBy) {
        boolean byVersion = "agent_version".equals(groupBy);
        boolean comparison = !"stage".equals(groupBy);
        Date now = new Date();
        Map<Long, SdlcStepDO> currentSteps = new HashMap<>();
        List<Long> flows = executions.stream().map(Execution::getSdlcId).filter(Objects::nonNull).distinct().toList();
        if (!flows.isEmpty()) for (SdlcStepDO step : dao.listCurrentSteps(tenantId, flows)) currentSteps.put(step.getId(), step);
        Map<Long, StageDurationVO.FlowSnapshot> snapshots = new LinkedHashMap<>();
        if (comparison) {
            List<Long> ids = executions.stream().map(Execution::getSnapshotId).filter(Objects::nonNull).distinct().toList();
            for (int offset = 0; offset < ids.size(); offset += EVENT_BATCH_SIZE) {
                for (SdlcExecutionSnapshot snapshot : dao.listSnapshots(tenantId, ids.subList(offset, Math.min(offset + EVENT_BATCH_SIZE, ids.size())))) {
                    snapshots.put(snapshot.getId(), new StageDurationVO.FlowSnapshot(snapshot.getId(), snapshot.getSdlcId(),
                            snapshot.getContentHash(), snapshot.getGmtCreate().toInstant().toString(), JSON.parseObject(snapshot.getConfigurationJson())));
                }
            }
        }
        Map<Long, List<Event>> events = new HashMap<>();
        List<Long> dispatchIds = executions.stream().map(Execution::getId).toList();
        // Bound each index lookup instead of sending thousands of IDs in one range query.
        for (int offset = 0; offset < dispatchIds.size(); offset += EVENT_BATCH_SIZE) {
            List<Long> batch = dispatchIds.subList(offset, Math.min(offset + EVENT_BATCH_SIZE, dispatchIds.size()));
            for (Event event : dao.listEvents(tenantId, batch)) {
                events.computeIfAbsent(event.getDispatchId(), ignored -> new ArrayList<>()).add(event);
            }
        }
        Map<Long, PreparedEvents> prepared = new HashMap<>();
        for (Execution execution : executions) {
            prepared.put(execution.getId(), normalize(execution, events.getOrDefault(execution.getId(), List.of())));
        }
        // Last activity only feeds the unobserved tail of a closed dispatch with an open stage; loading it for
        // every execution means scanning the full agent-message history to discard the result.
        List<Long> needActivity = new ArrayList<>();
        for (Execution execution : executions) {
            PreparedEvents own = prepared.get(execution.getId());
            if (DispatchStepTimings.needsLastActivity(execution, own.events(), new ArrayList<>(own.definitions().values()), now)) {
                needActivity.add(execution.getId());
            }
        }
        Map<Long, Event> lastActivities = new HashMap<>();
        // lastActivities has no empty-list fallback, so an empty selection must skip the call entirely.
        for (int offset = 0; offset < needActivity.size(); offset += EVENT_BATCH_SIZE) {
            List<Long> batch = needActivity.subList(offset, Math.min(offset + EVENT_BATCH_SIZE, needActivity.size()));
            for (Event activity : dao.lastActivities(tenantId, batch)) lastActivities.put(activity.getDispatchId(), activity);
        }
        Map<String, StageDurationVO.Stage> stages = new LinkedHashMap<>();
        Map<String, List<StageDurationVO.Sample>> samples = new HashMap<>();
        List<StageDurationVO.VersionSample> versionSamples = new ArrayList<>();
        int measured = 0;
        int withStages = 0;
        int notApplicable = 0;
        for (Execution execution : executions) {
            StageDurationVO.VersionSample versionSample = null;
            if (comparison) {
                versionSample = new StageDurationVO.VersionSample();
                describe(versionSample, execution);
                versionSample.setSdlcId(execution.getSdlcId());
                versionSample.setSdlcName(execution.getSdlcName());
                versionSample.setSnapshotId(execution.getSnapshotId());
                versionSample.setSnapshotSource(execution.getSnapshotSource());
                versionSample.setStatus(execution.getStatus());
                versionSample.setStages(new ArrayList<>());
                versionSamples.add(versionSample);
            }
            if (execution.getSdlcId() == null) {
                notApplicable++;
                continue;
            }
            PreparedEvents own = prepared.getOrDefault(execution.getId(), normalize(execution, List.of()));
            Map<String, SdlcStepDO> definitions = own.definitions();
            Map<String, Integer> recordedOrders = own.recordedOrders();
            List<DispatchRuntimeEventDO> normalized = new ArrayList<>(own.events());
            Event lastActivity = lastActivities.get(execution.getId());
            if (lastActivity != null) normalized.add(lastActivity);
            var timings = DispatchStepTimings.build(execution, normalized, new ArrayList<>(definitions.values()), now);
            if (!definitions.isEmpty()) withStages++;
            var snapshot = snapshots.get(execution.getSnapshotId());
            Long verifiedSnapshotId = snapshot != null && Objects.equals(execution.getSdlcId(), snapshot.sdlcId())
                    ? snapshot.id() : null;
            int index = 0;
            boolean hasMeasurement = false;
            for (var entry : definitions.entrySet()) {
                var timing = timings.get(index++);
                String stageIdentity = execution.getSdlcId() + ":" + entry.getKey();
                String key = stageIdentity
                        + (byVersion ? ":agent:" + execution.getAgentId() + ":version:" + execution.getAgentVersionId()
                        : "sdlc_snapshot".equals(groupBy) ? ":snapshot:" + Objects.toString(verifiedSnapshotId, "unknown") : "");
                StageDurationVO.Stage stage = stages.computeIfAbsent(key, ignored -> {
                    StageDurationVO.Stage value = new StageDurationVO.Stage();
                    value.setKey(key);
                    value.setSdlcId(execution.getSdlcId());
                    value.setSdlcName(execution.getSdlcName());
                    if ("sdlc_snapshot".equals(groupBy)) value.setSnapshotId(verifiedSnapshotId);
                    value.setStepId(entry.getValue().getId());
                    value.setStepOrder(recordedOrders.get(entry.getKey()));
                    value.setName(timing.getName());
                    SdlcStepDO current = currentSteps.get(entry.getValue().getId());
                    value.setCurrentDefinition(current != null && Objects.equals(current.getSdlcId(), execution.getSdlcId()));
                    if ("stage".equals(groupBy) && value.isCurrentDefinition()) value.setStepOrder(current.getStepOrder());
                    if (byVersion) {
                        value.setAgentId(execution.getAgentId());
                        value.setAgentName(execution.getAgentName());
                        value.setAgentVersionId(execution.getAgentVersionId());
                        value.setAgentVersionNo(execution.getAgentVersionNo());
                        value.setCurrentAgentVersion(execution.isCurrentAgentVersion());
                    }
                    return value;
                });
                StageDurationVO.Sample sample = new StageDurationVO.Sample();
                describe(sample, execution);
                sample.setStatus(timing.getStatus());
                sample.setDurationMs(timing.getDurationMs());
                sample.setTiming(timing);
                samples.computeIfAbsent(key, ignored -> new ArrayList<>()).add(sample);
                if (versionSample != null) {
                    StageDurationVO.StageSample measuredStage = new StageDurationVO.StageSample();
                    measuredStage.setKey(stageIdentity);
                    measuredStage.setStepId(entry.getValue().getId());
                    measuredStage.setStepOrder(recordedOrders.get(entry.getKey()));
                    measuredStage.setName(timing.getName());
                    measuredStage.setStatus(timing.getStatus());
                    measuredStage.setDurationMs(timing.getDurationMs());
                    measuredStage.setTiming(timing);
                    versionSample.getStages().add(measuredStage);
                }
                stage.setSampleCount(stage.getSampleCount() + 1);
                String status = timing.getStatus();
                if ("reused".equals(status)) stage.setReusedCount(stage.getReusedCount() + 1);
                else if ("skipped".equals(status)) stage.setSkippedCount(stage.getSkippedCount() + 1);
                else {
                    if ("done".equals(status)) stage.setCompletedCount(stage.getCompletedCount() + 1);
                    else if ("active".equals(status)) stage.setActiveCount(stage.getActiveCount() + 1);
                    else stage.setIncompleteCount(stage.getIncompleteCount() + 1);
                    if (timing.getDurationMs() == null) stage.setMissingDurationCount(stage.getMissingDurationCount() + 1);
                }
                if (timing.getDurationMs() != null) {
                    stage.setTotalDurationMs(stage.getTotalDurationMs() + timing.getDurationMs());
                    stage.setOtherWaitMs(stage.getOtherWaitMs() + timing.getOtherWaitMs());
                    stage.setUnknownMs(stage.getUnknownMs() + timing.getUnknownMs());
                    stage.setAfterKnownWaitMs(stage.getAfterKnownWaitMs() + timing.getAfterKnownWaitMs());
                    stage.setUnobservedTailMs(stage.getUnobservedTailMs() + timing.getUnobservedTailMs());
                    stage.setObservationDelayMs(stage.getObservationDelayMs() + timing.getObservationDelayMs());
                    stage.setOmittedOperationGroups(stage.getOmittedOperationGroups() + timing.getOmittedOperationGroups());
                    if (timing.isInstrumented()) {
                        stage.setInstrumentedSampleCount(stage.getInstrumentedSampleCount() + 1);
                        stage.setExternalWaitMs(Objects.requireNonNullElse(stage.getExternalWaitMs(), 0L) + timing.getExternalWaitMs());
                        stage.setProcessingMs(stage.getProcessingMs() + timing.getProcessingMs());
                        if (timing.getUnknownMs() == 0 && timing.getUnobservedTailMs() == 0) stage.setCoveredSampleCount(stage.getCoveredSampleCount() + 1);
                    }
                    hasMeasurement = true;
                }
            }
            if (hasMeasurement) measured++;
            if (versionSample != null && hasMeasurement) {
                var executionStages = versionSample.getStages();
                versionSample.setDurationMs(executionStages.stream().map(StageDurationVO.StageSample::getDurationMs)
                        .filter(Objects::nonNull).mapToLong(Long::longValue).sum());
                versionSample.setComplete(complete(execution, executionStages, snapshot));
            }
        }
        for (StageDurationVO.Stage stage : stages.values()) {
            List<StageDurationVO.Sample> all = samples.get(stage.getKey());
            List<Long> completed = all.stream().filter(s -> "done".equals(s.getStatus()) && s.getDurationMs() != null)
                    .map(StageDurationVO.Sample::getDurationMs).sorted().toList();
            if (!completed.isEmpty()) {
                stage.setAverageDurationMs(Math.round(completed.stream().mapToLong(Long::longValue).average().orElseThrow()));
                int size = completed.size();
                stage.setMedianDurationMs(size % 2 == 1 ? completed.get(size / 2)
                        : Math.round((completed.get(size / 2 - 1) + completed.get(size / 2)) / 2.0));
                stage.setP90DurationMs(completed.get((int) Math.ceil(size * .9) - 1));
                List<Long> afterWait = all.stream().filter(s -> "done".equals(s.getStatus()) && s.getTiming().getAfterKnownWaitMs() != null)
                        .map(s -> s.getTiming().getAfterKnownWaitMs()).sorted().toList();
                stage.setAfterKnownWaitMedianMs(size % 2 == 1 ? afterWait.get(size / 2)
                        : Math.round((afterWait.get(size / 2 - 1) + afterWait.get(size / 2)) / 2.0));
                stage.setAfterKnownWaitP90Ms(afterWait.get((int) Math.ceil(size * .9) - 1));
            }
            Map<String, StepTimingVO.Operation> operations = new TreeMap<>();
            for (var sample : all) for (var operation : sample.getTiming().getOperations()) {
                String key = operation.getTarget() + "/" + operation.getOperation() + "/" + operation.getKind();
                var total = operations.computeIfAbsent(key, ignored -> {
                    var value = new StepTimingVO.Operation(); value.setTarget(operation.getTarget());
                    value.setOperation(operation.getOperation()); value.setKind(operation.getKind()); return value;
                });
                total.setCount(total.getCount() + operation.getCount());
                total.setDurationMs(total.getDurationMs() + operation.getDurationMs());
            }
            stage.setOperations(new ArrayList<>(operations.values()));
            stage.setSlowest(all.stream().sorted(Comparator.comparing(StageDurationVO.Sample::getDurationMs,
                    Comparator.nullsLast(Comparator.reverseOrder())).thenComparing(StageDurationVO.Sample::getDispatchId))
                    .limit(10).toList());
        }
        StageDurationVO report = new StageDurationVO();
        report.setStartDate(executionDates(executions).min(Comparator.naturalOrder()).map(LocalDate::toString).orElse(""));
        report.setEndDate(executionDates(executions).max(Comparator.naturalOrder()).map(LocalDate::toString).orElse(""));
        report.setTimezone(ZONE.getId());
        report.setCalculatedAt(now.toInstant().toString());
        report.setExecutionCount(executions.size());
        report.setWorkitemCount(executions.stream().map(Execution::getWorkitemId).distinct().count());
        report.setMeasuredExecutionCount(measured);
        report.setStageExecutionCount(withStages);
        report.setNoStageExecutionCount(executions.size() - withStages - notApplicable);
        report.setNotApplicableExecutionCount(notApplicable);
        report.setMissingDurationCount(stages.values().stream().mapToInt(StageDurationVO.Stage::getMissingDurationCount).sum());
        report.setTotalDurationMs(stages.values().stream().mapToLong(StageDurationVO.Stage::getTotalDurationMs).sum());
        report.setStages(stages.values().stream().sorted(Comparator.comparingLong(StageDurationVO.Stage::getTotalDurationMs).reversed()
                .thenComparing(StageDurationVO.Stage::getKey)).toList());
        report.setVersionSamples(versionSamples);
        report.setFlowSnapshots(new ArrayList<>(snapshots.values()));
        report.setRecoverableSnapshotCount((int) executions.stream().filter(StageDurationService::recoverable).count());
        return report;
    }

    private static void validate(LocalDate start, LocalDate end, Long squadId, Long sdlcId) {
        if (start == null || end == null || start.isAfter(end) || end.isAfter(LocalDate.now(ZONE))
                || ChronoUnit.DAYS.between(start, end) >= 366) {
            throw new KeyedIllegalArgumentException("insights.invalid_date_range", null,
                    "Invalid stage duration range: " + start + ".." + end);
        }
        if ((squadId != null && squadId <= 0) || (sdlcId != null && sdlcId <= 0)) {
            throw new KeyedIllegalArgumentException("error.param_invalid", null, "Stage duration filters must be positive ids");
        }
    }

    private static void validateFilters(Long agentVersionId, String statusFilter) {
        if ((agentVersionId != null && agentVersionId <= 0)
                || (statusFilter != null && !STATUS_FILTERS.contains(statusFilter))) {
            throw new KeyedIllegalArgumentException("error.param_invalid", null, "Invalid stage duration filter");
        }
    }

    private static java.util.stream.Stream<LocalDate> executionDates(List<Execution> executions) {
        return executions.stream().map(row -> row.getGmtCreate().toInstant().atZone(ZONE).toLocalDate());
    }

    private List<Execution> loadExecutions(long tenantId, LocalDate start, LocalDate end, Long squadId, Long sdlcId, Long agentId, Long agentVersionId, String statusFilter, boolean excludeCanceled, Long maxDispatchId) {
        List<Execution> executions = dao.listExecutions(tenantId,
                Date.from(start.atStartOfDay(ZONE).toInstant()), Date.from(end.plusDays(1).atStartOfDay(ZONE).toInstant()),
                squadId, sdlcId, agentId, agentVersionId, statusFilter, MAX_EXECUTIONS + 1, excludeCanceled, maxDispatchId);
        if (executions.size() > MAX_EXECUTIONS) {
            throw new KeyedIllegalArgumentException("insights.stage_duration_range_too_large", new Object[]{MAX_EXECUTIONS},
                    "Stage duration query exceeds " + MAX_EXECUTIONS + " executions");
        }
        return executions;
    }

    private record PreparedEvents(List<DispatchRuntimeEventDO> events, Map<String, SdlcStepDO> definitions,
                                  Map<String, Integer> recordedOrders) {}

    private static PreparedEvents normalize(Execution execution, List<Event> ownEvents) {
        Map<String, Set<String>> aliases = new HashMap<>();
        for (Event event : ownEvents) {
            String key = identity(event);
            if (key == null) continue;
            if (event.getStepId() != null && event.getStepKey() != null && !event.getStepKey().isBlank())
                aliases.computeIfAbsent("key:" + event.getStepKey(), ignored -> new HashSet<>()).add(key);
            if ((event.getStepId() != null || event.getStepKey() != null) && event.getStepOrder() != null)
                aliases.computeIfAbsent("order:" + event.getStepOrder(), ignored -> new HashSet<>()).add(key);
        }
        Map<String, SdlcStepDO> definitions = new LinkedHashMap<>();
        Map<String, Integer> recordedOrders = new HashMap<>();
        List<DispatchRuntimeEventDO> normalized = new ArrayList<>();
        for (Event event : ownEvents) {
            String identity = identity(event);
            if (identity == null) {
                normalized.add(event);
                continue;
            }
            // Older events may have only an order/key. Resolve it only when the recorded identity is unique.
            Set<String> candidates = aliases.get(identity);
            if (candidates != null && candidates.size() == 1) identity = candidates.iterator().next();
            SdlcStepDO step = definitions.computeIfAbsent(identity, key -> {
                SdlcStepDO value = new SdlcStepDO();
                value.setId(event.getStepId());
                value.setStepOrder(definitions.size() + 1);
                return value;
            });
            if (event.getStepId() != null) step.setId(event.getStepId());
            if (event.getStepName() != null && !event.getStepName().isBlank()) step.setName(event.getStepName());
            else if (step.getName() == null) step.setName(event.getFallbackStepName());
            if (event.getStepOrder() != null) recordedOrders.put(identity, event.getStepOrder());
            // Normalize only the projection: historical step ids/names survive edits and deleted definitions.
            DispatchRuntimeEventDO copy = new DispatchRuntimeEventDO();
            copy.setId(event.getId());
            copy.setDispatchId(execution.getId());
            copy.setStepOrder(step.getStepOrder());
            copy.setStepName(event.getStepName());
            copy.setEventType(event.getEventType());
            copy.setError(event.getError());
            copy.setDetailJson(event.getDetailJson());
            copy.setEventTime(event.getEventTime());
            copy.setGmtCreate(event.getGmtCreate());
            normalized.add(copy);
        }
        return new PreparedEvents(normalized, definitions, recordedOrders);
    }

    private static void describe(StageDurationVO.Sample sample, Execution execution) {
        sample.setDispatchId(execution.getId());
        sample.setWorkitemId(execution.getWorkitemId());
        sample.setTitle(execution.getTitle());
        sample.setAgentName(execution.getAgentName());
        sample.setAgentId(execution.getAgentId());
        sample.setAgentVersionId(execution.getAgentVersionId());
        sample.setAgentVersionNo(execution.getAgentVersionNo());
        sample.setCurrentAgentVersion(execution.isCurrentAgentVersion());
        sample.setDispatchStatus(execution.getStatus());
        sample.setCreatedAt(execution.getGmtCreate().toInstant().toString());
    }

    private static boolean complete(Execution execution, List<StageDurationVO.StageSample> stages,
                                    StageDurationVO.FlowSnapshot snapshot) {
        if (!DispatchStatus.SUCCEEDED.equals(execution.getStatus()) || snapshot == null
                || !Objects.equals(execution.getSdlcId(), snapshot.sdlcId()) || stages.isEmpty()) return false;
        if (stages.stream().anyMatch(s -> !Set.of("done", "reused", "skipped").contains(s.getStatus())
                || ("done".equals(s.getStatus()) && s.getDurationMs() == null))) return false;
        if (!(snapshot.configuration().get("steps") instanceof List<?> expected)) return false;
        for (int i = 0; i < expected.size(); i++) {
            if (!(expected.get(i) instanceof Map<?, ?> step)) return false;
            if (Boolean.FALSE.equals(step.get("required"))) continue;
            String id = Objects.toString(step.get("id"), "");
            if (id.isBlank() || stages.stream().noneMatch(s -> id.equals(Objects.toString(s.getStepId(), ""))
                    || s.getKey().equals(execution.getSdlcId() + ":key:" + id))) return false;
        }
        return true;
    }

    private static boolean recoverable(Execution execution) {
        return execution.getSnapshotId() == null && (execution.getSnapshotSource() == null
                || Set.of("UNAVAILABLE", "UNVERIFIED").contains(execution.getSnapshotSource()))
                && execution.getPackageOssRef() != null && !execution.getPackageOssRef().isBlank()
                && DispatchStatus.isTerminal(execution.getStatus());
    }

    public StageDurationVO.Recovery recoverSnapshots(long tenantId, LocalDate start, LocalDate end, Long squadId, Long sdlcId, Long beforeDispatchId) {
        validate(start, end, squadId, sdlcId);
        if (beforeDispatchId != null && beforeDispatchId <= 0)
            throw new KeyedIllegalArgumentException("error.param_invalid", null, "Recovery cursor must be a positive dispatch id");
        Date from = Date.from(start.atStartOfDay(ZONE).toInstant());
        Date until = Date.from(end.plusDays(1).atStartOfDay(ZONE).toInstant());
        List<Execution> pending = dao.listRecoverableExecutions(tenantId, from, until, squadId, sdlcId, beforeDispatchId);
        if (pending.isEmpty()) return new StageDurationVO.Recovery(0, 0, 0, 0, 0, null);
        int remaining = dao.countRecoverableExecutions(tenantId, from, until, squadId, sdlcId, beforeDispatchId);
        Map<Long, Date> firstEvents = new HashMap<>();
        for (Event event : dao.firstEvents(tenantId, pending.stream().map(Execution::getId).toList()))
            firstEvents.put(event.getDispatchId(), event.getGmtCreate());
        int recovered = 0, unavailable = 0, failed = 0;
        for (Execution execution : pending) {
            try {
                if (snapshotService.recover(execution, firstEvents.get(execution.getId()))) recovered++;
                else unavailable++;
            } catch (RuntimeException failure) {
                failed++;
                log.warn("SDLC snapshot recovery failed tenantId={} dispatchId={}", tenantId, execution.getId(), failure);
            }
        }
        // Advance even past failures; omitting the cursor explicitly starts a new bounded retry pass.
        int left = Math.max(0, remaining - pending.size());
        return new StageDurationVO.Recovery(pending.size(), recovered, unavailable, failed, left,
                left > 0 ? pending.getLast().getId() : null);
    }

    private static String identity(DispatchRuntimeEventDO event) {
        if (event.getStepId() != null) return "id:" + event.getStepId();
        if (event.getStepKey() != null && !event.getStepKey().isBlank()) return "key:" + event.getStepKey();
        if (event.getStepOrder() != null) return "order:" + event.getStepOrder();
        if (event.getStepName() != null && !event.getStepName().isBlank()) return "name:" + event.getStepName();
        return null;
    }
}
