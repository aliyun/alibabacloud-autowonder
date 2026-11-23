package com.aliyun.autowonder.user.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RegisterRequest {
    private String username;
    private String password;
    private String email;
    private String nickname;
    /** 邮箱验证开启时必填：注册用途的一次性验证 proof，绑定目标邮箱。 */
    private String emailVerificationProof;
}
