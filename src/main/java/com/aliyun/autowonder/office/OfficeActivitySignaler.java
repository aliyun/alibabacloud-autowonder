package com.aliyun.autowonder.office;

import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Sends a refresh hint only after the durable source row is visible to readers. */
@Component
public class OfficeActivitySignaler {
    private final OfficeRealtimePublisher publisher;

    public OfficeActivitySignaler(OfficeRealtimePublisher publisher) {
        this.publisher = publisher;
    }

    public void afterCommit(long workspaceId, String reason, Object sourceId) {
        Runnable publish = () -> publisher.publish(workspaceId, reason, sourceId);
        if (!TransactionSynchronizationManager.isActualTransactionActive()
                || !TransactionSynchronizationManager.isSynchronizationActive()) {
            publish.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                publish.run();
            }
        });
    }
}
