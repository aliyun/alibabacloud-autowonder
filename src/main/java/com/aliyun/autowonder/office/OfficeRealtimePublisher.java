package com.aliyun.autowonder.office;

import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.redis.RedisManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class OfficeRealtimePublisher {
    public static final String CHANNEL_PREFIX = "office:";
    public static final String FRAME_TYPE = "office-activity-changed";
    private static final Logger log = LoggerFactory.getLogger(OfficeRealtimePublisher.class);
    private final RedisManager redis;

    public OfficeRealtimePublisher(RedisManager redis) {
        this.redis = redis;
    }

    /** Best effort only: the durable REST projection remains the source of truth. */
    public void publish(long workspaceId, String reason, Object sourceId) {
        if (workspaceId <= 0) return;
        String channel = CHANNEL_PREFIX + workspaceId;
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("reason", reason);
        payload.put("sourceId", sourceId);
        Map<String, Object> frame = new LinkedHashMap<>();
        frame.put("channel", channel);
        frame.put("type", FRAME_TYPE);
        frame.put("payload", payload);
        frame.put("timestamp", System.currentTimeMillis());
        try {
            redis.publish(channel, JSON.toJSONString(frame));
        } catch (RuntimeException failure) {
            log.warn("office realtime publish failed workspaceId={} reason={}: {}",
                    workspaceId, reason, failure.getMessage());
        }
    }
}
