package com.aliyun.autowonder.im.notification;

import com.aliyun.autowonder.branding.PlatformBrandingService;
import com.aliyun.autowonder.im.PlatformImChannelConfigService;
import com.aliyun.autowonder.im.UserImIdentityDO;
import com.aliyun.autowonder.im.UserImIdentityService;
import com.aliyun.autowonder.notification.NotificationDO;
import com.aliyun.autowonder.notification.NotificationLink;
import com.aliyun.autowonder.notification.NotificationLinkJson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Single owner for the IM copy of a new system notification.
 *
 * <p>Every notification that reaches a recipient's in-app list is also queued for IM when the
 * platform bot is configured and enabled, and the recipient has a bound external id on that
 * provider. Missing any of the three conditions only records the skip reason: nothing is retried,
 * no backfill task is created and history is never scanned.
 *
 * <p>Callers must invoke this only for committed notifications; {@code NotifyService} batches one
 * event and enqueues after the transaction completes.
 */
@Component
public class SystemNotificationImDispatcher {
    private static final Logger log = LoggerFactory.getLogger(SystemNotificationImDispatcher.class);

    static final String KEY_PREFIX = "system-notification";

    /**
     * Types delivered by their dedicated IM listener; queueing them here as well would send twice.
     * Those listeners stamp {@code systemNotification} on the tasks they create.
     */
    static final Set<String> DEDICATED_IM_TYPES = Set.of(
            ImNotificationTask.TYPE_WORKITEM_ASSIGNED,
            ImNotificationTask.TYPE_COMMENT_MENTION,
            ImNotificationTask.TYPE_WORKSPACE_ACCESS_REQUEST,
            ImNotificationTask.TYPE_WORKSPACE_ACCESS_REVIEWED);

    private final PlatformImChannelConfigService configs;
    private final UserImIdentityService identities;
    private final ImNotificationQueue queue;
    private final PlatformBrandingService brandingService;

    public SystemNotificationImDispatcher(PlatformImChannelConfigService configs,
                                          UserImIdentityService identities,
                                          ImNotificationQueue queue,
                                          PlatformBrandingService brandingService) {
        this.configs = configs;
        this.identities = identities;
        this.queue = queue;
        this.brandingService = brandingService;
    }

    /** Returns true when the notification is queued or already owned by a dedicated listener. */
    public boolean dispatch(NotificationDO notification) {
        if (notification == null) {
            return false;
        }
        String type = notification.getType();
        if (type != null && DEDICATED_IM_TYPES.contains(type)) {
            return true;
        }
        return dispatchAll(List.of(notification)) > 0;
    }

    /**
     * Queues the IM copy of every notification produced by one event.
     *
     * <p>The channel selection and its readiness are resolved once per batch instead of once per
     * recipient; the external identity stays a per-recipient lookup by nature.
     *
     * @return how many tasks were enqueued
     */
    public int dispatchAll(List<NotificationDO> notifications) {
        if (notifications == null || notifications.isEmpty()) {
            return 0;
        }
        List<NotificationDO> candidates = new ArrayList<>(notifications.size());
        for (NotificationDO notification : notifications) {
            if (notification == null || notification.getId() == null || notification.getRecipientId() == null) {
                continue;
            }
            String type = notification.getType();
            if (type != null && DEDICATED_IM_TYPES.contains(type)) {
                continue;
            }
            candidates.add(notification);
        }
        if (candidates.isEmpty()) {
            return 0;
        }
        String provider = configs.selectedProvider();
        if (!configs.isReady(provider)) {
            for (NotificationDO notification : candidates) {
                logSkip(notification, provider, "channel-not-ready");
            }
            return 0;
        }
        int enqueued = 0;
        for (NotificationDO notification : candidates) {
            UserImIdentityDO identity = identities.find(notification.getRecipientId(), provider);
            if (identity == null || identity.getExternalUserId() == null || identity.getExternalUserId().isBlank()) {
                logSkip(notification, provider, "identity-missing");
                continue;
            }
            try {
                queue.enqueue(buildTask(notification, provider));
            } catch (Exception e) {
                // Enqueue failure must stay visible as a failure, never as a delivered notification.
                log.error("IM system notification enqueue failed notificationId={} recipientUserId={} provider={} "
                                + "type={}", notification.getId(), notification.getRecipientId(), provider,
                        notification.getType(), e);
                continue;
            }
            enqueued++;
            log.info("IM system notification enqueued notificationId={} recipientUserId={} provider={} type={} scope={}",
                    notification.getId(), notification.getRecipientId(), provider, notification.getType(),
                    notification.getScope());
        }
        return enqueued;
    }

    private void logSkip(NotificationDO notification, String provider, String reason) {
        log.info("IM system notification skipped reason={} notificationId={} recipientUserId={} provider={} type={}",
                reason, notification.getId(), notification.getRecipientId(), provider, notification.getType());
    }

    private ImNotificationTask buildTask(NotificationDO notification, String provider) {
        String baseUrl = brandingService.effectivePublicBaseUrl();
        return ImNotificationTask.systemNotification(
                KEY_PREFIX + ":" + notification.getId() + ":" + provider + ":" + notification.getRecipientId(),
                notification.getId(),
                notification.getTenantId() == null ? 0L : notification.getTenantId(),
                notification.getRecipientId(),
                notification.getType(),
                notification.getRecipientLocale(),
                notification.getTitle(),
                notification.getContent(),
                absoluteUrl(baseUrl, notification.getLink()),
                absoluteLinks(baseUrl, NotificationLinkJson.decode(notification.getRelatedLinksJson())));
    }

    private static List<NotificationLink> absoluteLinks(String baseUrl, List<NotificationLink> links) {
        if (links == null) {
            return null;
        }
        List<NotificationLink> absolute = new ArrayList<>(links.size());
        for (NotificationLink link : links) {
            absolute.add(new NotificationLink(link.kind(), link.title(), absoluteUrl(baseUrl, link.url())));
        }
        return absolute;
    }

    private static String absoluteUrl(String baseUrl, String url) {
        if (url == null || url.isBlank()) {
            return null;
        }
        String normalizedBase = baseUrl == null ? "" : baseUrl.trim();
        while (normalizedBase.endsWith("/")) {
            normalizedBase = normalizedBase.substring(0, normalizedBase.length() - 1);
        }
        if (url.startsWith("http://") || url.startsWith("https://")) {
            return url;
        }
        return normalizedBase + url;
    }
}
