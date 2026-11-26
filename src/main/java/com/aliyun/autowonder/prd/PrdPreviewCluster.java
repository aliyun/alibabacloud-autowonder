package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.redis.RedisManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.List;
import java.util.UUID;

/** Shared ownership and short-lived data handshake routes. Payloads stay off Redis. */
@Component
class PrdPreviewCluster {
    static final long LEASE_MS = PrdPreviewRelay.HEARTBEAT_MS;
    private static final int DATA_ROUTE_SECONDS = 8;
    private static final Logger log = LoggerFactory.getLogger(PrdPreviewCluster.class);
    private static final String RENEW = """
            if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
            redis.call('psetex', KEYS[1], ARGV[3], ARGV[2])
            return 1
            """;
    static final String HANDOFF = "X-Autowonder-Preview-Handoff";

    record Owner(String node, String generation, boolean ready) {
        String value() { return node + ":" + generation + ":" + (ready ? "1" : "0"); }
        Owner withReady(boolean next) { return new Owner(node, generation, next); }
    }

    private final PrdReviewPreviewProperties properties;
    private final RedisManager redis;

    PrdPreviewCluster(PrdReviewPreviewProperties properties, RedisManager redis) {
        this.properties = properties;
        this.redis = redis;
    }

    boolean enabled() { return properties.getCluster().isEnabled(); }
    boolean local(Owner owner) { return properties.getCluster().getNode().equals(owner.node()); }
    URI peer(Owner owner) { return properties.getCluster().getPeers().get(owner.node()); }

    Owner acquire(String bindingId) {
        var candidate = new Owner(properties.getCluster().getNode(), UUID.randomUUID().toString(), false);
        return redis.tryAcquireLock(ownerKey(bindingId), candidate.value(), LEASE_MS) ? candidate : null;
    }

    boolean renew(String bindingId, Owner previous, Owner current) {
        return Long.valueOf(1).equals(redis.eval(RENEW, List.of(ownerKey(bindingId)),
                List.of(previous.value(), current.value(), Long.toString(LEASE_MS))));
    }

    void release(String bindingId, Owner owner) {
        try {
            redis.releaseLock(ownerKey(bindingId), owner.value());
        } catch (RuntimeException unavailable) {
            // The lease expires on its own, including when the instance or Redis connection disappears.
            log.debug("Preview owner release failed for {}", bindingId, unavailable);
        }
    }

    Owner owner(String bindingId) { return read(ownerKey(bindingId)); }

    void publishStream(String streamId, Owner owner) {
        redis.setWithExpire(streamKey(streamId), owner.value(), DATA_ROUTE_SECONDS);
    }

    Owner routeStream(String streamId) {
        return streamId.matches("[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}") ? read(streamKey(streamId)) : null;
    }

    private Owner read(String key) {
        try {
            String value = redis.getString(key);
            if (value == null) return null;
            String[] parts = value.split(":", -1);
            if (parts.length != 3 || !parts[1].matches("[0-9a-f-]{36}") || !List.of("0", "1").contains(parts[2])) return null;
            var owner = new Owner(parts[0], parts[1], "1".equals(parts[2]));
            return local(owner) || peer(owner) != null ? owner : null;
        } catch (RuntimeException unavailable) {
            log.debug("Preview ownership lookup failed", unavailable);
            return null;
        }
    }

    String recoveryKey(String binding, String session) { return key("recover:", binding + ":" + session); }

    private String ownerKey(String id) { return key("owner:", id); }
    private String streamKey(String id) { return key("stream:", id); }
    private String key(String type, String id) {
        return "prd:preview:" + properties.getCluster().getNamespace() + ":" + type + id;
    }
}
