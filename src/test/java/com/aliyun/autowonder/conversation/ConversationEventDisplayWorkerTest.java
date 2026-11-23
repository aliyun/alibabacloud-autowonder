package com.aliyun.autowonder.conversation;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ConversationEventDisplayWorkerTest {

    private final ConversationEventDisplayPreparationService preparation =
            mock(ConversationEventDisplayPreparationService.class);
    private ConversationEventDisplayWorker worker;

    @BeforeEach
    void setUp() {
        worker = new ConversationEventDisplayWorker(preparation);
        ReflectionTestUtils.setField(worker, "enabled", true);
        ReflectionTestUtils.setField(worker, "realtimeBatch", 20);
        ReflectionTestUtils.setField(worker, "historyBatch", 30);
        ReflectionTestUtils.setField(worker, "historyScanRows", 200);
        ReflectionTestUtils.setField(worker, "historyTimeBudgetMs", 300L);
        ReflectionTestUtils.setField(worker, "retentionDays", 30);
        ReflectionTestUtils.setField(worker, "cleanupBatch", 500);
    }

    @Test
    void realtimeTickOnlyProcessesTheRealtimeChannels() {
        worker.realtimeTick();

        verify(preparation).processRealtimeDue(20);
        verify(preparation, never()).scanHistoryBatch(org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyLong());
        verify(preparation, never()).processHistoryDue(org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void realtimeTickIsNotBlockedByAFailingHistoryScan() {
        doThrow(new IllegalStateException("history scan blocked")).when(preparation)
                .scanHistoryBatch(200, 300L);

        worker.historyTick();
        assertDoesNotThrow(() -> worker.realtimeTick());

        verify(preparation).processRealtimeDue(20);
        verify(preparation).processHistoryDue(30);
    }

    /** 历史扫描慢或抛错时，历史回填自己失败，实时消费仍然推进。 */
    @Test
    void historyScanFailureStillRunsTheHistoryPreparationAndKeepsTheWorkerAlive() {
        doThrow(new IllegalStateException("db down")).when(preparation).scanHistoryBatch(200, 300L);

        assertDoesNotThrow(() -> worker.historyTick());

        verify(preparation).processHistoryDue(30);
        assertDoesNotThrow(() -> worker.realtimeTick());
    }

    @Test
    void historyPreparationFailureDoesNotStopTheRealtimeChannel() {
        doThrow(new IllegalStateException("db down")).when(preparation).processHistoryDue(30);

        assertDoesNotThrow(() -> worker.historyTick());
        assertDoesNotThrow(() -> worker.realtimeTick());

        verify(preparation).processRealtimeDue(20);
    }

    @Test
    void historyTickScansThenPreparesHistory() {
        when(preparation.scanHistoryBatch(200, 300L)).thenReturn(4);

        worker.historyTick();

        verify(preparation).scanHistoryBatch(200, 300L);
        verify(preparation).processHistoryDue(30);
    }

    @Test
    void historyTickSamplesTheQueueSnapshotOnlyEveryObservationWindow() {
        for (int i = 0; i < ConversationEventDisplayWorker.OBSERVABILITY_EVERY_TICKS; i++) {
            worker.historyTick();
        }
        // 15 个 tick 只采样一次队列快照，避免每 2s 三次计数查询压 DB。
        verify(preparation).queueSnapshot();
        for (int i = 0; i < ConversationEventDisplayWorker.OBSERVABILITY_EVERY_TICKS - 1; i++) {
            worker.historyTick();
        }
        verify(preparation).queueSnapshot();
    }

    @Test
    void ticksAreSkippedWhenTheWorkerIsDisabled() {
        ReflectionTestUtils.setField(worker, "enabled", false);

        worker.realtimeTick();
        worker.historyTick();
        worker.cleanup();

        verifyNoInteractions(preparation);
    }

    @Test
    void realtimeTickSwallowsPreparationFailuresWithoutRetryingTheSameCall() {
        doThrow(new IllegalStateException("db down")).when(preparation).processRealtimeDue(20);

        assertDoesNotThrow(() -> worker.realtimeTick());
        assertDoesNotThrow(() -> worker.realtimeTick());
        verify(preparation, times(2)).processRealtimeDue(20);
    }

    @Test
    void realtimeTickIsSkippedWhileAPreviousTickIsStillRunning() {
        AtomicBoolean running = (AtomicBoolean) ReflectionTestUtils.getField(worker,
                "realtimeRunning");
        running.set(true);
        try {
            worker.realtimeTick();
        } finally {
            running.set(false);
        }
        verify(preparation, never()).processRealtimeDue(org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void historyTickIsSkippedWhileAPreviousTickIsStillRunning() {
        AtomicBoolean running = (AtomicBoolean) ReflectionTestUtils.getField(worker,
                "historyRunning");
        running.set(true);
        try {
            worker.historyTick();
        } finally {
            running.set(false);
        }
        verify(preparation, never()).scanHistoryBatch(org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    void cleanupUsesTheConfiguredRetentionAndBatch() {
        worker.cleanup();

        verify(preparation).cleanupExpired(30, 500);
    }

    @Test
    void cleanupSwallowsFailures() {
        doThrow(new IllegalStateException("db down")).when(preparation).cleanupExpired(30, 500);

        assertDoesNotThrow(() -> worker.cleanup());
    }

    @Test
    void dedicatedSchedulersKeepRealtimeProgressingWhileHistoryIsBlocked() throws Exception {
        CountDownLatch historyEntered = new CountDownLatch(1);
        CountDownLatch releaseHistory = new CountDownLatch(1);
        CountDownLatch realtimeProgressed = new CountDownLatch(2);
        org.mockito.Mockito.doAnswer(call -> {
            historyEntered.countDown();
            releaseHistory.await(5, TimeUnit.SECONDS);
            return 0;
        }).when(preparation).scanHistoryBatch(200, 300L);
        org.mockito.Mockito.doAnswer(call -> {
            if (historyEntered.getCount() == 0) realtimeProgressed.countDown();
            return 0;
        }).when(preparation).processRealtimeDue(20);
        try {
            worker.start();
            org.junit.jupiter.api.Assertions.assertTrue(historyEntered.await(2, TimeUnit.SECONDS));
            org.junit.jupiter.api.Assertions.assertTrue(realtimeProgressed.await(2, TimeUnit.SECONDS));
            org.junit.jupiter.api.Assertions.assertTrue(worker.isRunning());
        } finally {
            releaseHistory.countDown();
            worker.stop();
        }
        org.junit.jupiter.api.Assertions.assertFalse(worker.isRunning());
    }

    @Test
    void exhaustedDerivedWorkBudgetSkipsDatabaseWorkAndReleasesOnFailure() {
        var admission = new ConversationDisplayWorkAdmission(4);
        worker.setAdmission(admission);
        org.junit.jupiter.api.Assertions.assertTrue(admission.tryAcquire());
        worker.realtimeTick();
        worker.historyTick();
        worker.cleanup();
        verifyNoInteractions(preparation);
        admission.release();
        doThrow(new IllegalStateException("db down")).when(preparation).processRealtimeDue(20);
        worker.realtimeTick();
        org.junit.jupiter.api.Assertions.assertTrue(admission.tryAcquire());
        admission.release();
    }
}
