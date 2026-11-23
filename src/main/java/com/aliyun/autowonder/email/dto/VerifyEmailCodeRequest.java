package com.aliyun.autowonder.email.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class VerifyEmailCodeRequest {
    private String purpose;
    private String email;
    private String challengeId;
    private String code;
}
