package com.aliyun.autowonder.email;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.redis.RedisManager;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Objects;

/**
 * 短期凭证：
 * <ul>
 *   <li>受限验证凭证（awev_）：15 分钟，只用于邮箱验证/更换邮箱接口，不能刷新成普通会话。</li>
 *   <li>邮箱验证 proof（awevp_）：绑定用途、用户与目标邮箱的一次性凭据，保存时消费。</li>
 * </ul>
 */
@Service
public class EmailVerificationTokenService {

    public static final String RESTRICTED_PREFIX = "awev_";
    public static final String PROOF_PREFIX = "awevp_";
    public static final int RESTRICTED_TTL_SECONDS = 900;
    static final int PROOF_TTL_SECONDS = 600;

    private static final String RESTRICTED_KEY_PREFIX = "aw:email:restricted:";
    private static final String PROOF_KEY_PREFIX = "aw:email:proof:";
    private static final SecureRandom RANDOM = new SecureRandom();

    private static final String CONSUME_SCRIPT =
            "local value = redis.call('get', KEYS[1]) "
            + "if value then redis.call('del', KEYS[1]) end "
            + "return value";

    private final RedisManager redisManager;

    public EmailVerificationTokenService(RedisManager redisManager) {
        this.redisManager = redisManager;
    }

    public String issueRestricted(Long userId) {
        String token = randomToken(RESTRICTED_PREFIX);
        redisManager.setWithExpire(RESTRICTED_KEY_PREFIX + token, String.valueOf(userId),
                RESTRICTED_TTL_SECONDS);
        return token;
    }

    public Long resolveRestricted(String token) {
        if (token == null || !token.startsWith(RESTRICTED_PREFIX)) {
            return null;
        }
        String value = redisManager.getString(RESTRICTED_KEY_PREFIX + token);
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Long.valueOf(value);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public void revokeRestricted(String token) {
        if (token != null && token.startsWith(RESTRICTED_PREFIX)) {
            redisManager.del(RESTRICTED_KEY_PREFIX + token);
        }
    }

    public String issueProof(EmailVerificationPurpose purpose, Long userId, String email) {
        String token = randomToken(PROOF_PREFIX);
        ProofPayload payload = new ProofPayload();
        payload.setPurpose(purpose.name());
        payload.setUserId(userId);
        payload.setEmail(email);
        redisManager.setWithExpire(PROOF_KEY_PREFIX + token, JSON.toJSONString(payload), PROOF_TTL_SECONDS);
        return token;
    }

    /** 原子消费 proof：用途、用户、目标邮箱任一不符即拒绝，且不保留可用凭据。 */
    public void consumeProof(String proof, EmailVerificationPurpose purpose, Long userId, String email) {
        if (proof == null || !proof.startsWith(PROOF_PREFIX)) {
            throw new BizException(ErrorCode.EMAIL_VERIFICATION_PROOF_INVALID);
        }
        Object raw;
        try {
            raw = redisManager.eval(CONSUME_SCRIPT, List.of(PROOF_KEY_PREFIX + proof), List.of());
        } catch (RuntimeException e) {
            throw new BizException(ErrorCode.EMAIL_VERIFICATION_PROOF_INVALID);
        }
        if (!(raw instanceof String stored) || stored.isBlank()) {
            throw new BizException(ErrorCode.EMAIL_VERIFICATION_PROOF_INVALID);
        }
        ProofPayload payload;
        try {
            payload = JSON.parseObject(stored, ProofPayload.class);
        } catch (RuntimeException e) {
            throw new BizException(ErrorCode.EMAIL_VERIFICATION_PROOF_INVALID);
        }
        if (payload == null || !purpose.name().equals(payload.getPurpose())
                || !Objects.equals(userId, payload.getUserId())
                || payload.getEmail() == null || email == null
                || !payload.getEmail().equalsIgnoreCase(email.trim())) {
            throw new BizException(ErrorCode.EMAIL_VERIFICATION_PROOF_INVALID);
        }
    }

    private String randomToken(String prefix) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return prefix + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    @lombok.Getter
    @lombok.Setter
    public static class ProofPayload {
        private String purpose;
        private Long userId;
        private String email;
    }
}
