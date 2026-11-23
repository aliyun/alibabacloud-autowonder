package com.aliyun.autowonder.workspace;

import com.aliyun.autowonder.redis.RedisManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * Converges the historical gap left by the old delete flow: workspaces deleted before deletion
 * disabled external sync may still have enabled bindings, ACTIVE timers and non-terminal
 * dispatches. Nothing is deleted — each residual switch is turned off exactly like a fresh
 * delete does, and the row drops out of the candidate query, so repeated runs are no-ops.
 *
 * <p>Deliberately no auto-restore counterpart: a restored workspace keeps everything paused and
 * disabled until an operator re-enables it explicitly.</p>
 */
@Component
public class WorkspaceBackgroundGovernanceTask {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceBackgroundGovernanceTask.class);
    private static final String LOCK_KEY = "workspace:background-governance:lock";
    private static final long LOCK_TTL_MS = 120_000L;
    /** Audit/attribution placeholder: no human operator drives a scheduled governance pass. */
    static final long SYSTEM_OPERATOR_ID = 0L;

    private final WorkspaceBackgroundGovernanceDao governanceDao;
    private final WorkspaceDeletionLinkage deletionLinkage;
    private final RedisManager redis;
    private final int batchSize;

    public WorkspaceBackgroundGovernanceTask(WorkspaceBackgroundGovernanceDao governanceDao,
                                             WorkspaceDeletionLinkage deletionLinkage,
                                             RedisManager redis,
                                             @Value("${autowonder.workspace-governance.batch-size:100}") int batchSize) {
        this.governanceDao = governanceDao;
        this.deletionLinkage = deletionLinkage;
        this.redis = redis;
        this.batchSize = Math.max(1, Math.min(batchSize, 500));
    }

    @Scheduled(fixedDelayString = "${autowonder.workspace-governance.fixed-delay-ms:3600000}")
    public void sweep() {
        String owner = UUID.randomUUID().toString();
        if (!redis.tryAcquireLock(LOCK_KEY, owner, LOCK_TTL_MS)) {
            return;
        }
        try {
            List<Long> candidates = governanceDao.listResidualWorkspaceIds(
                    WorkspaceDeletionLinkage.IN_FLIGHT_STATUSES, batchSize);
            if (candidates == null || candidates.isEmpty()) {
                return;
            }
            int governed = 0;
            for (Long workspaceId : candidates) {
                if (workspaceId == null) {
                    continue;
                }
                try {
                    if (govern(workspaceId) > 0) {
                        governed++;
                    }
                } catch (RuntimeException failure) {
                    // One workspace must never stop the sweep for the others.
                    log.warn("workspace background governance failed tenantId={}", workspaceId, failure);
                }
            }
            log.info("workspace background governance swept candidates={} changed={}",
                    candidates.size(), governed);
        } catch (RuntimeException failure) {
            log.warn("workspace background governance query failed", failure);
        } finally {
            redis.releaseLock(LOCK_KEY, owner);
        }
    }

    /** Stops every residual background switch of one deleted workspace; returns how many changed. */
    int govern(long workspaceId) {
        int bindings = deletionLinkage.disableExternalBindings(workspaceId, SYSTEM_OPERATOR_ID);
        int tasks = deletionLinkage.pauseScheduledTasks(workspaceId, SYSTEM_OPERATOR_ID);
        int dispatches = deletionLinkage.stopInFlightDispatches(workspaceId, SYSTEM_OPERATOR_ID);
        int changed = bindings + tasks + dispatches;
        if (changed > 0) {
            log.info("workspace background governance tenantId={} disabledExternalBindings={} "
                            + "pausedScheduledTasks={} stoppedDispatches={}",
                    workspaceId, bindings, tasks, dispatches);
        }
        return changed;
    }
}
