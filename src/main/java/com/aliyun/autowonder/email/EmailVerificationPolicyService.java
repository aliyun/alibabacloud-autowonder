package com.aliyun.autowonder.email;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.email.dto.EmailVerificationPolicyPublicVO;
import com.aliyun.autowonder.email.dto.EmailVerificationPolicyVO;
import com.aliyun.autowonder.email.dto.UpdateEmailVerificationPolicyRequest;
import com.aliyun.autowonder.email.event.EmailVerificationBroadcastRequestedEvent;
import com.aliyun.autowonder.user.UserDO;
import com.aliyun.autowonder.user.UserDao;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 邮箱验证策略的唯一口径：启用周期、后缀白名单、验证状态与访问门禁都在这里计算，
 * 调用方不得各自实现不同条件。
 *
 * <p>关键语义：
 * <ul>
 *   <li>总开关开启前的账号为存量；开启后注册或 SSO 首次建号的账号须先完成首次验证。</li>
 *   <li>首次验证成功后，邮箱失效或管理员改邮箱按存量强制开关处理。</li>
 *   <li>后缀变更按最新版本即时判定，不等待批处理；失效标记持久化，重新加入后缀不自动恢复。</li>
 * </ul>
 */
@Service
public class EmailVerificationPolicyService {

    public static final int CODE_LENGTH = 6;
    public static final int CODE_TTL_SECONDS = 600;
    public static final int RESEND_INTERVAL_SECONDS = 60;
    public static final int MAX_CODE_ATTEMPTS = 5;

    private static final Pattern DOMAIN_PATTERN =
            Pattern.compile("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$");

    private final PlatformEmailPolicyDao policyDao;
    private final UserDao userDao;
    private final MailSettingsService mailSettingsService;
    private final ApplicationEventPublisher eventPublisher;

    public EmailVerificationPolicyService(PlatformEmailPolicyDao policyDao, UserDao userDao,
                                          MailSettingsService mailSettingsService,
                                          ApplicationEventPublisher eventPublisher) {
        this.policyDao = policyDao;
        this.userDao = userDao;
        this.mailSettingsService = mailSettingsService;
        this.eventPublisher = eventPublisher;
    }

    // ---- 读取 ----

    public EmailVerificationPolicyVO getPolicy() {
        PlatformEmailPolicyDO row = policyDao.find();
        EmailVerificationPolicyVO vo = new EmailVerificationPolicyVO();
        vo.setVerificationEnabled(isEnabled(row == null ? null : row.getVerificationEnabled()));
        vo.setForceExistingEnabled(isEnabled(row == null ? null : row.getForceExistingEnabled()));
        vo.setSuffixRestrictionEnabled(isEnabled(row == null ? null : row.getSuffixRestrictionEnabled()));
        vo.setAllowedSuffixes(parseSuffixes(row == null ? null : row.getAllowedSuffixes()));
        vo.setVerificationEnabledAt(row == null ? null : row.getPeriodStartedAt());
        vo.setVersion(row == null || row.getPolicyVersion() == null ? 0L : row.getPolicyVersion());
        vo.setMailSettingsTested(mailSettingsService.isActiveConfigTested());
        return vo;
    }

    public EmailVerificationPolicyPublicVO publicPolicy() {
        PlatformEmailPolicyDO row = policyDao.find();
        EmailVerificationPolicyPublicVO vo = new EmailVerificationPolicyPublicVO();
        vo.setVerificationEnabled(isEnabled(row == null ? null : row.getVerificationEnabled()));
        vo.setSuffixRestrictionEnabled(isEnabled(row == null ? null : row.getSuffixRestrictionEnabled()));
        vo.setAllowedSuffixes(parseSuffixes(row == null ? null : row.getAllowedSuffixes()));
        vo.setCodeLength(CODE_LENGTH);
        vo.setCodeTtlSeconds(CODE_TTL_SECONDS);
        vo.setResendIntervalSeconds(RESEND_INTERVAL_SECONDS);
        vo.setMaxAttempts(MAX_CODE_ATTEMPTS);
        return vo;
    }

    public boolean verificationEnabled() {
        PlatformEmailPolicyDO row = policyDao.find();
        return row != null && isEnabled(row.getVerificationEnabled());
    }

    public boolean forceExistingEnabled() {
        PlatformEmailPolicyDO row = policyDao.find();
        return row != null && isEnabled(row.getForceExistingEnabled());
    }

    public boolean suffixRestrictionEnabled() {
        PlatformEmailPolicyDO row = policyDao.find();
        return row != null && isEnabled(row.getSuffixRestrictionEnabled());
    }

    public List<String> allowedSuffixes() {
        PlatformEmailPolicyDO row = policyDao.find();
        return parseSuffixes(row == null ? null : row.getAllowedSuffixes());
    }

    // ---- 判定 ----

    /** 后缀精确匹配：规范化完整域名，不做通配或尾部字符串匹配；未开启约束时一律合规。 */
    public boolean isEmailCompliant(String email) {
        PlatformEmailPolicyDO row = policyDao.find();
        if (row == null || !isEnabled(row.getSuffixRestrictionEnabled())) {
            return true;
        }
        return isCompliantDomain(email, parseSuffixes(row.getAllowedSuffixes()));
    }

    public boolean isEmailVerified(UserDO user) {
        if (user == null || Integer.valueOf(1).equals(user.getVerificationInvalidated())) {
            return false;
        }
        String verified = user.getVerifiedEmail();
        String current = normalizeEmail(user.getEmail());
        if (verified == null || current == null) {
            return false;
        }
        return verified.trim().equalsIgnoreCase(current) && isEmailCompliant(current);
    }

    /**
     * 是否必须完成邮箱验证才能使用平台。账号停用、待审核等原有限制由各自守卫处理，
     * 这里只回答邮箱验证本身的要求。
     */
    public boolean requiresVerification(UserDO user) {
        if (user == null) {
            return false;
        }
        PlatformEmailPolicyDO row = policyDao.find();
        if (row == null || !isEnabled(row.getVerificationEnabled())) {
            return false;
        }
        if (isEmailVerified(user)) {
            return false;
        }
        if (isNewAccountInCurrentPeriod(user, row) && user.getFirstVerifiedAt() == null) {
            return true;
        }
        return isEnabled(row.getForceExistingEnabled());
    }

    public void requireUsable(UserDO user) {
        if (requiresVerification(user)) {
            throw new BizException(ErrorCode.EMAIL_VERIFICATION_REQUIRED);
        }
    }

    private boolean isNewAccountInCurrentPeriod(UserDO user, PlatformEmailPolicyDO row) {
        Date periodStart = row.getPeriodStartedAt();
        Date created = user.getGmtCreate();
        // 缺少启用周期或创建时间时按存量处理，避免把历史账号误判为新账号而锁死平台。
        return periodStart != null && created != null && !created.before(periodStart);
    }

    // ---- 更新 ----

    @Transactional
    public EmailVerificationPolicyVO update(long userId, UpdateEmailVerificationPolicyRequest request) {
        if (request == null) {
            throw BizException.keyed(ErrorCode.PARAM_INVALID, "email.policy_request_required", null,
                    "邮箱验证策略请求不能为空");
        }
        PlatformEmailPolicyDO current = policyDao.find();
        boolean currentVerification = current != null && isEnabled(current.getVerificationEnabled());
        boolean currentForce = current != null && isEnabled(current.getForceExistingEnabled());
        boolean currentSuffix = current != null && isEnabled(current.getSuffixRestrictionEnabled());
        List<String> currentSuffixes = parseSuffixes(current == null ? null : current.getAllowedSuffixes());
        long currentVersion = current == null || current.getPolicyVersion() == null ? 0L : current.getPolicyVersion();

        if (request.getExpectedVersion() != null && request.getExpectedVersion() != currentVersion) {
            throw new BizException(ErrorCode.EMAIL_POLICY_VERSION_CONFLICT);
        }

        boolean newVerification = request.getVerificationEnabled() == null
                ? currentVerification : request.getVerificationEnabled();
        boolean newForce = request.getForceExistingEnabled() == null
                ? currentForce : request.getForceExistingEnabled();
        boolean newSuffix = request.getSuffixRestrictionEnabled() == null
                ? currentSuffix : request.getSuffixRestrictionEnabled();
        List<String> newSuffixes = request.getAllowedSuffixes() == null
                ? currentSuffixes : normalizeSuffixes(request.getAllowedSuffixes());

        if (currentVerification && !newVerification
                && !Boolean.TRUE.equals(request.getConfirmDisableVerification())) {
            throw new BizException(ErrorCode.EMAIL_POLICY_DISABLE_CONFIRM_REQUIRED);
        }
        // 总开关关闭同时关闭存量强制；显式要求开启强制但没有开启总开关则拒绝。
        if (Boolean.TRUE.equals(request.getForceExistingEnabled()) && !newVerification) {
            throw new BizException(ErrorCode.EMAIL_POLICY_FORCE_REQUIRES_VERIFICATION);
        }
        if (!newVerification) {
            newForce = false;
        }
        if (newSuffix && newSuffixes.isEmpty()) {
            throw new BizException(ErrorCode.EMAIL_SUFFIX_POLICY_INVALID);
        }
        boolean enablingVerification = !currentVerification && newVerification;
        if (enablingVerification && !mailSettingsService.isActiveConfigTested()) {
            throw new BizException(ErrorCode.MAIL_SETTINGS_TEST_REQUIRED);
        }

        Date periodStartedAt = current == null ? null : current.getPeriodStartedAt();
        if (enablingVerification) {
            periodStartedAt = new Date();
        }

        PlatformEmailPolicyDO row = new PlatformEmailPolicyDO();
        row.setVerificationEnabled(newVerification ? 1 : 0);
        row.setForceExistingEnabled(newForce ? 1 : 0);
        row.setSuffixRestrictionEnabled(newSuffix ? 1 : 0);
        row.setAllowedSuffixes(joinSuffixes(newSuffixes));
        row.setPeriodStartedAt(periodStartedAt);
        row.setPolicyVersion(currentVersion + 1);
        row.setUpdatedBy(userId);

        if (current == null) {
            try {
                policyDao.insert(row);
            } catch (org.springframework.dao.DuplicateKeyException concurrentInsert) {
                throw new BizException(ErrorCode.EMAIL_POLICY_VERSION_CONFLICT);
            }
        } else if (policyDao.update(row, currentVersion) == 0) {
            throw new BizException(ErrorCode.EMAIL_POLICY_VERSION_CONFLICT);
        }

        boolean verificationJustEnabled = !currentVerification && newVerification;
        if (newSuffix && (verificationJustEnabled || !currentSuffix
                || !currentSuffixes.equals(newSuffixes))) {
            invalidateNonCompliantVerifications(newSuffixes);
        }
        if (!currentForce && newForce) {
            // 事务提交后按接收者语言发送；去重按策略版本。
            eventPublisher.publishEvent(new EmailVerificationBroadcastRequestedEvent(row.getPolicyVersion()));
        }
        return getPolicy();
    }

    /** 后缀策略生效后，此前已验证但不合规的邮箱持久化标记需重新验证。 */
    void invalidateNonCompliantVerifications(List<String> suffixes) {
        for (UserDO user : userDao.listUsersForVerificationPolicy()) {
            if (Integer.valueOf(1).equals(user.getVerificationInvalidated())) {
                continue;
            }
            String verified = user.getVerifiedEmail();
            if (verified != null && !isCompliantDomain(verified, suffixes)) {
                userDao.invalidateEmailVerification(user.getId());
            }
        }
    }

    // ---- 规范化 ----

    /**
     * 后缀规范化：去空白、去一个可选前导 @、忽略大小写、按域名去重；
     * 拒绝空列表、通配符、完整邮箱与非法域名。
     */
    public List<String> normalizeSuffixes(List<String> raw) {
        Set<String> unique = new LinkedHashSet<>();
        if (raw != null) {
            for (String value : raw) {
                if (value == null) {
                    continue;
                }
                String candidate = value.trim().toLowerCase(Locale.ROOT);
                if (candidate.startsWith("@")) {
                    candidate = candidate.substring(1);
                }
                if (candidate.isEmpty()) {
                    continue;
                }
                if (candidate.contains("@") || candidate.contains("*") || candidate.contains(" ")
                        || !DOMAIN_PATTERN.matcher(candidate).matches()) {
                    throw new BizException(ErrorCode.EMAIL_SUFFIX_POLICY_INVALID);
                }
                unique.add(candidate);
            }
        }
        return new ArrayList<>(unique);
    }

    List<String> parseSuffixes(String stored) {
        List<String> result = new ArrayList<>();
        if (stored == null || stored.isBlank()) {
            return result;
        }
        for (String value : stored.split(",")) {
            String trimmed = value.trim().toLowerCase(Locale.ROOT);
            if (!trimmed.isEmpty()) {
                result.add(trimmed);
            }
        }
        return result;
    }

    private String joinSuffixes(List<String> suffixes) {
        return suffixes.isEmpty() ? null : String.join(",", suffixes);
    }

    boolean isCompliantDomain(String email, List<String> suffixes) {
        String normalized = normalizeEmail(email);
        if (normalized == null) {
            return false;
        }
        int at = normalized.lastIndexOf('@');
        if (at <= 0 || at == normalized.length() - 1) {
            return false;
        }
        String domain = normalized.substring(at + 1).toLowerCase(Locale.ROOT);
        return suffixes.contains(domain);
    }

    private String normalizeEmail(String email) {
        if (email == null) {
            return null;
        }
        String trimmed = email.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static boolean isEnabled(Integer flag) {
        return Integer.valueOf(1).equals(flag);
    }
}
