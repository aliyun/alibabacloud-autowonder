package com.aliyun.autowonder.workitem;

import com.aliyun.autowonder.dispatch.DispatchDO;
import com.aliyun.autowonder.dispatch.DispatchRuntimeEventDO;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.json.JSONArray;
import com.aliyun.autowonder.sdlc.SdlcStepDO;
import org.junit.jupiter.api.Test;

import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class DispatchStepTimingsTest {
    @Test
    void untimedProgressRetainsElapsedDurationAndInsightsSeparatesTheUnobservedTail() {
        var failed = dispatch("FAILED", 250_000L);
        var events = List.of(event(1, 10, 1, "step.started", 10_000));
        var steps = List.of(step(1));
        var now = new Date(300_000);
        var scheduled = DispatchStepTimings.buildProgress(failed, events, steps, now).getFirst();
        var workitem = DispatchStepTimings.buildProgress(failed, events, Map.of(), new Date(10_000), steps, now).getFirst();
        var report = DispatchStepTimings.build(failed, events, steps, now).getFirst();

        assertEquals(240_000L, scheduled.getDurationMs());
        assertEquals(scheduled.getDurationMs(), workitem.getDurationMs());
        assertEquals(0L, report.getDurationMs());
        assertEquals(240_000L, report.getUnobservedTailMs());

        var detail = event(2, 10, 1, "step.timing", 20_000);
        detail.setDetailJson(summary("attempt-1", 1_000, 0, 1_000, 0));
        var measured = DispatchStepTimings.buildProgress(failed, List.of(events.getFirst(), detail), steps, now).getFirst();
        assertEquals(report.getDurationMs(), measured.getDurationMs());
        assertEquals(report.getUnobservedTailMs(), measured.getUnobservedTailMs());
    }

    @Test
    void measuresOnlyThisDispatchAndKeepsUnstartedStepsUnknown() {
        var rows = DispatchStepTimings.build(dispatch("RUNNING", 90_000L), List.of(
                event(1, 9, 1, "step.started", 0),
                event(2, 9, 1, "step.failed", 600_000),
                event(3, 10, 1, "step.started", 100_000),
                event(4, 10, 1, "step.completed", 110_000),
                event(5, 10, 2, "step.started", 111_000)),
                List.of(step(1), step(2), step(3)), new Date(131_000));
        assertEquals(10_000L, rows.get(0).getDurationMs());
        assertEquals("done", rows.get(0).getStatus());
        assertEquals(20_000L, rows.get(1).getDurationMs());
        assertEquals("active", rows.get(1).getStatus());
        assertNull(rows.get(2).getDurationMs());
        assertEquals("pending", rows.get(2).getStatus());
    }

    @Test
    void freezesIncompleteIntervalsAfterTerminationOrPause() {
        for (String status : List.of("FAILED", "CANCELED", "SUCCEEDED", "PAUSED")) {
            var rows = DispatchStepTimings.build(dispatch(status, 30_000L),
                    List.of(event(1, 10, 1, "step.started", 10_000)),
                    List.of(step(1)), new Date(900_000));
            assertEquals(0L, rows.get(0).getDurationMs(), status);
            assertEquals(20_000L, rows.get(0).getUnobservedTailMs(), status);
            assertNotEquals("active", rows.get(0).getStatus(), status);
        }
    }

    @Test
    void interruptionClosesTheStageBeforeADaysLaterCancellation() {
        var stop = event(5, 10, 1, "session.interrupted", 837);
        stop.setStepId(null);
        var row = DispatchStepTimings.build(dispatch("CANCELED", 604_800_000L), List.of(
                event(1, 10, 1, "step.started", 0),
                event(2, 10, 1, "llm.failed", 11),
                event(3, 10, 1, "turn.interrupted", 15), stop),
                List.of(step(1)), new Date(700_000_000)).getFirst();
        assertEquals(837L, row.getDurationMs());
        assertEquals(837L, row.getUnknownMs());
        assertEquals(0L, row.getUnobservedTailMs());
        assertEquals("cancelled", row.getStatus());
        for (String terminal : List.of("dispatch.cancelled", "dispatch.failed", "dispatch.completed")) {
            var end = event(6, 10, 1, terminal, 1_000); end.setStepId(null);
            var lateResume = event(7, 10, 1, "session.resumed", 2_000); lateResume.setStepId(null);
            row = DispatchStepTimings.build(dispatch("CANCELED", 1_000L), List.of(
                    event(1, 10, 1, "step.started", 0), stop, end, lateResume,
                    event(8, 10, 1, "agent.message", 3_000)), List.of(step(1)), new Date(9_000)).getFirst();
            assertEquals(837L, row.getDurationMs(), terminal);
            assertEquals(0L, row.getOtherWaitMs(), terminal);
        }
    }

    @Test
    void keepsTransientProviderFailureAndSeparatesConfirmedPauseFromWork() {
        var pause = event(3, 10, 1, "session.interrupted", 10_000);
        var resume = event(4, 10, 1, "session.resumed", 50_000);
        pause.setStepId(null); resume.setStepId(null);
        var row = DispatchStepTimings.build(dispatch("SUCCEEDED", 999_000L), List.of(
                event(1, 10, 1, "step.started", 0),
                event(2, 10, 1, "llm.failed", 5_000), pause, resume,
                event(5, 10, 1, "step.completed", 60_000)), List.of(step(1)), new Date(999_000)).getFirst();
        assertEquals(60_000L, row.getDurationMs());
        assertEquals(40_000L, row.getOtherWaitMs());
        assertEquals(20_000L, row.getAfterKnownWaitMs());
        assertNull(row.getExternalWaitMs());
    }

    @Test
    void sameAttemptRestartClosesAPauseButAnotherAttemptOrAFailureDoesNot() {
        for (String stop : List.of("dispatch.paused", "session.interrupted", "session.failed", "session.cancelled")) {
            for (Integer nextAttempt : java.util.Arrays.asList(null, 1, 2)) {
                var start = event(1, 10, 1, "step.started", 0);
                var restart = event(3, 10, 1, "step.started", 50_000);
                if (nextAttempt != null) {
                    start.setDetailJson("{\"stepAttempt\":1}");
                    restart.setDetailJson("{\"stepAttempt\":" + nextAttempt + "}");
                }
                var row = DispatchStepTimings.build(dispatch("SUCCEEDED", 60_000L), List.of(start,
                        event(2, 10, 1, stop, 10_000), restart, event(4, 10, 1, "step.completed", 60_000)),
                        List.of(step(1)), new Date(60_000)).getFirst();
                long wait = ("dispatch.paused".equals(stop) || "session.interrupted".equals(stop))
                        && !Integer.valueOf(2).equals(nextAttempt) ? 40_000L : 0L;
                assertEquals(wait, row.getOtherWaitMs());
                assertEquals(20_000L + wait, row.getDurationMs());
            }
        }
    }

    @Test
    void laterStageResumeCannotReopenAnEarlierInterruptedStage() {
        var stop = event(2, 10, 1, "session.interrupted", 10_000); stop.setStepId(null);
        var resume = event(4, 10, 2, "session.resumed", 25_000); resume.setStepId(null);
        var rows = DispatchStepTimings.build(dispatch("SUCCEEDED", 90_000L), List.of(
                event(1, 10, 1, "step.started", 0), stop, event(3, 10, 2, "step.started", 20_000), resume,
                event(5, 10, 2, "step.completed", 30_000)), List.of(step(1), step(2)), new Date(90_000));
        assertEquals(10_000L, rows.get(0).getDurationMs());
        assertEquals(0L, rows.get(0).getOtherWaitMs());
        assertEquals(10_000L, rows.get(1).getDurationMs());
        for (boolean nameOnly : List.of(false, true)) {
            var foreignStop = event(4, 10, 1, "session.interrupted", 23_000);
            var foreignResume = event(5, 10, 1, "session.resumed", 27_000);
            if (nameOnly) for (var boundary : List.of(foreignStop, foreignResume)) {
                boundary.setStepId(null); boundary.setStepName("Stage 1");
            }
            rows = DispatchStepTimings.build(dispatch("SUCCEEDED", 90_000L), List.of(
                    event(1, 10, 1, "step.started", 0), event(2, 10, 1, "step.completed", 10_000),
                    event(3, 10, 2, "step.started", 20_000), foreignStop, foreignResume,
                    event(6, 10, 2, "step.completed", 30_000)), List.of(step(1), step(2)), new Date(90_000));
            assertEquals(10_000L, rows.get(1).getDurationMs());
            assertEquals(0L, rows.get(1).getOtherWaitMs());
        }
    }

    @Test
    void accumulatesRerunsWithoutCountingTheGapOrDuplicateStarts() {
        var rows = DispatchStepTimings.build(dispatch("SUCCEEDED", 100_000L), List.of(
                event(1, 10, 1, "step.started", 0),
                event(2, 10, 1, "step.started", 1_000),
                event(3, 10, 1, "step.failed", 10_000),
                event(4, 10, 1, "step.started", 80_000),
                event(5, 10, 1, "step.completed", 100_000)),
                List.of(step(1)), new Date(900_000));
        assertEquals(30_000L, rows.get(0).getDurationMs());
    }

    @Test
    void preservesMissingMeasurementsAndReusedState() {
        var rows = DispatchStepTimings.build(dispatch("SUCCEEDED", 30_000L), List.of(
                event(1, 10, 1, "step.completed", 10_000),
                event(2, 10, 2, "step.reused", 11_000)),
                List.of(step(1), step(2)), new Date(900_000));
        assertNull(rows.get(0).getDurationMs());
        assertEquals("done", rows.get(0).getStatus());
        assertNull(rows.get(1).getDurationMs());
        assertEquals("reused", rows.get(1).getStatus());
    }

    @Test
    void retainsRecordedNamesAndBoundsClockSkewAndMissingEndTimes() {
        var start = event(1, 10, 1, "step.started", 10_000);
        start.setStepName("Original stage");
        var rows = DispatchStepTimings.build(dispatch("FAILED", null), List.of(start),
                List.of(step(1)), new Date(900_000));
        assertEquals(0L, rows.get(0).getDurationMs());
        assertEquals("Original stage", rows.get(0).getName());
        var reversed = DispatchStepTimings.build(dispatch("FAILED", 5_000L), List.of(start),
                List.of(step(1)), new Date(900_000));
        assertEquals(0L, reversed.get(0).getDurationMs());
    }

    @Test
    void delayedTelemetryCannotExtendAnUnclosedTerminatedStep() {
        for (String lateType : List.of("step.timing", "operation.timing", "runtime.last_observed", "runtime.operation_timing")) {
            var row = DispatchStepTimings.build(dispatch("FAILED", 90_000L), List.of(
                    event(1, 10, 1, "step.started", 0), event(2, 10, 1, "agent.tool_result", 10_000),
                    event(3, 10, 1, lateType, 80_000)), List.of(step(1)), new Date(90_000)).getFirst();
            assertEquals(10_000L, row.getDurationMs(), lateType);
            assertEquals(80_000L, row.getUnobservedTailMs(), lateType);
        }
    }

    @Test
    void actualRuntimeActivityIsObservedBeforeTermination() {
        for (String type : List.of("completion_requested", "skill.loaded", "skill.invoked", "plugin.loaded",
                "subagent.requested", "subagent.started", "subagent.completed", "subagent.failed", "subagent.cancelled",
                "context.compact_started", "context.compact_completed", "task.failed", "runtime.failed")) {
            var row = DispatchStepTimings.build(dispatch("FAILED", 90_000L), List.of(
                    event(1, 10, 1, "step.started", 0), event(2, 10, 1, type, 20_000)),
                    List.of(step(1)), new Date(90_000)).getFirst();
            assertEquals(20_000L, row.getDurationMs(), type);
            assertEquals(70_000L, row.getUnobservedTailMs(), type);
        }
    }

    @Test
    void failoverIsTheObservedBoundaryUntilTheNextExecutorStarts() {
        var start = event(1, 10, 1, "step.started", 1_000);
        var failover = event(2, 10, 1, "dispatch.executor_failover", 10_000);
        failover.setStepId(null);
        for (String status : List.of("PENDING", "FAILED")) {
            var dispatch = dispatch(status, 90_000L);
            assertEquals(new Date(10_000), DispatchStepTimings.observedCutoff(dispatch, List.of(start, failover), new Date(90_000)));
            var row = DispatchStepTimings.build(dispatch, List.of(start, failover), List.of(step(1)), new Date(90_000)).getFirst();
            assertEquals(9_000L, row.getDurationMs());
            assertEquals(0L, row.getUnobservedTailMs());
        }
    }

    @Test
    void artifactWorkExtendsAnOpenStageOnlyUntilItsCompletion() {
        var failed = dispatch("FAILED", 100_000L);
        var steps = List.of(step(1));
        var now = new Date(100_000);
        for (String type : List.of("artifact.discovered", "artifact.hashed", "artifact.sealed")) {
            var events = new java.util.ArrayList<>(List.of(
                    event(1, 10, 1, "step.started", 1_000),
                    event(3, 10, 1, type, 6_000),
                    event(4, 10, 1, "upload.completed", 90_000),
                    event(5, 10, 1, "runtime.checkpoint_saved", 95_000)));
            var open = DispatchStepTimings.build(failed, events, steps, now).getFirst();
            assertEquals(5_000L, open.getDurationMs(), type);
            assertEquals(94_000L, open.getUnobservedTailMs(), type);

            events.add(1, event(2, 10, 1, "step.completed", 3_000));
            assertEquals(2_000L, DispatchStepTimings.build(failed, events, steps, now).getFirst().getDurationMs(), type);
        }
    }

    @Test
    void lastActivityIsOnlyNeededForAClosedDispatchThatKeepsAStageOpen() {
        var now = new Date(300_000);
        var steps = List.of(step(1));
        var open = List.of(event(1, 10, 1, "step.started", 0));
        var closed = List.of(event(1, 10, 1, "step.started", 0), event(2, 10, 1, "step.completed", 1_000));
        assertTrue(DispatchStepTimings.needsLastActivity(dispatch("FAILED", 2_000L), open, steps, now));
        assertTrue(DispatchStepTimings.needsLastActivity(dispatch("CANCELED", 2_000L), open, steps, now));
        assertTrue(DispatchStepTimings.needsLastActivity(dispatch("PAUSED", 2_000L), open, steps, now));
        assertFalse(DispatchStepTimings.needsLastActivity(dispatch("RUNNING", 2_000L), open, steps, now));
        assertFalse(DispatchStepTimings.needsLastActivity(dispatch("SUCCEEDED", 2_000L), closed, steps, now));
        assertFalse(DispatchStepTimings.needsLastActivity(dispatch("SUCCEEDED", 2_000L), List.of(), steps, now));
        assertFalse(DispatchStepTimings.needsLastActivity(dispatch("SUCCEEDED", 2_000L), closed, List.of(), now));
        assertFalse(DispatchStepTimings.needsLastActivity(null, closed, steps, now));
    }

    private DispatchDO dispatch(String status, Long end) {
        DispatchDO dispatch = new DispatchDO();
        dispatch.setId(10L);
        dispatch.setStatus(status);
        if (end != null) dispatch.setGmtModified(new Date(end));
        return dispatch;
    }

    @Test
    void takesLatestSnapshotPerSegmentAndPreservesUnknownRemainder() {
        var partial = event(2, 10, 1, "step.timing", 2_000);
        partial.setDetailJson(summary("segment-a", 2_000, 1_000, 1_000, 0));
        var complete = event(4, 10, 1, "step.timing", 10_000);
        complete.setDetailJson(summary("segment-a", 10_000, 4_000, 2_000, 4_000));
        var replay = event(5, 10, 1, "step.timing", 2_000); replay.setDetailJson(partial.getDetailJson());
        var row = DispatchStepTimings.build(dispatch("SUCCEEDED", 90_000L), List.of(
                event(1, 10, 1, "step.started", 0), partial,
                event(3, 10, 1, "step.completed", 10_000), complete, replay), List.of(step(1)), new Date(90_000)).getFirst();
        assertEquals("done", row.getStatus());
        assertTrue(row.isInstrumented());
        assertEquals(4_000L, row.getExternalWaitMs());
        assertEquals(4_000L, row.getProcessingMs());
        assertEquals(2_000L, row.getUnknownMs());
        assertEquals(6_000L, row.getAfterKnownWaitMs());
        assertEquals(10_000L, row.getDurationMs());
    }

    @Test
    void unsupportedOrInvalidSummariesDoNotTurnMissingTelemetryIntoZero() {
        for (String detail : List.of("{bad-json", "{\"timing\":{\"version\":2}}", summary("bad", 10_000, -1, 1, 10_000),
                summary("fractional", 10_000, 1_000, 1_000, 8_000).replace("1000,", "1000.1,"),
                summary("coerced", 10_000, 1_000, 1_000, 8_000).replace("1000,", "\"1000\","))) {
            var summary = event(3, 10, 1, "step.timing", 10_000); summary.setDetailJson(detail);
            var row = DispatchStepTimings.build(dispatch("SUCCEEDED", 30_000L), List.of(
                    event(1, 10, 1, "step.started", 0), event(2, 10, 1, "step.completed", 10_000), summary),
                    List.of(step(1)), new Date(90_000)).getFirst();
            assertFalse(row.isInstrumented());
            assertNull(row.getExternalWaitMs());
            assertEquals(10_000L, row.getUnknownMs());
        }
    }

    @Test
    void clippedSegmentsOmitUnattributableOperationsButPreserveParallelTotalsInFullWindows() {
        for (long observed : List.of(0L, 5_000L, 10_000L)) {
            var report = event(3, 10, 1, "step.timing", 80_000);
            report.setDetailJson(summary("one", 10_000, 10_000, 0, 0).replace("}}", ",\"operations\":[{\"target\":\"api\",\"operation\":\"poll\",\"kind\":\"external_call\",\"count\":2,\"durationMs\":20000}]} }"));
            var row = DispatchStepTimings.build(dispatch("FAILED", 90_000L), List.of(
                    event(1, 10, 1, "step.started", 0), event(2, 10, 1, "agent.tool_result", observed), report),
                    List.of(step(1)), new Date(90_000)).getFirst();
            assertEquals(observed, row.getDurationMs());
            if (observed < 10_000) {
                assertFalse(row.isInstrumented());
                assertNull(row.getExternalWaitMs());
                assertEquals(observed, row.getUnknownMs());
                assertEquals(observed, row.getAfterKnownWaitMs());
                assertTrue(row.getOperations().isEmpty());
                assertEquals(1, row.getOmittedOperationGroups());
            } else {
                assertEquals(20_000L, row.getOperations().getFirst().getDurationMs());
                assertEquals(2L, row.getOperations().getFirst().getCount());
            }
        }
        var first = event(3, 10, 1, "step.timing", 10_000);
        first.setDetailJson(summary("first", 6_000, 6_000, 0, 0));
        var second = event(4, 10, 1, "step.timing", 10_000);
        second.setDetailJson(summary("second", 6_000, 0, 0, 6_000));
        for (var reports : List.of(List.of(first, second), List.of(second, first))) {
            var events = new java.util.ArrayList<>(List.of(event(1, 10, 1, "step.started", 0), event(2, 10, 1, "step.completed", 10_000)));
            events.addAll(reports);
            var row = DispatchStepTimings.build(dispatch("SUCCEEDED", 10_000L), events, List.of(step(1)), new Date(10_000)).getFirst();
            assertFalse(row.isInstrumented());
            assertNull(row.getExternalWaitMs());
            assertEquals(10_000L, row.getUnknownMs());
        }
    }

    @Test
    void reportsOperationGroupsBeyondTheBoundAsOmitted() {
        var report = event(3, 10, 1, "step.timing", 10_000);
        var detail = JSON.parseObject(summary("bounded", 5_000, 5_000, 0, 0));
        var groups = new JSONArray();
        for (int i = 0; i < 35; i++) groups.add(JSON.parseObject(
                "{\"target\":\"api" + i + "\",\"operation\":\"poll\",\"kind\":\"external_call\",\"count\":1,\"durationMs\":10}"));
        detail.getJSONObject("timing").put("operations", groups);
        detail.getJSONObject("timing").put("omittedOperationGroups", 2);
        report.setDetailJson(detail.toJSONString());
        var resumed = event(4, 10, 1, "step.timing", 10_000);
        var next = JSON.parseObject(summary("resumed", 5_000, 5_000, 0, 0));
        next.getJSONObject("timing").put("operations", List.of(groups.get(34), groups.get(0)));
        resumed.setDetailJson(next.toJSONString());
        var row = DispatchStepTimings.build(dispatch("SUCCEEDED", 10_000L), List.of(
                event(1, 10, 1, "step.started", 0), event(2, 10, 1, "step.completed", 10_000), report, resumed),
                List.of(step(1)), new Date(20_000)).getFirst();
        assertEquals(32, row.getOperations().size());
        assertEquals(6, row.getOmittedOperationGroups());
        assertEquals(2, row.getOperations().getFirst().getCount());
        assertEquals(20, row.getOperations().getFirst().getDurationMs());
        assertEquals(10_000, row.getExternalWaitMs());
    }

    @Test
    void timingWithConflictingStepIdentityCannotAttachByReusedOrder() {
        var report = event(3, 10, 2, "step.timing", 10_000);
        report.setStepOrder(1);
        report.setDetailJson(summary("old-step", 10_000, 10_000, 0, 0));
        var row = DispatchStepTimings.build(dispatch("SUCCEEDED", 10_000L), List.of(
                event(1, 10, 1, "step.started", 0), event(2, 10, 1, "step.completed", 10_000), report),
                List.of(step(1)), new Date(20_000)).getFirst();
        assertFalse(row.isInstrumented());
        assertNull(row.getExternalWaitMs());
        var stage = step(1); stage.setCode("build");
        report.setStepId(null); report.setStepKey("build");
        var duplicate = step(2); duplicate.setCode("build");
        report.setStepOrder(2);
        assertEquals(java.util.Set.of(duplicate), StepTimingSummaries.index(List.of(report), List.of(stage, duplicate)).keySet());
        report.setStepOrder(null);
        assertTrue(StepTimingSummaries.index(List.of(report), List.of(stage, duplicate)).isEmpty());
        report.setStepOrder(1);
        for (String key : java.util.Arrays.asList("build", null)) {
            report.setStepKey(key);
            var fallback = DispatchStepTimings.build(dispatch("SUCCEEDED", 10_000L), List.of(
                    event(1, 10, 1, "step.started", 0), event(2, 10, 1, "step.completed", 10_000), report),
                    List.of(stage), new Date(20_000)).getFirst();
            assertTrue(fallback.isInstrumented());
            assertEquals(10_000, fallback.getExternalWaitMs());
        }
    }

    private String summary(String segment, long elapsed, long external, long unknown, long processing) {
        return "{\"timing\":{\"version\":1,\"segmentId\":\"" + segment + "\",\"elapsedMs\":" + elapsed
                + ",\"externalWaitMs\":" + external + ",\"unknownMs\":" + unknown + ",\"processingMs\":" + processing + "}}";
    }

    private SdlcStepDO step(int id) {
        SdlcStepDO step = new SdlcStepDO();
        step.setId((long) id);
        step.setStepOrder(id);
        step.setName("Stage " + id);
        return step;
    }

    private DispatchRuntimeEventDO event(long id, long dispatchId, int step, String type, long time) {
        DispatchRuntimeEventDO event = new DispatchRuntimeEventDO();
        event.setId(id);
        event.setDispatchId(dispatchId);
        event.setStepId((long) step);
        event.setEventType(type);
        event.setEventTime(new Date(time));
        return event;
    }
}
