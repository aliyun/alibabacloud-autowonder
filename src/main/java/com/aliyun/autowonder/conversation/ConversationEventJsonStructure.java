package com.aliyun.autowonder.conversation;

/**
 * Streaming structural guard for large provider payloads.
 *
 * <p>Runs before {@code JSON.parse} so a deeply nested or absurdly wide payload is rejected
 * without first materialising an object graph.
 */
public final class ConversationEventJsonStructure {

    public enum Verdict {
        OK, NOT_JSON, TOO_DEEP, TOO_MANY_TOKENS
    }

    private ConversationEventJsonStructure() {
    }

    public static Verdict inspect(String json) {
        if (json == null || json.isBlank()) {
            return Verdict.NOT_JSON;
        }
        int depth = 0;
        int tokens = 0;
        boolean inString = false;
        boolean escaped = false;
        for (int i = 0; i < json.length(); i++) {
            char ch = json.charAt(i);
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch == '\\') {
                    escaped = true;
                } else if (ch == '"') {
                    inString = false;
                    tokens++;
                }
                continue;
            }
            switch (ch) {
                case '"' -> inString = true;
                case '{', '[' -> {
                    depth++;
                    tokens++;
                    if (depth > ConversationEventDisplayBudget.MAX_STRUCTURE_DEPTH) {
                        return Verdict.TOO_DEEP;
                    }
                    if (tokens > ConversationEventDisplayBudget.MAX_STRUCTURE_TOKENS) {
                        return Verdict.TOO_MANY_TOKENS;
                    }
                }
                case '}', ']' -> {
                    depth--;
                    if (depth < 0) {
                        return Verdict.NOT_JSON;
                    }
                    if (++tokens > ConversationEventDisplayBudget.MAX_STRUCTURE_TOKENS) {
                        return Verdict.TOO_MANY_TOKENS;
                    }
                }
                case ',', ':' -> {
                    if (++tokens > ConversationEventDisplayBudget.MAX_STRUCTURE_TOKENS) {
                        return Verdict.TOO_MANY_TOKENS;
                    }
                }
                default -> {
                    if (!Character.isWhitespace(ch) && ch != '-' && ch != '+'
                            && ch != '.' && ch != 'e' && ch != 'E'
                            && (ch < '0' || ch > '9')
                            && !Character.isJavaIdentifierPart(ch)) {
                        return Verdict.NOT_JSON;
                    }
                }
            }
        }
        if (inString || depth != 0) {
            return Verdict.NOT_JSON;
        }
        return Verdict.OK;
    }
}
