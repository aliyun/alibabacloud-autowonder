package com.aliyun.autowonder.websocket;

import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.json.JSONObject;
import com.aliyun.autowonder.auth.jwt.JwtService;
import com.aliyun.autowonder.auth.jwt.TokenPayload;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.websocket.CloseReason;
import javax.websocket.OnClose;
import javax.websocket.OnError;
import javax.websocket.OnMessage;
import javax.websocket.OnOpen;
import javax.websocket.Session;
import javax.websocket.server.ServerEndpoint;
import java.util.concurrent.ConcurrentHashMap;

@ServerEndpoint("/ws")
public class BrowserRealtimeEndpoint {

    private static final Logger log = LoggerFactory.getLogger(BrowserRealtimeEndpoint.class);
    private static final ConcurrentHashMap<Session, Long> SESSION_WORKSPACES = new ConcurrentHashMap<>();

    private volatile boolean authenticated = false;

    @OnOpen
    public void onOpen(Session session) {
        log.info("browser realtime connected sessionId={}", session.getId());
    }

    @OnMessage
    public void onMessage(String message, Session session) {
        try {
            JSONObject frame = JSON.parseObject(message);
            if (frame == null) {
                closeQuietly(session, "invalid frame");
                return;
            }
            String type = frame.getString("type");

            if (!authenticated) {
                if (!"auth".equals(type)) {
                    closeQuietly(session, "auth required");
                    return;
                }
                handleAuth(frame, session);
                return;
            }

            switch (type != null ? type : "") {
                case "subscribe":
                    handleSubscribe(frame, session);
                    break;
                case "unsubscribe":
                    handleUnsubscribe(frame, session);
                    break;
                default:
                    log.debug("browser realtime unknown frame type sessionId={} type={}", session.getId(), type);
                    break;
            }
        } catch (Exception e) {
            log.warn("browser realtime message failed sessionId={}", session.getId(), e);
        }
    }

    private void handleAuth(JSONObject frame, Session session) {
        String token = frame.getString("token");
        if (token == null || token.isBlank()) {
            closeQuietly(session, "missing token");
            return;
        }
        JwtService jwtService = WsSpringContext.getBean(JwtService.class);
        TokenPayload payload = jwtService.parse(token);
        if (payload.getCurrentWorkspaceId() == null) {
            closeQuietly(session, "missing workspace");
            return;
        }
        long workspaceId = payload.getCurrentWorkspaceId();
        long userId = payload.getUserId() != null ? payload.getUserId() : 0L;
        // 长连接不能绕过邮箱验证门禁：鉴权时立即校验当前策略，并按原因区分关闭语义。
        switch (emailGate(userId)) {
            case UNKNOWN_USER -> {
                closeQuietly(session, "unknown user");
                return;
            }
            case VERIFICATION_REQUIRED -> {
                closeQuietly(session, "email verification required");
                return;
            }
            default -> {
            }
        }
        SESSION_WORKSPACES.put(session, workspaceId);
        authenticated = true;

        BrowserRealtimeSubscriberManager subscriberManager =
                WsSpringContext.getBean(BrowserRealtimeSubscriberManager.class);
        subscriberManager.recordPrincipal(session, workspaceId, userId);

        log.info("browser realtime authenticated sessionId={} workspaceId={} userId={}",
                session.getId(), workspaceId, userId);
    }

    /** 区分「未知用户」与「需要邮箱验证」，避免把鉴权失败误报成验证拦截。 */
    private EmailGate emailGate(long userId) {
        if (userId <= 0) {
            return EmailGate.UNKNOWN_USER;
        }
        com.aliyun.autowonder.user.UserDO user =
                WsSpringContext.getBean(com.aliyun.autowonder.user.UserDao.class).findById(userId);
        if (user == null) {
            return EmailGate.UNKNOWN_USER;
        }
        com.aliyun.autowonder.email.EmailVerificationPolicyService policy =
                WsSpringContext.getBean(com.aliyun.autowonder.email.EmailVerificationPolicyService.class);
        return policy.requiresVerification(user) ? EmailGate.VERIFICATION_REQUIRED : EmailGate.PASS;
    }

    private enum EmailGate {
        PASS, UNKNOWN_USER, VERIFICATION_REQUIRED
    }

    private void handleSubscribe(JSONObject frame, Session session) {
        String channel = frame.getString("channel");
        if (channel == null || channel.isBlank()) {
            return;
        }
        BrowserRealtimeSubscriberManager subscriberManager =
                WsSpringContext.getBean(BrowserRealtimeSubscriberManager.class);
        BrowserRealtimeAuthorizationService authService =
                WsSpringContext.getBean(BrowserRealtimeAuthorizationService.class);

        BrowserRealtimeSubscriberManager.PrincipalInfo principal = subscriberManager.getPrincipal(session);
        if (principal == null) {
            return;
        }
        // 业务动作边界重新检查：策略变更后既有长连接不继续读取数据。
        EmailGate gate = emailGate(principal.getUserId());
        if (gate != EmailGate.PASS) {
            log.warn("browser subscription denied sessionId={} userId={} reason={}",
                    session.getId(), principal.getUserId(), gate);
            return;
        }
        if (!authService.authorize(principal.getTenantId(), principal.getUserId(), channel)) {
            log.warn("browser subscription denied sessionId={} workspaceId={} userId={} channel={}",
                    session.getId(), principal.getTenantId(), principal.getUserId(), channel);
            return;
        }
        subscriberManager.addSubscription(session, channel);
    }

    private void handleUnsubscribe(JSONObject frame, Session session) {
        String channel = frame.getString("channel");
        if (channel == null || channel.isBlank()) {
            return;
        }
        BrowserRealtimeSubscriberManager subscriberManager =
                WsSpringContext.getBean(BrowserRealtimeSubscriberManager.class);
        subscriberManager.removeSubscription(session, channel);
    }

    @OnClose
    public void onClose(Session session) {
        SESSION_WORKSPACES.remove(session);
        BrowserRealtimeSubscriberManager subscriberManager =
                WsSpringContext.safeGetBean(BrowserRealtimeSubscriberManager.class);
        if (subscriberManager != null) {
            subscriberManager.removeSession(session);
        }
        log.info("browser realtime disconnected sessionId={}", session.getId());
    }

    @OnError
    public void onError(Session session, Throwable error) {
        if (session != null) {
            SESSION_WORKSPACES.remove(session);
            BrowserRealtimeSubscriberManager subscriberManager =
                    WsSpringContext.safeGetBean(BrowserRealtimeSubscriberManager.class);
            if (subscriberManager != null) {
                subscriberManager.removeSession(session);
            }
            log.warn("browser realtime error sessionId={}", session.getId(), error);
        } else {
            log.warn("browser realtime error", error);
        }
    }

    static void broadcast(long workspaceId, String frameJson) {
        BrowserRealtimeSubscriberManager subscriberManager =
                WsSpringContext.safeGetBean(BrowserRealtimeSubscriberManager.class);
        if (subscriberManager == null) return;
        for (Session session : SESSION_WORKSPACES.keySet()) {
            if (!session.isOpen()) {
                SESSION_WORKSPACES.remove(session);
                continue;
            }
            Long sessionWorkspaceId = SESSION_WORKSPACES.get(session);
            if (sessionWorkspaceId == null || sessionWorkspaceId != workspaceId) {
                continue;
            }
            subscriberManager.deliverToSession(session, frameJson);
        }
    }

    private static void closeQuietly(Session session, String reason) {
        try {
            SESSION_WORKSPACES.remove(session);
            session.close(new CloseReason(CloseReason.CloseCodes.VIOLATED_POLICY, reason));
        } catch (Exception ignore) {}
    }
}
