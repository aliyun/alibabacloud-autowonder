package com.aliyun.autowonder.prd;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
class PrdReviewTunnelProbeTest {
    @Test void reflectsDisconnectAndRecoveryImmediatelyWithoutCachedReady() {
        var relay=mock(PrdPreviewRelay.class); var binding=new PrdReviewPreviewProperties.Binding();
        var probe=new PrdReviewTunnelProbe(relay);
        when(relay.available(binding)).thenReturn(true,false,true);
        assertTrue(probe.available(binding)); assertFalse(probe.available(binding)); assertTrue(probe.available(binding));
    }
}
