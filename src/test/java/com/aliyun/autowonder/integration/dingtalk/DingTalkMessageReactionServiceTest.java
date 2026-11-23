package com.aliyun.autowonder.integration.dingtalk;

import java.util.HashSet;
import java.util.Set;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class DingTalkMessageReactionServiceTest {

    private final DingTalkBindingService bindings = mock(DingTalkBindingService.class);
    private final DingTalkOutboundSender sender = mock(DingTalkOutboundSender.class);
    private final DingTalkMessageReactionService service =
            new DingTalkMessageReactionService(bindings, sender);

    @Test
    void skipsNullBindingAndBlankTargets() {
        service.markReceived(null, "conv", "m-1");
        service.recallReceived(null, "conv", "m-1");

        var legacy = binding("LEGACY");
        service.markReceived(legacy, " ", "m-1");
        service.markReceived(legacy, "conv", " ");
        service.recallReceived(legacy, " ", "m-1");
        service.recallReceived(legacy, "conv", "");
        service.markReceived(legacy, null, "m-1");
        service.recallReceived(legacy, "conv", null);

        verifyNoInteractions(sender);
        verify(bindings, never()).effectiveIdentity(any());
    }

    @Test
    void deliversReactionsWithTheResolvedIdentityForLegacyAndSharedBindings() {
        var legacy = binding("LEGACY");
        var shared = binding("SHARED");
        when(bindings.effectiveIdentity(legacy)).thenReturn(
                new DingTalkBindingService.EffectiveIdentity("ak", "rc", "https://gw", "sk"));
        when(bindings.effectiveIdentity(shared)).thenReturn(
                new DingTalkBindingService.EffectiveIdentity("live-ak", "live-rc",
                        "https://live-gw", "live-sk"));
        String emotion = DingTalkMessageReactionService.ackEmotionFor("m-1");

        service.markReceived(legacy, "conv", "m-1");
        service.recallReceived(legacy, "conv", "m-1");
        service.markReceived(shared, "conv", "m-1");
        service.recallReceived(shared, "conv", "m-1");

        verify(sender).replyReceivedEmotion(eq("ak"), eq("sk"), eq("https://gw"), eq("rc"),
                eq("conv"), eq("m-1"), eq(emotion), anyLong());
        verify(sender).recallReceivedEmotion(eq("ak"), eq("sk"), eq("https://gw"), eq("rc"),
                eq("conv"), eq("m-1"), eq(emotion), anyLong());
        // A shared row keeps only its creation-time identity, so the live config values must win.
        verify(sender).replyReceivedEmotion(eq("live-ak"), eq("live-sk"), eq("https://live-gw"),
                eq("live-rc"), eq("conv"), eq("m-1"), eq(emotion), anyLong());
        verify(sender).recallReceivedEmotion(eq("live-ak"), eq("live-sk"), eq("https://live-gw"),
                eq("live-rc"), eq("conv"), eq("m-1"), eq(emotion), anyLong());
    }

    @Test
    void swallowsProviderFailuresForReplyAndRecall() {
        var legacy = binding("LEGACY");
        when(bindings.effectiveIdentity(legacy)).thenReturn(
                new DingTalkBindingService.EffectiveIdentity("ak", "rc", "https://gw", "sk"));
        doThrow(new IllegalStateException("provider down")).when(sender)
                .replyReceivedEmotion(anyString(), anyString(), anyString(), anyString(),
                        anyString(), anyString(), anyString(), anyLong());
        doThrow(new IllegalStateException("provider down")).when(sender)
                .recallReceivedEmotion(anyString(), anyString(), anyString(), anyString(),
                        anyString(), anyString(), anyString(), anyLong());

        service.markReceived(legacy, "conv", "m-2");
        service.recallReceived(legacy, "conv", "m-2");

        verify(sender).replyReceivedEmotion(eq("ak"), eq("sk"), eq("https://gw"), eq("rc"),
                eq("conv"), eq("m-2"), anyString(), anyLong());
        verify(sender).recallReceivedEmotion(eq("ak"), eq("sk"), eq("https://gw"), eq("rc"),
                eq("conv"), eq("m-2"), anyString(), anyLong());
    }

    @Test
    void skipsReactionWhenIdentityResolutionFails() {
        var shared = binding("SHARED");
        doThrow(new IllegalStateException("live config missing"))
                .when(bindings).effectiveIdentity(shared);

        service.markReceived(shared, "conv", "m-3");
        service.recallReceived(shared, "conv", "m-3");

        verifyNoInteractions(sender);
    }

    @Test
    void picksOneCandidatePerMessageAndVariesAcrossMessages() {
        String first = DingTalkMessageReactionService.ackEmotionFor("m-1");
        assertTrue(DingTalkMessageReactionService.ACK_EMOTIONS.contains(first));
        assertEquals(first, DingTalkMessageReactionService.ackEmotionFor("m-1"));

        Set<String> seen = new HashSet<>();
        for (int i = 0; i < 100; i++) {
            String emotion = DingTalkMessageReactionService.ackEmotionFor("msg-" + i);
            assertTrue(DingTalkMessageReactionService.ACK_EMOTIONS.contains(emotion));
            seen.add(emotion);
        }
        assertTrue(seen.size() > 1);
    }

    private static DingtalkRobotBindingDO binding(String mode) {
        var binding = new DingtalkRobotBindingDO();
        binding.setId(7L);
        binding.setTenantId(1L);
        binding.setAgentId(3L);
        binding.setStatus("ENABLED");
        binding.setBindingMode(mode);
        binding.setAppKey("ak");
        binding.setRobotCode("rc");
        binding.setBaseUrl("https://gw");
        return binding;
    }
}
