package com.aliyun.autowonder.notification;

import com.aliyun.autowonder.branding.PlatformBrandingService;
import com.aliyun.autowonder.im.ImProviderType;
import com.aliyun.autowonder.im.PlatformImChannelConfigService;
import com.aliyun.autowonder.im.UserImIdentityDO;
import com.aliyun.autowonder.im.UserImIdentityService;
import com.aliyun.autowonder.im.notification.ImNotificationQueue;
import com.aliyun.autowonder.im.notification.ImNotificationTask;
import com.aliyun.autowonder.im.notification.SystemNotificationImDispatcher;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class PlatformImNotifyChannelTest {

    private final PlatformImChannelConfigService configs = mock(PlatformImChannelConfigService.class);
    private final UserImIdentityService identities = mock(UserImIdentityService.class);
    private final ImNotificationQueue queue = mock(ImNotificationQueue.class);
    private final PlatformBrandingService branding = mock(PlatformBrandingService.class);
    private final PlatformImNotifyChannel channel = new PlatformImNotifyChannel(configs,
            new SystemNotificationImDispatcher(configs, identities, queue, branding));

    @Test
    void nameFollowsTheSelectedProvider() {
        when(configs.selectedProvider()).thenReturn("FEISHU");
        assertEquals("feishu", channel.name());
    }

    @Test
    void deliverQueuesTheNotificationSnapshotOnTheSelectedProvider() {
        when(configs.selectedProvider()).thenReturn("DINGTALK");
        when(configs.isReady("DINGTALK")).thenReturn(true);
        when(branding.effectivePublicBaseUrl()).thenReturn("https://auto.example.com/");
        UserImIdentityDO identity = new UserImIdentityDO();
        identity.setExternalUserId("staff-001");
        when(identities.find(9L, "DINGTALK")).thenReturn(identity);
        NotificationDO notification = new NotificationDO();
        notification.setId(77L);
        notification.setTenantId(7L);
        notification.setRecipientId(9L);
        notification.setType("USER_REGISTRATION_REVIEW");
        notification.setTitle("有新用户注册，请审核");
        notification.setContent("用户 A 提交了注册申请");
        notification.setLink("/workspaces/branding?tab=user-management");

        assertTrue(channel.deliver(notification));

        ArgumentCaptor<ImNotificationTask> task = ArgumentCaptor.forClass(ImNotificationTask.class);
        verify(queue).enqueue(task.capture());
        assertEquals("system-notification:77:DINGTALK:9", task.getValue().notificationKey());
        assertEquals("DINGTALK", task.getValue().provider());
        assertEquals("USER_REGISTRATION_REVIEW", task.getValue().notificationType());
        assertEquals("有新用户注册，请审核", task.getValue().notificationTitle());
        assertEquals("用户 A 提交了注册申请", task.getValue().notificationContent());
        assertEquals("https://auto.example.com/workspaces/branding?tab=user-management",
                task.getValue().notificationLink());
        assertTrue(task.getValue().bypassesLegacyImPreference());
    }

    @Test
    void deliverBatchQueuesEveryRecipientWithOneChannelReadyRead() {
        when(configs.selectedProvider()).thenReturn("DINGTALK");
        when(configs.isReady("DINGTALK")).thenReturn(true);
        when(branding.effectivePublicBaseUrl()).thenReturn("https://auto.example.com");
        UserImIdentityDO identity = new UserImIdentityDO();
        identity.setExternalUserId("staff-001");
        when(identities.find(9L, "DINGTALK")).thenReturn(identity);
        when(identities.find(10L, "DINGTALK")).thenReturn(identity);

        channel.deliverBatch(List.of(genericNotification(77L, 9L), genericNotification(78L, 10L)));

        verify(queue, times(2)).enqueue(any());
        // 一批收件人只读一次平台渠道就绪状态。
        verify(configs, times(1)).isReady("DINGTALK");
    }

    @Test
    void dedicatedTypesStayWithTheirOwnReliableListener() {
        NotificationDO notification = new NotificationDO();
        notification.setType("WORKITEM_ASSIGNED");

        assertTrue(channel.deliver(notification));
        verifyNoInteractions(queue, identities);
    }

    @Test
    void missingIdentityIsReportedAsNotDeliveredAndNotQueued() {
        when(configs.selectedProvider()).thenReturn("FEISHU");
        when(configs.isReady("FEISHU")).thenReturn(true);
        NotificationDO notification = new NotificationDO();
        notification.setId(78L);
        notification.setRecipientId(9L);
        notification.setType("USER_REGISTRATION_REVIEW");

        assertFalse(channel.deliver(notification));
        verify(queue, never()).enqueue(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void providerNamesAreNormalizedBeforeUse() {
        assertEquals("FEISHU", ImProviderType.normalize("feishu"));
    }

    private static NotificationDO genericNotification(long id, long recipientId) {
        NotificationDO notification = new NotificationDO();
        notification.setId(id);
        notification.setTenantId(7L);
        notification.setRecipientId(recipientId);
        notification.setType("USER_REGISTRATION_REVIEW");
        notification.setTitle("有新用户注册，请审核");
        notification.setContent("用户 A 提交了注册申请");
        return notification;
    }
}
