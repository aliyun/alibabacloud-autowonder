package com.aliyun.autowonder.notification;

import java.util.List;

public interface NotifyChannel {
    String name();

    boolean deliver(NotificationDO notification);

    /**
     * Delivers every notification produced by one event. Channels that are not batch-aware keep the
     * per-notification semantics; batch-aware channels may reuse per-event state such as provider
     * configuration instead of resolving it once per recipient.
     */
    default void deliverBatch(List<NotificationDO> notifications) {
        for (NotificationDO notification : notifications) {
            deliver(notification);
        }
    }
}
