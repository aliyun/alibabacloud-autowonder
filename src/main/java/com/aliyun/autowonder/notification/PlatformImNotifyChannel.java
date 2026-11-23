package com.aliyun.autowonder.notification;

import com.aliyun.autowonder.im.PlatformImChannelConfigService;
import com.aliyun.autowonder.im.notification.SystemNotificationImDispatcher;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Locale;

/** Every new system notification reuses the single platform bot and the recipient's IM identity. */
@Component
public class PlatformImNotifyChannel implements NotifyChannel {
    private final PlatformImChannelConfigService configs;
    private final SystemNotificationImDispatcher dispatcher;

    public PlatformImNotifyChannel(PlatformImChannelConfigService configs, SystemNotificationImDispatcher dispatcher) {
        this.configs = configs;
        this.dispatcher = dispatcher;
    }

    @Override
    public String name() { return configs.selectedProvider().toLowerCase(Locale.ROOT); }

    @Override
    public boolean deliver(NotificationDO notification) {
        // Queue only: retries, dedupe and the DLQ stay in the existing reliable IM pipeline.
        return dispatcher.dispatch(notification);
    }

    @Override
    public void deliverBatch(List<NotificationDO> notifications) {
        // One event resolves the platform channel once instead of once per recipient (N3).
        dispatcher.dispatchAll(notifications);
    }
}
