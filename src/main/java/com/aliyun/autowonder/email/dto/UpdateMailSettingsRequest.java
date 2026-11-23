package com.aliyun.autowonder.email.dto;

import lombok.Getter;
import lombok.Setter;

/** 保存草稿；password 留空表示保留已保存密钥。 */
@Getter
@Setter
public class UpdateMailSettingsRequest {
    private String host;
    private Integer port;
    private String security;
    private String fromAddress;
    private String fromName;
    private String authMode;
    private String username;
    private String password;
    private Integer expectedVersion;
}
