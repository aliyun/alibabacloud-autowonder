package com.aliyun.autowonder.prd;
import org.springframework.stereotype.Component;
/** Compatibility name for callers; readiness is live relay registration, never a cached external route. */
@Component
public class PrdReviewTunnelProbe {
    private final PrdPreviewRelay relay;
    public PrdReviewTunnelProbe(PrdPreviewRelay relay) { this.relay=relay; }
    public boolean available(PrdReviewPreviewProperties.Binding binding) { return relay.available(binding); }
    public String status(PrdReviewPreviewProperties.Binding binding) { return relay.status(binding); }
}
