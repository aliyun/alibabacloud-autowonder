package com.aliyun.autowonder.email;

import com.aliyun.autowonder.auth.session.SessionIssuanceService;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.user.UserDO;
import com.aliyun.autowonder.user.UserDao;
import com.aliyun.autowonder.user.dto.LoginResponse;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Date;

/**
 * 注册、个人中心与受限页共用的邮箱验证编排：验证码校验、proof 签发/消费、
 * 受限页的原子完成动作与重新签发会话。
 */
@Service
public class EmailVerificationService {

    private final EmailVerificationPolicyService policyService;
    private final EmailCodeService codeService;
    private final EmailVerificationTokenService tokenService;
    private final UserDao userDao;
    private final SessionIssuanceService sessionIssuanceService;

    public EmailVerificationService(EmailVerificationPolicyService policyService,
                                    EmailCodeService codeService,
                                    EmailVerificationTokenService tokenService,
                                    UserDao userDao,
                                    SessionIssuanceService sessionIssuanceService) {
        this.policyService = policyService;
        this.codeService = codeService;
        this.tokenService = tokenService;
        this.userDao = userDao;
        this.sessionIssuanceService = sessionIssuanceService;
    }

    public EmailCodeService.Challenge sendCode(EmailVerificationPurpose purpose, String email,
                                               Long userId, String ip) {
        if (!policyService.verificationEnabled()) {
            throw new BizException(ErrorCode.EMAIL_VERIFICATION_DISABLED);
        }
        String target = normalizeEmail(email);
        if (target == null || !policyService.isEmailCompliant(target)) {
            throw new BizException(ErrorCode.EMAIL_SUFFIX_NOT_ALLOWED);
        }
        return codeService.send(purpose, target, userId, ip);
    }

    /** 校验验证码并签发绑定用途/用户/目标邮箱的一次性 proof；注册流程不创建账号。 */
    public String verifyForProof(EmailVerificationPurpose purpose, String email, Long userId,
                                 String challengeId, String code) {
        String target = normalizeEmail(email);
        if (target == null) {
            throw new BizException(ErrorCode.PARAM_INVALID);
        }
        codeService.verify(purpose, target, userId, challengeId, code);
        return tokenService.issueProof(purpose, userId, target);
    }

    /** 注册成功前消费注册 proof；proof 与目标邮箱绑定，不能挪用给其他邮箱。 */
    public void consumeRegisterProof(String proof, String email) {
        tokenService.consumeProof(proof, EmailVerificationPurpose.REGISTER, null, email);
    }

    /** 个人资料保存时消费改邮箱 proof。 */
    public void consumeProfileProof(Long userId, String email, String proof) {
        tokenService.consumeProof(proof, EmailVerificationPurpose.PROFILE_EMAIL, userId, email);
    }

    /**
     * 受限页“验证并继续”：原子消费验证码、更新邮箱与验证状态，随后重新核验账号状态并签发正常会话。
     */
    @Transactional
    public LoginResponse completeRestricted(Long userId, String email, String challengeId, String code) {
        UserDO user = userDao.findById(userId);
        if (user == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        String target = normalizeEmail(email);
        if (target == null || !policyService.isEmailCompliant(target)) {
            throw new BizException(ErrorCode.EMAIL_SUFFIX_NOT_ALLOWED);
        }
        codeService.verify(EmailVerificationPurpose.RESTRICTED, target, userId, challengeId, code);

        Date now = new Date();
        Date firstVerifiedAt = user.getFirstVerifiedAt() == null ? now : user.getFirstVerifiedAt();
        try {
            if (userDao.updateEmailWithVerification(userId, target, target, now, firstVerifiedAt) != 1) {
                throw new BizException(ErrorCode.UNAUTHORIZED);
            }
        } catch (DuplicateKeyException e) {
            throw BizException.keyed(ErrorCode.CONFLICT, "user.email_in_use", null, "邮箱已被使用");
        }
        UserDO updated = userDao.findById(userId);
        if (updated == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        // 重新核验停用/待审状态；通过后签发正常会话。
        return sessionIssuanceService.issue(updated);
    }

    public void revokeRestricted(String token) {
        tokenService.revokeRestricted(token);
    }

    private String normalizeEmail(String email) {
        if (email == null) {
            return null;
        }
        String trimmed = email.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
