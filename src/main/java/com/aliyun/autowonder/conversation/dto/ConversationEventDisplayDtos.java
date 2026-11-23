package com.aliyun.autowonder.conversation.dto;

import java.util.List;

/** Bounded DTOs for the event summary and segmented content endpoints. */
public final class ConversationEventDisplayDtos {

    private ConversationEventDisplayDtos() {
    }

    public record SummaryItem(long eventId, String eventType, int dispatchAttempt, long eventSeq,
            String occurredAt, String state, boolean truncated, boolean detailAvailable,
            String summary, Long contentLength, Integer totalSegments, String payload,
            String projectionVersion, Long revision) {
    }

    public record SummaryPage(List<SummaryItem> items, Long nextCursor, boolean hasMore,
            String preparationStatus, String projectionVersion, int pendingCount, int failedCount,
            Long retryAfterMs, Long publicationWatermark) {
    }

    public record ContentSegment(long eventId, String content, int segmentIndex, Long previousCursor,
            Long nextCursor, boolean hasMore, String projectionVersion, String state,
            Long retryAfterMs) {
    }
}
