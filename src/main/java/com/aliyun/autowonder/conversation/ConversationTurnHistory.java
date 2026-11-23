package com.aliyun.autowonder.conversation;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.function.Function;

/** UI-only history reads; never materializes a complete persisted message. */
public final class ConversationTurnHistory {
    private static final com.fasterxml.jackson.databind.ObjectMapper JSON =
            new com.fasterxml.jackson.databind.ObjectMapper();
    private static final int PAGE_BUDGET = 240 * 1024;
    private ConversationTurnHistory() {}
    public record Page<T>(List<T> items, boolean hasMore, Long nextBeforeTurnId, Long nextAfterTurnId) {
        public Page(List<T> items, boolean hasMore, Long nextBeforeTurnId) {
            this(items, hasMore, nextBeforeTurnId, null);
        }
        public <R> Page<R> map(Function<T, R> mapper) {
            return bounded(new Page<>(items.stream().map(mapper).toList(), hasMore, nextBeforeTurnId, nextAfterTurnId));
        }
    }
    public record ContentSegment(String content, long segmentIndex, String nextCursor, boolean hasMore) {}

    public static Page<AgentConversationTurnDO> page(AgentConversationTurnDao dao, Long tenantId,
            Long conversationId, Long beforeTurnId, Integer requestedLimit, boolean prd) {
        return page(dao, tenantId, conversationId, beforeTurnId, null, requestedLimit, prd);
    }

    public static Page<AgentConversationTurnDO> page(AgentConversationTurnDao dao, Long tenantId,
            Long conversationId, Long beforeTurnId, Long afterTurnId, Integer requestedLimit, boolean prd) {
        if (beforeTurnId != null && beforeTurnId <= 0) throw new BizException(ErrorCode.PARAM_INVALID);
        if (afterTurnId != null && (afterTurnId <= 0 || beforeTurnId != null)) throw new BizException(ErrorCode.PARAM_INVALID);
        int limit = requestedLimit == null ? 50 : Math.max(1, Math.min(50, requestedLimit));
        List<AgentConversationTurnDO> fetched = new ArrayList<>(afterTurnId == null
                ? dao.listHistoryPage(tenantId, conversationId, beforeTurnId, limit + 1, prd)
                : dao.listHistoryAfterPage(tenantId, conversationId, afterTurnId, limit + 1, prd));
        var order = java.util.Comparator.comparing(AgentConversationTurnDO::getId);
        fetched.sort(afterTurnId == null ? order.reversed() : order);
        List<AgentConversationTurnDO> rows = new ArrayList<>(fetched.subList(0, Math.min(limit, fetched.size())));
        boolean hasMore = fetched.size() > limit;
        for (var row : rows) {
            String content = row.getContent();
            String preview = preview(content);
            row.setContentHasMore(row.isContentHasMore() || !java.util.Objects.equals(content, preview));
            row.setContent(preview);
        }
        Long next = hasMore && !rows.isEmpty() ? rows.get(rows.size() - 1).getId() : null;
        if (afterTurnId == null) Collections.reverse(rows);
        return bounded(new Page<>(rows, hasMore, afterTurnId == null ? next : null,
                afterTurnId == null ? null : rows.isEmpty() ? afterTurnId : rows.getLast().getId()));
    }

    /** Remove whole oldest items only: the next keyset request returns every omitted item. */
    public static <T> Page<T> bounded(Page<T> page) {
        return envelope(page, Function.identity());
    }

    public static <T, R> R envelope(Page<T> page, Function<Page<T>, R> render) {
        var items = new ArrayList<>(page.items());
        boolean more = page.hasMore();
        Long next = page.nextBeforeTurnId();
        Long after = page.nextAfterTurnId();
        try {
            while (JSON.writeValueAsBytes(render.apply(new Page<>(items, more, next, after))).length > PAGE_BUDGET) {
                if (items.size() <= 1) throw new BizException(ErrorCode.SYSTEM_BUSY);
                if (after == null) items.removeFirst(); else items.removeLast();
                more = true;
                if (after == null) next = JSON.valueToTree(items.getFirst()).path("id").longValue();
                else after = JSON.valueToTree(items.getLast()).path("id").longValue();
            }
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("Cannot serialize bounded conversation history", e);
        }
        return render.apply(new Page<>(items, more, next, after));
    }

    static String preview(String content) {
        if (content == null) return null;
        int end = 0, bytes = 0;
        while (end < content.length()) {
            int cp = content.codePointAt(end);
            int length = new String(Character.toChars(cp)).getBytes(StandardCharsets.UTF_8).length;
            if (bytes + length > 2048) break;
            bytes += length;
            end += Character.charCount(cp);
        }
        return content.substring(0, end);
    }

    public static ContentSegment content(AgentConversationTurnDao dao, Long tenantId, Long conversationId,
            Long turnId, String cursor, boolean prd) {
        long index;
        try {
            index = cursor == null ? 0 : Long.parseLong(cursor);
            if (index < 0 || index > (Long.MAX_VALUE - 1) / 4096) throw new NumberFormatException();
        } catch (NumberFormatException e) { throw new BizException(ErrorCode.PARAM_INVALID); }
        var row = dao.findHistoryContentSegment(tenantId, conversationId, turnId, index * 4096 + 1, prd);
        if (row == null) throw new BizException(ErrorCode.NOT_FOUND);
        return new ContentSegment(row.getContent(), index, row.isContentHasMore() ? Long.toString(index + 1) : null,
                row.isContentHasMore());
    }
}
