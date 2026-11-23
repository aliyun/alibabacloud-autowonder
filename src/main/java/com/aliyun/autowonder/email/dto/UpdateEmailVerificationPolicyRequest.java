package com.aliyun.autowonder.email.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/** 平台管理员更新邮箱验证策略；只提交需要变化的字段。 */
@Getter
@Setter
public class UpdateEmailVerificationPolicyRequest {
    private Boolean verificationEnabled;
    private Boolean forceExistingEnabled;
    private Boolean suffixRestrictionEnabled;
    private List<String> allowedSuffixes;
    /** 关闭总开关必须显式确认；缺省按拒绝处理。 */
    private Boolean confirmDisableVerification;
    private Integer expectedVersion;
}
