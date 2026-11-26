package com.aliyun.autowonder.office;

import com.aliyun.autowonder.dispatch.DispatchRequestService;
import com.aliyun.autowonder.dispatch.DispatchSucceededEvent;
import com.aliyun.autowonder.integration.event.WorkitemStatusChangedEvent;
import com.aliyun.autowonder.workitem.WorkitemCreatedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
public class OfficeActivitySignalListener {
    private final OfficeRealtimePublisher publisher;

    public OfficeActivitySignalListener(OfficeRealtimePublisher publisher) {
        this.publisher = publisher;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onCreated(WorkitemCreatedEvent event) {
        publisher.publish(event.tenantId(), "WORKITEM_CREATED", event.workitemId());
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onStatus(WorkitemStatusChangedEvent event) {
        publisher.publish(event.tenantId(), "WORKITEM_STATUS_CHANGED", event.workitemId());
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onHumanRequest(DispatchRequestService.HumanRequestCreated event) {
        publisher.publish(event.workspaceId(), "HITL_REQUESTED", event.requestId());
    }

    /** DispatchSucceededEvent is already emitted from the result after-commit queue. */
    @EventListener
    public void onStepCompleted(DispatchSucceededEvent event) {
        publisher.publish(event.getTenantId(), "STEP_COMPLETED", event.getDispatchId());
    }
}
