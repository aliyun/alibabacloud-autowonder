package com.aliyun.autowonder.email;

import com.aliyun.autowonder.access.SystemAdminService;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.context.AutoWonderContext;
import com.aliyun.autowonder.email.dto.EmailVerificationPolicyVO;
import com.aliyun.autowonder.email.dto.UpdateEmailVerificationPolicyRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PlatformEmailPolicyControllerTest {

    private static final long OPERATOR = 7L;

    private EmailVerificationPolicyService policyService;
    private EmailVerificationNotificationListener notificationListener;
    private SystemAdminService systemAdminService;
    private PlatformEmailPolicyController controller;

    @BeforeEach
    void setUp() {
        policyService = mock(EmailVerificationPolicyService.class);
        notificationListener = mock(EmailVerificationNotificationListener.class);
        systemAdminService = mock(SystemAdminService.class);
        controller = new PlatformEmailPolicyController(policyService, notificationListener, systemAdminService);
        AutoWonderContext.get().setUserId(OPERATOR);
    }

    @AfterEach
    void tearDown() {
        AutoWonderContext.destroy();
    }

    @Test
    void readAndUpdateRequirePlatformAdmin() {
        EmailVerificationPolicyVO vo = new EmailVerificationPolicyVO();
        when(policyService.getPolicy()).thenReturn(vo);

        assertSame(vo, controller.get().getData());
        verify(systemAdminService).requireSystemAdmin(OPERATOR, "配置邮箱验证策略",
                "access.admin.email_verification_denied");

        UpdateEmailVerificationPolicyRequest request = new UpdateEmailVerificationPolicyRequest();
        when(policyService.update(OPERATOR, request)).thenReturn(vo);
        assertSame(vo, controller.update(request).getData());
    }

    @Test
    void replayNotificationsDelegatesToListener() {
        controller.replayNotifications(5L);
        verify(notificationListener).replay(5L);

        controller.replayNotifications(null);
        verify(notificationListener).replay(0L);
    }

    @Test
    void anonymousCallerIsUnauthorized() {
        AutoWonderContext.destroy();
        AutoWonderContext.get();

        assertEquals("10401", assertThrows(BizException.class,
                () -> controller.replayNotifications(5L)).getCode());
        verify(notificationListener, never()).replay(any(Long.class));
    }
}
