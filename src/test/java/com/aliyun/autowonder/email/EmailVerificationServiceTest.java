package com.aliyun.autowonder.email;

import com.aliyun.autowonder.auth.session.SessionIssuanceService;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.user.UserDO;
import com.aliyun.autowonder.user.UserDao;
import com.aliyun.autowonder.user.dto.LoginResponse;
import com.aliyun.autowonder.user.dto.UserVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;

import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EmailVerificationServiceTest {

    private static final long USER_ID = 21L;

    private EmailVerificationPolicyService policy;
    private EmailCodeService codeService;
    private EmailVerificationTokenService tokenService;
    private UserDao userDao;
    private SessionIssuanceService sessionIssuanceService;
    private EmailVerificationService service;

    @BeforeEach
    void setUp() {
        policy = mock(EmailVerificationPolicyService.class);
        codeService = mock(EmailCodeService.class);
        tokenService = mock(EmailVerificationTokenService.class);
        userDao = mock(UserDao.class);
        sessionIssuanceService = mock(SessionIssuanceService.class);
        service = new EmailVerificationService(policy, codeService, tokenService, userDao,
                sessionIssuanceService);
    }

    private UserDO user(String email) {
        UserDO user = new UserDO();
        user.setId(USER_ID);
        user.setEmail(email);
        user.setStatus(0);
        user.setGmtCreate(new Date());
        return user;
    }

    @Test
    void sendCodeRequiresVerificationToBeEnabled() {
        when(policy.verificationEnabled()).thenReturn(false);
        assertEquals("51002", assertThrows(BizException.class, () -> service.sendCode(
                EmailVerificationPurpose.REGISTER, "user@example.com", null, "1.1.1.1")).getCode());
    }

    @Test
    void sendCodeRejectsNonCompliantDomain() {
        when(policy.verificationEnabled()).thenReturn(true);
        when(policy.isEmailCompliant("user@other.com")).thenReturn(false);
        assertEquals("51006", assertThrows(BizException.class, () -> service.sendCode(
                EmailVerificationPurpose.REGISTER, "user@other.com", null, "1.1.1.1")).getCode());
        assertEquals("51006", assertThrows(BizException.class, () -> service.sendCode(
                EmailVerificationPurpose.REGISTER, "  ", null, "1.1.1.1")).getCode());
    }

    @Test
    void sendCodeDelegatesWithNormalizedEmail() {
        when(policy.verificationEnabled()).thenReturn(true);
        when(policy.isEmailCompliant("user@example.com")).thenReturn(true);
        EmailCodeService.Challenge challenge =
                new EmailCodeService.Challenge("c", new Date(), new Date());
        when(codeService.send(EmailVerificationPurpose.PROFILE_EMAIL, "user@example.com", USER_ID, "1.1.1.1"))
                .thenReturn(challenge);

        assertSame(challenge, service.sendCode(EmailVerificationPurpose.PROFILE_EMAIL,
                " user@example.com ", USER_ID, "1.1.1.1"));
    }

    @Test
    void verifyForProofConsumesCodeThenIssuesProof() {
        when(tokenService.issueProof(EmailVerificationPurpose.PROFILE_EMAIL, USER_ID, "new@example.com"))
                .thenReturn("awevp_ok");

        assertEquals("awevp_ok", service.verifyForProof(EmailVerificationPurpose.PROFILE_EMAIL,
                "new@example.com", USER_ID, "challenge", "123456"));
        verify(codeService).verify(EmailVerificationPurpose.PROFILE_EMAIL, "new@example.com",
                USER_ID, "challenge", "123456");
    }

    @Test
    void verifyForProofRejectsMissingEmail() {
        assertEquals("10001", assertThrows(BizException.class, () -> service.verifyForProof(
                EmailVerificationPurpose.REGISTER, "  ", null, "c", "123456")).getCode());
    }

    @Test
    void consumeRegisterProofBindsAnonymousPurposeAndEmail() {
        service.consumeRegisterProof("awevp_reg", "user@example.com");
        verify(tokenService).consumeProof("awevp_reg", EmailVerificationPurpose.REGISTER, null,
                "user@example.com");
    }

    @Test
    void consumeProfileProofBindsUser() {
        service.consumeProfileProof(USER_ID, "new@example.com", "awevp_p");
        verify(tokenService).consumeProof("awevp_p", EmailVerificationPurpose.PROFILE_EMAIL, USER_ID,
                "new@example.com");
    }

    @Test
    void completeRestrictedUpdatesEmailThenIssuesNormalSession() {
        UserDO existing = user("old@example.com");
        UserDO updated = user("new@example.com");
        updated.setVerifiedEmail("new@example.com");
        when(userDao.findById(USER_ID)).thenReturn(existing, updated);
        when(policy.isEmailCompliant("new@example.com")).thenReturn(true);
        LoginResponse session = new LoginResponse(USER_ID, "access", "refresh", new UserVO());
        when(sessionIssuanceService.issue(updated)).thenReturn(session);
        when(userDao.updateEmailWithVerification(eq(USER_ID), eq("new@example.com"),
                eq("new@example.com"), any(Date.class), any(Date.class))).thenReturn(1);

        assertSame(session, service.completeRestricted(USER_ID, "new@example.com", "c", "123456"));
        verify(codeService).verify(EmailVerificationPurpose.RESTRICTED, "new@example.com",
                USER_ID, "c", "123456");
    }

    @Test
    void completeRestrictedRejectsUnknownUserAndBadEmail() {
        when(userDao.findById(USER_ID)).thenReturn(null);
        assertEquals("10401", assertThrows(BizException.class, () -> service.completeRestricted(
                USER_ID, "new@example.com", "c", "123456")).getCode());

        when(userDao.findById(USER_ID)).thenReturn(user("old@example.com"));
        assertEquals("51006", assertThrows(BizException.class, () -> service.completeRestricted(
                USER_ID, "new@example.com", "c", "123456")).getCode());
    }

    @Test
    void completeRestrictedMapsEmailConflict() {
        when(userDao.findById(USER_ID)).thenReturn(user("old@example.com"));
        when(policy.isEmailCompliant("taken@example.com")).thenReturn(true);
        when(userDao.updateEmailWithVerification(anyLong(), anyString(), anyString(),
                any(Date.class), any(Date.class))).thenThrow(new DuplicateKeyException("dup"));

        assertEquals("10409", assertThrows(BizException.class, () -> service.completeRestricted(
                USER_ID, "taken@example.com", "c", "123456")).getCode());
        verify(sessionIssuanceService, never()).issue(any());
    }

    @Test
    void completeRestrictedFailsWhenUpdateMatchesNoRow() {
        when(userDao.findById(USER_ID)).thenReturn(user("old@example.com"));
        when(policy.isEmailCompliant("new@example.com")).thenReturn(true);
        when(userDao.updateEmailWithVerification(anyLong(), anyString(), anyString(),
                any(Date.class), any(Date.class))).thenReturn(0);

        assertEquals("10401", assertThrows(BizException.class, () -> service.completeRestricted(
                USER_ID, "new@example.com", "c", "123456")).getCode());
    }

    @Test
    void revokeRestrictedDelegates() {
        service.revokeRestricted("awev_abc");
        verify(tokenService).revokeRestricted("awev_abc");
    }
}
