package com.aliyun.autowonder.email;

import com.aliyun.autowonder.access.SystemAdminService;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.common.result.Result;
import com.aliyun.autowonder.context.AutoWonderContext;
import com.aliyun.autowonder.email.dto.EmailVerificationPolicyVO;
import com.aliyun.autowonder.email.dto.UpdateEmailVerificationPolicyRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 平台级邮箱验证策略配置，仅平台管理员可读写。 */
@RestController
@RequestMapping("/api/platform/email-verification/policy")
public class PlatformEmailPolicyController {

    private static final org.slf4j.Logger LOGGER =
            org.slf4j.LoggerFactory.getLogger(PlatformEmailPolicyController.class);

    private final EmailVerificationPolicyService policyService;
    private final EmailVerificationNotificationListener notificationListener;
    private final SystemAdminService systemAdminService;

    public PlatformEmailPolicyController(EmailVerificationPolicyService policyService,
                                         EmailVerificationNotificationListener notificationListener,
                                         SystemAdminService systemAdminService) {
        this.policyService = policyService;
        this.notificationListener = notificationListener;
        this.systemAdminService = systemAdminService;
    }

    @GetMapping
    public Result<EmailVerificationPolicyVO> get() {
        requireAdmin();
        return Result.ok(policyService.getPolicy());
    }

    @PutMapping
    public Result<EmailVerificationPolicyVO> update(
            @RequestBody UpdateEmailVerificationPolicyRequest request) {
        long userId = requireAdmin();
        return Result.ok(policyService.update(userId, request));
    }

    /** 通知补偿：按策略版本重放强制验证通知，仅平台管理员可触发。 */
    @PostMapping("/notifications/{policyVersion}/replay")
    public Result<Void> replayNotifications(@PathVariable("policyVersion") Long policyVersion) {
        long operatorId = requireAdmin();
        long version = policyVersion == null ? 0L : policyVersion;
        notificationListener.replay(version);
        // 重放属人工补偿动作，记录可追溯的操作人与策略版本。
        LOGGER.info("email verification notifications replayed policyVersion={} operatorId={}",
                version, operatorId);
        return Result.ok(null);
    }

    private long requireAdmin() {
        Long userId = AutoWonderContext.get().getUserId();
        if (userId == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        systemAdminService.requireSystemAdmin(userId, "配置邮箱验证策略",
                "access.admin.email_verification_denied");
        return userId;
    }
}
