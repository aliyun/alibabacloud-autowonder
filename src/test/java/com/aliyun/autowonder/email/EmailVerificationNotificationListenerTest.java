package com.aliyun.autowonder.email;

import com.aliyun.autowonder.notification.NotifyService;
import com.aliyun.autowonder.user.UserDO;
import com.aliyun.autowonder.user.UserDao;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EmailVerificationNotificationListenerTest {

    private EmailVerificationNoticeDao noticeDao;
    private UserDao userDao;
    private NotifyService notifyService;
    private EmailVerificationPolicyService policyService;
    private EmailVerificationNotificationListener listener;

    @BeforeEach
    void setUp() {
        noticeDao = mock(EmailVerificationNoticeDao.class);
        userDao = mock(UserDao.class);
        notifyService = mock(NotifyService.class);
        policyService = mock(EmailVerificationPolicyService.class);
        com.aliyun.autowonder.email.dto.EmailVerificationPolicyVO policy =
                new com.aliyun.autowonder.email.dto.EmailVerificationPolicyVO();
        policy.setVersion(10L);
        when(policyService.getPolicy()).thenReturn(policy);
        listener = new EmailVerificationNotificationListener(noticeDao, userDao, notifyService,
                policyService);
    }

    private UserDO user(long id) {
        UserDO user = new UserDO();
        user.setId(id);
        user.setEmail("u" + id + "@example.com");
        return user;
    }

    @Test
    void duplicatePolicyVersionSkipsSending() {
        when(noticeDao.insertIfAbsent(5L)).thenReturn(0);
        listener.dispatch(5L);
        verify(userDao, never()).listUnverifiedActiveUsers();
        verify(notifyService, never()).notify(any());
    }

    @Test
    void sendsOnePlatformNotificationPerUnverifiedUser() {
        when(noticeDao.insertIfAbsent(5L)).thenReturn(1);
        when(userDao.listUnverifiedActiveUsers()).thenReturn(List.of(user(1L), user(2L)));

        listener.dispatch(5L);

        ArgumentCaptor<com.aliyun.autowonder.notification.NotifyEvent> captor =
                ArgumentCaptor.forClass(com.aliyun.autowonder.notification.NotifyEvent.class);
        verify(notifyService, times(2)).notify(captor.capture());
        assertEquals("PLATFORM", captor.getAllValues().get(0).getScope());
        assertEquals(0L, captor.getAllValues().get(0).getTenantId());
        assertEquals("/email-verification", captor.getAllValues().get(0).getLink());
        verify(noticeDao).updateCounts(5L, 2, 0);
    }

    @Test
    void singleRecipientFailureDoesNotStopOthers() {
        when(noticeDao.insertIfAbsent(6L)).thenReturn(1);
        when(userDao.listUnverifiedActiveUsers()).thenReturn(List.of(user(1L), user(2L)));
        doThrow(new IllegalStateException("notification down")).doNothing()
                .when(notifyService).notify(any());

        listener.dispatch(6L);

        verify(notifyService, times(2)).notify(any());
        verify(noticeDao).updateCounts(6L, 2, 1);
    }

    @Test
    void broadcastEventSwallowsFailures() {
        when(noticeDao.insertIfAbsent(7L)).thenThrow(new IllegalStateException("db down"));
        listener.onBroadcast(new com.aliyun.autowonder.email.event.EmailVerificationBroadcastRequestedEvent(7L));
        verify(noticeDao, never()).updateCounts(eq(7L), org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void replayResendsAndOverwritesCountsWithoutDroppingHistory() {
        when(noticeDao.insertIfAbsent(9L)).thenReturn(0);
        when(userDao.listUnverifiedActiveUsers()).thenReturn(List.of(user(1L)));

        listener.replay(9L);

        // 重放保留去重行（不删除历史），仍向当前未验证用户重发并覆盖本次计数。
        verify(noticeDao).updateCounts(9L, 1, 0);
        verify(notifyService).notify(any());
    }

    @Test
    void replayRejectsVersionsOutsideTheCurrentPolicyRange() {
        assertEquals("10001", org.junit.jupiter.api.Assertions.assertThrows(
                com.aliyun.autowonder.common.error.BizException.class,
                () -> listener.replay(0L)).getCode());
        assertEquals("10001", org.junit.jupiter.api.Assertions.assertThrows(
                com.aliyun.autowonder.common.error.BizException.class,
                () -> listener.replay(11L)).getCode());
        verify(userDao, never()).listUnverifiedActiveUsers();
    }
}
