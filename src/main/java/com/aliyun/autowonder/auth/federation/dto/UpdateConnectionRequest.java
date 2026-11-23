package com.aliyun.autowonder.auth.federation.dto;

import lombok.Getter;
import lombok.Setter;

/**
 * 更新协议连接：null 字段保持现状；clientSecret 为空串或 null 表示沿用已存密钥。
 * 更新不会推导默认用户名声明：usernameClaim 空串仍表示该连接回到原有随机用户名行为。
 */
@Getter
@Setter
public class UpdateConnectionRequest {
    private String name;
    private Integer enabled;
    private String issuer;
    private String samlSsoUrl;
    private String samlCert;
    private String oidcAuthorizeUrl;
    private String oidcTokenUrl;
    private String oidcJwksUrl;
    private String clientId;
    private String clientSecret;
    private String scopes;
    private String subjectClaim;
    private String nameClaim;
    private String emailClaim;
    /** null 保持现状；空串清除映射。 */
    private String usernameClaim;
    /** null 保持现状；空串清除映射。 */
    private String feishuUserIdClaim;
    /** null 保持现状；0/1 覆盖。 */
    private Integer autoProvision;
    /** null 保持现状；0/1 覆盖。开启时必须已有 usernameClaim。 */
    private Integer bindExistingByUsername;
    /** null 保持现状；true 设为唯一默认连接，false 清除本连接的默认标记。 */
    private Boolean defaultLogin;
    private String allowedTenants;
    private Integer sortOrder;
}
