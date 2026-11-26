package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.redis.RedisManager;
import com.aliyun.autowonder.websocket.PresenceManager;
import com.aliyun.autowonder.websocket.SessionRegistry;
import com.aliyun.autowonder.websocket.WsDispatchTransport;
import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Service
public class PrdPreviewRecovery {
    private static final String FEATURE = "PRD_PREVIEW_RECOVERY_V2";
    private final SessionRegistry sessions;
    private final PresenceManager presence;
    private final PrdPreviewCluster cluster;
    private final RedisManager redis;
    private final Cache<String, Long> attempts = CacheBuilder.newBuilder()
            .maximumSize(1024)
            .expireAfterWrite(60, TimeUnit.SECONDS)
            .build();

    PrdPreviewRecovery(SessionRegistry sessions, PresenceManager presence, PrdPreviewCluster cluster, RedisManager redis) {
        this.sessions = sessions;
        this.presence = presence;
        this.cluster = cluster;
        this.redis = redis;
    }

    boolean supports(long executorId) {
        return presence.supportsProtocolFeature(executorId, FEATURE);
    }

    String ensure(PrdReviewPreviewProperties.Binding binding, PrdDesignRuntimeDO runtime) {
        if (cluster.enabled()) return ensureCluster(binding, runtime);
        var session = sessions.findByExecutorId(binding.getExecutorId());
        if (session == null || !session.getSession().isOpen() || session.getTenantId() != binding.getWorkspaceId()) {
            return "EXECUTOR_OFFLINE";
        }
        if (!supports(binding.getExecutorId())) {
            return "RECOVERY_UNSUPPORTED";
        }
        String attempt = binding.getId() + ":" + session.getSession().getId() + bootstrapSuffix(runtime);
        long now = System.nanoTime();
        Long previous = attempts.asMap().putIfAbsent(attempt, now);
        if (previous != null) {
            return now - previous >= TimeUnit.SECONDS.toNanos(40) ? "RECOVERY_TIMEOUT" : "RECOVERING";
        }
        try {
            session.sendText(JSON.toJSONString(frame(binding, runtime)));
            return "RECOVERING";
        } catch (IOException unavailable) {
            attempts.invalidate(attempt);
            return "EXECUTOR_OFFLINE";
        }
    }

    private String ensureCluster(PrdReviewPreviewProperties.Binding binding, PrdDesignRuntimeDO runtime) {
        String key = null;
        String attempt = Long.toString(System.currentTimeMillis());
        try {
            long executor = binding.getExecutorId();
            if (!presence.isExecutorOnline(executor)) return "EXECUTOR_OFFLINE";
            if (!supports(executor)) return "RECOVERY_UNSUPPORTED";
            String sessionId = presence.currentSessionId(executor);
            if (sessionId == null) return "EXECUTOR_OFFLINE";
            var local = sessions.findByExecutorId(executor);
            boolean ownsSession = local != null && local.getSession().isOpen()
                    && sessionId.equals(local.getSession().getId());
            if (ownsSession && local.getTenantId() != binding.getWorkspaceId()) return "EXECUTOR_OFFLINE";
            key = cluster.recoveryKey(binding.getId(), sessionId) + bootstrapSuffix(runtime);
            if (!redis.tryAcquireLock(key, attempt, 60_000L)) {
                String previous = redis.getString(key);
                return previous != null && System.currentTimeMillis() - Long.parseLong(previous) >= 40_000
                        ? "RECOVERY_TIMEOUT" : "RECOVERING";
            }
            var command = frame(binding, runtime);
            if (ownsSession) {
                local.sendText(JSON.toJSONString(command));
            } else {
                command.put("executorId", executor);
                command.put("sessionId", sessionId);
                redis.publish(WsDispatchTransport.BROADCAST_CHANNEL, JSON.toJSONString(command));
            }
            return "RECOVERING";
        } catch (IOException | RuntimeException unavailable) {
            if (key != null) try { redis.releaseLock(key, attempt); } catch (RuntimeException ignored) {}
            return "EXECUTOR_OFFLINE";
        }
    }

    private static String bootstrapSuffix(PrdDesignRuntimeDO runtime) {
        return Long.valueOf(0L).equals(runtime.getTurnId()) ? ":bootstrap:" + runtime.getDispatchAttempt() : "";
    }

    static Map<String, Object> frame(PrdReviewPreviewProperties.Binding binding, PrdDesignRuntimeDO runtime) {
        var command = new HashMap<String, Object>(Map.of("type", "PRD_PREVIEW_ENSURE", "bindingId", binding.getId(),
                "workspaceId", binding.getWorkspaceId(), "workitemId", binding.getWorkitemId(),
                "conversationId", binding.getConversationId(), "sourceKey", binding.getSourceKey(),
                "port", runtime.getPort() == null ? 0 : runtime.getPort()));
        if (Long.valueOf(0L).equals(runtime.getTurnId())) command.put("bootstrapAttempt",runtime.getDispatchAttempt());
        if (runtime.getDirectory() != null) command.put("directory", runtime.getDirectory());
        return command;
    }
}
