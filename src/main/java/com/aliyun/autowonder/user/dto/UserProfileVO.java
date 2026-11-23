package com.aliyun.autowonder.user.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.Date;

@Getter
@Setter
public class UserProfileVO {
    private Long id;
    private String username;
    private String nickname;
    private String email;
    private String phone;
    /** 只读：当前登录用户是否可以创建空间（服务端最终会再次校验）。 */
    private boolean canCreateWorkspace;
    /** 当前邮箱是否已完成归属验证（来自 verified_email 快照与后缀策略）。 */
    private boolean emailVerified;
    private Date emailVerifiedAt;
}
