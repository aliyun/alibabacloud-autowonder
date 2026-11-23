package com.aliyun.autowonder.email.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.Date;

/** 发码响应：不返回验证码，只返回挑战标识与时间点。 */
@Getter
@Setter
public class SendEmailCodeResponse {
    private String challengeId;
    private Date resendAt;
    private Date expiresAt;
}
