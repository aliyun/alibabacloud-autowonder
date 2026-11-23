package com.aliyun.autowonder.user;

import lombok.Getter;
import lombok.Setter;
import java.util.Date;

@Getter
@Setter
public class UserDO {
    private Long id;
    private String username;
    private String email;
    /** 最近一次验证成功的邮箱快照；与 email 不一致即未验证。 */
    private String verifiedEmail;
    private Date verifiedAt;
    /** 首次验证成功时间；用于区分新账号首次验证与存量账号。 */
    private Date firstVerifiedAt;
    /** 0 有效 / 1 被后缀策略等置为需重新验证；重新加入后缀不自动恢复。 */
    private Integer verificationInvalidated;
    private String passwordHash;
    private String nickname;
    private String avatarUrl;
    private String phone;
    private Integer status;
    private Integer isAdmin;
    private Date deactivatedAt;
    private Date coolingOffExpiresAt;
    private Date deactivationRevokedAt;
    private Date lastLoginAt;
    private Date gmtCreate;
    private Date gmtModified;
    private Integer isDeleted;
    private String deletedUsername;
    private String deletedEmail;
    private Date deletedAt;
    private Long deletedBy;
    /** 平台级空间创建个人授权位；缺省 0 = 未单独授权。 */
    private Integer workspaceCreationGranted;
}
