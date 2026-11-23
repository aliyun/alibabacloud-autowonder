package com.aliyun.autowonder.email.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/** 公开安全投影：不含管理员配置细节，仅启用状态、允许后缀与验证码交互参数。 */
@Getter
@Setter
public class EmailVerificationPolicyPublicVO {
    private boolean verificationEnabled;
    private boolean suffixRestrictionEnabled;
    private List<String> allowedSuffixes = new ArrayList<>();
    private int codeLength;
    private int codeTtlSeconds;
    private int resendIntervalSeconds;
    private int maxAttempts;
}
