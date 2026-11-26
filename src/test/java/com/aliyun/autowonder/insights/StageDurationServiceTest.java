package com.aliyun.autowonder.insights;

import com.aliyun.autowonder.common.error.KeyedIllegalArgumentException;
import com.aliyun.autowonder.insights.StageDurationService.Event;
import com.aliyun.autowonder.insights.dto.StageDurationPlanVO;
import com.aliyun.autowonder.insights.dto.StageDurationVO;
import com.aliyun.autowonder.sdlc.SdlcExecutionSnapshot;
import com.aliyun.autowonder.sdlc.SdlcExecutionSnapshotService;
import com.aliyun.autowonder.sdlc.SdlcStepDO;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class StageDurationServiceTest {
    private final StageDurationDao dao = mock(StageDurationDao.class);
    private final StageDurationService service = new StageDurationService(dao);
    private final LocalDate start = LocalDate.of(2026, 1, 1), end = start.plusDays(6);

    @Test
    void versionComparisonBoundsEachVersionBeforeFilteringStageMeasurements() {
        var first = execution(1, 5, "FAILED", 10_000);
        first.setAgentId(7L); first.setAgentVersionId(70L);
        var second = execution(2, 5, "SUCCEEDED", 10_000);
        second.setAgentId(7L); second.setAgentVersionId(71L);
        when(dao.listVersionExecutions(9, 7, 70, null, null, 30, false)).thenReturn(List.of(first));
        when(dao.listVersionExecutions(9, 7, 71, null, null, 30, false)).thenReturn(List.of(second));
        when(dao.listEvents(9, List.of(1L, 2L))).thenReturn(List.of(event(1, 2, 10, "step.started", 0),
                event(2, 2, 10, "step.completed", 1_000)));
        var report = service.versionSamples(9, 7, List.of(70L, 71L), null, null, false);
        assertEquals(30, report.getSampleLimit());
        assertEquals(2, report.getExecutionCount());
        assertEquals(List.of(1L, 2L), report.getVersionSamples().stream().map(StageDurationVO.Sample::getDispatchId).toList());
        assertNull(report.getVersionSamples().getFirst().getDurationMs());
        assertEquals(1_000L, report.getVersionSamples().getLast().getStages().getFirst().getDurationMs());
        assertFalse(report.getVersionSamples().getLast().isComplete());
        verify(dao, never()).listExecutions(anyLong(), any(), any(), any(), any(), any(), any(), any(), anyInt(), anyBoolean(), any());
    }

    @Test
    void scopesEachVersionToInclusiveBeijingDatesBeforeApplyingItsSampleLimit() {
        var lower = Date.from(Instant.parse("2025-12-31T16:00:00Z"));
        var upper = Date.from(Instant.parse("2026-01-07T16:00:00Z"));
        var report = service.versionSamples(9, 7, List.of(70L, 71L), start, end, false);
        verify(dao).listVersionExecutions(9, 7, 70, lower, upper, 30, false);
        verify(dao).listVersionExecutions(9, 7, 71, lower, upper, 30, false);
        assertTrue(report.getVersionSamples().isEmpty());
        assertEquals("2026-01-01", report.getStartDate());
        assertEquals("2026-01-07", report.getEndDate());
        assertEquals(30, report.getSampleLimit());
    }

    @Test
    void rejectsPartialReversedFutureAndOverlongVersionDateRangesBeforeReadingData() {
        for (var dates : new LocalDate[][]{{start, null}, {null, end}, {end, start},
                {start, start.plusDays(366)}, {LocalDate.now(ZoneId.of("Asia/Shanghai")), LocalDate.now(ZoneId.of("Asia/Shanghai")).plusDays(1)}}) {
            assertThrows(KeyedIllegalArgumentException.class,
                    () -> service.versionSamples(9, 7, List.of(70L), dates[0], dates[1], false));
        }
        verifyNoInteractions(dao);
    }

    @Test
    void rejectsInvalidOrUnboundedVersionSelectionsAndAgentIdsBeforeReadingData() {
        for (var ids : List.of(List.<Long>of(), List.of(1L, 2L, 3L), List.of(1L, 1L), List.of(0L), List.of(-1L))) {
            assertThrows(KeyedIllegalArgumentException.class, () -> service.versionSamples(9, 7, ids, null, null, false));
        }
        assertThrows(KeyedIllegalArgumentException.class, () -> service.versionSamples(9, 7, null, null, null, false));
        assertThrows(KeyedIllegalArgumentException.class, () -> service.versionSamples(9, 0, List.of(1L), null, null, false));
        assertThrows(KeyedIllegalArgumentException.class, () -> service.versions(9, -1, false));
        assertThrows(KeyedIllegalArgumentException.class, () -> service.get(9, start, end, null, null, "agent_version", 0L));
        verifyNoInteractions(dao);
    }

    @Test
    void historicalRecoveryAdvancesPastFailuresAndRetriesUnknownRecordsOnlyOnExplicitNewPass() {
        var snapshots = mock(SdlcExecutionSnapshotService.class);
        ReflectionTestUtils.setField(service, "snapshotService", snapshots);
        List<StageDurationService.Execution> executions = new ArrayList<>();
        for (int i = 1; i <= 25; i++) {
            var row = execution(i, 5, "SUCCEEDED", 10_000);
            row.setTenantId(9L); row.setPackageOssRef("bucket/9/100/" + i + ".zip");
            executions.add(row);
        }
        executions.get(0).setSnapshotSource("UNVERIFIED");
        executions.get(1).setSnapshotSource("UNAVAILABLE");
        executions.get(2).setStatus("RUNNING");
        executions.get(3).setSnapshotId(40L);
        given(executions, List.of());
        var eligible = executions.stream().filter(row -> row.getId() != 3 && row.getId() != 4)
                .sorted(Comparator.comparing(StageDurationService.Execution::getId).reversed()).toList();
        when(dao.listRecoverableExecutions(eq(9L), any(), any(), isNull(), isNull(), nullable(Long.class)))
                .thenAnswer(call -> { Long cursor = call.getArgument(5); return eligible.stream().filter(row -> cursor == null || row.getId() < cursor).limit(20).toList(); });
        when(dao.countRecoverableExecutions(eq(9L), any(), any(), isNull(), isNull(), nullable(Long.class)))
                .thenAnswer(call -> { Long cursor = call.getArgument(5); return (int) eligible.stream().filter(row -> cursor == null || row.getId() < cursor).count(); });
        when(snapshots.recover(any(), any())).thenAnswer(call -> {
            StageDurationService.Execution row = call.getArgument(0);
            if (row.getId() >= 6) throw new IllegalStateException("persistent failure");
            return true;
        });
        var first = service.recoverSnapshots(9, start, end, null, null, null);
        assertEquals(new StageDurationVO.Recovery(20, 0, 0, 20, 3, 6L), first);
        var second = service.recoverSnapshots(9, start, end, null, null, first.nextBeforeDispatchId());
        assertEquals(new StageDurationVO.Recovery(3, 3, 0, 0, 0, null), second);
        assertEquals(0, service.recoverSnapshots(9, start, end, null, null, 1L).checked());
        verify(dao, never()).countRecoverableExecutions(eq(9L), any(), any(), isNull(), isNull(), eq(1L));
        verify(snapshots).recover(executions.get(0), null);
        verify(snapshots).recover(executions.get(1), null);
        verify(snapshots, times(23)).recover(any(), any());
        clearInvocations(snapshots);
        service.get(9, start, end, null, null, "sdlc_snapshot", null);
        verifyNoInteractions(snapshots);
        service.recoverSnapshots(9, start, end, null, null, null);
        verify(snapshots, times(20)).recover(any(), any());
        assertThrows(KeyedIllegalArgumentException.class, () -> service.recoverSnapshots(9, start, end, null, null, 0L));
    }

    @Test
    void snapshotGroupingSeparatesVerifiedConfigurationsAndUnknownWithoutBorrowingForeignFlows() {
        List<StageDurationService.Execution> executions = new ArrayList<>();
        List<Event> events = new ArrayList<>();
        for (int i = 1; i <= 4; i++) {
            var row = execution(i, 5, "SUCCEEDED", 10_000);
            row.setSnapshotId(i == 4 ? null : 39L + i); executions.add(row);
            events.add(event(i * 2, i, 10, "step.started", 0));
            events.add(event(i * 2 + 1, i, 10, "step.completed", i * 1000));
        }
        List<SdlcExecutionSnapshot> snapshots = new ArrayList<>();
        for (long id = 40; id <= 42; id++) {
            var snapshot = SdlcExecutionSnapshot.from(9, id == 42 ? 6 : 5, Map.of("steps", List.of(Map.of("id", "10", "instruction", "config " + id))));
            snapshot.setId(id); snapshot.setGmtCreate(new Date(0)); snapshots.add(snapshot);
        }
        when(dao.listSnapshots(eq(9L), anyList())).thenReturn(snapshots);
        given(executions, events);
        var report = service.get(9, start, end, null, null, "sdlc_snapshot", null);
        assertEquals(3, report.getStages().size());
        assertEquals(2, report.getStages().stream().filter(row -> row.getSnapshotId() == null).findFirst().orElseThrow().getSampleCount());
        assertEquals(1000L, report.getStages().stream().filter(row -> Objects.equals(row.getSnapshotId(), 40L)).findFirst().orElseThrow().getMedianDurationMs());
        assertEquals(2000L, report.getStages().stream().filter(row -> Objects.equals(row.getSnapshotId(), 41L)).findFirst().orElseThrow().getMedianDurationMs());
    }

    @Test
    void explicitDifferentStageIdentityCannotCompleteTheRequiredSnapshotStageByOrder() {
        var row = execution(1, 5, "SUCCEEDED", 10_000); row.setSnapshotId(40L);
        var snapshot = SdlcExecutionSnapshot.from(9, 5, Map.of("steps", List.of(Map.of("id", "10", "required", true))));
        snapshot.setId(40L); snapshot.setGmtCreate(new Date(0));
        when(dao.listSnapshots(9, List.of(40L))).thenReturn(List.of(snapshot));
        var started = event(1, 1, 99, "step.started", 0); started.setStepOrder(1);
        var completed = event(2, 1, 99, "step.completed", 1000); completed.setStepOrder(1);
        given(List.of(row), List.of(started, completed));
        var result = service.get(9, start, end, null, null, "sdlc_snapshot", null).getVersionSamples().getFirst();
        assertFalse(result.isComplete());
        assertEquals("5:id:99", result.getStages().getFirst().getKey());
    }

    @Test
    void orderOnlyEvidenceCannotProveTheFrozenRequiredStageIdentity() {
        var row = execution(1, 5, "SUCCEEDED", 10_000); row.setSnapshotId(40L);
        var snapshot = SdlcExecutionSnapshot.from(9, 5, Map.of("steps", List.of(Map.of("id", "10", "required", true))));
        snapshot.setId(40L); snapshot.setGmtCreate(new Date(0));
        when(dao.listSnapshots(9, List.of(40L))).thenReturn(List.of(snapshot));
        var started = legacy(1, 1, "step.started", 0); started.setStepOrder(1);
        var completed = legacy(2, 1, "step.completed", 1000); completed.setStepOrder(1);
        given(List.of(row), List.of(started, completed));
        assertFalse(service.get(9, start, end, null, null, "sdlc_snapshot", null).getVersionSamples().getFirst().isComplete());
    }

    @Test
    void returnsExecutionTotalsAndOnlyMarksCompleteWhenTheFrozenRequiredStagesAreMeasured() {
        List<StageDurationService.Execution> executions = new ArrayList<>();
        List<Event> events = new ArrayList<>();
        long[][] durations = {{2, 100}, {50, 50}, {100, 2}, {2}, {20, 5}};
        for (int i = 0; i < durations.length; i++) {
            var execution = execution(i + 1, 5, i == 4 ? "FAILED" : "SUCCEEDED", 200_000);
            execution.setSnapshotId(40L); execution.setAgentId(7L); execution.setAgentVersionId(70L);
            executions.add(execution);
            for (int stage = 0; stage < durations[i].length; stage++) {
                var started = event(events.size() + 1, i + 1, 10 + stage, "step.started", 0);
                var completed = event(events.size() + 2, i + 1, 10 + stage, "step.completed", durations[i][stage] * 1000);
                started.setStepOrder(stage + 1); completed.setStepOrder(stage + 1);
                events.add(started); events.add(completed);
            }
        }
        var snapshot = SdlcExecutionSnapshot.from(9, 5, Map.of("steps", List.of(
                Map.of("id", "10", "required", true), Map.of("id", "11", "required", true))));
        snapshot.setId(40L); snapshot.setGmtCreate(new Date(0));
        when(dao.listSnapshots(9, List.of(40L))).thenReturn(List.of(snapshot));
        var current = new SdlcStepDO(); current.setId(10L); current.setSdlcId(5L); current.setStepOrder(2);
        when(dao.listCurrentSteps(9, List.of(5L))).thenReturn(List.of(current));
        given(executions, events);

        for (String mode : List.of("agent_version", "sdlc_snapshot")) {
            var report = service.get(9, start, end, null, null, mode, null);
            assertEquals(List.of(102_000L, 100_000L, 102_000L, 2_000L, 25_000L),
                    report.getVersionSamples().stream().map(StageDurationVO.VersionSample::getDurationMs).toList());
            assertEquals(List.of(true, true, true, false, false),
                    report.getVersionSamples().stream().map(StageDurationVO.VersionSample::isComplete).toList());
            assertEquals(report.getTotalDurationMs(), report.getVersionSamples().stream().mapToLong(StageDurationVO.Sample::getDurationMs).sum());
            assertEquals(1, report.getFlowSnapshots().size());
            assertTrue(report.getStages().stream().filter(s -> s.getStepId() == 10L).findFirst().orElseThrow().isCurrentDefinition());
            assertEquals(1, report.getStages().stream().filter(s -> s.getStepId() == 10L).findFirst().orElseThrow().getStepOrder());
            assertFalse(report.getStages().stream().filter(s -> s.getStepId() == 11L).findFirst().orElseThrow().isCurrentDefinition());
        }
        var summary = service.get(9, start, end, null, null, "stage", null);
        assertTrue(summary.getVersionSamples().isEmpty());
        assertTrue(summary.getFlowSnapshots().isEmpty());
    }

    @Test
    void unknownSnapshotDoesNotPretendThatMissingStageRecordsAreZero() {
        var known = execution(1, 5, "SUCCEEDED", 50_000);
        given(List.of(known), List.of(event(1, 1, 10, "step.started", 0), event(2, 1, 10, "step.completed", 10_000)));
        var report = service.get(9, start, end, null, null, "agent_version", null);
        assertEquals(10_000L, report.getVersionSamples().getFirst().getDurationMs());
        assertFalse(report.getVersionSamples().getFirst().isComplete());
        assertNull(report.getVersionSamples().getFirst().getSnapshotId());
        assertEquals(10_000L, report.getStages().getFirst().getAverageDurationMs(), "Existing per-stage metrics retain their original cohort");
    }

    @Test
    void accumulatesRerunsAndComputesCompletedPercentilesWithoutCountingGapsOrOtherFlows() {
        var events = List.of(event(1, 1, 10, "step.started", 0), event(2, 1, 10, "step.failed", 10_000),
                event(3, 1, 10, "step.started", 90_000), event(4, 1, 10, "step.completed", 110_000),
                event(5, 2, 10, "step.started", 0), event(6, 2, 10, "step.completed", 10_000),
                event(7, 3, 10, "step.started", 0), event(8, 3, 10, "step.completed", 90_000));
        given(List.of(execution(1, 5, "SUCCEEDED", 120_000), execution(2, 5, "SUCCEEDED", 120_000),
                execution(3, 6, "SUCCEEDED", 120_000)), events);
        StageDurationVO report = service.get(9, start, end, 7L, 5L, "stage", null);
        var stage = report.getStages().stream().filter(s -> s.getSdlcId() == 5L).findFirst().orElseThrow();
        assertEquals(40_000, stage.getTotalDurationMs());
        assertEquals(20_000, stage.getAverageDurationMs());
        assertEquals(20_000, stage.getMedianDurationMs());
        assertEquals(30_000, stage.getP90DurationMs());
        assertEquals(2, stage.getSampleCount());
        assertEquals(3, report.getExecutionCount());
        assertEquals(1, report.getWorkitemCount());
        assertEquals(3, report.getMeasuredExecutionCount());
        assertEquals(2, report.getStages().size());
        assertEquals(130_000, report.getTotalDurationMs());
        verify(dao).listExecutions(eq(9L), eq(Date.from(Instant.parse("2025-12-31T16:00:00Z"))),
                eq(Date.from(Instant.parse("2026-01-07T16:00:00Z"))), eq(7L), eq(5L), isNull(), isNull(), isNull(), eq(5001), eq(false), isNull());
        assertEquals(1, events.get(0).getStepOrder());
    }

    @Test
    void separatesRunningPausedFailedAndMissingSamplesFromCompletedStatistics() {
        given(List.of(execution(1, 5, "RUNNING", 100_000), execution(2, 5, "PAUSED", 30_000),
                execution(3, 5, "FAILED", 40_000), execution(4, 5, "SUCCEEDED", 50_000)),
                List.of(event(1, 1, 10, "step.started", 10_000), event(2, 2, 10, "step.started", 10_000),
                        event(3, 3, 10, "step.started", 10_000), event(4, 3, 10, "step.failed", 25_000),
                        event(5, 4, 10, "step.completed", 50_000)));
        var report = service.get(9, start, end, null, null, "stage", null);
        var stage = report.getStages().getFirst();
        assertEquals(1, stage.getActiveCount());
        assertEquals(2, stage.getIncompleteCount());
        assertEquals(1, stage.getCompletedCount());
        assertEquals(1, stage.getMissingDurationCount());
        assertNull(stage.getAverageDurationMs());
        assertNull(stage.getMedianDurationMs());
        assertNull(stage.getP90DurationMs());
        assertEquals(3, report.getMeasuredExecutionCount());
        assertEquals(Instant.parse(report.getCalculatedAt()).toEpochMilli() - 10_000,
                stage.getSlowest().stream().filter(s -> s.getDispatchId() == 1).findFirst().orElseThrow().getDurationMs());
        assertEquals(0, stage.getSlowest().stream().filter(s -> s.getDispatchId() == 2).findFirst().orElseThrow().getDurationMs());
        var failure = event(2, 1, 10, "session.failed", 20_000); failure.setError("provider session failed");
        given(List.of(execution(1, 5, "RUNNING", 100_000)),
                List.of(event(1, 1, 10, "step.started", 10_000), failure));
        for (String groupBy : List.of("stage", "agent_version")) {
            stage = service.get(9, start, end, null, null, groupBy, null).getStages().getFirst();
            assertEquals("failed", stage.getSlowest().getFirst().getStatus());
            assertEquals(0, stage.getActiveCount());
            assertEquals(10_000L, stage.getSlowest().getFirst().getDurationMs());
        }
    }

    @Test
    void preservesUnknownCoverageReuseSkipAndHistoricalNamesWithoutCurrentDefinitions() {
        var unknownFlow = execution(3, 5, "SUCCEEDED", 40_000); unknownFlow.setSdlcId(null);
        var done = event(1, 1, 10, "step.completed", 10_000); done.setStepName("User supplied 名称");
        given(List.of(execution(1, 5, "SUCCEEDED", 30_000), execution(2, 5, "SUCCEEDED", 30_000), unknownFlow),
                List.of(done, event(2, 1, 11, "step.reused", 20_000), event(3, 1, 12, "step.skipped", 25_000)));
        var report = service.get(9, start, end, null, null, "stage", null);
        assertEquals(0, report.getMeasuredExecutionCount());
        assertEquals(1, report.getMissingDurationCount());
        assertEquals(3, report.getStages().size());
        var stage = report.getStages().stream().filter(s -> s.getStepId() == 10L).findFirst().orElseThrow();
        assertEquals("User supplied 名称", stage.getName());
        assertEquals(1, report.getStages().stream().mapToInt(StageDurationVO.Stage::getReusedCount).sum());
        assertEquals(1, report.getStages().stream().mapToInt(StageDurationVO.Stage::getSkippedCount).sum());
    }

    @Test
    void pairsLegacyOrderOnlyEventsWithUniqueRecordedIdsAndKeepsDistinctIdsApart() {
        var legacyStart = event(1, 1, 10, "step.started", 0); legacyStart.setStepId(null);
        var completed = event(2, 1, 10, "step.completed", 10_000);
        var otherStart = event(3, 2, 11, "step.started", 0);
        var otherEnd = event(4, 2, 11, "step.completed", 20_000);
        given(List.of(execution(1, 5, "SUCCEEDED", 30_000), execution(2, 5, "SUCCEEDED", 30_000)),
                List.of(legacyStart, completed, otherStart, otherEnd));
        var report = service.get(9, start, end, null, null, "stage", null);
        assertEquals(2, report.getStages().size());
        assertEquals(30_000, report.getTotalDurationMs());
        assertEquals(0, report.getMissingDurationCount());
    }

    @Test
    void usesLastRuntimeObservationWithoutLoadingToolPayloadsOrExtendingToBusinessUpdates() {
        var execution = execution(1, 5, "FAILED", 30_000);
        when(dao.lastActivities(9L, List.of(1L))).thenReturn(List.of(event(2, 1, 10, "runtime.last_activity", 10_000)));
        given(List.of(execution), List.of(event(1, 1, 10, "step.started", 0)));
        var stage = service.get(9, start, end, null, null, "stage", null).getStages().getFirst();
        assertEquals(10_000, stage.getTotalDurationMs());
        assertEquals(10_000, stage.getUnknownMs());
        assertEquals(20_000, stage.getUnobservedTailMs());
        assertNull(stage.getExternalWaitMs());
    }

    @Test
    void limitsDrilldownWithoutTruncatingSummarySamples() {
        List<StageDurationService.Execution> executions = new ArrayList<>();
        List<Event> events = new ArrayList<>();
        for (int i = 1; i <= 20; i++) {
            executions.add(execution(i, 5, "SUCCEEDED", 30_000));
            events.add(event(2L * i, i, 10, "step.started", 0));
            events.add(event(2L * i + 1, i, 10, "step.completed", i * 1000L));
        }
        given(executions, events);
        var stage = service.get(9, start, end, null, null, "stage", null).getStages().getFirst();
        assertEquals(20, stage.getCompletedCount());
        assertEquals(10_500, stage.getMedianDurationMs());
        assertEquals(18_000, stage.getP90DurationMs());
        assertEquals(10, stage.getSlowest().size());
        assertEquals(20, stage.getSlowest().getFirst().getDispatchId());
    }

    @Test
    void coversEveryExecutionAcrossBoundedQueriesAndFallsBackToExistingStepNames() {
        List<StageDurationService.Execution> executions = new ArrayList<>();
        List<Event> events = new ArrayList<>();
        for (int id = 1; id <= 201; id++) {
            executions.add(execution(id, 5, "SUCCEEDED", 2_000));
            for (var event : List.of(event(2L * id, id, 10, "step.started", 0),
                    event(2L * id + 1, id, 10, "step.completed", 1_000))) {
                event.setStepName(null); event.setFallbackStepName("Existing stage"); events.add(event);
            }
        }
        given(executions, events);
        var report = service.get(9, start, end, null, null, "stage", null);
        assertEquals(201, report.getMeasuredExecutionCount());
        assertEquals(201_000, report.getTotalDurationMs());
        var stage = report.getStages().getFirst();
        assertEquals("Existing stage", stage.getName());
        assertEquals(201, stage.getCompletedCount());
        assertEquals(1_000, stage.getMedianDurationMs());
        verify(dao, times(3)).listEvents(eq(9L), argThat(ids -> !ids.isEmpty() && ids.size() <= 100));
        verify(dao, never()).lastActivities(anyLong(), anyList());
    }

    @Test
    void loadsLastActivityOnlyForClosedExecutionsThatKeepAStageOpen() {
        var closed = execution(1, 5, "SUCCEEDED", 30_000);
        var openFailed = execution(2, 5, "FAILED", 30_000);
        var openRunning = execution(3, 5, "RUNNING", 30_000);
        var silent = execution(4, 5, "SUCCEEDED", 30_000);
        given(List.of(closed, openFailed, openRunning, silent), List.of(
                event(1, 1, 10, "step.started", 0), event(2, 1, 10, "step.completed", 10_000),
                event(3, 2, 10, "step.started", 0), event(4, 3, 10, "step.started", 0)));
        when(dao.lastActivities(9L, List.of(2L))).thenReturn(List.of(event(5, 2, 10, "runtime.last_activity", 10_000)));
        var report = service.get(9, start, end, null, null, "stage", null);
        verify(dao, times(1)).lastActivities(anyLong(), anyList());
        verify(dao).lastActivities(9L, List.of(2L));
        var stage = report.getStages().getFirst();
        assertEquals(10_000L, stage.getSlowest().stream().filter(s -> s.getDispatchId() == 2L).findFirst().orElseThrow().getDurationMs());
    }

    @Test
    void newAttemptAfterAPauseDoesNotCountThePauseAsStageDuration() {
        var firstStart = event(1, 1, 10, "step.started", 0);
        firstStart.setDetailJson("{\"stepAttempt\":1}");
        var secondStart = event(3, 1, 10, "step.started", 50_000);
        secondStart.setDetailJson("{\"stepAttempt\":2}");
        given(List.of(execution(1, 5, "SUCCEEDED", 60_000)), List.of(firstStart,
                event(2, 1, 10, "dispatch.paused", 10_000), secondStart, event(4, 1, 10, "step.completed", 60_000)));
        var stage = service.get(9, start, end, null, null, "stage", null).getStages().getFirst();
        assertEquals(20_000, stage.getTotalDurationMs());
        assertEquals(0, stage.getOtherWaitMs());
        assertEquals(20_000, stage.getAverageDurationMs());
    }

    @Test
    void planGroupsShardsByFlowAndKeepsUncountableTotalsAtTheOverview() {
        var first = execution(1, 5, "SUCCEEDED", 10_000);
        var second = execution(2, 5, "FAILED", 10_000);
        var third = execution(3, 6, "SUCCEEDED", 20_000);
        third.setWorkitemId(101L);
        var orphan = execution(4, 5, "SUCCEEDED", 30_000);
        orphan.setSdlcId(null);
        given(List.of(first, second, third, orphan), List.of());
        var plan = service.plan(9, start, end, null, null, null, null, null, false);
        assertEquals("single", plan.getMode());
        assertEquals(4, plan.getExecutionCount());
        assertEquals(2, plan.getWorkitemCount());
        assertEquals(1, plan.getNotApplicableExecutionCount());
        assertEquals(4L, plan.getSnapshot().getMaxDispatchId().longValue());
        assertEquals("1970-01-01", plan.getFirstExecutionDate());
        assertEquals("1970-01-01", plan.getLastExecutionDate());
        assertNotNull(plan.getSnapshot().getCalculatedAt());
        assertEquals(List.of(5L, 6L), plan.getShards().stream().map(StageDurationPlanVO.Shard::getSdlcId).toList());
        assertEquals(List.of(2, 1), plan.getShards().stream().map(StageDurationPlanVO.Shard::getExecutionCount).toList());
        assertEquals("Flow 5", plan.getShards().getFirst().getSdlcName());
        assertFalse(plan.getShards().getFirst().isOversized());
        verify(dao, never()).listEvents(anyLong(), anyList());
        verify(dao, never()).lastActivities(anyLong(), anyList());
        verify(dao, never()).listSnapshots(anyLong(), anyList());
    }

    @Test
    void planSplitsLargeWindowsAndFlagsOversizedFlowsWithoutCountingWorkitemsTwice() {
        List<StageDurationService.Execution> many = new ArrayList<>();
        for (int id = 1; id <= 201; id++) {
            var row = execution(id, id % 2 == 0 ? 5 : 6, "SUCCEEDED", 1_000);
            row.setWorkitemId(id % 2 == 0 ? 100L : 101L);
            many.add(row);
        }
        given(many, List.of());
        var plan = service.plan(9, start, end, null, null, null, null, null, false);
        assertEquals("sharded", plan.getMode());
        assertEquals(List.of(6L, 5L), plan.getShards().stream().map(StageDurationPlanVO.Shard::getSdlcId).toList());
        assertEquals(List.of(101, 100), plan.getShards().stream().map(StageDurationPlanVO.Shard::getExecutionCount).toList());
        assertEquals(2, plan.getWorkitemCount());
        assertEquals("single", service.plan(9, start, end, null, 5L, null, null, null, false).getMode());
        given(Collections.nCopies(501, execution(1, 5, "SUCCEEDED", 1_000)), List.of());
        var oversized = service.plan(9, start, end, null, null, null, null, null, false);
        assertEquals("single", oversized.getMode());
        assertTrue(oversized.getShards().getFirst().isOversized());
    }

    @Test
    void rejectsInvalidStatusVersionAndWorkerFiltersBeforeReadingData() {
        assertThrows(KeyedIllegalArgumentException.class, () -> service.get(9, start, end, null, null, "stage", null, 0L, null, false));
        assertThrows(KeyedIllegalArgumentException.class, () -> service.get(9, start, end, null, null, "stage", null, null, "NOT_A_STATUS", false));
        assertThrows(KeyedIllegalArgumentException.class, () -> service.plan(9, start, end, null, null, 0L, null, null, false));
        assertThrows(KeyedIllegalArgumentException.class, () -> service.plan(9, start, end, null, null, null, 0L, null, false));
        assertThrows(KeyedIllegalArgumentException.class, () -> service.plan(9, start, end, null, null, null, null, "NOT_A_STATUS", false));
        verifyNoInteractions(dao);
    }

    @Test
    void appliesTheSnapshotAnchorOnlyWhenTheCallerSuppliesOne() {
        given(List.of(execution(1, 5, "SUCCEEDED", 10_000)), List.of(
                event(1, 1, 10, "step.started", 0), event(2, 1, 10, "step.completed", 1_000)));
        service.get(9, start, end, null, null, "stage", null, null, null, false, 42L);
        verify(dao).listExecutions(eq(9L), any(), any(), isNull(), isNull(), isNull(), isNull(), isNull(), eq(5001), eq(false), eq(42L));
    }

    @Test
    void recordedNameWinsWhenLaterEventsOnlyHaveCurrentDefinitionFallback() {
        var first = event(1, 1, 10, "step.started", 0);
        first.setStepName("Historical name"); first.setFallbackStepName("Renamed definition");
        var last = event(2, 1, 10, "step.completed", 1_000);
        last.setStepName(null); last.setFallbackStepName("Renamed definition");
        given(List.of(execution(1, 5, "SUCCEEDED", 2_000)), List.of(first, last));
        assertEquals("Historical name", service.get(9, start, end, null, null, "stage", null).getStages().getFirst().getName());
        assertNull(last.getStepName());
    }

    @Test
    void comparesActualVersionsWithoutMixingWorkersOrReplacingUnknownHistory() {
        List<StageDurationService.Execution> executions = new ArrayList<>();
        List<Event> events = new ArrayList<>();
        long[] durations = {10_000, 30_000, 20_000, 40_000, 50_000, 60_000};
        for (int i = 0; i < durations.length; i++) {
            var execution = execution(i + 1, 5, "SUCCEEDED", durations[i]);
            execution.setAgentId(i == 3 ? 8L : 7L);
            execution.setAgentName("Original 员工");
            execution.setAgentVersionId(i == 4 ? null : i < 2 ? 70L : i == 2 ? 71L : i == 3 ? 80L : 79L);
            execution.setAgentVersionNo(i >= 4 ? null : i == 2 ? 2 : 1);
            execution.setCurrentAgentVersion(i == 2);
            executions.add(execution);
            events.add(event(i * 2L + 1, i + 1, 10, "step.started", 0));
            events.add(event(i * 2L + 2, i + 1, 10, "step.completed", durations[i]));
        }
        given(executions, events);
        var summary = service.get(9, start, end, null, null, "stage", null);
        var comparison = service.get(9, start, end, null, null, "agent_version", null);
        assertEquals(1, summary.getStages().size());
        assertNull(summary.getStages().getFirst().getAgentVersionId());
        assertEquals(5, comparison.getStages().size());
        assertEquals(210_000, comparison.getTotalDurationMs());
        assertEquals(summary.getTotalDurationMs(), comparison.getTotalDurationMs());
        assertEquals(summary.getExecutionCount(), comparison.getExecutionCount());
        assertEquals(summary.getWorkitemCount(), comparison.getWorkitemCount());
        assertEquals(summary.getMeasuredExecutionCount(), comparison.getMeasuredExecutionCount());
        assertEquals(summary.getMissingDurationCount(), comparison.getMissingDurationCount());
        var old = comparison.getStages().stream().filter(s -> Objects.equals(s.getAgentVersionId(), 70L)).findFirst().orElseThrow();
        assertEquals(2, old.getSampleCount());
        assertEquals(20_000, old.getAverageDurationMs());
        assertEquals(20_000, old.getMedianDurationMs());
        assertEquals(30_000, old.getP90DurationMs());
        assertEquals("Original 员工", old.getAgentName());
        assertFalse(old.getCurrentAgentVersion());
        assertTrue(old.getSlowest().stream().allMatch(s -> s.getAgentId() == 7L && s.getAgentVersionId() == 70L
                && s.getAgentVersionNo() == 1 && !s.isCurrentAgentVersion()));
        var current = comparison.getStages().stream().filter(s -> Boolean.TRUE.equals(s.getCurrentAgentVersion())).findFirst().orElseThrow();
        assertEquals(71L, current.getAgentVersionId());
        assertEquals(2, current.getAgentVersionNo());
        assertEquals(20_000, current.getAverageDurationMs());
        var unknown = comparison.getStages().stream().filter(s -> s.getAgentVersionId() == null).findFirst().orElseThrow();
        assertNull(unknown.getAgentVersionNo());
        assertEquals(50_000, unknown.getTotalDurationMs());
        var orphan = comparison.getStages().stream().filter(s -> Objects.equals(s.getAgentVersionId(), 79L)).findFirst().orElseThrow();
        assertNull(orphan.getAgentVersionNo());
        assertEquals(60_000, orphan.getTotalDurationMs());
    }

    @Test
    void skipsEventsWithoutAnyIdentityInBothPasses() {
        var anonymous = legacy(3, 1, "step.started", 0);
        var blankName = legacy(4, 1, "step.started", 0);
        blankName.setStepName("   ");
        var started = event(1, 1, 10, "step.started", 0);
        var completed = event(2, 1, 10, "step.completed", 4_000);
        given(List.of(execution(1, 5, "SUCCEEDED", 10_000)), List.of(anonymous, blankName, started, completed));
        var stage = service.get(9, start, end, null, null, "stage", null).getStages().getFirst();
        assertEquals(1, stage.getSampleCount());
        assertEquals(1, stage.getCompletedCount());
        assertEquals(4_000, stage.getTotalDurationMs());
    }

    @Test
    void resolvesKeyOnlyEventsToTheirUniqueRecordedId() {
        var started = event(1, 1, 10, "step.started", 0);
        started.setStepKey("review");
        var keyOnly = legacy(2, 1, "step.completed", 5_000);
        keyOnly.setStepKey("review");
        keyOnly.setStepOrder(1);
        keyOnly.setStepName("Recorded stage");
        given(List.of(execution(1, 5, "SUCCEEDED", 10_000)), List.of(started, keyOnly));
        var stage = service.get(9, start, end, null, null, "stage", null).getStages().getFirst();
        assertEquals("5:id:10", stage.getKey());
        assertEquals(1, stage.getSampleCount());
        assertEquals(5_000, stage.getTotalDurationMs());
    }

    @Test
    void degradesKeyOnlyEventsToTheirKeyWhenNoIdIsRecorded() {
        var started = legacy(1, 1, "step.started", 0);
        started.setStepKey("review");
        started.setStepOrder(1);
        started.setStepName("Review");
        var completed = legacy(2, 1, "step.completed", 5_000);
        completed.setStepKey("review");
        completed.setStepOrder(1);
        completed.setStepName("Review");
        given(List.of(execution(1, 5, "SUCCEEDED", 10_000)), List.of(started, completed));
        var stage = service.get(9, start, end, null, null, "stage", null).getStages().getFirst();
        assertEquals("5:key:review", stage.getKey());
        assertEquals("Review", stage.getName());
        assertEquals(5_000, stage.getTotalDurationMs());
    }

    @Test
    void degradesBlankKeyToTheRecordedOrder() {
        var started = legacy(1, 1, "step.started", 0);
        started.setStepKey("   ");
        started.setStepOrder(3);
        started.setStepName("Ordered stage");
        var completed = legacy(2, 1, "step.completed", 7_000);
        completed.setStepKey("   ");
        completed.setStepOrder(3);
        completed.setStepName("Ordered stage");
        given(List.of(execution(1, 5, "SUCCEEDED", 10_000)), List.of(started, completed));
        var stage = service.get(9, start, end, null, null, "stage", null).getStages().getFirst();
        assertEquals("5:order:3", stage.getKey());
        assertEquals(7_000, stage.getTotalDurationMs());
    }

    @Test
    void degradesEventsWithoutKeyOrOrderToTheirRecordedName() {
        var started = legacy(1, 1, "step.started", 0);
        started.setStepName("Legacy stage");
        var completed = legacy(2, 1, "step.completed", 3_000);
        completed.setStepName("Legacy stage");
        given(List.of(execution(1, 5, "SUCCEEDED", 10_000)), List.of(started, completed));
        var stage = service.get(9, start, end, null, null, "stage", null).getStages().getFirst();
        assertEquals("5:name:Legacy stage", stage.getKey());
        assertEquals("Legacy stage", stage.getName());
        assertEquals(3_000, stage.getTotalDurationMs());
    }

    @Test
    void keepsOrderIdentityWhenTheAliasMatchesSeveralRecordedIds() {
        var first = event(1, 1, 10, "step.started", 0);
        var second = event(2, 1, 11, "step.started", 0);
        var legacy = legacy(3, 1, "step.completed", 5_000);
        legacy.setStepOrder(1);
        given(List.of(execution(1, 5, "SUCCEEDED", 10_000)), List.of(first, second, legacy));
        var stages = service.get(9, start, end, null, null, "stage", null).getStages();
        assertEquals(3, stages.size());
        var ambiguous = stages.stream().filter(s -> "5:order:1".equals(s.getKey())).findFirst().orElseThrow();
        assertEquals(1, ambiguous.getSampleCount());
        assertEquals(1, ambiguous.getCompletedCount());
        assertEquals(1, ambiguous.getMissingDurationCount());
    }

    @Test
    void fallsBackToTheDefinitionNameWhenRecordedNamesAreBlank() {
        var started = event(1, 1, 10, "step.started", 0);
        started.setStepKey("  ");
        started.setStepName("   ");
        started.setFallbackStepName("Fallback stage");
        var completed = event(2, 1, 10, "step.completed", 5_000);
        completed.setStepKey("  ");
        completed.setStepName("   ");
        completed.setStepOrder(null);
        given(List.of(execution(1, 5, "SUCCEEDED", 10_000)), List.of(started, completed));
        var stage = service.get(9, start, end, null, null, "stage", null).getStages().getFirst();
        assertEquals("Fallback stage", stage.getName());
        assertEquals(5_000, stage.getTotalDurationMs());
    }

    @Test
    void validatesBoundsAndReturnsEmptyDataWithoutAnEmptyInQuery() {
        assertThrows(KeyedIllegalArgumentException.class, () -> service.get(9, null, end, null, null, "stage", null));
        assertThrows(KeyedIllegalArgumentException.class, () -> service.get(9, start, null, null, null, "stage", null));
        assertThrows(KeyedIllegalArgumentException.class, () -> service.get(9, end, start, null, null, "stage", null));
        assertThrows(KeyedIllegalArgumentException.class,
                () -> service.get(9, start, LocalDate.now(ZoneId.of("Asia/Shanghai")).plusDays(1), null, null, "stage", null));
        LocalDate recentEnd = LocalDate.now(ZoneId.of("Asia/Shanghai")).minusDays(1);
        assertThrows(KeyedIllegalArgumentException.class,
                () -> service.get(9, recentEnd.minusDays(366), recentEnd, null, null, "stage", null));
        assertThrows(KeyedIllegalArgumentException.class, () -> service.get(9, start, end, -1L, null, "stage", null));
        assertThrows(KeyedIllegalArgumentException.class, () -> service.get(9, start, end, null, -1L, "stage", null));
        assertThrows(KeyedIllegalArgumentException.class, () -> service.get(9, start, end, null, null, "latest", null));
        assertThrows(KeyedIllegalArgumentException.class, () -> service.get(9, start, end, null, null, null, null));
        verifyNoInteractions(dao);
        given(List.of(), List.of());
        assertTrue(service.get(9, start, end, null, null, "stage", null).getStages().isEmpty());
        verify(dao, never()).listEvents(anyLong(), anyList());
        given(Collections.nCopies(5001, execution(1, 5, "SUCCEEDED", 0)), List.of());
        var failure = assertThrows(KeyedIllegalArgumentException.class, () -> service.get(9, start, end, null, null, "stage", null));
        assertTrue(failure.getMessage().contains("5000"));
    }

    private void given(List<StageDurationService.Execution> executions, List<Event> events) {
        when(dao.listExecutions(anyLong(), any(), any(), any(), any(), any(), any(), any(), anyInt(), anyBoolean(), any())).thenReturn(executions);
        when(dao.listEvents(anyLong(), anyList())).thenAnswer(call -> {
            List<Long> ids = call.getArgument(1);
            return events.stream().filter(event -> ids.contains(event.getDispatchId())).toList();
        });
    }

    @Test
    void subtractsEachSampleBeforeComputingQuantilesAndKeepsCoverage() {
        var first = event(3, 1, 10, "step.timing", 100_000);
        first.setDetailJson("{\"timing\":{\"version\":1,\"segmentId\":\"one\",\"elapsedMs\":100000,\"externalWaitMs\":90000,\"unknownMs\":0,\"processingMs\":10000}}");
        var second = event(6, 2, 10, "step.timing", 80_000);
        second.setDetailJson("{\"timing\":{\"version\":1,\"segmentId\":\"two\",\"elapsedMs\":80000,\"externalWaitMs\":0,\"unknownMs\":10000,\"processingMs\":70000}}");
        given(List.of(execution(1, 5, "SUCCEEDED", 100_000), execution(2, 5, "SUCCEEDED", 80_000), execution(3, 5, "FAILED", 30_000)),
                List.of(event(1, 1, 10, "step.started", 0), event(2, 1, 10, "step.completed", 100_000), first,
                        event(4, 2, 10, "step.started", 0), event(5, 2, 10, "step.completed", 80_000), second));
        var report = service.get(9, start, end, null, null, "stage", 7L, 11L, "SUCCEEDED", false);
        var stage = report.getStages().getFirst();
        assertEquals(180_000, stage.getTotalDurationMs());
        assertEquals(90_000, stage.getExternalWaitMs());
        assertEquals(10_000, stage.getUnknownMs());
        assertEquals(45_000, stage.getAfterKnownWaitMedianMs());
        assertEquals(80_000, stage.getAfterKnownWaitP90Ms());
        assertEquals(100_000, stage.getP90DurationMs());
        assertEquals(2, stage.getInstrumentedSampleCount());
        assertEquals(1, stage.getCoveredSampleCount());
        assertEquals(2, report.getStageExecutionCount());
        assertEquals(1, report.getNoStageExecutionCount());
        verify(dao).listExecutions(eq(9L), any(), any(), isNull(), isNull(), eq(7L), eq(11L), eq("SUCCEEDED"), eq(5001), eq(false), isNull());
    }

    private StageDurationService.Execution execution(long id, long flow, String status, long updated) {
        var execution = new StageDurationService.Execution();
        execution.setId(id); execution.setWorkitemId(100L); execution.setSdlcId(flow);
        execution.setSdlcName("Flow " + flow); execution.setTitle("Original title");
        execution.setStatus(status); execution.setGmtCreate(new Date(0)); execution.setGmtModified(new Date(updated));
        return execution;
    }

    private Event event(long id, long dispatch, long step, String type, long time) {
        var event = new Event();
        event.setId(id); event.setDispatchId(dispatch); event.setStepId(step); event.setStepOrder(1);
        event.setStepName("Recorded stage"); event.setEventType(type); event.setEventTime(new Date(time));
        return event;
    }

    private Event legacy(long id, long dispatch, String type, long time) {
        var event = event(id, dispatch, 10, type, time);
        event.setStepId(null); event.setStepKey(null); event.setStepOrder(null); event.setStepName(null);
        return event;
    }
}
