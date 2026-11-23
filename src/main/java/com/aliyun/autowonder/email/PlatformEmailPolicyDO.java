package com.aliyun.autowonder.email;

import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/** 平台邮箱验证策略（全局单行表 platform_email_policy）。 */
@Getter
@Setter
public class PlatformEmailPolicyDO {
    private Integer id;
    private Integer verificationEnabled;
    private Integer forceExistingEnabled;
    private Integer suffixRestrictionEnabled;
    private String allowedSuffixes;
    private Date periodStartedAt;
    private Long policyVersion;
    private Long updatedBy;
    private Date gmtCreate;
    private Date gmtModified;
}
