package com.aliyun.autowonder.email;

import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

import javax.mail.internet.MimeMessage;
import java.util.Properties;

/**
 * 受限的 SMTP 发信适配：有限连接/读写超时，TLS 校验证书与主机名，
 * STARTTLS 强制升级不允许静默降级，免认证模式不发送残留凭据。
 */
@Component
public class SmtpMailSender {

    private static final int TIMEOUT_MILLIS = 10_000;

    public void send(MailConfig config, String secret, String recipient, String subject, String body) {
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost(config.getHost());
        sender.setPort(config.getPort());
        sender.setDefaultEncoding("UTF-8");

        boolean authenticating = MailConfig.AUTH_PASSWORD.equals(config.getAuthMode());
        Properties properties = sender.getJavaMailProperties();
        properties.put("mail.transport.protocol", "smtp");
        properties.put("mail.smtp.connectiontimeout", String.valueOf(TIMEOUT_MILLIS));
        properties.put("mail.smtp.timeout", String.valueOf(TIMEOUT_MILLIS));
        properties.put("mail.smtp.writetimeout", String.valueOf(TIMEOUT_MILLIS));
        properties.put("mail.smtp.auth", String.valueOf(authenticating));
        // 证书与主机名校验保持默认开启；不提供跳过校验的开关。
        properties.put("mail.smtp.ssl.checkserveridentity", "true");
        if (MailConfig.SECURITY_STARTTLS.equals(config.getSecurity())) {
            properties.put("mail.smtp.starttls.enable", "true");
            properties.put("mail.smtp.starttls.required", "true");
        } else if (MailConfig.SECURITY_SSL.equals(config.getSecurity())) {
            properties.put("mail.smtp.ssl.enable", "true");
        }
        if (authenticating) {
            sender.setUsername(config.getUsername());
            sender.setPassword(secret);
        }

        try {
            MimeMessage message = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, false, "UTF-8");
            if (config.getFromName() == null || config.getFromName().isBlank()) {
                helper.setFrom(config.getFromAddress());
            } else {
                helper.setFrom(config.getFromAddress(), config.getFromName());
            }
            helper.setTo(recipient);
            helper.setSubject(subject);
            helper.setText(body, false);
            sender.send(message);
        } catch (Exception e) {
            throw new MailDeliveryException(e);
        }
    }

    /** 发信失败统一包装，调用方只读取脱敏分类，不向上暴露 SMTP 原始错误。 */
    public static class MailDeliveryException extends RuntimeException {
        public MailDeliveryException(Throwable cause) {
            super("mail delivery failed", cause);
        }
    }
}
