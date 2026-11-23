package com.aliyun.autowonder.email;

import com.aliyun.autowonder.auth.jwt.JwtService;
import com.aliyun.autowonder.auth.jwt.TokenPayload;
import com.aliyun.autowonder.auth.session.SessionService;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.result.Result;
import com.aliyun.autowonder.email.dto.SendEmailCodeRequest;
import com.aliyun.autowonder.email.dto.SendEmailCodeResponse;
import com.aliyun.autowonder.email.dto.VerifyEmailCodeRequest;
import com.aliyun.autowonder.email.dto.VerifyEmailCodeResponse;
import com.aliyun.autowonder.user.UserDO;
import com.aliyun.autowonder.user.UserDao;
import com.aliyun.autowonder.user.dto.LoginResponse;
import com.aliyun.autowonder.user.dto.UserVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EmailVerificationControllerTest {

    private static final long USER_ID = 31L;
    private static final String JWT = "header.payload.signature";

    private EmailVerificationPolicyService policyService;
    private EmailVerificationService verificationService;
    private EmailVerificationTokenService tokenService;
    private JwtService jwtService;
    private SessionService sessionService;
    private UserDao userDao;
    private EmailVerificationController controller;

    @BeforeEach
    void setUp() {
        policyService = mock(EmailVerificationPolicyService.class);
        verificationService = mock(EmailVerificationService.class);
        tokenService = mock(EmailVerificationTokenService.class);
        jwtService = mock(JwtService.class);
        sessionService = mock(SessionService.class);
        userDao = mock(UserDao.class);
        controller = new EmailVerificationController(policyService, verificationService, tokenService,
                jwtService, sessionService, userDao);
    }

    private MockHttpServletRequest request(String bearerToken) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/auth/email-verification/codes");
        if (bearerToken != null) {
            request.addHeader("Authorization", "Bearer " + bearerToken);
        }
        return request;
    }

    private SendEmailCodeRequest codeRequest(String purpose, String email) {
        SendEmailCodeRequest request = new SendEmailCodeRequest();
        request.setPurpose(purpose);
        request.setEmail(email);
        return request;
    }

    private VerifyEmailCodeRequest verifyRequest(String purpose, String email) {
        VerifyEmailCodeRequest request = new VerifyEmailCodeRequest();
        request.setPurpose(purpose);
        request.setEmail(email);
        request.setChallengeId("challenge");
        request.setCode("123456");
        return request;
    }

    private UserDO user() {
        UserDO user = new UserDO();
        user.setId(USER_ID);
        user.setEmail("user@example.com");
        return user;
    }

    private void authenticateNormalToken() {
        when(jwtService.parse(JWT)).thenReturn(new TokenPayload(USER_ID, null, "jti"));
        when(sessionService.isBlacklisted("jti")).thenReturn(false);
        when(userDao.findById(USER_ID)).thenReturn(user());
    }

    @Test
    void policyProjectionIsPublic() {
        when(policyService.publicPolicy())
                .thenReturn(new com.aliyun.autowonder.email.dto.EmailVerificationPolicyPublicVO());
        assertNotNull(controller.policy().getData());
    }

    @Test
    void registerSendCodeWorksWithoutCredential() {
        when(verificationService.sendCode(eq(EmailVerificationPurpose.REGISTER), eq("user@example.com"),
                isNull(), any())).thenReturn(new EmailCodeService.Challenge("c", new Date(), new Date()));

        Result<SendEmailCodeResponse> result = controller.sendCode(
                codeRequest("REGISTER", "user@example.com"), request(null));

        assertNotNull(result.getData().getChallengeId());
    }

    @Test
    void profileSendCodeRequiresNormalSession() {
        when(verificationService.sendCode(eq(EmailVerificationPurpose.PROFILE_EMAIL), eq("new@example.com"),
                eq(USER_ID), any())).thenReturn(new EmailCodeService.Challenge("c", new Date(), new Date()));
        authenticateNormalToken();

        Result<SendEmailCodeResponse> result = controller.sendCode(
                codeRequest("PROFILE_EMAIL", "new@example.com"), request(JWT));

        assertEquals("c", result.getData().getChallengeId());
    }

    @Test
    void profileSendCodeWithoutSessionIsUnauthorized() {
        assertEquals("10401", assertThrows(BizException.class, () -> controller.sendCode(
                codeRequest("PROFILE_EMAIL", "new@example.com"), request(null))).getCode());
    }

    @Test
    void restrictedSendCodeRequiresRestrictedCredential() {
        when(tokenService.resolveRestricted("awev_ok")).thenReturn(USER_ID);
        when(verificationService.sendCode(eq(EmailVerificationPurpose.RESTRICTED), eq("user@example.com"),
                eq(USER_ID), any())).thenReturn(new EmailCodeService.Challenge("c", new Date(), new Date()));
        controller.sendCode(codeRequest("RESTRICTED", "user@example.com"), request("awev_ok"));

        authenticateNormalToken();
        assertEquals("51015", assertThrows(BizException.class, () -> controller.sendCode(
                codeRequest("RESTRICTED", "user@example.com"), request(JWT))).getCode());

        when(tokenService.resolveRestricted("awev_gone")).thenReturn(null);
        assertEquals("51017", assertThrows(BizException.class, () -> controller.sendCode(
                codeRequest("RESTRICTED", "user@example.com"), request("awev_gone"))).getCode());
    }

    @Test
    void restrictedCredentialCannotBeUsedForProfilePurpose() {
        when(tokenService.resolveRestricted("awev_ok")).thenReturn(USER_ID);
        assertEquals("51015", assertThrows(BizException.class, () -> controller.sendCode(
                codeRequest("PROFILE_EMAIL", "new@example.com"), request("awev_ok"))).getCode());
    }

    @Test
    void invalidPurposeIsParamInvalid() {
        assertEquals("10001", assertThrows(BizException.class, () -> controller.sendCode(
                codeRequest("SOMETHING", "a@b.com"), request(null))).getCode());
        assertEquals("10001", assertThrows(BizException.class, () -> controller.sendCode(
                codeRequest(null, "a@b.com"), request(null))).getCode());
    }

    @Test
    void registerVerifyReturnsProof() {
        when(verificationService.verifyForProof(EmailVerificationPurpose.REGISTER, "user@example.com",
                null, "challenge", "123456")).thenReturn("awevp_reg");

        Result<VerifyEmailCodeResponse> result = controller.verify(
                verifyRequest("REGISTER", "user@example.com"), request(null));

        assertEquals("awevp_reg", result.getData().getProof());
        assertNull(result.getData().getSession());
    }

    @Test
    void restrictedVerifyReturnsFreshSessionAndRevokesToken() {
        when(tokenService.resolveRestricted("awev_ok")).thenReturn(USER_ID);
        LoginResponse session = new LoginResponse(USER_ID, "access", "refresh", new UserVO());
        when(verificationService.completeRestricted(USER_ID, "user@example.com", "challenge", "123456"))
                .thenReturn(session);

        Result<VerifyEmailCodeResponse> result = controller.verify(
                verifyRequest("RESTRICTED", "user@example.com"), request("awev_ok"));

        assertSame(session, result.getData().getSession());
        verify(tokenService).revokeRestricted("awev_ok");
    }

    @Test
    void blacklistedOrMissingSessionIsUnauthorized() {
        when(jwtService.parse(JWT)).thenReturn(new TokenPayload(USER_ID, null, "jti"));
        when(sessionService.isBlacklisted("jti")).thenReturn(true);
        assertEquals("10401", assertThrows(BizException.class, () -> controller.sendCode(
                codeRequest("PROFILE_EMAIL", "new@example.com"), request(JWT))).getCode());

        when(sessionService.isBlacklisted("jti")).thenReturn(false);
        when(userDao.findById(USER_ID)).thenReturn(null);
        assertEquals("10401", assertThrows(BizException.class, () -> controller.sendCode(
                codeRequest("PROFILE_EMAIL", "new@example.com"), request(JWT))).getCode());

        when(jwtService.parse(JWT)).thenThrow(new IllegalArgumentException("bad token"));
        assertEquals("10401", assertThrows(BizException.class, () -> controller.sendCode(
                codeRequest("PROFILE_EMAIL", "new@example.com"), request(JWT))).getCode());
    }

    @Test
    void signOutRevokesRestrictedTokenOnly() {
        controller.signOut(request("awev_ok"));
        verify(tokenService).revokeRestricted("awev_ok");

        org.mockito.Mockito.clearInvocations(tokenService);
        controller.signOut(request(null));
        verify(tokenService, never()).revokeRestricted(any());
    }
}
