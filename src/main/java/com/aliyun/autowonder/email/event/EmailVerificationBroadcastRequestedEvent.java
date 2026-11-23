package com.aliyun.autowonder.email.event;

/** 强制存量验证从关闭切换为开启：事务提交后向仍未验证的存量用户发送平台通知。 */
public record EmailVerificationBroadcastRequestedEvent(long policyVersion) {
}
