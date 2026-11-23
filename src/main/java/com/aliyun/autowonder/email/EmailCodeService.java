package com.aliyun.autowonder.email;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.common.i18n.SystemMessages;
import com.aliyun.autowonder.redis.RedisManager;
import com.aliyun.autowonder.user.UserSettingService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Date;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * 邮箱验证码：共享存储保存摘要与失败次数，限流按原子计数；
 * 校验与消费由单个 Lua 脚本原子完成，重发使旧码失效。
 */
@Service
public class EmailCodeService {

    private static final Logger LOGGER = LoggerFactory.getLogger(EmailCodeService.class);
    private static final SecureRandom RANDOM = new SecureRandom();

    private static final String CHALLENGE_PREFIX = "aw:email:code:";
    /** 用途+归属+邮箱 → 最新 challengeId；重发时旧码立即失效。 */
    private static final String LATEST_PREFIX = "aw:email:latest:";
    private static final String COOLDOWN_PREFIX = "aw:email:cooldown:";
    private static final String RATE_EMAIL_PREFIX = "aw:email:rate:email:";
    private static final String RATE_USER_PREFIX = "aw:email:rate:user:";
    private static final String RATE_IP_PREFIX = "aw:email:rate:ip:";
    private static final String RATE_PLATFORM_KEY = "aw:email:rate:platform";

    static final int EMAIL_LIMIT_PER_HOUR = 10;
    static final int USER_LIMIT_PER_HOUR = 10;
    static final int IP_LIMIT_PER_HOUR = 30;
    static final int PLATFORM_LIMIT_PER_HOUR = 1000;

    private static final String VERIFY_SCRIPT =
            "local purpose = redis.call('hget', KEYS[1], 'purpose') "
            + "if not purpose then return 'EXPIRED' end "
            + "if purpose ~= ARGV[1] then return 'MISMATCH' end "
            + "local email = redis.call('hget', KEYS[1], 'email') "
            + "if not email or email ~= ARGV[2] then return 'MISMATCH' end "
            + "local owner = redis.call('hget', KEYS[1], 'owner') "
            + "if not owner or owner ~= ARGV[3] then return 'MISMATCH' end "
            + "if redis.call('hget', KEYS[1], 'codeHash') ~= ARGV[4] then "
            + "  local failures = redis.call('hincrby', KEYS[1], 'failures', 1) "
            + "  if failures >= tonumber(ARGV[5]) then redis.call('del', KEYS[1]); return 'EXHAUSTED' end "
            + "  return 'INVALID' "
            + "end "
            + "redis.call('del', KEYS[1]) "
            + "return 'OK'";

    private final RedisManager redisManager;
    private final MailSettingsService mailSettingsService;
    private final UserSettingService userSettingService;

    public EmailCodeService(RedisManager redisManager, MailSettingsService mailSettingsService,
                            UserSettingService userSettingService) {
        this.redisManager = redisManager;
        this.mailSettingsService = mailSettingsService;
        this.userSettingService = userSettingService;
    }

    public record Challenge(String challengeId, Date resendAt, Date expiresAt) {
    }

    /**
     * 生成并发送 6 位验证码。发送失败不产生可用验证码，但保留短暂重发冷却。
     */
    public Challenge send(EmailVerificationPurpose purpose, String email, Long userId, String ip) {
        String normalizedEmail = normalizeEmail(email);
        if (normalizedEmail == null) {
            throw new BizException(ErrorCode.EMAIL_SUFFIX_NOT_ALLOWED);
        }
        String cooldownKey = COOLDOWN_PREFIX + purpose.name() + ":" + normalizedEmail;
        if (Boolean.TRUE.equals(redisManager.exists(cooldownKey))) {
            throw new BizException(ErrorCode.EMAIL_CODE_RATE_LIMITED);
        }
        enforceRateLimits(normalizedEmail, userId, ip);

        String code = randomCode();
        String challengeId = UUID.randomUUID().toString().replace("-", "");
        String key = CHALLENGE_PREFIX + challengeId;
        String owner = userId == null ? "anonymous" : String.valueOf(userId);
        String latestKey = LATEST_PREFIX + purpose.name() + ":" + owner + ":" + normalizedEmail;
        String previousChallengeId = redisManager.getString(latestKey);
        redisManager.hset(key, "purpose", purpose.name());
        redisManager.hset(key, "email", normalizedEmail);
        redisManager.hset(key, "owner", owner);
        redisManager.hset(key, "codeHash", hashCode(challengeId, code));
        redisManager.hset(key, "failures", "0");
        redisManager.setExpire(key, EmailVerificationPolicyService.CODE_TTL_SECONDS);

        try {
            Locale locale = userId == null
                    ? Locale.SIMPLIFIED_CHINESE : userSettingService.recipientLocale(userId);
            String subject = SystemMessages.render("email.code_email.subject", null,
                    "AutoWonder verification code", locale);
            String body = SystemMessages.render("email.code_email.body",
                    new Object[]{code, EmailVerificationPolicyService.CODE_TTL_SECONDS / 60},
                    "Your verification code is " + code, locale);
            mailSettingsService.sendActiveMail(normalizedEmail, subject, body);
        } catch (RuntimeException e) {
            // 失败发送不得留下可用验证码，但保留短暂重发冷却。
            redisManager.del(key);
            applyResendCooldown(cooldownKey);
            throw e;
        }

        // 重发使旧码失效：删除此前 challenge 并发布最新指针。
        if (previousChallengeId != null && !previousChallengeId.isBlank()
                && !previousChallengeId.equals(challengeId)) {
            redisManager.del(CHALLENGE_PREFIX + previousChallengeId);
        }
        redisManager.setWithExpire(latestKey, challengeId,
                EmailVerificationPolicyService.CODE_TTL_SECONDS);
        applyResendCooldown(cooldownKey);

        long now = System.currentTimeMillis();
        return new Challenge(challengeId,
                new Date(now + EmailVerificationPolicyService.RESEND_INTERVAL_SECONDS * 1000L),
                new Date(now + EmailVerificationPolicyService.CODE_TTL_SECONDS * 1000L));
    }

    private void applyResendCooldown(String cooldownKey) {
        redisManager.setString(cooldownKey, "1");
        redisManager.setExpire(cooldownKey, EmailVerificationPolicyService.RESEND_INTERVAL_SECONDS);
    }

    /** 原子校验并消费；用途、目标邮箱、归属用户任一不匹配都视为无效。 */
    public void verify(EmailVerificationPurpose purpose, String email, Long userId,
                       String challengeId, String code) {
        String normalizedEmail = normalizeEmail(email);
        if (normalizedEmail == null || challengeId == null || challengeId.isBlank()
                || code == null || code.isBlank()) {
            throw new BizException(ErrorCode.EMAIL_CODE_INVALID);
        }
        String key = CHALLENGE_PREFIX + challengeId.trim();
        String owner = userId == null ? "anonymous" : String.valueOf(userId);
        // 只接受当前最新 challenge：重发后旧 challengeId 即使未过期也不可用。
        String latest = redisManager.getString(
                LATEST_PREFIX + purpose.name() + ":" + owner + ":" + normalizedEmail);
        if (latest == null || !latest.equals(challengeId.trim())) {
            throw new BizException(ErrorCode.EMAIL_CODE_INVALID);
        }
        Object result;
        try {
            result = redisManager.eval(VERIFY_SCRIPT, List.of(key),
                    List.of(purpose.name(), normalizedEmail, owner, hashCode(challengeId.trim(), code.trim()),
                            String.valueOf(EmailVerificationPolicyService.MAX_CODE_ATTEMPTS)));
        } catch (RuntimeException e) {
            LOGGER.warn("email code verification failed", e);
            throw new BizException(ErrorCode.EMAIL_CODE_INVALID);
        }
        String outcome = result == null ? "EXPIRED" : String.valueOf(result);
        if (!"OK".equals(outcome)) {
            throw new BizException(ErrorCode.EMAIL_CODE_INVALID);
        }
    }

    public void revoke(String challengeId) {
        if (challengeId != null && !challengeId.isBlank()) {
            redisManager.del(CHALLENGE_PREFIX + challengeId.trim());
        }
    }

    private void enforceRateLimits(String email, Long userId, String ip) {
        if (redisManager.exIncrBy(RATE_EMAIL_PREFIX + email, 1, 3600) > EMAIL_LIMIT_PER_HOUR) {
            throw new BizException(ErrorCode.EMAIL_CODE_RATE_LIMITED);
        }
        if (userId != null
                && redisManager.exIncrBy(RATE_USER_PREFIX + userId, 1, 3600) > USER_LIMIT_PER_HOUR) {
            throw new BizException(ErrorCode.EMAIL_CODE_RATE_LIMITED);
        }
        if (ip != null && !ip.isBlank()
                && redisManager.exIncrBy(RATE_IP_PREFIX + ip, 1, 3600) > IP_LIMIT_PER_HOUR) {
            throw new BizException(ErrorCode.EMAIL_CODE_RATE_LIMITED);
        }
        if (redisManager.exIncrBy(RATE_PLATFORM_KEY, 1, 3600) > PLATFORM_LIMIT_PER_HOUR) {
            throw new BizException(ErrorCode.EMAIL_CODE_RATE_LIMITED);
        }
    }

    private String randomCode() {
        int value = RANDOM.nextInt(1_000_000);
        return String.format(Locale.ROOT, "%06d", value);
    }

    private String hashCode(String challengeId, String code) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(
                    digest.digest((challengeId + ":" + code).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private String normalizeEmail(String email) {
        if (email == null) {
            return null;
        }
        String trimmed = email.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
