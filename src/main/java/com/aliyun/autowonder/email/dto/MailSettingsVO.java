package com.aliyun.autowonder.email.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/** 平台邮件发送配置视图：不回传密钥，只回传是否已配置。 */
@Getter
@Setter
public class MailSettingsVO {
    private String host;
    private Integer port;
    private String security;
    private String fromAddress;
    private String fromName;
    private String authMode;
    private String username;
    private boolean secretConfigured;
    private boolean activeConfigured;
    private long draftVersion;
    private long activeVersion;
    private boolean tested;
    private boolean testSuccess;
    private Date testedAt;
    private String testResult;
    private boolean activeTested;
}
