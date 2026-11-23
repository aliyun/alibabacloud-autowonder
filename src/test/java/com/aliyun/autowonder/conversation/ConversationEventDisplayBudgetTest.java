package com.aliyun.autowonder.conversation;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConversationEventDisplayBudgetTest {

    @Test
    void splitsOnUtf8BoundariesAndReassemblesExactly() {
        String text = "中文内容".repeat(5000) + "🙂tail";

        List<String> segments = ConversationEventDisplayBudget.splitUtf8(
                text, ConversationEventDisplayBudget.MAX_SEGMENT_CONTENT_BYTES);

        assertTrue(segments.size() > 1);
        for (String segment : segments) {
            assertTrue(ConversationEventDisplayBudget.utf8Length(segment)
                    <= ConversationEventDisplayBudget.MAX_SEGMENT_CONTENT_BYTES);
            assertFalse(segment.isEmpty());
        }
        assertEquals(text, String.join("", segments));
    }

    @Test
    void splitsSurrogatePairsWithoutBreakingThem() {
        String text = "🙂".repeat(10);
        List<String> segments = ConversationEventDisplayBudget.splitUtf8(text, 5);
        for (String segment : segments) {
            assertFalse(segment.isEmpty());
            assertTrue(segment.codePointCount(0, segment.length()) > 0);
        }
        assertEquals(text, String.join("", segments));
    }

    @Test
    void keepsEmptyContentAsOneSegment() {
        assertEquals(List.of(""), ConversationEventDisplayBudget.splitUtf8("", 16));
        assertEquals(List.of(""), ConversationEventDisplayBudget.splitUtf8(null, 16));
    }

    @Test
    void summaryStaysInsideTheTwoKilobyteBudget() {
        String summary = ConversationEventDisplayBudget.summarize("字".repeat(5000));
        assertTrue(ConversationEventDisplayBudget.utf8Length(summary)
                <= ConversationEventDisplayBudget.MAX_SUMMARY_BYTES);
        assertTrue(summary.endsWith("…"));
    }

    @Test
    void smallTextIsItsOwnSummaryWithoutCollapsing() {
        assertEquals("line1\nline2", ConversationEventDisplayBudget.summarize("line1\nline2"));
    }

    @Test
    void encodedLengthCountsJsonEscaping() {
        assertTrue(ConversationEventDisplayBudget.encodedLength("中")
                > ConversationEventDisplayBudget.utf8Length("中"));
    }

    @Test
    void truncationHandlesNullAndZeroBudgets() {
        assertNull(ConversationEventDisplayBudget.truncateUtf8(null, 10));
        assertEquals("", ConversationEventDisplayBudget.truncateUtf8("abc", 0));
        assertEquals("abc", ConversationEventDisplayBudget.truncateUtf8("abc", 3));
        assertEquals(0, ConversationEventDisplayBudget.utf8Length(null));
        assertEquals(0, ConversationEventDisplayBudget.encodedLength(null));
    }

    @Test
    void summarizeHandlesBlankContent() {
        assertEquals("", ConversationEventDisplayBudget.summarize("   "));
        assertNull(ConversationEventDisplayBudget.summarize(null));
    }
}
