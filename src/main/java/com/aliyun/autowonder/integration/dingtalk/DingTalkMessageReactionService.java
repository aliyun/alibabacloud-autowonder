package com.aliyun.autowonder.integration.dingtalk;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class DingTalkMessageReactionService {

    private static final Logger log = LoggerFactory.getLogger(DingTalkMessageReactionService.class);

    /** Candidate acknowledgements posted right after an @ message; one is picked per message. */
    static final List<String> ACK_EMOTIONS = List.of(
            "🤔思考中", "👀收到", "⚡加速中", "📥已收到", "🔍处理中");

    private final DingTalkBindingService bindingService;
    private final DingTalkOutboundSender sender;

    public DingTalkMessageReactionService(DingTalkBindingService bindingService,
            DingTalkOutboundSender sender) {
        this.bindingService = bindingService;
        this.sender = sender;
    }

    public void markReceived(DingtalkRobotBindingDO binding, String openConversationId,
            String openMsgId) {
        if (binding == null || isBlank(openConversationId) || isBlank(openMsgId)) {
            return;
        }
        String emotion = ackEmotionFor(openMsgId);
        try {
            DingTalkBindingService.EffectiveIdentity identity =
                    bindingService.effectiveIdentity(binding);
            sender.replyReceivedEmotion(identity.appKey(), identity.secret(), identity.baseUrl(),
                    identity.robotCode(), openConversationId, openMsgId, emotion,
                    System.currentTimeMillis());
            log.info("dingtalk ack reaction added robotCode={} conversationId={} msgId={} emotion={}",
                    identity.robotCode(), openConversationId, openMsgId, emotion);
        } catch (Exception e) {
            log.warn("dingtalk ack reaction add failed robotCode={} conversationId={} msgId={}: {}",
                    binding.getRobotCode(), openConversationId, openMsgId, e.getMessage());
        }
    }

    public void recallReceived(DingtalkRobotBindingDO binding, String openConversationId,
            String openMsgId) {
        if (binding == null || isBlank(openConversationId) || isBlank(openMsgId)) {
            return;
        }
        String emotion = ackEmotionFor(openMsgId);
        try {
            DingTalkBindingService.EffectiveIdentity identity =
                    bindingService.effectiveIdentity(binding);
            sender.recallReceivedEmotion(identity.appKey(), identity.secret(), identity.baseUrl(),
                    identity.robotCode(), openConversationId, openMsgId, emotion,
                    System.currentTimeMillis());
            log.info("dingtalk ack reaction recalled robotCode={} conversationId={} msgId={}",
                    identity.robotCode(), openConversationId, openMsgId);
        } catch (Exception e) {
            log.warn("dingtalk ack reaction recall failed robotCode={} conversationId={} msgId={}: {}",
                    binding.getRobotCode(), openConversationId, openMsgId, e.getMessage());
        }
    }

    /** Stable per message so reply and recall carry the same emotion without extra state. */
    static String ackEmotionFor(String openMsgId) {
        return ACK_EMOTIONS.get(Math.floorMod(openMsgId.hashCode(), ACK_EMOTIONS.size()));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
