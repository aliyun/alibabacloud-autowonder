package com.aliyun.autowonder.user.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class UpdateProfileRequest {
    private String nickname;
    private String email;
    private String phone;
    /** 修改邮箱时携带的一次性验证 proof；未改邮箱时不要求。 */
    private String emailVerificationProof;
}
