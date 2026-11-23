package com.aliyun.autowonder.conversation;

import com.aliyun.autowonder.json.JSON;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** First-version engineering budgets for bounded event display. All sizes are UTF-8 bytes. */
public final class ConversationEventDisplayBudget {

    public static final String PROJECTION_VERSION = "v2-semantic";

    public static final int MAX_LIST_ITEMS = 100;
    public static final int MAX_SUMMARY_BYTES = 2048;
    public static final int MAX_LIST_RESPONSE_BYTES = 256 * 1024;
    public static final int MAX_SEGMENT_CONTENT_BYTES = 16 * 1024;
    public static final int MAX_SEGMENT_RESPONSE_BYTES = 128 * 1024;
    public static final int MAX_STATUS_RESPONSE_BYTES = 8 * 1024;
    public static final long MAX_EVENT_BYTES = 32L * 1024 * 1024;

    public static final int MAX_STRUCTURE_DEPTH = 20;
    public static final int MAX_STRUCTURE_TOKENS = 200_000;
    public static final int MAX_CHUNKS = 4096;

    public static final int WORKER_BATCH = 20;
    public static final int CHUNK_BATCH = 32;
    public static final int MAX_PREPARE_ATTEMPTS = 3;
    public static final long RETRY_DELAY_MS = 30_000L;
    public static final long LEASE_MS = 120_000L;
    public static final long MISSING_CHUNK_FAILED_MS = 300_000L;

    public static final int NOTIFICATION_MAX_BYTES = 8192;
    public static final String DISPLAY_AVAILABLE_TYPE = "CONVERSATION_EVENT_DISPLAY_AVAILABLE";

    /** Legacy entries keep their shape only while the whole array stays inside this budget. */
    public static final int LEGACY_RESPONSE_BYTES = MAX_LIST_RESPONSE_BYTES - MAX_STATUS_RESPONSE_BYTES;

    private static final String ELLIPSIS = "…";

    private ConversationEventDisplayBudget() {
    }

    public static int utf8Length(String value) {
        return value == null ? 0 : value.getBytes(StandardCharsets.UTF_8).length;
    }

    public static int encodedLength(Object value) {
        return value == null ? 0 : utf8Length(JSON.toJSONString(value));
    }

    /** Cuts on a code point boundary so no UTF-8 character is split. */
    public static String truncateUtf8(String value, int maxBytes) {
        if (value == null) {
            return null;
        }
        if (maxBytes <= 0) {
            return "";
        }
        if (utf8Length(value) <= maxBytes) {
            return value;
        }
        int bytes = 0;
        int index = 0;
        while (index < value.length()) {
            int codePoint = value.codePointAt(index);
            int width = utf8Width(codePoint);
            if (bytes + width > maxBytes) {
                break;
            }
            bytes += width;
            index += Character.charCount(codePoint);
        }
        return value.substring(0, index);
    }

    /** Splits public content into UTF-8 bounded slices without breaking surrogate pairs. */
    public static List<String> splitUtf8(String value, int maxBytesPerSegment) {
        List<String> segments = new ArrayList<>();
        if (value == null || value.isEmpty()) {
            segments.add("");
            return segments;
        }
        int limit = maxBytesPerSegment <= 0 ? MAX_SEGMENT_CONTENT_BYTES : maxBytesPerSegment;
        int start = 0;
        while (start < value.length()) {
            int end = start;
            int bytes = 0;
            while (end < value.length()) {
                int codePoint = value.codePointAt(end);
                int width = utf8Width(codePoint);
                if (bytes + width > limit && end > start) {
                    break;
                }
                bytes += width;
                end += Character.charCount(codePoint);
            }
            if (end == start) {
                end = start + Character.charCount(value.codePointAt(start));
            }
            segments.add(value.substring(start, end));
            start = end;
        }
        return segments;
    }

    private static int utf8Width(int codePoint) {
        if (codePoint < 0x80) {
            return 1;
        }
        if (codePoint < 0x800) {
            return 2;
        }
        if (codePoint < 0x10000) {
            return 3;
        }
        return 4;
    }

    /** Deterministic summary: small text kept verbatim, long text collapsed and cut to 2KiB. */
    public static String summarize(String value) {
        if (value == null) {
            return null;
        }
        if (value.isBlank()) {
            return "";
        }
        if (utf8Length(value) <= MAX_SUMMARY_BYTES) {
            return value;
        }
        String collapsed = value.replaceAll("\\s+", " ").trim();
        int budget = MAX_SUMMARY_BYTES - utf8Length(ELLIPSIS);
        return truncateUtf8(collapsed, budget).stripTrailing() + ELLIPSIS;
    }
}
