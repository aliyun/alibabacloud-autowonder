package com.aliyun.autowonder.email;

import com.aliyun.autowonder.auth.jwt.JwtService;
import com.aliyun.autowonder.auth.jwt.TokenPayload;
import com.aliyun.autowonder.auth.session.SessionService;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.common.result.Result;
import com.aliyun.autowonder.email.dto.EmailVerificationPolicyPublicVO;
import com.aliyun.autowonder.email.dto.SendEmailCodeRequest;
import com.aliyun.autowonder.email.dto.SendEmailCodeResponse;
import com.aliyun.autowonder.email.dto.VerifyEmailCodeRequest;
import com.aliyun.autowonder.email.dto.VerifyEmailCodeResponse;
import com.aliyun.autowonder.user.UserDO;
import com.aliyun.autowonder.user.UserDao;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import java.util.Locale;

/**
 * 公开邮箱验证入口。注册用途匿名可用；个人中心用途需要普通会话；
 * 受限页只接受 15 分钟受限验证凭证，已有个人令牌不能用来验证或更换邮箱。
 */
@RestController
@RequestMapping("/api/auth/email-verification")
public class EmailVerificationController {

    private final EmailVerificationPolicyService policyService;
    private final EmailVerificationService verificationService;
    private final EmailVerificationTokenService tokenService;
    private final JwtService jwtService;
    private final SessionService sessionService;
    private final UserDao userDao;

    public EmailVerificationController(EmailVerificationPolicyService policyService,
                                       EmailVerificationService verificationService,
                                       EmailVerificationTokenService tokenService,
                                       JwtService jwtService,
                                       SessionService sessionService,
                                       UserDao userDao) {
        this.policyService = policyService;
        this.verificationService = verificationService;
        this.tokenService = tokenService;
        this.jwtService = jwtService;
        this.sessionService = sessionService;
        this.userDao = userDao;
    }

    private record Caller(Long userId, String restrictedToken) {
    }

    @GetMapping("/policy")
    public Result<EmailVerificationPolicyPublicVO> policy() {
        return Result.ok(policyService.publicPolicy());
    }

    @PostMapping("/codes")
    public Result<SendEmailCodeResponse> sendCode(@RequestBody SendEmailCodeRequest request,
                                                  HttpServletRequest httpRequest) {
        EmailVerificationPurpose purpose = parsePurpose(request == null ? null : request.getPurpose());
        Caller caller = resolveCaller(httpRequest, purpose);
        EmailCodeService.Challenge challenge = verificationService.sendCode(
                purpose, request.getEmail(), caller.userId(), clientIp(httpRequest));
        SendEmailCodeResponse response = new SendEmailCodeResponse();
        response.setChallengeId(challenge.challengeId());
        response.setResendAt(challenge.resendAt());
        response.setExpiresAt(challenge.expiresAt());
        return Result.ok(response);
    }

    @PostMapping("/verify")
    public Result<VerifyEmailCodeResponse> verify(@RequestBody VerifyEmailCodeRequest request,
                                                  HttpServletRequest httpRequest) {
        EmailVerificationPurpose purpose = parsePurpose(request == null ? null : request.getPurpose());
        Caller caller = resolveCaller(httpRequest, purpose);
        VerifyEmailCodeResponse response = new VerifyEmailCodeResponse();
        if (purpose == EmailVerificationPurpose.RESTRICTED) {
            response.setSession(verificationService.completeRestricted(caller.userId(), request.getEmail(),
                    request.getChallengeId(), request.getCode()));
            tokenService.revokeRestricted(caller.restrictedToken());
        } else {
            response.setProof(verificationService.verifyForProof(purpose, request.getEmail(),
                    caller.userId(), request.getChallengeId(), request.getCode()));
        }
        return Result.ok(response);
    }

    /** 受限页退出：撤销受限凭证，不触碰普通会话。 */
    @PostMapping("/sign-out")
    public Result<Void> signOut(HttpServletRequest httpRequest) {
        String token = bearerToken(httpRequest);
        if (token != null) {
            tokenService.revokeRestricted(token);
        }
        return Result.ok(null);
    }

    private Caller resolveCaller(HttpServletRequest request, EmailVerificationPurpose purpose) {
        String token = bearerToken(request);
        if (token != null && token.startsWith(EmailVerificationTokenService.RESTRICTED_PREFIX)) {
            Long userId = tokenService.resolveRestricted(token);
            if (userId == null) {
                throw new BizException(ErrorCode.EMAIL_VERIFICATION_TOKEN_INVALID);
            }
            if (purpose != EmailVerificationPurpose.RESTRICTED) {
                throw new BizException(ErrorCode.EMAIL_RESTRICTED_CREDENTIAL_REQUIRED);
            }
            return new Caller(userId, token);
        }
        if (purpose == EmailVerificationPurpose.REGISTER) {
            return new Caller(null, null);
        }
        if (token == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        TokenPayload payload;
        try {
            payload = jwtService.parse(token);
        } catch (Exception e) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        if (payload.getJti() != null && sessionService.isBlacklisted(payload.getJti())) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        UserDO user = userDao.findById(payload.getUserId());
        if (user == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        if (purpose == EmailVerificationPurpose.RESTRICTED) {
            throw new BizException(ErrorCode.EMAIL_RESTRICTED_CREDENTIAL_REQUIRED);
        }
        return new Caller(user.getId(), null);
    }

    private String bearerToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            return null;
        }
        String token = header.substring("Bearer ".length()).trim();
        return token.isEmpty() ? null : token;
    }

    /** 来源 IP 仅取容器/代理传入的地址；受信代理配置由部署负责，这里不做猜测。 */
    private String clientIp(HttpServletRequest request) {
        return request.getRemoteAddr();
    }

    private EmailVerificationPurpose parsePurpose(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new BizException(ErrorCode.PARAM_INVALID);
        }
        try {
            return EmailVerificationPurpose.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new BizException(ErrorCode.PARAM_INVALID);
        }
    }
}
