package com.aliyun.autowonder.email;

import com.aliyun.autowonder.access.SystemAdminService;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.common.result.Result;
import com.aliyun.autowonder.context.AutoWonderContext;
import com.aliyun.autowonder.email.dto.MailSettingsVO;
import com.aliyun.autowonder.email.dto.MailTestResultVO;
import com.aliyun.autowonder.email.dto.TestMailRequest;
import com.aliyun.autowonder.email.dto.UpdateMailSettingsRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 平台邮件发送配置：仅平台管理员可读写，响应永不返回密钥。 */
@RestController
@RequestMapping("/api/platform/mail-settings")
public class MailSettingsController {

    private final MailSettingsService mailSettingsService;
    private final SystemAdminService systemAdminService;

    public MailSettingsController(MailSettingsService mailSettingsService,
                                  SystemAdminService systemAdminService) {
        this.mailSettingsService = mailSettingsService;
        this.systemAdminService = systemAdminService;
    }

    @GetMapping
    public Result<MailSettingsVO> get() {
        requireAdmin();
        return Result.ok(mailSettingsService.get());
    }

    @PutMapping
    public Result<MailSettingsVO> save(@RequestBody UpdateMailSettingsRequest request) {
        long userId = requireAdmin();
        return Result.ok(mailSettingsService.saveDraft(userId, request));
    }

    @PostMapping("/test")
    public Result<MailTestResultVO> test(@RequestBody TestMailRequest request) {
        long userId = requireAdmin();
        return Result.ok(mailSettingsService.test(userId, request));
    }

    private long requireAdmin() {
        Long userId = AutoWonderContext.get().getUserId();
        if (userId == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        systemAdminService.requireSystemAdmin(userId, "配置邮件发送",
                "access.admin.email_verification_denied");
        return userId;
    }
}
