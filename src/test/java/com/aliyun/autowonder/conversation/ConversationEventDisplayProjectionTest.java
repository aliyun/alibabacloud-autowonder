package com.aliyun.autowonder.conversation;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConversationEventDisplayProjectionTest {

    @Test
    void largeTextSegmentsRenderWithoutReassemblingAJsonEnvelope() {
        String content = "开始🌏\n\"斜杠\\".repeat(4000);
        String raw = com.aliyun.autowonder.json.JSON.toJSONString(java.util.Map.of(
                "type", "text_delta", "content", content));
        var prepared = ConversationEventDisplayProjection.prepare("WORKITEM_CLARIFICATION", "text_delta", raw);
        StringBuilder received = new StringBuilder();
        for (String encoded : prepared.segments()) {
            var frame = com.aliyun.autowonder.json.JSON.parseObject(encoded);
            assertEquals("display_content", frame.getString("type"));
            assertEquals("content", frame.getString("field"));
            assertEquals("text_delta", frame.getString("eventType"));
            assertTrue(ConversationEventDisplayBudget.utf8Length(encoded) <= 16 * 1024);
            received.append(frame.getString("text"));
        }
        assertEquals(content, received.toString());
    }

    @Test
    void largeToolOutputSegmentsKeepTheCallIdentityAndFullOutput() {
        String output = "tool output\n".repeat(7000);
        String raw = com.aliyun.autowonder.json.JSON.toJSONString(java.util.Map.of(
                "type", "tool_result", "callId", "call-1", "output", output));
        var prepared = ConversationEventDisplayProjection.prepare("PRD", "tool_result", raw);
        StringBuilder received = new StringBuilder();
        for (String encoded : prepared.segments()) {
            var frame = com.aliyun.autowonder.json.JSON.parseObject(encoded);
            assertEquals("output", frame.getString("field"));
            assertEquals("call-1", frame.getJSONObject("metadata").getString("callId"));
            received.append(frame.getString("text"));
        }
        assertEquals(output, received.toString());
    }

    @Test
    void largeToolInputRetainsItsExactJsonValueAsDisplayText() {
        String raw = com.aliyun.autowonder.json.JSON.toJSONString(java.util.Map.of(
                "type", "tool_use", "callId", "call-2", "tool", "write_file",
                "input", java.util.Map.of("content", "abc".repeat(9000))));
        var prepared = ConversationEventDisplayProjection.prepare("PRD", "tool_use", raw);
        StringBuilder received = new StringBuilder();
        for (String encoded : prepared.segments()) {
            var frame = com.aliyun.autowonder.json.JSON.parseObject(encoded);
            assertEquals("input", frame.getString("field"));
            received.append(frame.getString("text"));
        }
        assertEquals("abc".repeat(9000), com.aliyun.autowonder.json.JSON.parseObject(
                received.toString()).getString("content"));
    }

    @Test
    void platformTextKeepsItsBody() {
        assertEquals("hello 世界", ConversationEventDisplayProjection.project(
                PlatformConversationChannel.CHANNEL, "text", "hello 世界"));
    }

    @Test
    void platformThinkingOnlyShowsStatus() {
        var projected = com.aliyun.autowonder.json.JSON.parseObject(
                ConversationEventDisplayProjection.project(
                        PlatformConversationChannel.CHANNEL, "thinking", "{\"content\":\"secret\"}"));
        assertEquals("status", projected.getString("type"));
        assertEquals("PROCESSING", projected.getString("status"));
        assertFalse(projected.containsKey("content"));
    }

    @Test
    void platformProjectionRedactsWithoutTheLegacyTwelveThousandCharacterCut() {
        String longTail = "word ".repeat(3000);
        String raw = "{\"output\":\"" + longTail + "\",\"password\":\"private-value\"}";

        String projected = ConversationEventDisplayProjection.project(
                PlatformConversationChannel.CHANNEL, "tool_result", raw);

        assertTrue(projected.length() > 12000);
        assertTrue(projected.contains("[REDACTED]"));
        assertFalse(projected.contains("private-value"));
    }

    @Test
    void clarificationKeepsItsAuthorisedOriginalContent() {
        String raw = "{\"content\":\"用户可见原文\"}";
        assertEquals(raw, ConversationEventDisplayProjection.project("WORKITEM_CLARIFICATION", "text", raw));
    }

    @Test
    void largeContentIsMarkedForDetailAndGetsABoundedSummary() {
        var prepared = ConversationEventDisplayProjection.prepare(
                "WORKITEM_CLARIFICATION", "tool_result", "x".repeat(40000));

        assertTrue(prepared.detailAvailable());
        assertTrue(prepared.truncated());
        assertTrue(ConversationEventDisplayBudget.utf8Length(prepared.summary())
                <= ConversationEventDisplayBudget.MAX_SUMMARY_BYTES);
        assertTrue(prepared.segments().size() > 1);
    }

    @Test
    void smallContentStaysInlineInTheSummaryPage() {
        var prepared = ConversationEventDisplayProjection.prepare(
                "WORKITEM_CLARIFICATION", "text", "short reply");

        assertFalse(prepared.detailAvailable());
        assertEquals("short reply", prepared.summary());
        assertEquals(1, prepared.segments().size());
    }

    @Test
    void evenAnInlineEventsContentEndpointUsesTheDeclaredSemanticVersion() {
        var prepared = ConversationEventDisplayProjection.prepare("PRD", "text", "short reply");
        var frame = com.aliyun.autowonder.json.JSON.parseObject(prepared.segments().get(0));
        assertEquals("display_content", frame.getString("type"));
        assertEquals("short reply", frame.getString("text"));
    }

    @Test
    void brokenPlatformJsonIsRejectedInsteadOfGuessing() {
        var error = assertThrows(ConversationEventDisplayProjection.RejectedException.class,
                () -> ConversationEventDisplayProjection.prepare(
                        PlatformConversationChannel.CHANNEL, "tool_result", "{not-json"));
        assertEquals(ConversationEventDisplayProjection.Rejection.NOT_JSON, error.getRejection());
    }

    @Test
    void tooDeepOrTooWidePayloadsAreRejectedWithTheirReason() {
        String deep = "[".repeat(ConversationEventDisplayBudget.MAX_STRUCTURE_DEPTH + 2)
                + "]".repeat(ConversationEventDisplayBudget.MAX_STRUCTURE_DEPTH + 2);
        assertEquals(ConversationEventDisplayProjection.Rejection.TOO_DEEP,
                assertThrows(ConversationEventDisplayProjection.RejectedException.class,
                        () -> ConversationEventDisplayProjection.prepare(
                                PlatformConversationChannel.CHANNEL, "tool_result", deep)).getRejection());

        StringBuilder wide = new StringBuilder("{");
        for (int i = 0; i < ConversationEventDisplayBudget.MAX_STRUCTURE_TOKENS; i++) {
            wide.append("\"k").append(i).append("\":1,");
        }
        wide.append("\"end\":1}");
        assertEquals(ConversationEventDisplayProjection.Rejection.TOO_MANY_TOKENS,
                assertThrows(ConversationEventDisplayProjection.RejectedException.class,
                        () -> ConversationEventDisplayProjection.prepare(
                                PlatformConversationChannel.CHANNEL, "tool_result", wide.toString())).getRejection());
    }

    @Test
    void nullPayloadBecomesAnEmptyPreparedBody() {
        var prepared = ConversationEventDisplayProjection.prepare(
                "WORKITEM_CLARIFICATION", "text", null);

        assertEquals("", prepared.text());
        assertEquals(1, prepared.segments().size());
        assertFalse(prepared.detailAvailable());
    }

    @Test
    void clarificationThinkingKeepsItsContent() {
        String raw = "{\"content\":\"thinking\"}";
        assertEquals(raw, ConversationEventDisplayProjection.project(
                "WORKITEM_CLARIFICATION", "thinking", raw));
    }

    @Test
    void platformHelpersCoverBothPayloadBranches() {
        assertEquals("hello", PlatformEventProjection.payloadFull("text", "hello"));
        assertTrue(PlatformEventProjection.payloadFull("tool_result", "{broken")
                .contains("[REDACTED]"));
        assertTrue(PlatformEventProjection.payloadFull("thinking_delta", "{}")
                .contains("PROCESSING"));
        org.junit.jupiter.api.Assertions.assertNull(
                PlatformEventProjection.payloadFull("tool_result", null));
    }

    @Test
    void unknownChannelAndNullEventTypeTakeThePreservingPath() {
        assertEquals("{\"a\":1}", ConversationEventDisplayProjection.project(null, "tool_result", "{\"a\":1}"));
        var prepared = ConversationEventDisplayProjection.prepare(null, null, "plain");
        assertEquals("plain", prepared.text());
        org.junit.jupiter.api.Assertions.assertNull(
                com.aliyun.autowonder.util.RuntimeActionSanitizer.sanitizeFull(null));
    }

    /** QA-B3：投影结果 UTF-8 超过 32MiB → TOO_LARGE，不静默截断。 */
    @Test
    void projectionOverThirtyTwoMebibytesIsRejectedAsTooLarge() {
        String oversized = "x".repeat((int) ConversationEventDisplayBudget.MAX_EVENT_BYTES + 1);

        var error = assertThrows(ConversationEventDisplayProjection.RejectedException.class,
                () -> ConversationEventDisplayProjection.prepare(
                        "WORKITEM_CLARIFICATION", "text", oversized));

        assertEquals(ConversationEventDisplayProjection.Rejection.TOO_LARGE, error.getRejection());
    }
}
