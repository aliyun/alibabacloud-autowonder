package com.aliyun.autowonder.auth.federation;

import com.aliyun.autowonder.im.ImProviderType;
import com.aliyun.autowonder.im.PlatformImChannelConfigService;
import com.aliyun.autowonder.im.UserImIdentityService;
import com.aliyun.autowonder.user.UserDao;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

/**
 * SSO 认证属性到内部账号资料的同步。
 * <ul>
 *   <li>飞书用户 ID：必须同时满足连接配置了属性名、认证结果携带非空值、平台当前消息通道为飞书。</li>
 *   <li>昵称/邮箱：仅在认证结果有有效非空映射值时覆盖，缺失保留原值；用户名不在此处修改。</li>
 * </ul>
 * 同步不参与登录核心事务：失败只记录脱敏日志，不影响登录或回滚账号绑定。
 */
@Service
public class SsoIdentityAttributeSyncService {
    private static final Logger log = LoggerFactory.getLogger(SsoIdentityAttributeSyncService.class);
    private static final int MAX_EXTERNAL_USER_ID_LENGTH = 256;
    private static final int MAX_NICKNAME_LENGTH = 64;
    private static final int MAX_EMAIL_LENGTH = 128;

    private final PlatformImChannelConfigService channelConfigService;
    private final UserImIdentityService userImIdentityService;
    private final UserDao userDao;

    public SsoIdentityAttributeSyncService(PlatformImChannelConfigService channelConfigService,
                                           UserImIdentityService userImIdentityService,
                                           UserDao userDao) {
        this.channelConfigService = channelConfigService;
        this.userImIdentityService = userImIdentityService;
        this.userDao = userDao;
    }

    /** 核心建号/绑定事务提交后调用；任何异常都被吞掉，避免阻断登录。 */
    public void syncFeishu(Long userId, FederationConnectionDO connection, ExternalIdentity identity) {
        if (userId == null || connection == null || identity == null) {
            return;
        }
        String claim = trimToNull(connection.getFeishuUserIdClaim());
        String value = trimToNull(identity.feishuUserId());
        if (claim == null || value == null) {
            return;
        }
        try {
            if (!ImProviderType.FEISHU.getKey().equals(channelConfigService.selectedProvider())) {
                return;
            }
            if (value.length() > MAX_EXTERNAL_USER_ID_LENGTH) {
                log.warn("sso identity sync skipped userId={} claim={} reason=value_too_long", userId, claim);
                return;
            }
            userImIdentityService.update(userId, ImProviderType.FEISHU.getKey(), value, userId);
            log.info("sso identity sync completed userId={} provider=FEISHU claim={} source=sso", userId, claim);
        } catch (RuntimeException e) {
            // 不输出原始断言、令牌或完整飞书 ID，只留可诊断的异常类型。
            log.warn("sso identity sync failed userId={} provider=FEISHU claim={} source=sso error={}",
                    userId, claim, e.getClass().getSimpleName());
        }
    }

    /**
     * 已有账号（原绑定或按用户名匹配）后续登录的资料同步：昵称、邮箱有非空映射值才覆盖，
     * 缺失保留；邮箱被其他账号占用时不合并、不抢占，保留原值并记录诊断。
     */
    public void syncProfile(Long userId, ExternalIdentity identity) {
        if (userId == null || identity == null) {
            return;
        }
        String nickname = normalizeNickname(identity.displayName());
        if (nickname != null) {
            try {
                userDao.updateNickname(userId, nickname);
            } catch (RuntimeException e) {
                log.warn("sso profile sync failed userId={} field=nickname error={}",
                        userId, e.getClass().getSimpleName());
            }
        }
        String email = normalizeEmail(userId, identity.email());
        if (email != null) {
            try {
                userDao.updateEmail(userId, email);
            } catch (DuplicateKeyException e) {
                log.warn("sso profile sync skipped userId={} field=email reason=email_conflict", userId);
            } catch (RuntimeException e) {
                log.warn("sso profile sync failed userId={} field=email error={}",
                        userId, e.getClass().getSimpleName());
            }
        }
    }

    private static String normalizeNickname(String value) {
        String trimmed = trimToNull(value);
        if (trimmed == null) {
            return null;
        }
        return trimmed.length() > MAX_NICKNAME_LENGTH ? trimmed.substring(0, MAX_NICKNAME_LENGTH) : trimmed;
    }

    private static String normalizeEmail(Long userId, String value) {
        String trimmed = trimToNull(value);
        if (trimmed == null) {
            return null;
        }
        if (trimmed.length() > MAX_EMAIL_LENGTH) {
            // 截断会产生一个错误的收件地址，宁可跳过并留下诊断。
            log.warn("sso profile sync skipped userId={} field=email reason=value_too_long", userId);
            return null;
        }
        return trimmed;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
