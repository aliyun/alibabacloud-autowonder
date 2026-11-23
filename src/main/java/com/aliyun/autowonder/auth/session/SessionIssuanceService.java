package com.aliyun.autowonder.auth.session;

import com.aliyun.autowonder.auth.jwt.JwtProperties;
import com.aliyun.autowonder.auth.jwt.JwtService;
import com.aliyun.autowonder.auth.jwt.TokenPayload;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.email.EmailVerificationPolicyService;
import com.aliyun.autowonder.email.EmailVerificationTokenService;
import com.aliyun.autowonder.user.UserAccountStates;
import com.aliyun.autowonder.user.UserDO;
import com.aliyun.autowonder.user.dto.LoginResponse;
import com.aliyun.autowonder.user.dto.UserVO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.UUID;

/**
 * 共享会话签发：密码登录与联合登录都在身份校验通过后走这里，
 * 保证两种入口签发的 AW 会话（access/refresh 及用户视图）完全一致。
 * 需要邮箱验证时改为签发 15 分钟受限凭证，不签发可用的普通会话。
 */
@Service
public class SessionIssuanceService {

    public static final String PURPOSE_EMAIL_VERIFICATION = "EMAIL_VERIFICATION";

    private final JwtService jwtService;
    private final SessionService sessionService;
    private final JwtProperties jwtProperties;

    /**
     * 可选门禁依赖：保留三参构造供既有调用与测试使用；应用运行时由 Spring 注入。
     */
    @Autowired(required = false)
    private EmailVerificationPolicyService emailVerificationPolicyService;
    @Autowired(required = false)
    private EmailVerificationTokenService emailVerificationTokenService;

    public SessionIssuanceService(JwtService jwtService, SessionService sessionService,
                                  JwtProperties jwtProperties) {
        this.jwtService = jwtService;
        this.sessionService = sessionService;
        this.jwtProperties = jwtProperties;
    }

    public LoginResponse issue(UserDO user) {
        // 所有签发路径（密码登录、联合登录、绑定后登录）共用同一守卫：待审或已注销账号不签发会话。
        if (UserAccountStates.isPendingReview(user)) {
            throw new BizException(ErrorCode.USER_REGISTRATION_PENDING_REVIEW);
        }
        if (UserAccountStates.isLegacyDeactivated(user) || UserAccountStates.isDeleted(user)) {
            throw new BizException(ErrorCode.DEACTIVATION_ACCOUNT_DISABLED);
        }
        if (emailVerificationPolicyService != null && emailVerificationTokenService != null
                && emailVerificationPolicyService.requiresVerification(user)) {
            String restrictedToken = emailVerificationTokenService.issueRestricted(user.getId());
            LoginResponse restricted = new LoginResponse(user.getId(), null, null, toVO(user));
            restricted.setSessionPurpose(PURPOSE_EMAIL_VERIFICATION);
            restricted.setRestrictedToken(restrictedToken);
            restricted.setRestrictedExpiresAt(new Date(System.currentTimeMillis()
                    + EmailVerificationTokenService.RESTRICTED_TTL_SECONDS * 1000L));
            return restricted;
        }
        String jti = UUID.randomUUID().toString();
        String accessToken = jwtService.signAccess(new TokenPayload(user.getId(), null, jti));
        String refreshToken = UUID.randomUUID().toString();
        sessionService.storeRefresh(refreshToken, user.getId(), (int) jwtProperties.getRefreshTtlSeconds());
        return new LoginResponse(user.getId(), accessToken, refreshToken, toVO(user));
    }

    private UserVO toVO(UserDO user) {
        UserVO vo = new UserVO();
        vo.setId(user.getId());
        vo.setUsername(user.getUsername());
        vo.setNickname(user.getNickname());
        vo.setEmail(user.getEmail());
        vo.setIsAdmin(Integer.valueOf(1).equals(user.getIsAdmin()));
        return vo;
    }
}
