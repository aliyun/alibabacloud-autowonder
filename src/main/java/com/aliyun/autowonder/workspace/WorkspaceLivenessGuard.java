package com.aliyun.autowonder.workspace;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Liveness probe shared by every space-scoped background worker.
 *
 * <p>A logical workspace delete is the runtime boundary: once it commits, external sync,
 * schedulers, dispatch admission and notification delivery must not start new work for that
 * workspace. Each worker still owns its own guarded query or transition — this probe only shrinks
 * the window between "already fetched the rows" and "about to act", it is not a lock.</p>
 *
 * <p>The probe fails open on a read error: treating a transient database failure as "deleted"
 * would silently stop live workspaces, while a missed cycle only delays the next check.</p>
 */
@Component
public class WorkspaceLivenessGuard {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceLivenessGuard.class);

    private final WorkspaceDao workspaceDao;

    public WorkspaceLivenessGuard(WorkspaceDao workspaceDao) {
        this.workspaceDao = workspaceDao;
    }

    /** True when the workspace row exists and is not logically deleted. */
    public boolean isActive(long workspaceId) {
        try {
            return workspaceDao.countLive(workspaceId) > 0;
        } catch (RuntimeException failure) {
            log.warn("workspace liveness check failed, treating as active workspaceId={}", workspaceId, failure);
            return true;
        }
    }
}
