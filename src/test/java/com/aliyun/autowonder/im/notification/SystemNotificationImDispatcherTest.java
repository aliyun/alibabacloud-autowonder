package com.aliyun.autowonder.im.notification;

import com.aliyun.autowonder.branding.PlatformBrandingService;
import com.aliyun.autowonder.im.PlatformImChannelConfigService;
import com.aliyun.autowonder.im.UserImIdentityDO;
import com.aliyun.autowonder.im.UserImIdentityService;
import com.aliyun.autowonder.notification.NotificationDO;
import com.aliyun.autowonder.notification.NotificationLink;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class SystemNotificationImDispatcherTest {

    private final PlatformImChannelConfigService configs = mock(PlatformImChannelConfigService.class);
    private final UserImIdentityService identities = mock(UserImIdentityService.class);
    private final ImNotificationQueue queue = mock(ImNotificationQueue.class);
    private final PlatformBrandingService branding = mock(PlatformBrandingService.class);
    private final SystemNotificationImDispatcher dispatcher =
            new SystemNotificationImDispatcher(configs, identities, queue, branding);

    @Test
    void queuesTheFullSnapshotForAWorkspaceNotification() {
        readyWithIdentity();
        when(branding.effectivePublicBaseUrl()).thenReturn("https://auto.example.com");
        NotificationDO notification = notification("DUPLICATE_INTENT");
        notification.setLink("/workitems/55?workspaceId=7");
        notification.setRecipientLocale("en-US");
        notification.setRelatedLinksJson("[{\"kind\":\"SUBMITTED\",\"title\":\"new\",\"url\":\"/workitems/55?workspaceId=7\"},"
                + "{\"kind\":\"DUPLICATE\",\"title\":\"old\",\"url\":\"/workitems/2?workspaceId=7\"}]");

        assertTrue(dispatcher.dispatch(notification));

        ArgumentCaptor<ImNotificationTask> task = ArgumentCaptor.forClass(ImNotificationTask.class);
        verify(queue).enqueue(task.capture());
        assertEquals("system-notification:88:DINGTALK:9", task.getValue().notificationKey());
        assertEquals(88L, task.getValue().notificationId());
        assertEquals(7L, task.getValue().tenantId());
        assertEquals(9L, task.getValue().recipientUserId());
        // Platform notifications carry no work item: the generic path must not borrow refId as one.
        assertEquals(0L, task.getValue().workitemId());
        assertEquals("重复提醒", task.getValue().notificationTitle());
        assertEquals("新旧标题", task.getValue().notificationContent());
        assertEquals("https://auto.example.com/workitems/55?workspaceId=7", task.getValue().notificationLink());
        assertEquals("en-US", task.getValue().recipientLocale());
        assertEquals(List.of(
                        new NotificationLink("SUBMITTED", "new", "https://auto.example.com/workitems/55?workspaceId=7"),
                        new NotificationLink("DUPLICATE", "old", "https://auto.example.com/workitems/2?workspaceId=7")),
                task.getValue().relatedLinks());
        assertTrue(task.getValue().bypassesLegacyImPreference());
        assertTrue(task.getValue().hasNotificationSnapshot());
    }

    @Test
    void platformNotificationNeedsNoWorkspaceOrWorkItem() {
        readyWithIdentity();
        when(branding.effectivePublicBaseUrl()).thenReturn("https://auto.example.com");
        NotificationDO notification = notification("USER_REGISTRATION_REVIEW");
        notification.setTenantId(0L);
        notification.setRecipientId(9L);

        assertTrue(dispatcher.dispatch(notification));

        ArgumentCaptor<ImNotificationTask> task = ArgumentCaptor.forClass(ImNotificationTask.class);
        verify(queue).enqueue(task.capture());
        assertEquals(0L, task.getValue().tenantId());
        assertEquals(0L, task.getValue().workitemId());
        assertNull(task.getValue().notificationLink());
        assertNull(task.getValue().relatedLinks());
    }

    @Test
    void absoluteLinksAreKeptAndMissingBaseUrlYieldsTheRawPath() {
        readyWithIdentity();
        when(branding.effectivePublicBaseUrl()).thenReturn(null);
        NotificationDO notification = notification("USER_REGISTRATION_REVIEW");
        notification.setLink("/workspaces?view=spaces");
        NotificationDO absolute = notification("USER_REGISTRATION_REVIEW");
        absolute.setLink("https://other.example/path");
        NotificationDO blank = notification("USER_REGISTRATION_REVIEW");
        blank.setLink("   ");

        assertTrue(dispatcher.dispatch(notification));
        assertTrue(dispatcher.dispatch(absolute));
        assertTrue(dispatcher.dispatch(blank));

        ArgumentCaptor<ImNotificationTask> task = ArgumentCaptor.forClass(ImNotificationTask.class);
        verify(queue, org.mockito.Mockito.times(3)).enqueue(task.capture());
        assertEquals("/workspaces?view=spaces", task.getAllValues().get(0).notificationLink());
        assertEquals("https://other.example/path", task.getAllValues().get(1).notificationLink());
        assertNull(task.getAllValues().get(2).notificationLink());
    }

    @Test
    void missingTenantIdAndInsecureLinkStillQueue() {
        readyWithIdentity();
        when(branding.effectivePublicBaseUrl()).thenReturn("https://auto.example.com");
        NotificationDO notification = notification("USER_REGISTRATION_REVIEW");
        notification.setTenantId(null);
        notification.setLink("http://insecure.example/path");

        assertTrue(dispatcher.dispatch(notification));

        ArgumentCaptor<ImNotificationTask> task = ArgumentCaptor.forClass(ImNotificationTask.class);
        verify(queue).enqueue(task.capture());
        assertEquals(0L, task.getValue().tenantId());
        assertEquals("http://insecure.example/path", task.getValue().notificationLink());
    }

    @Test
    void skipsWhenThePlatformChannelIsNotReady() {
        when(configs.selectedProvider()).thenReturn("DINGTALK");
        when(configs.isReady("DINGTALK")).thenReturn(false);

        assertFalse(dispatcher.dispatch(notification("USER_REGISTRATION_REVIEW")));
        verifyNoInteractions(identities, queue);
    }

    @Test
    void skipsWhenTheRecipientHasNoBoundIdentity() {
        when(configs.selectedProvider()).thenReturn("DINGTALK");
        when(configs.isReady("DINGTALK")).thenReturn(true);
        when(identities.find(9L, "DINGTALK")).thenReturn(null);

        assertFalse(dispatcher.dispatch(notification("USER_REGISTRATION_REVIEW")));
        verify(queue, never()).enqueue(any());
    }

    @Test
    void skipsWhenTheBoundExternalIdIsBlank() {
        readyWithIdentity();
        UserImIdentityDO identity = new UserImIdentityDO();
        identity.setExternalUserId("  ");
        when(identities.find(9L, "DINGTALK")).thenReturn(identity);

        assertFalse(dispatcher.dispatch(notification("USER_REGISTRATION_REVIEW")));
        verify(queue, never()).enqueue(any());

        UserImIdentityDO missingExternalId = new UserImIdentityDO();
        when(identities.find(9L, "DINGTALK")).thenReturn(missingExternalId);
        assertFalse(dispatcher.dispatch(notification("USER_REGISTRATION_REVIEW")));
        verify(queue, never()).enqueue(any());
    }

    @Test
    void enqueueFailureIsReportedAsNotDelivered() {
        readyWithIdentity();
        doThrow(new IllegalStateException("redis down")).when(queue).enqueue(any());

        assertFalse(dispatcher.dispatch(notification("USER_REGISTRATION_REVIEW")));
    }

    @Test
    void dedicatedImTypesAreOwnedByTheirListener() {
        assertTrue(dispatcher.dispatch(notification("WORKITEM_ASSIGNED")));
        assertTrue(dispatcher.dispatch(notification("COMMENT_MENTION")));
        assertTrue(dispatcher.dispatch(notification("WORKSPACE_ACCESS_REQUEST")));
        assertTrue(dispatcher.dispatch(notification("WORKSPACE_ACCESS_REVIEWED")));
        verifyNoInteractions(queue, configs, identities);
    }

    @Test
    void dispatchAllResolvesChannelReadinessOncePerBatch() {
        readyWithIdentity();
        UserImIdentityDO second = new UserImIdentityDO();
        second.setExternalUserId("staff-002");
        when(identities.find(10L, "DINGTALK")).thenReturn(second);
        NotificationDO secondNotification = notification("USER_REGISTRATION_REVIEW");
        secondNotification.setId(89L);
        secondNotification.setRecipientId(10L);

        assertEquals(2, dispatcher.dispatchAll(List.of(notification("USER_REGISTRATION_REVIEW"), secondNotification)));

        verify(queue, times(2)).enqueue(any());
        // 同一事件的渠道选择与就绪状态只读一次，不再逐收件人重复读配置。
        verify(configs, times(1)).selectedProvider();
        verify(configs, times(1)).isReady("DINGTALK");
        verify(identities, times(1)).find(9L, "DINGTALK");
        verify(identities, times(1)).find(10L, "DINGTALK");
    }

    @Test
    void dispatchAllFiltersDedicatedAndIncompleteRows() {
        readyWithIdentity();
        NotificationDO withoutId = notification("USER_REGISTRATION_REVIEW");
        withoutId.setId(null);
        NotificationDO dedicated = notification("WORKITEM_ASSIGNED");

        assertEquals(1, dispatcher.dispatchAll(java.util.Arrays.asList(
                null, withoutId, dedicated, notification("USER_REGISTRATION_REVIEW"))));

        verify(queue, times(1)).enqueue(any());
    }

    @Test
    void dispatchAllIgnoresEmptyInput() {
        assertEquals(0, dispatcher.dispatchAll(null));
        assertEquals(0, dispatcher.dispatchAll(List.of()));
        verifyNoInteractions(queue, configs, identities);
    }

    @Test
    void dispatchAllSkipsEveryRecipientWhenTheChannelIsNotReady() {
        when(configs.selectedProvider()).thenReturn("DINGTALK");
        when(configs.isReady("DINGTALK")).thenReturn(false);
        NotificationDO second = notification("USER_REGISTRATION_REVIEW");
        second.setRecipientId(10L);

        assertEquals(0, dispatcher.dispatchAll(List.of(notification("USER_REGISTRATION_REVIEW"), second)));

        verifyNoInteractions(identities);
        verify(queue, never()).enqueue(any());
        verify(configs, times(1)).selectedProvider();
    }

    @Test
    void dispatchAllKeepsDeliveringWhenOneEnqueueFails() {
        readyWithIdentity();
        doThrow(new IllegalStateException("redis down")).doNothing().when(queue).enqueue(any());
        NotificationDO second = notification("USER_REGISTRATION_REVIEW");
        second.setId(89L);
        second.setRecipientId(10L);
        UserImIdentityDO other = new UserImIdentityDO();
        other.setExternalUserId("staff-002");
        when(identities.find(10L, "DINGTALK")).thenReturn(other);

        assertEquals(1, dispatcher.dispatchAll(List.of(notification("USER_REGISTRATION_REVIEW"), second)));

        verify(queue, times(2)).enqueue(any());
    }

    @Test
    void dispatchAllSkipsOnlyTheRecipientWithoutIdentity() {
        readyWithIdentity();
        NotificationDO second = notification("USER_REGISTRATION_REVIEW");
        second.setId(89L);
        second.setRecipientId(10L);
        when(identities.find(10L, "DINGTALK")).thenReturn(null);

        assertEquals(1, dispatcher.dispatchAll(List.of(notification("USER_REGISTRATION_REVIEW"), second)));

        verify(queue, times(1)).enqueue(any());
    }

    @Test
    void incompleteRowsAreIgnored() {
        assertFalse(dispatcher.dispatch(null));

        NotificationDO withoutId = notification("USER_REGISTRATION_REVIEW");
        withoutId.setId(null);
        assertFalse(dispatcher.dispatch(withoutId));

        NotificationDO withoutRecipient = notification("USER_REGISTRATION_REVIEW");
        withoutRecipient.setRecipientId(null);
        assertFalse(dispatcher.dispatch(withoutRecipient));
        verifyNoInteractions(queue);
    }

    @Test
    void nullTypeStillDispatchesAfterTheConditionChecks() {
        when(configs.selectedProvider()).thenReturn("DINGTALK");
        when(configs.isReady("DINGTALK")).thenReturn(false);
        NotificationDO notification = notification(null);

        assertFalse(dispatcher.dispatch(notification));
        verifyNoInteractions(queue);
    }

    private void readyWithIdentity() {
        when(configs.selectedProvider()).thenReturn("DINGTALK");
        when(configs.isReady("DINGTALK")).thenReturn(true);
        UserImIdentityDO identity = new UserImIdentityDO();
        identity.setExternalUserId("staff-001");
        when(identities.find(9L, "DINGTALK")).thenReturn(identity);
    }
    private static NotificationDO notification(String type) {
        NotificationDO notification = new NotificationDO();
        notification.setId(88L);
        notification.setTenantId(7L);
        notification.setRecipientId(9L);
        notification.setType(type);
        notification.setTitle("重复提醒");
        notification.setContent("新旧标题");
        return notification;
    }
}
