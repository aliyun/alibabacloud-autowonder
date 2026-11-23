package com.aliyun.autowonder.conversation;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.conversation.dto.ClarificationElicitationVO;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Durable settled questions, read independently from the conversation envelope. */
public final class ConversationQuestionHistory {
    private static final ObjectMapper JSON = new ObjectMapper();
    private ConversationQuestionHistory() {}
    public record Page(List<ClarificationElicitationVO> items, boolean hasMore, Long nextBeforeId, Long nextAfterId) {}
    @lombok.Data
    public static class Segment {
        private String message;
        private String requestedSchema;
        private String answerJson;
        private boolean hasMore;
        private String nextCursor;
    }

    public static Page page(AgentConversationElicitationDao dao, long tenantId, long conversationId,
            long turnId, Long beforeId, Long afterId) {
        if (turnId <= 0 || beforeId != null && (beforeId <= 0 || afterId != null)
                || afterId != null && afterId < 0) throw new BizException(ErrorCode.PARAM_INVALID);
        var rows = dao.listHistoryPage(tenantId, conversationId, turnId, beforeId, afterId, 21);
        var items = new ArrayList<>(rows.stream().limit(20).map(ClarificationElicitationVO::fromDelivery).toList());
        boolean more = rows.size() > 20;
        try {
            while (JSON.writeValueAsBytes(new Page(items, more, items.isEmpty() ? null : items.getFirst().getHistoryId(),
                    items.isEmpty() ? null : items.getLast().getHistoryId())).length > 240 * 1024) {
                if (items.size() <= 1) throw new BizException(ErrorCode.SYSTEM_BUSY);
                items.removeLast(); more = true;
            }
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalStateException(e); }
        if (beforeId != null) Collections.reverse(items);
        return new Page(items, more, items.isEmpty() ? null : items.getFirst().getHistoryId(),
                items.isEmpty() ? null : items.getLast().getHistoryId());
    }
    public static Segment content(AgentConversationElicitationDao dao, long tenantId, long conversationId,
            long turnId, long id, String cursor) {
        long index;
        try {
            index = cursor == null ? 0 : Long.parseLong(cursor);
            if (index < 0 || index > (Long.MAX_VALUE - 1) / 4096 || id <= 0 || turnId <= 0) throw new NumberFormatException();
        } catch (NumberFormatException e) { throw new BizException(ErrorCode.PARAM_INVALID); }
        var segment = dao.findHistoryContentSegment(tenantId, conversationId, turnId, id, index * 4096 + 1);
        if (segment == null) throw new BizException(ErrorCode.NOT_FOUND);
        segment.setNextCursor(segment.isHasMore() ? Long.toString(index + 1) : null);
        return segment;
    }
}
