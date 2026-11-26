package com.aliyun.autowonder.workitem;

import com.aliyun.autowonder.dispatch.DispatchDO;
import com.aliyun.autowonder.dispatch.DispatchRuntimeEventDO;
import com.aliyun.autowonder.dispatch.DispatchStatus;
import com.aliyun.autowonder.json.JSONObject;
import com.aliyun.autowonder.sdlc.SdlcStepDO;
import com.aliyun.autowonder.workitem.dto.StepTimingVO;

import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Per-dispatch elapsed step time. Queueing and other dispatches are never attributed to a step. */
public final class DispatchStepTimings {
    private static final Set<String> RUNNING = Set.of("DISPATCHED", "ACKED", "RUNNING",
            "PAUSING", "PAUSE_FAILED", "WAITING_FOR_PAUSE");

    // Shared with the insights SQL cutoff; telemetry snapshots and upload bookkeeping are not activity.
    public static final Set<String> ACTIVITY_EVENT_TYPES = Set.of(
            "step.started", "step.completed", "step.failed", "step.fix_required", "step.cancelled", "step.blocked",
            "step.reused", "step.stale", "step.skipped", "step.checklist_updated", "step.completion_requested", "completion_requested",
            "step.gate_started", "step.gate_finished", "step.gate_failed",
            "artifact.discovered", "artifact.hashed", "artifact.sealed",
            "session.started", "session.interrupted", "session.resumed", "session.forked", "session.completed", "session.failed", "session.cancelled",
            "dispatch.paused", "dispatch.resumed", "dispatch.recovered", "dispatch.executor_failover", "dispatch.failed", "dispatch.cancelled", "dispatch.completed",
            "turn.started", "turn.completed", "turn.failed", "turn.interrupted", "llm.started", "llm.completed", "llm.failed",
            "llm.thinking_started", "llm.thinking_completed", "mcp.call", "mcp.result", "cli.call", "cli.result", "bash.call", "bash.result",
            "skill.loaded", "skill.invoked", "plugin.loaded", "subagent.requested", "subagent.started",
            "subagent.completed", "subagent.failed", "subagent.cancelled",
            "context.compact_started", "context.compact_completed", "task.failed", "runtime.failed",
            "agent.started", "agent.message", "agent.tool_use", "agent.tool_result", "agent.progress", "runtime.wait_started", "runtime.wait_finished");

    private DispatchStepTimings() {}

    public static List<StepTimingVO> build(DispatchDO dispatch, List<DispatchRuntimeEventDO> events,
                                           List<SdlcStepDO> steps, Date now) {
        return build(dispatch, events, steps, now, false);
    }

    public static List<StepTimingVO> buildProgress(DispatchDO dispatch, List<DispatchRuntimeEventDO> events,
                                                   List<SdlcStepDO> steps, Date now) {
        return build(dispatch, events, steps, now, true);
    }

    private static List<StepTimingVO> build(DispatchDO dispatch, List<DispatchRuntimeEventDO> events,
                                            List<SdlcStepDO> steps, Date now, boolean deliveryProgress) {
        List<DispatchRuntimeEventDO> ownEvents = events.stream()
                .filter(event -> Objects.equals(dispatch.getId(), event.getDispatchId())).toList();
        var summaries = StepTimingSummaries.index(ownEvents, steps);
        boolean elapsedProgress = deliveryProgress && summaries.isEmpty();
        Date cutoff = elapsedProgress
                ? elapsedCutoff(dispatch, ownEvents, now)
                : observedCutoff(dispatch, ownEvents, now);
        return describe(dispatch, steps, now, cutoff, RuntimeStepTimeline.fromTimings(ownEvents, steps, cutoff), summaries);
    }

    static List<StepTimingVO> buildProgress(DispatchDO dispatch, List<DispatchRuntimeEventDO> events,
                                            Map<SdlcStepDO, Map<String, JSONObject>> summaries,
                                            Date lastActivity, List<SdlcStepDO> steps, Date now) {
        Date cutoff = summaries.isEmpty() ? elapsedCutoff(dispatch, events, now) : observedCutoff(dispatch, lastActivity, now);
        return describe(dispatch, steps, now, cutoff, RuntimeStepTimeline.fromProgress(events, steps, cutoff, false, null),
                summaries);
    }

    /**
     * Only a closed dispatch with an unclosed stage reads the last-activity cutoff when the build runs;
     * every other execution would load activity rows whose value is never used.
     */
    public static boolean needsLastActivity(DispatchDO dispatch, List<DispatchRuntimeEventDO> events,
                                            List<SdlcStepDO> steps, Date now) {
        if (dispatch == null || RUNNING.contains(Objects.toString(dispatch.getStatus(), ""))) return false;
        Date cutoff = observedCutoff(dispatch, events, now);
        if (cutoff == null) return false;
        RuntimeStepTimeline timeline = RuntimeStepTimeline.fromTimings(events, steps, cutoff);
        return steps.stream().anyMatch(timeline::isOpen);
    }

    private static List<StepTimingVO> describe(DispatchDO dispatch, List<SdlcStepDO> steps, Date now, Date observedEnd,
                                               RuntimeStepTimeline timeline, Map<SdlcStepDO, Map<String, JSONObject>> summaries) {
        boolean running = RUNNING.contains(Objects.toString(dispatch.getStatus(), ""));
        return steps.stream().map(step -> {
            StepTimingVO timing = new StepTimingVO();
            timing.setStepId(step.getId());
            timing.setName(step.getName());
            timing.setDurationMs(timeline.durationOf(step));
            timing.setOtherWaitMs(timeline.otherWaitOf(step));
            if (timing.getDurationMs() != null) {
                timing.setUnknownMs(Math.max(0, timing.getDurationMs() - timing.getOtherWaitMs()));
                timing.setAfterKnownWaitMs(timing.getUnknownMs());
            }
            if (!running && timeline.isOpen(step) && observedEnd != null && dispatch.getGmtModified() != null) {
                timing.setUnobservedTailMs(Math.max(0, Math.min(now.getTime(), dispatch.getGmtModified().getTime()) - observedEnd.getTime()));
            }
            StepTimingSummaries.apply(timing, summaries.getOrDefault(step, Map.of()));
            String status = timeline.statusOf(step);
            DispatchRuntimeEventDO last = timeline.lastEventOf(step);
            if (last != null && last.getStepName() != null && !last.getStepName().isBlank()) {
                timing.setName(last.getStepName());
            }
            if (last != null && "step.reused".equals(last.getEventType())) status = "reused";
            if (last != null && "step.skipped".equals(last.getEventType())) status = "skipped";
            if ("active".equals(status) && !running) {
                status = DispatchStatus.PAUSED.equals(dispatch.getStatus()) ? "paused"
                        : DispatchStatus.CANCELED.equals(dispatch.getStatus()) ? "cancelled"
                        : DispatchStatus.FAILED.equals(dispatch.getStatus()) || DispatchStatus.TIMEOUT.equals(dispatch.getStatus())
                        ? "failed" : "interrupted";
            }
            timing.setStatus(status == null ? "pending" : status);
            return timing;
        }).toList();
    }

    // The existing delivery-progress API shows elapsed time to termination for an unmeasured open step.
    // The analytics report accounts for time after the last activity separately.
    static Date elapsedCutoff(DispatchDO dispatch, List<DispatchRuntimeEventDO> events, Date now) {
        if (dispatch == null || RUNNING.contains(Objects.toString(dispatch.getStatus(), ""))) return now;
        Date end = dispatch.getGmtModified();
        if (end == null) {
            end = events.stream().map(DispatchStepTimings::eventTime).filter(Objects::nonNull)
                    .max(Date::compareTo).orElse(null);
        }
        return end != null && end.after(now) ? now : end;
    }

    static Date observedCutoff(DispatchDO dispatch, List<DispatchRuntimeEventDO> events, Date now) {
        // A later business update is not evidence that the runtime kept working.
        Date observed = events.stream()
                .filter(event -> isActivity(event.getEventType()))
                .map(DispatchStepTimings::eventTime)
                .filter(Objects::nonNull).max(Date::compareTo).orElse(null);
        return observedCutoff(dispatch, observed, now);
    }

    static boolean isActivity(String type) {
        return type != null && (ACTIVITY_EVENT_TYPES.contains(type) || "runtime.last_activity".equals(type));
    }

    static Date observedCutoff(DispatchDO dispatch, Date lastActivity, Date now) {
        if (dispatch == null || RUNNING.contains(Objects.toString(dispatch.getStatus(), ""))) return now;
        return lastActivity != null && lastActivity.after(now) ? now : lastActivity;
    }

    private static Date eventTime(DispatchRuntimeEventDO event) {
        return event.getEventTime() != null ? event.getEventTime() : event.getGmtCreate();
    }
}
