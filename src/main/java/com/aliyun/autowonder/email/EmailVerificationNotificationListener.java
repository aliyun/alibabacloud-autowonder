package com.aliyun.autowonder.email;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.email.event.EmailVerificationBroadcastRequestedEvent;
import com.aliyun.autowonder.notification.NotifyEvent;
import com.aliyun.autowonder.notification.NotifyService;
import com.aliyun.autowonder.notification.NotificationScope;
import com.aliyun.autowonder.user.UserDO;
import com.aliyun.autowonder.user.UserDao;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.List;

/**
 * 强制存量验证开启通知：平台范围、仅站内渠道，接收者按各自 ui.locale 渲染。
 * 通知失败不影响已经生效的强制策略；单用户失败不阻塞其他接收者。
 */
@Component
public class EmailVerificationNotificationListener {

    private static final Logger LOGGER = LoggerFactory.getLogger(EmailVerificationNotificationListener.class);

    static final String TYPE_EMAIL_VERIFICATION_REQUIRED = "EMAIL_VERIFICATION_REQUIRED";
    static final String LINK = "/email-verification";

    private final EmailVerificationNoticeDao noticeDao;
    private final UserDao userDao;
    private final NotifyService notifyService;
    private final EmailVerificationPolicyService policyService;

    public EmailVerificationNotificationListener(EmailVerificationNoticeDao noticeDao, UserDao userDao,
                                                 NotifyService notifyService,
                                                 EmailVerificationPolicyService policyService) {
        this.noticeDao = noticeDao;
        this.userDao = userDao;
        this.notifyService = notifyService;
        this.policyService = policyService;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = false)
    public void onBroadcast(EmailVerificationBroadcastRequestedEvent event) {
        try {
            dispatch(event.policyVersion());
        } catch (Exception e) {
            LOGGER.error("email verification broadcast failed policyVersion={}", event.policyVersion(), e);
        }
    }

    /** 按策略版本去重后向未验证存量用户发送通知；失败计数写入事件行便于补偿。 */
    public void dispatch(long policyVersion) {
        dispatch(policyVersion, true);
    }

    private void dispatch(long policyVersion, boolean dedupe) {
        if (dedupe) {
            if (noticeDao.insertIfAbsent(policyVersion) != 1) {
                LOGGER.info("email verification broadcast already sent policyVersion={}", policyVersion);
                return;
            }
        } else {
            // 人工重放保留去重行与历史，仅确保该版本存在记录行以便更新本次计数。
            noticeDao.insertIfAbsent(policyVersion);
        }
        List<UserDO> recipients = userDao.listUnverifiedActiveUsers();
        int failures = 0;
        for (UserDO user : recipients) {
            try {
                notifyService.notify(buildEvent(user.getId()));
            } catch (Exception e) {
                failures++;
                LOGGER.warn("email verification notification failed policyVersion={} userId={}",
                        policyVersion, user.getId(), e);
            }
        }
        noticeDao.updateCounts(policyVersion, recipients.size(), failures);
        LOGGER.info("email verification broadcast done policyVersion={} recipients={} failures={}",
                policyVersion, recipients.size(), failures);
    }

    /**
     * 人工补偿入口：对仍处于有效范围内的策略版本重新通知当前未验证用户。
     * 保留原有去重记录与历史，仅覆盖写入本次发送计数；仅平台管理员可触发。
     */
    public void replay(long policyVersion) {
        long currentVersion = policyService.getPolicy().getVersion();
        if (policyVersion <= 0 || policyVersion > currentVersion) {
            throw BizException.keyed(ErrorCode.PARAM_INVALID, "email.policy_version_invalid",
                    new Object[]{policyVersion, currentVersion},
                    "policyVersion " + policyVersion + " out of range 1.." + currentVersion);
        }
        dispatch(policyVersion, false);
    }

    private NotifyEvent buildEvent(Long recipientId) {
        NotifyEvent event = new NotifyEvent();
        event.setTenantId(0L);
        event.setScope(NotificationScope.PLATFORM);
        event.setType(TYPE_EMAIL_VERIFICATION_REQUIRED);
        event.setTitle("平台要求验证邮箱");
        event.setTitleKey("notification.email_verification_required.title");
        event.setContent("平台已要求验证邮箱。完成验证前，已登录会话、个人令牌及自动化访问将受限。");
        event.setContentKey("notification.email_verification_required.content");
        event.setLink(LINK);
        event.setRefType(TYPE_EMAIL_VERIFICATION_REQUIRED);
        event.setRefId(recipientId);
        event.setRecipientIds(List.of(recipientId));
        return event;
    }
}
