package com.aliyun.autowonder.email;

import lombok.Getter;
import lombok.Setter;

/** SMTP 非敏感配置；密钥单独加密保存，不进入本对象。 */
@Getter
@Setter
public class MailConfig {
    /** 连接加密方式：STARTTLS / SSL / NONE。 */
    public static final String SECURITY_STARTTLS = "STARTTLS";
    public static final String SECURITY_SSL = "SSL";
    public static final String SECURITY_NONE = "NONE";
    /** 认证方式：PASSWORD / NONE。 */
    public static final String AUTH_PASSWORD = "PASSWORD";
    public static final String AUTH_NONE = "NONE";

    private String host;
    private Integer port;
    private String security;
    private String fromAddress;
    private String fromName;
    private String authMode;
    private String username;
}
