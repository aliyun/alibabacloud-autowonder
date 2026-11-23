package com.aliyun.autowonder.email.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class SendEmailCodeRequest {
    private String purpose;
    private String email;
}
