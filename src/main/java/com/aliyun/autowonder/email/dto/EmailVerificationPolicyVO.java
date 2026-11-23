package com.aliyun.autowonder.email.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/** 平台管理员看到的邮箱验证与后缀策略。 */
@Getter
@Setter
public class EmailVerificationPolicyVO {
    private boolean verificationEnabled;
    private boolean forceExistingEnabled;
    private boolean suffixRestrictionEnabled;
    private List<String> allowedSuffixes = new ArrayList<>();
    private Date verificationEnabledAt;
    /** 策略乐观锁版本，更新时原样回传。 */
    private long version;
    /** 当前生效 SMTP 配置是否已通过同版本测试；关闭验证时允许为 false。 */
    private boolean mailSettingsTested;
}
