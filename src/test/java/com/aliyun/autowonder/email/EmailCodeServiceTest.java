package com.aliyun.autowonder.email;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.redis.RedisManager;
import com.aliyun.autowonder.user.UserSettingService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Locale;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EmailCodeServiceTest {

    private RedisManager redis;
    private MailSettingsService mailSettingsService;
    private UserSettingService userSettingService;
    private EmailCodeService service;

    @BeforeEach
    void setUp() {
        redis = mock(RedisManager.class);
        mailSettingsService = mock(MailSettingsService.class);
        userSettingService = mock(UserSettingService.class);
        when(userSettingService.recipientLocale(anyLong())).thenReturn(Locale.CHINA);
        service = new EmailCodeService(redis, mailSettingsService, userSettingService);
        when(redis.exIncrBy(anyString(), anyLong(), anyLong())).thenReturn(1L);
    }

    private void stubLatest(EmailVerificationPurpose purpose, String owner, String email, String challengeId) {
        when(redis.getString("aw:email:latest:" + purpose.name() + ":" + owner + ":" + email))
                .thenReturn(challengeId);
    }

    @Test
    void sendStoresChallengeAndReturnsWindows() {
        when(redis.exists(anyString())).thenReturn(false);

        EmailCodeService.Challenge challenge =
                service.send(EmailVerificationPurpose.REGISTER, "user@example.com", null, "10.0.0.1");

        assertNotNull(challenge.challengeId());
        assertTrue(challenge.resendAt().after(new java.util.Date(0)));
        assertTrue(challenge.expiresAt().after(challenge.resendAt()));
        verify(redis).hset(anyString(), eq("purpose"), eq("REGISTER"));
        verify(redis).hset(anyString(), eq("email"), eq("user@example.com"));
        verify(redis).hset(anyString(), eq("owner"), eq("anonymous"));
        verify(mailSettingsService).sendActiveMail(eq("user@example.com"), anyString(), anyString());
        verify(redis).setString(anyString(), eq("1"));
        verify(redis).setWithExpire(
                eq("aw:email:latest:REGISTER:anonymous:user@example.com"),
                eq(challenge.challengeId()),
                eq((long) EmailVerificationPolicyService.CODE_TTL_SECONDS));
    }

    @Test
    void resendInvalidatesPreviousChallenge() {
        when(redis.exists(anyString())).thenReturn(false);
        stubLatest(EmailVerificationPurpose.PROFILE_EMAIL, "5", "user@example.com", "previous-challenge");

        EmailCodeService.Challenge challenge = service.send(
                EmailVerificationPurpose.PROFILE_EMAIL, "user@example.com", 5L, "1.1.1.1");

        verify(redis).del("aw:email:code:previous-challenge");
        verify(redis).setWithExpire(
                eq("aw:email:latest:PROFILE_EMAIL:5:user@example.com"),
                eq(challenge.challengeId()),
                eq((long) EmailVerificationPolicyService.CODE_TTL_SECONDS));
    }

    @Test
    void anonymousRegistrationMailUsesChinese() {
        when(redis.exists(anyString())).thenReturn(false);
        service.send(EmailVerificationPurpose.REGISTER, "user@example.com", null, "10.0.0.1");

        ArgumentCaptor<String> subject = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(mailSettingsService).sendActiveMail(eq("user@example.com"), subject.capture(), body.capture());
        assertTrue(subject.getValue().contains("邮箱验证码"));
        assertTrue(body.getValue().contains("分钟内有效"));
    }

    @Test
    void authenticatedMailUsesRecipientLocale() {
        when(redis.exists(anyString())).thenReturn(false);
        when(userSettingService.recipientLocale(5L)).thenReturn(Locale.US);

        service.send(EmailVerificationPurpose.PROFILE_EMAIL, "user@example.com", 5L, "1.1.1.1");

        ArgumentCaptor<String> subject = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(mailSettingsService).sendActiveMail(eq("user@example.com"), subject.capture(), body.capture());
        assertTrue(subject.getValue().toLowerCase(Locale.ROOT).contains("verification code"));
        assertTrue(body.getValue().contains("Do not share"));
        assertFalse(body.getValue().contains("您的验证码"));
    }

    @Test
    void cooldownBlocksImmediateResend() {
        when(redis.exists(anyString())).thenReturn(true);
        assertEquals("51004", assertThrows(BizException.class, () -> service.send(
                EmailVerificationPurpose.RESTRICTED, "user@example.com", 5L, "1.1.1.1")).getCode());
        verify(mailSettingsService, never()).sendActiveMail(anyString(), anyString(), anyString());
    }

    @Test
    void rateLimitsAreEnforcedPerEmailUserIpAndPlatform() {
        when(redis.exists(anyString())).thenReturn(false);
        when(redis.exIncrBy(startsWith("aw:email:rate:email:"), anyLong(), anyLong())).thenReturn(11L);
        assertEquals("51004", assertThrows(BizException.class, () -> service.send(
                EmailVerificationPurpose.PROFILE_EMAIL, "user@example.com", 5L, "1.1.1.1")).getCode());

        when(redis.exIncrBy(startsWith("aw:email:rate:email:"), anyLong(), anyLong())).thenReturn(1L);
        when(redis.exIncrBy(startsWith("aw:email:rate:user:"), anyLong(), anyLong())).thenReturn(11L);
        assertEquals("51004", assertThrows(BizException.class, () -> service.send(
                EmailVerificationPurpose.PROFILE_EMAIL, "user@example.com", 5L, "1.1.1.1")).getCode());

        when(redis.exIncrBy(startsWith("aw:email:rate:user:"), anyLong(), anyLong())).thenReturn(1L);
        when(redis.exIncrBy(startsWith("aw:email:rate:ip:"), anyLong(), anyLong())).thenReturn(31L);
        assertEquals("51004", assertThrows(BizException.class, () -> service.send(
                EmailVerificationPurpose.PROFILE_EMAIL, "user@example.com", 5L, "1.1.1.1")).getCode());

        when(redis.exIncrBy(startsWith("aw:email:rate:ip:"), anyLong(), anyLong())).thenReturn(1L);
        when(redis.exIncrBy(eq("aw:email:rate:platform"), anyLong(), anyLong())).thenReturn(1001L);
        assertEquals("51004", assertThrows(BizException.class, () -> service.send(
                EmailVerificationPurpose.PROFILE_EMAIL, "user@example.com", 5L, "1.1.1.1")).getCode());
    }

    @Test
    void sendFailureRemovesChallengeButKeepsResendCooldown() {
        when(redis.exists(anyString())).thenReturn(false);
        doThrow(new BizException(com.aliyun.autowonder.common.error.ErrorCode.EMAIL_SEND_FAILED))
                .when(mailSettingsService).sendActiveMail(anyString(), anyString(), anyString());

        assertEquals("51005", assertThrows(BizException.class, () -> service.send(
                EmailVerificationPurpose.REGISTER, "user@example.com", null, "1.1.1.1")).getCode());
        verify(redis).del(anyString());
        // 发送失败不产生可用验证码，但仍保留 60 秒重发冷却。
        verify(redis).setString(anyString(), eq("1"));
    }

    @Test
    void verifyAcceptsSuccessfulScriptOutcome() {
        stubLatest(EmailVerificationPurpose.REGISTER, "anonymous", "user@example.com", "challenge");
        when(redis.eval(anyString(), anyList(), anyList())).thenReturn("OK");
        service.verify(EmailVerificationPurpose.REGISTER, "user@example.com", null, "challenge", "123456");
        verify(redis).eval(anyString(), anyList(), anyList());
    }

    @Test
    void verifyRejectsStaleChallengeAfterResend() {
        stubLatest(EmailVerificationPurpose.REGISTER, "anonymous", "user@example.com", "newest");
        assertEquals("51003", assertThrows(BizException.class, () -> service.verify(
                EmailVerificationPurpose.REGISTER, "user@example.com", null, "old", "123456")).getCode());
        verify(redis, never()).eval(anyString(), anyList(), anyList());

        stubLatest(EmailVerificationPurpose.REGISTER, "anonymous", "user@example.com", null);
        assertEquals("51003", assertThrows(BizException.class, () -> service.verify(
                EmailVerificationPurpose.REGISTER, "user@example.com", null, "newest", "123456")).getCode());
    }

    @Test
    void verifyRejectsInvalidOrMismatchedOutcomes() {
        stubLatest(EmailVerificationPurpose.REGISTER, "anonymous", "user@example.com", "c");
        when(redis.eval(anyString(), anyList(), anyList())).thenReturn("INVALID");
        assertEquals("51003", assertThrows(BizException.class, () -> service.verify(
                EmailVerificationPurpose.REGISTER, "user@example.com", null, "c", "000000")).getCode());

        when(redis.eval(anyString(), anyList(), anyList())).thenReturn("EXHAUSTED");
        assertEquals("51003", assertThrows(BizException.class, () -> service.verify(
                EmailVerificationPurpose.REGISTER, "user@example.com", null, "c", "000000")).getCode());

        when(redis.eval(anyString(), anyList(), anyList())).thenReturn(null);
        assertEquals("51003", assertThrows(BizException.class, () -> service.verify(
                EmailVerificationPurpose.REGISTER, "user@example.com", null, "c", "000000")).getCode());
    }

    @Test
    void verifyRejectsMissingInputsAndRedisErrors() {
        assertEquals("51003", assertThrows(BizException.class, () -> service.verify(
                EmailVerificationPurpose.REGISTER, null, null, "c", "000000")).getCode());
        assertEquals("51003", assertThrows(BizException.class, () -> service.verify(
                EmailVerificationPurpose.REGISTER, "a@b.com", null, " ", "000000")).getCode());
        assertEquals("51003", assertThrows(BizException.class, () -> service.verify(
                EmailVerificationPurpose.REGISTER, "a@b.com", null, "c", " ")).getCode());

        stubLatest(EmailVerificationPurpose.REGISTER, "anonymous", "a@b.com", "c");
        when(redis.eval(anyString(), anyList(), anyList())).thenThrow(new IllegalStateException("down"));
        assertEquals("51003", assertThrows(BizException.class, () -> service.verify(
                EmailVerificationPurpose.REGISTER, "a@b.com", null, "c", "000000")).getCode());
    }

    @Test
    void revokeIgnoresBlankChallenge() {
        service.revoke(null);
        service.revoke("  ");
        verify(redis, never()).del(any());
        service.revoke("challenge");
        verify(redis).del("aw:email:code:challenge");
    }

    @Test
    void sendRequiresEmail() {
        assertEquals("51006", assertThrows(BizException.class, () -> service.send(
                EmailVerificationPurpose.REGISTER, "   ", null, "1.1.1.1")).getCode());
    }
}
