package com.aliyun.autowonder.auth.federation;

/**
 * 协议适配器输出的统一外部身份：只包含已通过协议校验的稳定标识与展示信息，
 * 不携带任何 AutoWonder 用户、会话或工作空间语义。
 * username 仅在连接配置了用户名声明且认证结果携带该声明时有值；username 与 subject 相互独立。
 * feishuUserId 仅在连接配置了飞书属性名且认证结果携带该属性时有值。
 */
public record ExternalIdentity(Long providerId, String issuer, String subject,
                               String displayName, String email, String feishuUserId,
                               String username) {

    public ExternalIdentity(Long providerId, String issuer, String subject,
                            String displayName, String email, String feishuUserId) {
        this(providerId, issuer, subject, displayName, email, feishuUserId, null);
    }

    public ExternalIdentity(Long providerId, String issuer, String subject,
                            String displayName, String email) {
        this(providerId, issuer, subject, displayName, email, null, null);
    }
}
