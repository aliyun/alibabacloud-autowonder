package com.aliyun.autowonder.email;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * SMTP 发信适配的失败路径：本机 1 号端口拒绝连接，连接阶段即失败，
 * 用于覆盖三种加密方式与免认证分支，不发起真实投递。
 */
class SmtpMailSenderTest {

    private final SmtpMailSender sender = new SmtpMailSender();

    private MailConfig config(String security, String authMode) {
        MailConfig config = new MailConfig();
        config.setHost("127.0.0.1");
        config.setPort(1);
        config.setSecurity(security);
        config.setFromAddress("noreply@example.com");
        config.setFromName("AutoWonder");
        config.setAuthMode(authMode);
        if (MailConfig.AUTH_PASSWORD.equals(authMode)) {
            config.setUsername("noreply@example.com");
        }
        return config;
    }

    @Test
    void startTlsDeliveryFailureIsWrapped() {
        assertThrows(SmtpMailSender.MailDeliveryException.class,
                () -> sender.send(config(MailConfig.SECURITY_STARTTLS, MailConfig.AUTH_PASSWORD),
                        "secret", "tester@example.com", "subject", "body"));
    }

    @Test
    void sslDeliveryFailureIsWrapped() {
        assertThrows(SmtpMailSender.MailDeliveryException.class,
                () -> sender.send(config(MailConfig.SECURITY_SSL, MailConfig.AUTH_PASSWORD),
                        "secret", "tester@example.com", "subject", "body"));
    }

    @Test
    void unauthenticatedRelayFailureIsWrapped() {
        assertThrows(SmtpMailSender.MailDeliveryException.class,
                () -> sender.send(config(MailConfig.SECURITY_NONE, MailConfig.AUTH_NONE),
                        null, "tester@example.com", "subject", "body"));
    }
}
