package com.aliyun.autowonder.email;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.email.dto.MailSettingsVO;
import com.aliyun.autowonder.email.dto.MailTestResultVO;
import com.aliyun.autowonder.email.dto.TestMailRequest;
import com.aliyun.autowonder.email.dto.UpdateMailSettingsRequest;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.security.crypto.SecretCrypto;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Date;
import java.util.HexFormat;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 邮件发送配置的草稿/生效生命周期：测试结果绑定完整配置版本与密钥版本，
 * 未经同版本测试不能替换生效配置；失败保留此前生效配置。
 */
@Service
public class MailSettingsService {

    private static final Logger LOGGER = LoggerFactory.getLogger(MailSettingsService.class);
    private static final Pattern EMAIL_PATTERN =
            Pattern.compile("^[A-Za-z0-9+_.-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)+$");

    private final MailSettingsDao mailSettingsDao;
    private final SmtpMailSender smtpMailSender;
    private final SecretCrypto secretCrypto;
    private final ObjectProvider<EmailVerificationPolicyService> policyProvider;

    public MailSettingsService(MailSettingsDao mailSettingsDao, SmtpMailSender smtpMailSender,
                               SecretCrypto secretCrypto,
                               ObjectProvider<EmailVerificationPolicyService> policyProvider) {
        this.mailSettingsDao = mailSettingsDao;
        this.smtpMailSender = smtpMailSender;
        this.secretCrypto = secretCrypto;
        this.policyProvider = policyProvider;
    }

    public MailSettingsVO get() {
        MailSettingsDO row = mailSettingsDao.find();
        MailSettingsVO vo = new MailSettingsVO();
        if (row == null) {
            vo.setDraftVersion(0);
            vo.setActiveVersion(0);
            return vo;
        }
        MailConfig draft = parseConfig(row.getDraftConfig());
        if (draft != null) {
            vo.setHost(draft.getHost());
            vo.setPort(draft.getPort());
            vo.setSecurity(draft.getSecurity());
            vo.setFromAddress(draft.getFromAddress());
            vo.setFromName(draft.getFromName());
            vo.setAuthMode(draft.getAuthMode());
            vo.setUsername(draft.getUsername());
        }
        vo.setSecretConfigured(row.getDraftSecretRef() != null);
        vo.setActiveConfigured(row.getActiveConfig() != null);
        vo.setDraftVersion(nullSafe(row.getDraftVersion()));
        vo.setActiveVersion(nullSafe(row.getActiveVersion()));
        vo.setTested(row.getTestedFingerprint() != null);
        vo.setTestSuccess(Integer.valueOf(1).equals(row.getTestSuccess()));
        vo.setTestedAt(row.getTestedAt());
        vo.setTestResult(row.getTestResult());
        vo.setActiveTested(isActiveConfigTested());
        return vo;
    }

    @Transactional
    public MailSettingsVO saveDraft(long userId, UpdateMailSettingsRequest request) {
        MailConfig config = toConfig(request);
        MailSettingsDO row = mailSettingsDao.find();
        long draftVersion = row == null ? 0 : nullSafe(row.getDraftVersion());
        if (request.getExpectedVersion() != null && request.getExpectedVersion() != draftVersion) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_VERSION_CONFLICT);
        }

        long secretVersion = row == null ? 0 : nullSafe(row.getDraftSecretVersion());
        String secretRef = row == null ? null : row.getDraftSecretRef();
        if (hasText(request.getPassword())) {
            secretRef = secretCrypto.encrypt(request.getPassword().trim());
            secretVersion = secretVersion + 1;
        }
        if (MailConfig.AUTH_PASSWORD.equals(config.getAuthMode()) && !hasText(secretRef)) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_INVALID);
        }
        // 免认证模式不得残留凭据。
        if (MailConfig.AUTH_NONE.equals(config.getAuthMode())) {
            secretRef = null;
        }

        String fingerprint = fingerprint(config, secretVersion);
        boolean tested = Integer.valueOf(1).equals(row == null ? null : row.getTestSuccess())
                && fingerprint.equals(row == null ? null : row.getTestedFingerprint());
        EmailVerificationPolicyService policy = policyProvider.getIfAvailable();
        if (policy != null && policy.verificationEnabled() && !tested) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_TEST_REQUIRED);
        }

        MailSettingsDO update = new MailSettingsDO();
        update.setDraftConfig(JSON.toJSONString(config));
        update.setDraftSecretRef(secretRef);
        update.setDraftSecretVersion(secretVersion);
        update.setDraftVersion(draftVersion + 1);
        update.setUpdatedBy(userId);
        if (tested) {
            update.setActiveConfig(update.getDraftConfig());
            update.setActiveSecretRef(secretRef);
            update.setActiveSecretVersion(secretVersion);
            update.setActiveVersion((row == null ? 0 : nullSafe(row.getActiveVersion())) + 1);
            update.setTestedFingerprint(row.getTestedFingerprint());
            update.setTestedAt(row.getTestedAt());
            update.setTestSuccess(row.getTestSuccess());
            update.setTestResult(row.getTestResult());
        } else {
            update.setActiveConfig(row == null ? null : row.getActiveConfig());
            update.setActiveSecretRef(row == null ? null : row.getActiveSecretRef());
            update.setActiveSecretVersion(row == null ? 0 : nullSafe(row.getActiveSecretVersion()));
            update.setActiveVersion(row == null ? 0 : nullSafe(row.getActiveVersion()));
            update.setTestedFingerprint(null);
            update.setTestedAt(null);
            update.setTestSuccess(0);
            update.setTestResult(null);
        }

        if (row == null) {
            try {
                mailSettingsDao.insert(update);
            } catch (org.springframework.dao.DuplicateKeyException concurrentInsert) {
                throw new BizException(ErrorCode.MAIL_SETTINGS_VERSION_CONFLICT);
            }
        } else if (mailSettingsDao.updateDraft(update, draftVersion) == 0) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_VERSION_CONFLICT);
        }
        return get();
    }

    /** 测试当前表单：使用保留的有效密钥或本次新填密钥；测试成功不自动保存配置字段。 */
    @Transactional
    public MailTestResultVO test(long userId, TestMailRequest request) {
        MailConfig config = toConfig(request);
        String recipient = request == null ? null : trimToNull(request.getRecipient());
        if (recipient == null || !EMAIL_PATTERN.matcher(recipient).matches()) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_INVALID);
        }

        MailSettingsDO row = ensureRow();
        long secretVersion = nullSafe(row.getDraftSecretVersion());
        String secretRef = row.getDraftSecretRef();
        if (hasText(request.getPassword())) {
            secretRef = secretCrypto.encrypt(request.getPassword().trim());
            secretVersion = secretVersion + 1;
            if (mailSettingsDao.updateDraftSecret(secretRef, secretVersion, userId,
                    nullSafe(row.getDraftVersion())) != 1) {
                throw new BizException(ErrorCode.MAIL_SETTINGS_VERSION_CONFLICT);
            }
            row.setDraftSecretRef(secretRef);
            row.setDraftSecretVersion(secretVersion);
        }
        if (MailConfig.AUTH_PASSWORD.equals(config.getAuthMode()) && !hasText(secretRef)) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_INVALID);
        }
        String fingerprint = fingerprint(config, secretVersion);

        boolean success;
        String failureCode = null;
        try {
            smtpMailSender.send(config, decrypt(secretRef), recipient,
                    "AutoWonder 邮件配置测试 / Mail settings test",
                    "This is a test message from AutoWonder platform mail settings. "
                            + "SMTP acceptance does not guarantee final delivery.");
            success = true;
        } catch (SmtpMailSender.MailDeliveryException e) {
            success = false;
            failureCode = describeFailure(e);
            LOGGER.warn("mail settings test failed userId={} failureCode={}", userId, failureCode);
        }

        MailSettingsDO update = new MailSettingsDO();
        update.setTestedFingerprint(success ? fingerprint : null);
        update.setTestedAt(new Date());
        update.setTestSuccess(success ? 1 : 0);
        update.setTestResult(failureCode);
        update.setUpdatedBy(userId);
        if (mailSettingsDao.recordTest(update, nullSafe(row.getDraftVersion())) == 0) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_VERSION_CONFLICT);
        }

        MailTestResultVO vo = new MailTestResultVO();
        vo.setSuccess(success);
        vo.setFailureCode(failureCode);
        vo.setFingerprint(fingerprint);
        vo.setTestedAt(update.getTestedAt());
        vo.setSettings(get());
        return vo;
    }

    public boolean isActiveConfigTested() {
        MailSettingsDO row = mailSettingsDao.find();
        if (row == null || row.getActiveConfig() == null || row.getTestedFingerprint() == null) {
            return false;
        }
        MailConfig active = parseConfig(row.getActiveConfig());
        if (active == null) {
            return false;
        }
        return fingerprint(active, nullSafe(row.getActiveSecretVersion())).equals(row.getTestedFingerprint());
    }

    /** 真实发信统一使用生效配置；未配置或解密失败一律按发送失败处理，绝不放行验证。 */
    public void sendActiveMail(String recipient, String subject, String body) {
        MailSettingsDO row = mailSettingsDao.find();
        MailConfig config = row == null ? null : parseConfig(row.getActiveConfig());
        if (config == null) {
            throw new BizException(ErrorCode.EMAIL_SEND_FAILED);
        }
        try {
            smtpMailSender.send(config, decrypt(row.getActiveSecretRef()), recipient, subject, body);
        } catch (RuntimeException e) {
            LOGGER.warn("email delivery failed via active mail settings", e);
            throw new BizException(ErrorCode.EMAIL_SEND_FAILED);
        }
    }

    private MailSettingsDO ensureRow() {
        MailSettingsDO row = mailSettingsDao.find();
        if (row != null) {
            return row;
        }
        MailSettingsDO created = new MailSettingsDO();
        created.setDraftSecretVersion(0L);
        created.setActiveSecretVersion(0L);
        created.setDraftVersion(0L);
        created.setActiveVersion(0L);
        created.setTestSuccess(0);
        try {
            mailSettingsDao.insert(created);
        } catch (org.springframework.dao.DuplicateKeyException concurrentInsert) {
            // 并发创建：以已存在的行为准。
        }
        MailSettingsDO reloaded = mailSettingsDao.find();
        if (reloaded == null) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_VERSION_CONFLICT);
        }
        return reloaded;
    }

    private MailConfig toConfig(UpdateMailSettingsRequest request) {
        if (request == null) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_INVALID);
        }
        MailConfig config = new MailConfig();
        config.setHost(requireSingleLine(request.getHost()));
        Integer port = request.getPort();
        if (port == null || port < 1 || port > 65535) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_INVALID);
        }
        config.setPort(port);
        String security = normalizeToken(request.getSecurity());
        if (!MailConfig.SECURITY_STARTTLS.equals(security) && !MailConfig.SECURITY_SSL.equals(security)
                && !MailConfig.SECURITY_NONE.equals(security)) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_INVALID);
        }
        config.setSecurity(security);
        String fromAddress = requireSingleLine(request.getFromAddress());
        if (!EMAIL_PATTERN.matcher(fromAddress).matches()) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_INVALID);
        }
        config.setFromAddress(fromAddress);
        if (request.getFromName() != null && containsLineBreak(request.getFromName())) {
            // 拒绝换行注入发件字段。
            throw new BizException(ErrorCode.MAIL_SETTINGS_INVALID);
        }
        config.setFromName(trimToNull(request.getFromName()));
        String authMode = normalizeToken(request.getAuthMode());
        if (!MailConfig.AUTH_PASSWORD.equals(authMode) && !MailConfig.AUTH_NONE.equals(authMode)) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_INVALID);
        }
        if (MailConfig.AUTH_PASSWORD.equals(authMode) && MailConfig.SECURITY_NONE.equals(security)) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_INVALID);
        }
        config.setAuthMode(authMode);
        if (MailConfig.AUTH_PASSWORD.equals(authMode)) {
            config.setUsername(requireSingleLine(request.getUsername()));
        }
        return config;
    }

    private String requireSingleLine(String value) {
        String trimmed = trimToNull(value);
        if (trimmed == null || containsLineBreak(trimmed)) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_INVALID);
        }
        return trimmed;
    }

    private boolean containsLineBreak(String value) {
        return value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0;
    }

    private String normalizeToken(String value) {
        String trimmed = trimToNull(value);
        return trimmed == null ? null : trimmed.toUpperCase(Locale.ROOT);
    }

    private String decrypt(String secretRef) {
        if (secretRef == null) {
            return null;
        }
        try {
            return secretCrypto.decrypt(secretRef);
        } catch (RuntimeException e) {
            throw new BizException(ErrorCode.EMAIL_SEND_FAILED);
        }
    }

    private MailConfig parseConfig(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return JSON.parseObject(json, MailConfig.class);
        } catch (RuntimeException e) {
            return null;
        }
    }

    String fingerprint(MailConfig config, long secretVersion) {
        String canonical = String.join("\n",
                nullToEmpty(config.getHost()),
                config.getPort() == null ? "" : String.valueOf(config.getPort()),
                nullToEmpty(config.getSecurity()),
                nullToEmpty(config.getFromAddress()),
                nullToEmpty(config.getFromName()),
                nullToEmpty(config.getAuthMode()),
                nullToEmpty(config.getUsername()),
                String.valueOf(secretVersion));
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private String describeFailure(Throwable error) {
        Throwable cause = error.getCause() == null ? error : error.getCause();
        String name = cause.getClass().getSimpleName();
        if (cause instanceof javax.mail.AuthenticationFailedException) {
            return "AUTH_FAILED";
        }
        if (cause instanceof javax.mail.MessagingException) {
            return "SMTP_FAILED:" + name;
        }
        return "SEND_FAILED:" + name;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static long nullSafe(Long value) {
        return value == null ? 0L : value;
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }
}
