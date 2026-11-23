package com.aliyun.autowonder.user.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.Date;

@Getter
@Setter
public class LoginResponse {
    private Long userId;
    private String accessToken;
    private String refreshToken;
    private UserVO user;
    /** 普通会话为 null；需要先验证邮箱时为 EMAIL_VERIFICATION，此时只下发受限凭证。 */
    private String sessionPurpose;
    /** 15 分钟受限验证凭证；不能刷新成普通会话。 */
    private String restrictedToken;
    private Date restrictedExpiresAt;

    public LoginResponse(Long userId, String accessToken, String refreshToken, UserVO user) {
        this.userId = userId;
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        this.user = user;
    }
}
