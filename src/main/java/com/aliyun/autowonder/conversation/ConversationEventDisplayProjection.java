package com.aliyun.autowonder.conversation;

import com.aliyun.autowonder.json.JSON;

import java.util.List;
import java.util.Locale;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Turns raw provider slices into a channel-correct public projection and UTF-8 bounded segments.
 *
 * <p>Platform conversations keep the existing sanitising rules; clarification and PRD keep their
 * authorised original text so the summary never silently deletes content the user may read.
 */
public final class ConversationEventDisplayProjection {

    public enum Rejection {
        TOO_LARGE, NOT_JSON, TOO_DEEP, TOO_MANY_TOKENS, UNAVAILABLE
    }

    public static final class RejectedException extends RuntimeException {
        private final Rejection rejection;

        RejectedException(Rejection rejection, String message) {
            super(message);
            this.rejection = rejection;
        }

        public Rejection getRejection() {
            return rejection;
        }
    }

    public record Prepared(String text, List<String> segments, String summary,
            boolean truncated, boolean detailAvailable, int bytes) {
    }

    private ConversationEventDisplayProjection() {
    }

    public static Prepared prepare(String channel, String eventType, String raw) {
        if (ConversationEventDisplayBudget.utf8Length(raw) > ConversationEventDisplayBudget.MAX_EVENT_BYTES) {
            throw new RejectedException(Rejection.TOO_LARGE, "raw event exceeds 32MiB");
        }
        String projected = project(channel, eventType, raw);
        int bytes = ConversationEventDisplayBudget.utf8Length(projected);
        if (bytes > ConversationEventDisplayBudget.MAX_EVENT_BYTES) {
            throw new RejectedException(Rejection.TOO_LARGE, "projected event exceeds 32MiB");
        }
        if (isPlatform(channel) && needsJsonCheck(eventType)) {
            ConversationEventJsonStructure.Verdict verdict = ConversationEventJsonStructure.inspect(raw);
            switch (verdict) {
                case TOO_DEEP -> throw new RejectedException(Rejection.TOO_DEEP, "event nesting exceeds 20");
                case TOO_MANY_TOKENS -> throw new RejectedException(Rejection.TOO_MANY_TOKENS, "event tokens exceed 200000");
                case NOT_JSON -> throw new RejectedException(Rejection.NOT_JSON, "event payload is not valid JSON");
                default -> { }
            }
        }
        boolean detailAvailable = bytes > ConversationEventDisplayBudget.MAX_SUMMARY_BYTES;
        // Small events keep their exact projected text so legacy-style rendering still works from
        // the summary page alone; large ones get the deterministic collapsed summary.
        String summary = detailAvailable
                ? ConversationEventDisplayBudget.summarize(projected)
                : projected;
        List<String> segments = semanticSegments(eventType, projected == null ? "" : projected);
        return new Prepared(projected, segments, summary, detailAvailable, detailAvailable, bytes);
    }

    /** Each segment is a complete JSON value, so a browser can render it before the next arrives. */
    private static List<String> semanticSegments(String eventType, String projected) {
        String field = "raw";
        String text = projected;
        Map<String, Object> metadata = new LinkedHashMap<>();
        try {
            Object value = JSON.parse(projected);
            if (value instanceof Map<?, ?> object) {
                for (var entry : object.entrySet()) metadata.put(String.valueOf(entry.getKey()), entry.getValue());
                String candidate = switch (eventType == null ? "" : eventType) {
                    case "text", "text_delta", "thinking", "thinking_delta" -> "content";
                    case "tool_result" -> "output";
                    case "tool_use" -> "input";
                    default -> "raw";
                };
                if (!"raw".equals(candidate) && metadata.get(candidate) != null) {
                    Object body = metadata.remove(candidate);
                    field = candidate;
                    text = body instanceof String string ? string : JSON.toJSONString(body);
                }
                if (ConversationEventDisplayBudget.encodedLength(metadata) > 2048 || "raw".equals(field)) {
                    field = "raw";
                    text = projected;
                    // Arbitrary/nested metadata is preserved in raw text, never copied to every frame.
                    metadata.clear();
                    for (String key : List.of("type", "tool", "callId", "status")) {
                        Object item = object.get(key);
                        if (item instanceof String string && string.length() <= 256) metadata.put(key, string);
                    }
                }
            }
        } catch (RuntimeException ignored) {
            // Authorised non-JSON provider text remains readable verbatim.
        }
        Map<String, Object> frame = new LinkedHashMap<>();
        frame.put("type", "display_content");
        frame.put("eventType", eventType == null ? "unknown" : eventType);
        frame.put("field", field);
        frame.put("metadata", metadata);
        frame.put("text", "");
        int available = ConversationEventDisplayBudget.MAX_SEGMENT_CONTENT_BYTES
                - ConversationEventDisplayBudget.encodedLength(frame);
        List<String> segments = new ArrayList<>();
        int start = 0;
        do {
            int end = start;
            int encodedBytes = 0;
            while (end < text.length()) {
                int cp = text.codePointAt(end);
                // Jackson escapes JSON controls, backslash and quotes; Unicode stays UTF-8.
                int width = cp == '"' || cp == '\\' || cp == '\n' || cp == '\r'
                        || cp == '\t' || cp == '\b' || cp == '\f' ? 2
                        : cp < 32 ? 6 : cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
                if (encodedBytes + width > available) break;
                encodedBytes += width;
                end += Character.charCount(cp);
            }
            if (end == start && start < text.length()) {
                throw new RejectedException(Rejection.UNAVAILABLE, "event metadata exceeds segment budget");
            }
            frame.put("text", text.substring(start, end));
            String encoded = JSON.toJSONString(frame);
            if (ConversationEventDisplayBudget.utf8Length(encoded)
                    > ConversationEventDisplayBudget.MAX_SEGMENT_CONTENT_BYTES) {
                throw new RejectedException(Rejection.UNAVAILABLE, "semantic segment exceeds budget");
            }
            segments.add(encoded);
            start = end;
        } while (start < text.length());
        return segments;
    }

    public static String project(String channel, String eventType, String raw) {
        String type = eventType == null ? "" : eventType;
        if (isPlatform(channel)) {
            return PlatformEventProjection.payloadFull(type, raw);
        }
        if (raw == null) {
            return "";
        }
        // Clarification and PRD keep their authorised original content; only plain text is escaped
        // by the renderer, never executed as HTML.
        return raw;
    }

    private static boolean isPlatform(String channel) {
        return channel != null && PlatformConversationChannel.CHANNEL.equalsIgnoreCase(channel);
    }

    private static boolean needsJsonCheck(String eventType) {
        if (eventType == null) {
            return false;
        }
        String type = eventType.toLowerCase(Locale.ROOT);
        return !(type.equals("text") || type.equals("text_delta")
                || type.equals("thinking") || type.equals("thinking_delta"));
    }

    static boolean isJson(String value) {
        if (value == null || value.isBlank()) {
            return false;
        }
        try {
            JSON.parse(value);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }
}
