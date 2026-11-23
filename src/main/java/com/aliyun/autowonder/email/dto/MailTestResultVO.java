package com.aliyun.autowonder.email.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/** 测试发送结果：成功只表示 SMTP 服务接受邮件，不表示最终送达。 */
@Getter
@Setter
public class MailTestResultVO {
    private boolean success;
    /** 脱敏失败分类，前端按语言渲染；成功时为 null。 */
    private String failureCode;
    private String fingerprint;
    private Date testedAt;
    private MailSettingsVO settings;
}
