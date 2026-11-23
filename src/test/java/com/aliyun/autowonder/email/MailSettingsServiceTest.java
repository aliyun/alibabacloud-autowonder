package com.aliyun.autowonder.email;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.email.dto.MailTestResultVO;
import com.aliyun.autowonder.email.dto.TestMailRequest;
import com.aliyun.autowonder.email.dto.UpdateMailSettingsRequest;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.security.crypto.SecretCrypto;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;

import javax.mail.AuthenticationFailedException;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MailSettingsServiceTest {

    private static final long OPERATOR = 9L;

    private MailSettingsDao dao;
    private SmtpMailSender sender;
    private SecretCrypto secretCrypto;
    @SuppressWarnings("unchecked")
    private ObjectProvider<EmailVerificationPolicyService> policyProvider;
    private EmailVerificationPolicyService policy;
    private MailSettingsService service;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        dao = mock(MailSettingsDao.class);
        sender = mock(SmtpMailSender.class);
        secretCrypto = mock(SecretCrypto.class);
        policyProvider = mock(ObjectProvider.class);
        policy = mock(EmailVerificationPolicyService.class);
        service = new MailSettingsService(dao, sender, secretCrypto, policyProvider);
    }

    private UpdateMailSettingsRequest request(String security, String authMode, String password) {
        UpdateMailSettingsRequest request = new UpdateMailSettingsRequest();
        request.setHost("smtp.example.com");
        request.setPort(587);
        request.setSecurity(security);
        request.setFromAddress("noreply@example.com");
        request.setFromName("AutoWonder");
        request.setAuthMode(authMode);
        request.setUsername(authMode.equals(MailConfig.AUTH_PASSWORD) ? "noreply@example.com" : null);
        request.setPassword(password);
        return request;
    }

    private MailConfig configOf(UpdateMailSettingsRequest request) {
        MailConfig config = new MailConfig();
        config.setHost(request.getHost());
        config.setPort(request.getPort());
        config.setSecurity(request.getSecurity());
        config.setFromAddress(request.getFromAddress());
        config.setFromName(request.getFromName());
        config.setAuthMode(request.getAuthMode());
        config.setUsername(request.getUsername());
        return config;
    }

    @Test
    void getWithoutRowReturnsEmptyDraft() {
        when(dao.find()).thenReturn(null);
        assertEquals(0L, service.get().getDraftVersion());
        assertFalse(service.get().isSecretConfigured());
        assertFalse(service.isActiveConfigTested());
    }

    @Test
    void getReturnsDraftAndTestMetadataWithoutSecret() {
        MailConfig config = configOf(request(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD, null));
        MailSettingsDO row = new MailSettingsDO();
        row.setDraftConfig(JSON.toJSONString(config));
        row.setDraftSecretRef("enc:secret");
        row.setDraftSecretVersion(2L);
        row.setActiveConfig(JSON.toJSONString(config));
        row.setActiveSecretVersion(2L);
        row.setDraftVersion(4L);
        row.setActiveVersion(3L);
        row.setTestSuccess(1);
        row.setTestedFingerprint(service.fingerprint(config, 2));
        row.setTestedAt(new Date());
        when(dao.find()).thenReturn(row);

        assertEquals("smtp.example.com", service.get().getHost());
        assertTrue(service.get().isSecretConfigured());
        assertTrue(service.isActiveConfigTested());
    }

    @Test
    void invalidConfigurationsAreRejected() {
        UpdateMailSettingsRequest badPort = request(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD, "pw");
        badPort.setPort(70000);
        assertEquals("51009", assertThrows(BizException.class,
                () -> service.saveDraft(OPERATOR, badPort)).getCode());

        UpdateMailSettingsRequest badSecurity = request("OBSCURE", MailConfig.AUTH_PASSWORD, "pw");
        assertEquals("51009", assertThrows(BizException.class,
                () -> service.saveDraft(OPERATOR, badSecurity)).getCode());

        UpdateMailSettingsRequest plainPassword =
                request(MailConfig.SECURITY_NONE, MailConfig.AUTH_PASSWORD, "pw");
        assertEquals("51009", assertThrows(BizException.class,
                () -> service.saveDraft(OPERATOR, plainPassword)).getCode());

        UpdateMailSettingsRequest injected = request(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD, "pw");
        injected.setFromName("Name\nBcc: evil@example.com");
        assertEquals("51009", assertThrows(BizException.class,
                () -> service.saveDraft(OPERATOR, injected)).getCode());

        UpdateMailSettingsRequest noUser = request(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD, "pw");
        noUser.setUsername("  ");
        assertEquals("51009", assertThrows(BizException.class,
                () -> service.saveDraft(OPERATOR, noUser)).getCode());
    }

    @Test
    void passwordModeWithoutSavedSecretIsRejected() {
        when(dao.find()).thenReturn(null);
        UpdateMailSettingsRequest request = request(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD, null);
        assertEquals("51009", assertThrows(BizException.class,
                () -> service.saveDraft(OPERATOR, request)).getCode());
    }

    @Test
    void untestedDraftIsSavedWithoutReplacingActiveConfig() {
        MailSettingsDO row = new MailSettingsDO();
        row.setDraftVersion(2L);
        row.setDraftSecretVersion(1L);
        row.setDraftSecretRef("enc:old");
        row.setActiveConfig("{\"host\":\"old\"}");
        row.setActiveSecretRef("enc:old");
        row.setActiveSecretVersion(1L);
        row.setActiveVersion(5L);
        when(dao.find()).thenReturn(row);
        when(dao.updateDraft(any(), anyLong())).thenReturn(1);

        UpdateMailSettingsRequest request = request(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD, null);
        // 配置字段变化但未测试：只保存草稿，生效配置保持原样。
        request.setHost("smtp2.example.com");
        service.saveDraft(OPERATOR, request);

        ArgumentCaptor<MailSettingsDO> captor = ArgumentCaptor.forClass(MailSettingsDO.class);
        verify(dao).updateDraft(captor.capture(), eq(2L));
        MailSettingsDO saved = captor.getValue();
        assertEquals("smtp2.example.com",
                JSON.parseObject(saved.getDraftConfig(), MailConfig.class).getHost());
        assertEquals("{\"host\":\"old\"}", saved.getActiveConfig());
        assertEquals(5L, saved.getActiveVersion());
        assertNull(saved.getTestedFingerprint());
        verify(secretCrypto, never()).encrypt(anyString());
    }

    @Test
    void verificationEnabledRejectsUntestedSave() {
        MailSettingsDO row = new MailSettingsDO();
        row.setDraftVersion(0L);
        row.setDraftSecretRef("enc:old");
        row.setDraftSecretVersion(1L);
        when(dao.find()).thenReturn(row);
        when(policyProvider.getIfAvailable()).thenReturn(policy);
        when(policy.verificationEnabled()).thenReturn(true);

        UpdateMailSettingsRequest request = request(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD, null);
        assertEquals("51010", assertThrows(BizException.class,
                () -> service.saveDraft(OPERATOR, request)).getCode());
        verify(dao, never()).updateDraft(any(), anyLong());
    }

    @Test
    void testedSameVersionActivatesConfig() {
        MailSettingsDO row = new MailSettingsDO();
        row.setDraftVersion(1L);
        row.setDraftSecretRef("enc:old");
        row.setDraftSecretVersion(2L);
        row.setActiveVersion(4L);
        row.setTestSuccess(1);
        row.setTestedFingerprint(service.fingerprint(
                configOf(request(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD, null)), 2L));
        row.setTestedAt(new Date());
        when(dao.find()).thenReturn(row);
        when(dao.updateDraft(any(), anyLong())).thenReturn(1);
        when(policyProvider.getIfAvailable()).thenReturn(policy);
        when(policy.verificationEnabled()).thenReturn(true);

        service.saveDraft(OPERATOR,
                request(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD, null));

        ArgumentCaptor<MailSettingsDO> captor = ArgumentCaptor.forClass(MailSettingsDO.class);
        verify(dao).updateDraft(captor.capture(), eq(1L));
        MailSettingsDO saved = captor.getValue();
        assertNotNull(saved.getActiveConfig());
        assertEquals(5L, saved.getActiveVersion());
        assertEquals(saved.getDraftConfig(), saved.getActiveConfig());
        assertEquals(2L, saved.getActiveSecretVersion());
    }

    @Test
    void newPasswordIsEncryptedAndClearedForAnonymousRelay() {
        MailSettingsDO row = new MailSettingsDO();
        row.setDraftVersion(0L);
        row.setDraftSecretRef("enc:old");
        row.setDraftSecretVersion(1L);
        when(dao.find()).thenReturn(row);
        when(dao.updateDraft(any(), anyLong())).thenReturn(1);
        when(secretCrypto.encrypt("new-secret")).thenReturn("enc:new");

        service.saveDraft(OPERATOR,
                request(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD, "new-secret"));
        ArgumentCaptor<MailSettingsDO> captor = ArgumentCaptor.forClass(MailSettingsDO.class);
        verify(dao).updateDraft(captor.capture(), eq(0L));
        assertEquals("enc:new", captor.getValue().getDraftSecretRef());
        assertEquals(2L, captor.getValue().getDraftSecretVersion());

        // 免认证模式不得残留凭据。
        service.saveDraft(OPERATOR, request(MailConfig.SECURITY_NONE, MailConfig.AUTH_NONE, null));
        verify(dao, org.mockito.Mockito.times(2)).updateDraft(captor.capture(), anyLong());
        assertNull(captor.getValue().getDraftSecretRef());
    }

    @Test
    void saveDraftRejectsStaleVersion() {
        MailSettingsDO row = new MailSettingsDO();
        row.setDraftVersion(3L);
        when(dao.find()).thenReturn(row);
        UpdateMailSettingsRequest request = request(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD, "pw");
        request.setExpectedVersion(2);
        assertEquals("51011", assertThrows(BizException.class,
                () -> service.saveDraft(OPERATOR, request)).getCode());
    }

    @Test
    void testSuccessRecordsFingerprint() {
        MailSettingsDO row = new MailSettingsDO();
        row.setDraftVersion(0L);
        row.setDraftSecretRef("enc:ok");
        row.setDraftSecretVersion(1L);
        when(dao.find()).thenReturn(row);
        when(dao.recordTest(any(), anyLong())).thenReturn(1);
        when(secretCrypto.decrypt("enc:ok")).thenReturn("plain-secret");

        TestMailRequest request = testRequest();
        MailTestResultVO result = service.test(OPERATOR, request);

        assertTrue(result.isSuccess());
        assertNull(result.getFailureCode());
        assertNotNull(result.getFingerprint());
        ArgumentCaptor<MailSettingsDO> captor = ArgumentCaptor.forClass(MailSettingsDO.class);
        verify(dao).recordTest(captor.capture(), eq(0L));
        assertEquals(1, captor.getValue().getTestSuccess());
        assertEquals(result.getFingerprint(), captor.getValue().getTestedFingerprint());
    }

    @Test
    void testFailureIsMaskedAndClearsProof() {
        MailSettingsDO row = new MailSettingsDO();
        row.setDraftVersion(0L);
        row.setDraftSecretRef("enc:ok");
        row.setDraftSecretVersion(1L);
        when(dao.find()).thenReturn(row);
        when(dao.recordTest(any(), anyLong())).thenReturn(1);
        when(secretCrypto.decrypt("enc:ok")).thenReturn("plain-secret");
        doThrow(new SmtpMailSender.MailDeliveryException(new AuthenticationFailedException("bad")))
                .when(sender).send(any(), any(), any(), any(), any());

        MailTestResultVO result = service.test(OPERATOR, testRequest());

        assertFalse(result.isSuccess());
        assertEquals("AUTH_FAILED", result.getFailureCode());
        ArgumentCaptor<MailSettingsDO> captor = ArgumentCaptor.forClass(MailSettingsDO.class);
        verify(dao).recordTest(captor.capture(), eq(0L));
        assertNull(captor.getValue().getTestedFingerprint());
        assertEquals(0, captor.getValue().getTestSuccess());
    }

    @Test
    void testWithNewPasswordPersistsSecretThenTests() {
        MailSettingsDO row = new MailSettingsDO();
        row.setDraftVersion(2L);
        row.setDraftSecretVersion(0L);
        when(dao.find()).thenReturn(row);
        when(secretCrypto.encrypt("fresh")).thenReturn("enc:fresh");
        when(secretCrypto.decrypt("enc:fresh")).thenReturn("fresh");
        when(dao.updateDraftSecret(eq("enc:fresh"), eq(1L), eq(OPERATOR), eq(2L))).thenReturn(1);
        when(dao.recordTest(any(), anyLong())).thenReturn(1);

        TestMailRequest request = testRequest();
        request.setPassword("fresh");
        assertTrue(service.test(OPERATOR, request).isSuccess());
        verify(dao).updateDraftSecret("enc:fresh", 1L, OPERATOR, 2L);
    }

    @Test
    void testReportsSecretVersionConflictWhenDraftMoved() {
        MailSettingsDO row = new MailSettingsDO();
        row.setDraftVersion(2L);
        row.setDraftSecretVersion(0L);
        when(dao.find()).thenReturn(row);
        when(secretCrypto.encrypt("fresh")).thenReturn("enc:fresh");
        when(dao.updateDraftSecret(any(), anyLong(), any(), anyLong())).thenReturn(0);

        TestMailRequest request = testRequest();
        request.setPassword("fresh");
        assertEquals("51011", assertThrows(BizException.class,
                () -> service.test(OPERATOR, request)).getCode());
    }

    @Test
    void testRejectsInvalidRecipient() {
        TestMailRequest request = testRequest();
        request.setRecipient("not-an-email");
        assertEquals("51009", assertThrows(BizException.class,
                () -> service.test(OPERATOR, request)).getCode());
    }

    @Test
    void recordTestConflictIsReported() {
        MailSettingsDO row = new MailSettingsDO();
        row.setDraftVersion(0L);
        row.setDraftSecretRef("enc:ok");
        row.setDraftSecretVersion(1L);
        when(dao.find()).thenReturn(row);
        when(secretCrypto.decrypt("enc:ok")).thenReturn("plain-secret");
        when(dao.recordTest(any(), anyLong())).thenReturn(0);
        assertEquals("51011", assertThrows(BizException.class,
                () -> service.test(OPERATOR, testRequest())).getCode());
    }

    @Test
    void sendActiveMailRequiresActiveConfig() {
        when(dao.find()).thenReturn(null);
        assertEquals("51005", assertThrows(BizException.class,
                () -> service.sendActiveMail("a@b.com", "s", "b")).getCode());
    }

    @Test
    void sendActiveMailUsesActiveConfigAndMasksDecryptFailure() {
        MailConfig config = configOf(request(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD, null));
        MailSettingsDO row = new MailSettingsDO();
        row.setActiveConfig(JSON.toJSONString(config));
        row.setActiveSecretRef("enc:active");
        row.setActiveSecretVersion(1L);
        when(dao.find()).thenReturn(row);
        when(secretCrypto.decrypt("enc:active")).thenReturn("plain");

        service.sendActiveMail("a@b.com", "subject", "body");
        verify(sender).send(any(), eq("plain"), eq("a@b.com"), eq("subject"), eq("body"));

        when(secretCrypto.decrypt("enc:active")).thenThrow(new IllegalStateException("cannot decrypt"));
        assertEquals("51005", assertThrows(BizException.class,
                () -> service.sendActiveMail("a@b.com", "s", "b")).getCode());
    }

    @Test
    void saveDraftCreatesRowWhenNoneExists() {
        when(dao.find()).thenReturn(null);
        when(secretCrypto.encrypt("secret")).thenReturn("enc:first");
        UpdateMailSettingsRequest request = request(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD, "secret");

        service.saveDraft(OPERATOR, request);

        ArgumentCaptor<MailSettingsDO> captor = ArgumentCaptor.forClass(MailSettingsDO.class);
        verify(dao).insert(captor.capture());
        assertEquals("enc:first", captor.getValue().getDraftSecretRef());
        assertEquals(1L, captor.getValue().getDraftVersion());
        assertEquals(0L, captor.getValue().getActiveVersion());
        assertNull(captor.getValue().getActiveConfig());
    }

    @Test
    void getToleratesMissingDraftConfig() {
        MailSettingsDO row = new MailSettingsDO();
        row.setDraftVersion(1L);
        row.setActiveVersion(0L);
        when(dao.find()).thenReturn(row);
        assertNull(service.get().getHost());
        assertEquals(1L, service.get().getDraftVersion());
    }

    @Test
    void testCreatesRowWhenNoneExists() {
        MailSettingsDO created = new MailSettingsDO();
        created.setDraftVersion(0L);
        created.setDraftSecretRef("enc:fresh");
        created.setDraftSecretVersion(1L);
        when(dao.find()).thenReturn(null, created);
        when(secretCrypto.encrypt("fresh")).thenReturn("enc:fresh");
        when(secretCrypto.decrypt("enc:fresh")).thenReturn("fresh");
        when(dao.updateDraftSecret(any(), anyLong(), any(), anyLong())).thenReturn(1);
        when(dao.recordTest(any(), anyLong())).thenReturn(1);

        TestMailRequest request = testRequest();
        request.setPassword("fresh");

        assertTrue(service.test(OPERATOR, request).isSuccess());
        verify(dao).insert(any());
    }

    @Test
    void failureCodesAreCategorisedWithoutLeakingDetails() {
        MailSettingsDO row = new MailSettingsDO();
        row.setDraftVersion(0L);
        row.setDraftSecretRef("enc:ok");
        row.setDraftSecretVersion(1L);
        when(dao.find()).thenReturn(row);
        when(dao.recordTest(any(), anyLong())).thenReturn(1);
        when(secretCrypto.decrypt("enc:ok")).thenReturn("plain");

        doThrow(new SmtpMailSender.MailDeliveryException(new javax.mail.MessagingException("smtp 550")))
                .when(sender).send(any(), any(), any(), any(), any());
        assertEquals("SMTP_FAILED:MessagingException", service.test(OPERATOR, testRequest()).getFailureCode());

        doThrow(new SmtpMailSender.MailDeliveryException(new RuntimeException("io")))
                .when(sender).send(any(), any(), any(), any(), any());
        assertEquals("SEND_FAILED:RuntimeException", service.test(OPERATOR, testRequest()).getFailureCode());
    }

    @Test
    void sendActiveMailMasksSenderFailures() {
        MailConfig config = configOf(request(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD, null));
        MailSettingsDO row = new MailSettingsDO();
        row.setActiveConfig(JSON.toJSONString(config));
        row.setActiveSecretRef("enc:active");
        row.setActiveSecretVersion(1L);
        when(dao.find()).thenReturn(row);
        when(secretCrypto.decrypt("enc:active")).thenReturn("plain");
        doThrow(new IllegalStateException("smtp down"))
                .when(sender).send(any(), any(), any(), any(), any());

        assertEquals("51005", assertThrows(BizException.class,
                () -> service.sendActiveMail("a@b.com", "s", "b")).getCode());
    }

    private TestMailRequest testRequest() {
        TestMailRequest request = new TestMailRequest();
        request.setHost("smtp.example.com");
        request.setPort(587);
        request.setSecurity(MailConfig.SECURITY_STARTTLS);
        request.setFromAddress("noreply@example.com");
        request.setFromName("AutoWonder");
        request.setAuthMode(MailConfig.AUTH_PASSWORD);
        request.setUsername("noreply@example.com");
        request.setRecipient("tester@example.com");
        return request;
    }
}
