package com.aliyun.autowonder.email.dto;

import com.aliyun.autowonder.user.dto.LoginResponse;
import lombok.Getter;
import lombok.Setter;

/**
 * 校验响应：注册/个人中心返回一次性 proof；受限页返回重新签发的正常会话。
 * 两者互斥，未使用的一侧为 null。
 */
@Getter
@Setter
public class VerifyEmailCodeResponse {
    private String proof;
    private LoginResponse session;
}
