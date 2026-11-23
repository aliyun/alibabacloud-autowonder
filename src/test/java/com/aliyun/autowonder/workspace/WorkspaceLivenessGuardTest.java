package com.aliyun.autowonder.workspace;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WorkspaceLivenessGuardTest {

    private static final long WORKSPACE_ID = 10L;

    private final WorkspaceDao workspaceDao = mock(WorkspaceDao.class);
    private final WorkspaceLivenessGuard guard = new WorkspaceLivenessGuard(workspaceDao);

    @Test
    void activeWhenTheRowIsNotLogicallyDeleted() {
        when(workspaceDao.countLive(WORKSPACE_ID)).thenReturn(1L);

        assertTrue(guard.isActive(WORKSPACE_ID));

        verify(workspaceDao).countLive(WORKSPACE_ID);
    }

    @Test
    void inactiveWhenTheRowIsLogicallyDeleted() {
        when(workspaceDao.countLive(WORKSPACE_ID)).thenReturn(0L);

        assertFalse(guard.isActive(WORKSPACE_ID));
    }

    @Test
    void readFailureFailsOpenSoLiveWorkspacesAreNotStopped() {
        // A transient database error must never be read as "deleted": that would silently stop
        // every live workspace until the next probe.
        when(workspaceDao.countLive(WORKSPACE_ID)).thenThrow(new IllegalStateException("db down"));

        assertTrue(guard.isActive(WORKSPACE_ID));
    }
}
