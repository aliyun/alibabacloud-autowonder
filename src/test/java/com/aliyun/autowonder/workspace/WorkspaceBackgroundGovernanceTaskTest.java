package com.aliyun.autowonder.workspace;

import com.aliyun.autowonder.redis.RedisManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class WorkspaceBackgroundGovernanceTaskTest {

    private WorkspaceBackgroundGovernanceDao governanceDao;
    private WorkspaceDeletionLinkage linkage;
    private RedisManager redis;
    private WorkspaceBackgroundGovernanceTask task;

    @BeforeEach
    void setUp() {
        governanceDao = mock(WorkspaceBackgroundGovernanceDao.class);
        linkage = mock(WorkspaceDeletionLinkage.class);
        redis = mock(RedisManager.class);
        task = new WorkspaceBackgroundGovernanceTask(governanceDao, linkage, redis, 100);
    }

    @Test
    void sweepsResidualWorkspacesWithTheFullInFlightDispatchStatusSet() {
        when(redis.tryAcquireLock(anyString(), anyString(), anyLong())).thenReturn(true);
        when(governanceDao.listResidualWorkspaceIds(any(), eq(100))).thenReturn(List.of(10L));
        when(linkage.disableExternalBindings(10L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID))
                .thenReturn(1);
        when(linkage.pauseScheduledTasks(10L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID))
                .thenReturn(1);
        when(linkage.stopInFlightDispatches(10L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID))
                .thenReturn(2);

        task.sweep();

        verify(governanceDao).listResidualWorkspaceIds(WorkspaceDeletionLinkage.IN_FLIGHT_STATUSES, 100);
        verify(linkage).disableExternalBindings(10L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID);
        verify(linkage).pauseScheduledTasks(10L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID);
        verify(linkage).stopInFlightDispatches(10L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID);
        verify(redis).releaseLock(eq("workspace:background-governance:lock"), anyString());
    }

    @Test
    void lockOwnerMissLeavesTheSweepToAnotherInstance() {
        when(redis.tryAcquireLock(anyString(), anyString(), anyLong())).thenReturn(false);

        task.sweep();

        verifyNoInteractions(governanceDao, linkage);
        verify(redis, never()).releaseLock(anyString(), anyString());
    }

    @Test
    void emptyCandidateListStillReleasesTheLock() {
        when(redis.tryAcquireLock(anyString(), anyString(), anyLong())).thenReturn(true);
        when(governanceDao.listResidualWorkspaceIds(any(), anyInt())).thenReturn(List.of());

        task.sweep();

        verifyNoInteractions(linkage);
        verify(redis).releaseLock(eq("workspace:background-governance:lock"), anyString());
    }

    @Test
    void nullCandidateListIsTolerated() {
        when(redis.tryAcquireLock(anyString(), anyString(), anyLong())).thenReturn(true);
        when(governanceDao.listResidualWorkspaceIds(any(), anyInt())).thenReturn(null);

        assertDoesNotThrow(task::sweep);

        verifyNoInteractions(linkage);
        verify(redis).releaseLock(eq("workspace:background-governance:lock"), anyString());
    }

    @Test
    void oneFailingWorkspaceDoesNotStopTheOthersAndTheLockIsReleased() {
        when(redis.tryAcquireLock(anyString(), anyString(), anyLong())).thenReturn(true);
        when(governanceDao.listResidualWorkspaceIds(any(), anyInt())).thenReturn(Arrays.asList(10L, 11L));
        when(linkage.disableExternalBindings(10L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID))
                .thenThrow(new IllegalStateException("binding update failed"));
        when(linkage.disableExternalBindings(11L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID))
                .thenReturn(1);

        assertDoesNotThrow(task::sweep);

        verify(linkage).pauseScheduledTasks(11L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID);
        verify(redis).releaseLock(eq("workspace:background-governance:lock"), anyString());
    }

    @Test
    void nullWorkspaceIdInsideTheBatchIsSkipped() {
        when(redis.tryAcquireLock(anyString(), anyString(), anyLong())).thenReturn(true);
        when(governanceDao.listResidualWorkspaceIds(any(), anyInt())).thenReturn(Arrays.asList((Long) null, 12L));

        task.sweep();

        verify(linkage).disableExternalBindings(12L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID);
    }

    @Test
    void candidateQueryFailureDoesNotEscapeAndStillReleasesTheLock() {
        when(redis.tryAcquireLock(anyString(), anyString(), anyLong())).thenReturn(true);
        when(governanceDao.listResidualWorkspaceIds(any(), anyInt()))
                .thenThrow(new IllegalStateException("query failed"));

        assertDoesNotThrow(task::sweep);

        verifyNoInteractions(linkage);
        verify(redis).releaseLock(eq("workspace:background-governance:lock"), anyString());
    }

    @Test
    void governReportsTheSumOfEverythingItStopped() {
        when(linkage.disableExternalBindings(10L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID))
                .thenReturn(2);
        when(linkage.pauseScheduledTasks(10L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID))
                .thenReturn(3);
        when(linkage.stopInFlightDispatches(10L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID))
                .thenReturn(4);

        assertEquals(9, task.govern(10L));
    }

    @Test
    void governWithNothingLeftToStopReportsZero() {
        assertEquals(0, task.govern(10L));
    }

    @Test
    void aWorkspaceThatReportsNoChangeIsNotCounted() {
        when(redis.tryAcquireLock(anyString(), anyString(), anyLong())).thenReturn(true);
        when(governanceDao.listResidualWorkspaceIds(any(), anyInt())).thenReturn(List.of(10L));

        assertDoesNotThrow(task::sweep);

        verify(linkage).stopInFlightDispatches(10L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID);
    }

    @Test
    void batchSizeIsClampedToAUsableRange() {
        WorkspaceBackgroundGovernanceTask zero = new WorkspaceBackgroundGovernanceTask(
                governanceDao, linkage, redis, 0);
        when(redis.tryAcquireLock(anyString(), anyString(), anyLong())).thenReturn(true);
        when(governanceDao.listResidualWorkspaceIds(any(), anyInt())).thenReturn(List.of());

        zero.sweep();

        verify(governanceDao).listResidualWorkspaceIds(any(), eq(1));
    }

    @Test
    void oversizeBatchIsCapped() {
        WorkspaceBackgroundGovernanceTask huge = new WorkspaceBackgroundGovernanceTask(
                governanceDao, linkage, redis, 10_000);
        when(redis.tryAcquireLock(anyString(), anyString(), anyLong())).thenReturn(true);
        when(governanceDao.listResidualWorkspaceIds(any(), anyInt())).thenReturn(List.of());

        huge.sweep();

        verify(governanceDao).listResidualWorkspaceIds(any(), eq(500));
    }

    @Test
    void linkageFailureForOneWorkspaceIsLoggedNotRethrown() {
        when(redis.tryAcquireLock(anyString(), anyString(), anyLong())).thenReturn(true);
        when(governanceDao.listResidualWorkspaceIds(any(), anyInt())).thenReturn(List.of(10L));
        doThrow(new IllegalStateException("stop failed"))
                .when(linkage).stopInFlightDispatches(10L, WorkspaceBackgroundGovernanceTask.SYSTEM_OPERATOR_ID);

        assertDoesNotThrow(task::sweep);

        verify(redis).releaseLock(eq("workspace:background-governance:lock"), anyString());
    }
}
