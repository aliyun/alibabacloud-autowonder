package com.aliyun.autowonder.auth.session;

import com.aliyun.autowonder.auth.jwt.JwtProperties;
import com.aliyun.autowonder.auth.jwt.JwtService;
import com.aliyun.autowonder.email.EmailVerificationPolicyService;
import com.aliyun.autowonder.email.EmailVerificationTokenService;
import com.aliyun.autowonder.user.UserDO;
import com.aliyun.autowonder.user.dto.LoginResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SessionIssuanceRestrictedTest {

    private JwtService jwtService;
    private SessionService sessionService;
    private EmailVerificationPolicyService policy;
    private EmailVerificationTokenService tokenService;
    private SessionIssuanceService service;

    @BeforeEach
    void setUp() throws Exception {
        jwtService = mock(JwtService.class);
        sessionService = mock(SessionService.class);
        JwtProperties props = mock(JwtProperties.class);
        when(props.getRefreshTtlSeconds()).thenReturn(3600L);
        when(jwtService.signAccess(any())).thenReturn("access-1");
        policy = mock(EmailVerificationPolicyService.class);
        tokenService = mock(EmailVerificationTokenService.class);
        service = new SessionIssuanceService(jwtService, sessionService, props);
        setField("emailVerificationPolicyService", policy);
        setField("emailVerificationTokenService", tokenService);
    }

    private void setField(String name, Object value) throws Exception {
        Field field = SessionIssuanceService.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(service, value);
    }

    private UserDO user() {
        UserDO user = new UserDO();
        user.setId(10000L);
        user.setUsername("alice");
        user.setNickname("Alice");
        user.setEmail("alice@corp.example.com");
        user.setIsAdmin(1);
        return user;
    }

    @Test
    void unverifiedUserGetsRestrictedCredentialInsteadOfSession() {
        UserDO user = user();
        when(policy.requiresVerification(user)).thenReturn(true);
        when(tokenService.issueRestricted(10000L)).thenReturn("awev_restricted");

        LoginResponse response = service.issue(user);

        assertEquals(SessionIssuanceService.PURPOSE_EMAIL_VERIFICATION, response.getSessionPurpose());
        assertEquals("awev_restricted", response.getRestrictedToken());
        assertNull(response.getAccessToken());
        assertNull(response.getRefreshToken());
        assertNotNull(response.getRestrictedExpiresAt());
        verify(sessionService, never()).storeRefresh(any(), anyLong(), anyInt());
        verify(jwtService, never()).signAccess(any());
    }

    @Test
    void verifiedUserStillGetsNormalSession() {
        UserDO user = user();
        when(policy.requiresVerification(user)).thenReturn(false);

        LoginResponse response = service.issue(user);

        assertNull(response.getSessionPurpose());
        assertEquals("access-1", response.getAccessToken());
        assertNotNull(response.getRefreshToken());
        verify(sessionService).storeRefresh(any(), anyLong(), anyInt());
    }

    @Test
    void restrictedCredentialIsNotIssuedForPendingReviewAccount() {
        UserDO user = user();
        user.setStatus(2);

        var error = org.junit.jupiter.api.Assertions.assertThrows(
                com.aliyun.autowonder.common.error.BizException.class, () -> service.issue(user));
        assertEquals("37012", error.getCode());
        verify(tokenService, never()).issueRestricted(anyLong());
    }

    @Test
    void restrictedTtlConstantIsFifteenMinutes() {
        assertTrue(EmailVerificationTokenService.RESTRICTED_TTL_SECONDS == 900);
    }
}
