package com.aliyun.autowonder.email;

import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/** 平台邮件发送配置（全局单行表 platform_mail_settings）。 */
@Getter
@Setter
public class MailSettingsDO {
    private Integer id;
    private String draftConfig;
    private String activeConfig;
    private String draftSecretRef;
    private String activeSecretRef;
    private Long draftSecretVersion;
    private Long activeSecretVersion;
    private Long draftVersion;
    private Long activeVersion;
    private String testedFingerprint;
    private Date testedAt;
    private Integer testSuccess;
    private String testResult;
    private Long updatedBy;
    private Date gmtCreate;
    private Date gmtModified;
}
