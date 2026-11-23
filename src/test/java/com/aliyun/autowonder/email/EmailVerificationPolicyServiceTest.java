package com.aliyun.autowonder.email;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.email.dto.EmailVerificationPolicyVO;
import com.aliyun.autowonder.email.dto.UpdateEmailVerificationPolicyRequest;
import com.aliyun.autowonder.email.event.EmailVerificationBroadcastRequestedEvent;
import com.aliyun.autowonder.user.UserDO;
import com.aliyun.autowonder.user.UserDao;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;

import java.util.Arrays;
import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EmailVerificationPolicyServiceTest {

    private static final long OPERATOR = 7L;

    private PlatformEmailPolicyDao policyDao;
    private UserDao userDao;
    private MailSettingsService mailSettingsService;
    private ApplicationEventPublisher eventPublisher;
    private EmailVerificationPolicyService service;

    @BeforeEach
    void setUp() {
        policyDao = mock(PlatformEmailPolicyDao.class);
        userDao = mock(UserDao.class);
        mailSettingsService = mock(MailSettingsService.class);
        eventPublisher = mock(ApplicationEventPublisher.class);
        service = new EmailVerificationPolicyService(policyDao, userDao, mailSettingsService, eventPublisher);
    }

    private PlatformEmailPolicyDO policy(boolean verification, boolean force, boolean suffix,
                                         String suffixes, Date periodStart, long version) {
        PlatformEmailPolicyDO row = new PlatformEmailPolicyDO();
        row.setId(1);
        row.setVerificationEnabled(verification ? 1 : 0);
        row.setForceExistingEnabled(force ? 1 : 0);
        row.setSuffixRestrictionEnabled(suffix ? 1 : 0);
        row.setAllowedSuffixes(suffixes);
        row.setPeriodStartedAt(periodStart);
        row.setPolicyVersion(version);
        return row;
    }

    private UserDO user(Date created, String email, String verifiedEmail, Date firstVerifiedAt,
                        Integer invalidated) {
        UserDO user = new UserDO();
        user.setId(11L);
        user.setGmtCreate(created);
        user.setEmail(email);
        user.setVerifiedEmail(verifiedEmail);
        user.setFirstVerifiedAt(firstVerifiedAt);
        user.setVerificationInvalidated(invalidated);
        user.setStatus(0);
        return user;
    }

    @Test
    void missingRowMeansEverythingDisabled() {
        when(policyDao.find()).thenReturn(null);

        EmailVerificationPolicyVO vo = service.getPolicy();
        assertFalse(vo.isVerificationEnabled());
        assertFalse(vo.isForceExistingEnabled());
        assertFalse(vo.isSuffixRestrictionEnabled());
        assertEquals(0L, vo.getVersion());
        assertTrue(vo.getAllowedSuffixes().isEmpty());
        assertFalse(service.requiresVerification(user(new Date(), "a@b.com", null, null, 0)));
        assertTrue(service.isEmailCompliant("anything@not-checked.example"));
        assertFalse(service.publicPolicy().isVerificationEnabled());
    }

    @Test
    void newAccountInCurrentPeriodMustVerifyBeforeFirstVerification() {
        Date periodStart = new Date(1_000_000L);
        when(policyDao.find()).thenReturn(policy(true, false, false, null, periodStart, 3L));

        assertTrue(service.requiresVerification(
                user(new Date(2_000_000L), "new@example.com", null, null, 0)));
        // 首次验证成功后按存量强制开关处理，未开启则不限制。
        assertFalse(service.requiresVerification(
                user(new Date(2_000_000L), "new@example.com", "new@example.com", new Date(), 0)));
    }

    @Test
    void existingAccountIsRestrictedOnlyWhenForceEnabled() {
        Date periodStart = new Date(1_000_000L);
        UserDO existing = user(new Date(500_000L), "old@example.com", null, null, 0);

        when(policyDao.find()).thenReturn(policy(true, false, false, null, periodStart, 1L));
        assertFalse(service.requiresVerification(existing));

        when(policyDao.find()).thenReturn(policy(true, true, false, null, periodStart, 2L));
        assertTrue(service.requiresVerification(existing));
        assertThrows(BizException.class, () -> service.requireUsable(existing));
    }

    @Test
    void verifiedAndCompliantEmailNeedsNoVerification() {
        when(policyDao.find()).thenReturn(policy(true, true, true, "example.com", new Date(1L), 1L));

        UserDO verified = user(new Date(2L), "user@example.com", "user@example.com", new Date(3L), 0);
        assertTrue(service.isEmailVerified(verified));
        assertFalse(service.requiresVerification(verified));

        // 大小写不同仍视为同一邮箱（沿用工程现有邮箱比较规则）。
        UserDO caseDiff = user(new Date(2L), "User@Example.COM", "user@example.com", new Date(3L), 0);
        assertTrue(service.isEmailVerified(caseDiff));
    }

    @Test
    void changedEmailOrInvalidationMakesUserUnverified() {
        when(policyDao.find()).thenReturn(policy(true, true, false, null, new Date(1L), 1L));

        UserDO changed = user(new Date(2L), "new@example.com", "old@example.com", new Date(3L), 0);
        assertFalse(service.isEmailVerified(changed));
        assertTrue(service.requiresVerification(changed));

        UserDO invalidated = user(new Date(2L), "same@example.com", "same@example.com", new Date(3L), 1);
        assertFalse(service.isEmailVerified(invalidated));
    }

    @Test
    void suffixMatchIsExactDomainNotStringSuffix() {
        when(policyDao.find()).thenReturn(policy(false, false, true, "example.com", null, 1L));

        assertTrue(service.isEmailCompliant("person@example.com"));
        assertFalse(service.isEmailCompliant("person@notexample.com"));
        assertFalse(service.isEmailCompliant("person@sub.example.com"));
        assertFalse(service.isEmailCompliant("no-domain"));
        assertFalse(service.isEmailCompliant(""));
    }

    @Test
    void suffixNormalizationDedupesCaseAndOptionalAt() {
        assertEquals(List.of("example.com", "gmail.com"),
                service.normalizeSuffixes(Arrays.asList(" @Example.COM ", "example.com", "gmail.com", " ")));
        BizException wildcard = assertThrows(BizException.class,
                () -> service.normalizeSuffixes(List.of("*.example.com")));
        assertEquals("51007", wildcard.getCode());
        BizException fullEmail = assertThrows(BizException.class,
                () -> service.normalizeSuffixes(List.of("user@example.com")));
        assertEquals("51007", fullEmail.getCode());
        assertTrue(service.normalizeSuffixes(List.of()).isEmpty());
    }

    @Test
    void enablingVerificationRequiresTestedMailSettings() {
        when(policyDao.find()).thenReturn(policy(false, false, false, null, null, 0L));
        when(mailSettingsService.isActiveConfigTested()).thenReturn(false);

        UpdateEmailVerificationPolicyRequest request = new UpdateEmailVerificationPolicyRequest();
        request.setVerificationEnabled(true);

        BizException ex = assertThrows(BizException.class, () -> service.update(OPERATOR, request));
        assertEquals("51010", ex.getCode());
        verify(policyDao, never()).update(any(), anyLong());
    }

    @Test
    void enablingVerificationStartsNewPeriodAndPersists() {
        when(policyDao.find()).thenReturn(policy(false, false, false, null, null, 4L));
        when(mailSettingsService.isActiveConfigTested()).thenReturn(true);
        when(policyDao.update(any(), anyLong())).thenReturn(1);

        UpdateEmailVerificationPolicyRequest request = new UpdateEmailVerificationPolicyRequest();
        request.setVerificationEnabled(true);
        request.setExpectedVersion(4);

        service.update(OPERATOR, request);

        verify(policyDao).update(org.mockito.ArgumentMatchers.argThat(row ->
                row.getVerificationEnabled() == 1
                        && row.getPolicyVersion() == 5L
                        && row.getPeriodStartedAt() != null
                        && row.getForceExistingEnabled() == 0), anyLong());
    }

    @Test
    void disablingVerificationRequiresConfirmationAndTurnsOffForce() {
        when(policyDao.find()).thenReturn(policy(true, true, false, null, new Date(), 2L));

        UpdateEmailVerificationPolicyRequest request = new UpdateEmailVerificationPolicyRequest();
        request.setVerificationEnabled(false);
        BizException confirm = assertThrows(BizException.class, () -> service.update(OPERATOR, request));
        assertEquals("51013", confirm.getCode());

        request.setConfirmDisableVerification(true);
        when(policyDao.update(any(), anyLong())).thenReturn(1);
        service.update(OPERATOR, request);
        verify(policyDao).update(org.mockito.ArgumentMatchers.argThat(row ->
                row.getVerificationEnabled() == 0 && row.getForceExistingEnabled() == 0), anyLong());
    }

    @Test
    void forceRequiresVerificationAndPublishesBroadcast() {
        when(policyDao.find()).thenReturn(policy(false, false, false, null, null, 0L));
        UpdateEmailVerificationPolicyRequest inconsistent = new UpdateEmailVerificationPolicyRequest();
        inconsistent.setForceExistingEnabled(true);
        assertEquals("51014", assertThrows(BizException.class,
                () -> service.update(OPERATOR, inconsistent)).getCode());

        when(policyDao.find()).thenReturn(policy(true, false, false, null, new Date(), 6L));
        when(policyDao.update(any(), anyLong())).thenReturn(1);
        UpdateEmailVerificationPolicyRequest enable = new UpdateEmailVerificationPolicyRequest();
        enable.setForceExistingEnabled(true);

        service.update(OPERATOR, enable);

        verify(eventPublisher).publishEvent(new EmailVerificationBroadcastRequestedEvent(7L));
    }

    @Test
    void suffixChangeInvalidatesPreviouslyVerifiedNonCompliantEmails() {
        when(policyDao.find()).thenReturn(policy(true, false, true, "example.org", new Date(1L), 1L));
        when(policyDao.update(any(), anyLong())).thenReturn(1);

        UserDO compliant = user(new Date(2L), "a@example.com", "a@example.com", new Date(3L), 0);
        compliant.setId(1L);
        UserDO nonCompliant = user(new Date(2L), "b@gmail.com", "b@gmail.com", new Date(3L), 0);
        nonCompliant.setId(2L);
        UserDO alreadyInvalid = user(new Date(2L), "c@gmail.com", "c@gmail.com", new Date(3L), 1);
        alreadyInvalid.setId(3L);
        when(userDao.listUsersForVerificationPolicy())
                .thenReturn(List.of(compliant, nonCompliant, alreadyInvalid));

        UpdateEmailVerificationPolicyRequest request = new UpdateEmailVerificationPolicyRequest();
        // 允许列表从 example.org 改为 example.com：b/c 不再合规，a 仍合规。
        request.setAllowedSuffixes(List.of("example.com"));

        service.update(OPERATOR, request);

        verify(userDao).invalidateEmailVerification(2L);
        verify(userDao, never()).invalidateEmailVerification(1L);
        verify(userDao, never()).invalidateEmailVerification(3L);
    }

    @Test
    void enablingSuffixRestrictionWithoutDomainsIsRejected() {
        when(policyDao.find()).thenReturn(policy(false, false, false, null, null, 0L));
        UpdateEmailVerificationPolicyRequest request = new UpdateEmailVerificationPolicyRequest();
        request.setSuffixRestrictionEnabled(true);
        request.setAllowedSuffixes(List.of());

        assertEquals("51007", assertThrows(BizException.class,
                () -> service.update(OPERATOR, request)).getCode());
        verify(policyDao, never()).update(any(), anyLong());
    }

    @Test
    void versionConflictIsReported() {
        when(policyDao.find()).thenReturn(policy(false, false, false, null, null, 3L));

        UpdateEmailVerificationPolicyRequest request = new UpdateEmailVerificationPolicyRequest();
        request.setExpectedVersion(2);

        assertEquals("51012", assertThrows(BizException.class,
                () -> service.update(OPERATOR, request)).getCode());
    }

    @Test
    void updateInsertsRowWhenMissingAndReportsConcurrentInsert() {
        when(policyDao.find()).thenReturn(null);
        UpdateEmailVerificationPolicyRequest request = new UpdateEmailVerificationPolicyRequest();
        request.setVerificationEnabled(true);
        when(mailSettingsService.isActiveConfigTested()).thenReturn(true);

        service.update(OPERATOR, request);
        verify(policyDao).insert(any());

        org.mockito.Mockito.doThrow(new org.springframework.dao.DuplicateKeyException("dup"))
                .when(policyDao).insert(any());
        assertEquals("51012", assertThrows(BizException.class,
                () -> service.update(OPERATOR, request)).getCode());
    }

    @Test
    void updateRejectsNullRequestAndStaleUpdate() {
        assertEquals("10001", assertThrows(BizException.class,
                () -> service.update(OPERATOR, null)).getCode());

        when(policyDao.find()).thenReturn(policy(false, false, false, null, null, 5L));
        when(policyDao.update(any(), anyLong())).thenReturn(0);
        UpdateEmailVerificationPolicyRequest request = new UpdateEmailVerificationPolicyRequest();
        request.setSuffixRestrictionEnabled(false);
        assertEquals("51012", assertThrows(BizException.class,
                () -> service.update(OPERATOR, request)).getCode());
    }

    @Test
    void convenienceAccessorsDefaultAndReadStoredPolicy() {
        when(policyDao.find()).thenReturn(null);
        assertFalse(service.verificationEnabled());
        assertFalse(service.forceExistingEnabled());
        assertFalse(service.suffixRestrictionEnabled());
        assertTrue(service.allowedSuffixes().isEmpty());

        when(policyDao.find()).thenReturn(policy(true, true, true, "example.com,gmail.com", new Date(), 2L));
        assertTrue(service.verificationEnabled());
        assertTrue(service.forceExistingEnabled());
        assertTrue(service.suffixRestrictionEnabled());
        assertEquals(List.of("example.com", "gmail.com"), service.allowedSuffixes());
        assertEquals(List.of("example.com", "gmail.com"), service.publicPolicy().getAllowedSuffixes());
        assertEquals(2L, service.getPolicy().getVersion());
    }

    @Test
    void nullUsersNeverRequireVerification() {
        when(policyDao.find()).thenReturn(policy(true, true, false, null, new Date(), 1L));
        assertFalse(service.isEmailVerified(null));
        assertFalse(service.requiresVerification(null));
        service.requireUsable(null);
    }

    @Test
    void missingVerificationFieldsAreUnverified() {
        when(policyDao.find()).thenReturn(policy(true, true, false, null, new Date(1L), 1L));
        assertFalse(service.isEmailVerified(user(new Date(2L), null, null, null, 0)));
        assertFalse(service.isEmailVerified(user(new Date(2L), "a@b.com", null, null, 0)));
    }

    @Test
    void suffixNormalizationSkipsNullAndBlankEntries() {
        assertEquals(List.of("example.com"),
                service.normalizeSuffixes(Arrays.asList(null, " ", "@EXAMPLE.COM")));
    }
}
