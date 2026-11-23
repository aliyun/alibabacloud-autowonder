package com.aliyun.autowonder.conversation;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.annotation.PreDestroy;
import java.util.Date;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.RejectedExecutionException;

/** HTTP reads signal recovery; discovery and queue writes never run on the request thread. */
@Component
public class ConversationEventDisplayRecovery implements AutoCloseable {
    private static final Logger log = LoggerFactory.getLogger(ConversationEventDisplayRecovery.class);
    private record Turn(long tenantId, long conversationId, long turnId) { }
    private final Set<Turn> pending = ConcurrentHashMap.newKeySet();
    private final ConversationEventDisplayPreparationService preparation;
    private final ConversationEventDisplayDao displayDao;
    private ConversationDisplayWorkAdmission admission = new ConversationDisplayWorkAdmission();

    @org.springframework.beans.factory.annotation.Autowired
    public void setAdmission(ConversationDisplayWorkAdmission admission) {
        this.admission = admission;
    }
    // The pending-set admission bounds both scheduled and running tasks to 128 turns.
    private final ScheduledThreadPoolExecutor worker = new ScheduledThreadPoolExecutor(1, runnable -> {
                Thread thread = new Thread(runnable, "conversation-opened-turn-recovery");
                thread.setDaemon(true);
                return thread;
            });

    public ConversationEventDisplayRecovery(ConversationEventDisplayPreparationService preparation,
            ConversationEventDisplayDao displayDao) {
        this.preparation = preparation;
        this.displayDao = displayDao;
        worker.setRemoveOnCancelPolicy(true);
    }

    public void request(long tenantId, long conversationId, long turnId) {
        Turn turn = new Turn(tenantId, conversationId, turnId);
        request(turn, 0, 0);
    }

    private void request(Turn turn, long legacyCursor, long delayMs) {
        synchronized (pending) {
            if (pending.size() >= 128 || !pending.add(turn)) return;
        }
        try {
            worker.schedule(() -> recover(turn, legacyCursor), delayMs, TimeUnit.MILLISECONDS);
        } catch (RejectedExecutionException rejected) {
            pending.remove(turn);
            // The durable raw rows remain the source of truth; a later read/scan retries.
        }
    }

    private void recover(Turn turn, long legacyCursor) {
        if (!admission.tryAcquire()) {
            pending.remove(turn);
            request(turn, legacyCursor, 250);
            return;
        }
        boolean more = false;
        long nextLegacyCursor = legacyCursor;
        try {
            displayDao.promoteTurn(turn.tenantId(), turn.conversationId(), turn.turnId(),
                    ConversationEventDisplayDO.CLASS_HISTORY,
                    ConversationEventDisplayDO.CLASS_INTERACTIVE, new Date());
            more = preparation.backfillTurn(turn.tenantId(), turn.conversationId(), turn.turnId()) > 0;
            var upgrade = preparation.upgradeLegacyReadyPage(turn.tenantId(), turn.conversationId(), turn.turnId(), legacyCursor);
            nextLegacyCursor = upgrade.nextCursor();
            more |= upgrade.hasMore();
        } catch (RuntimeException error) {
            log.warn("opened turn display recovery failed turnId={}: {}", turn.turnId(), error.getClass().getSimpleName());
        } finally {
            admission.release();
            pending.remove(turn);
        }
        // One bounded batch per turn, then join the tail behind other opened turns.
        if (more) request(turn, nextLegacyCursor, 250);
    }

    @Override
    @PreDestroy
    public void close() {
        worker.shutdownNow();
        pending.clear();
    }
}
