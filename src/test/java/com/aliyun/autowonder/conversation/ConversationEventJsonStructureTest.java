package com.aliyun.autowonder.conversation;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ConversationEventJsonStructureTest {

    @Test
    void acceptsAWellFormedPayload() {
        assertEquals(ConversationEventJsonStructure.Verdict.OK,
                ConversationEventJsonStructure.inspect("{\"a\":[1,true,null,{\"b\":\"x\"}]}"));
    }

    @Test
    void rejectsNonJson() {
        assertEquals(ConversationEventJsonStructure.Verdict.NOT_JSON,
                ConversationEventJsonStructure.inspect("not json at all {"));
        assertEquals(ConversationEventJsonStructure.Verdict.NOT_JSON,
                ConversationEventJsonStructure.inspect(""));
    }

    @Test
    void rejectsTooDeepNesting() {
        String deep = "[".repeat(ConversationEventDisplayBudget.MAX_STRUCTURE_DEPTH + 2)
                + "]".repeat(ConversationEventDisplayBudget.MAX_STRUCTURE_DEPTH + 2);
        assertEquals(ConversationEventJsonStructure.Verdict.TOO_DEEP,
                ConversationEventJsonStructure.inspect(deep));
    }

    @Test
    void rejectsTooManyTokens() {
        StringBuilder wide = new StringBuilder("{");
        for (int i = 0; i < ConversationEventDisplayBudget.MAX_STRUCTURE_TOKENS; i++) {
            wide.append("\"k").append(i).append("\":1,");
        }
        wide.append("\"end\":1}");
        assertEquals(ConversationEventJsonStructure.Verdict.TOO_MANY_TOKENS,
                ConversationEventJsonStructure.inspect(wide.toString()));
    }

    @Test
    void ignoresBracesInsideStrings() {
        assertEquals(ConversationEventJsonStructure.Verdict.OK,
                ConversationEventJsonStructure.inspect("{\"text\":\"[[[[{{{{\"}"));
    }

    @Test
    void handlesEscapedQuotesInsideStrings() {
        assertEquals(ConversationEventJsonStructure.Verdict.OK,
                ConversationEventJsonStructure.inspect("{\"text\":\"a\\\"b\"}"));
    }

    @Test
    void rejectsUnterminatedStringsAndNegativeDepth() {
        assertEquals(ConversationEventJsonStructure.Verdict.NOT_JSON,
                ConversationEventJsonStructure.inspect("{\"text\":\"unterminated"));
        assertEquals(ConversationEventJsonStructure.Verdict.NOT_JSON,
                ConversationEventJsonStructure.inspect("}"));
    }

    @Test
    void rejectsStrayCharactersOutsideStrings() {
        assertEquals(ConversationEventJsonStructure.Verdict.NOT_JSON,
                ConversationEventJsonStructure.inspect("{\"a\":@}"));
    }

    @Test
    void acceptsNumbersBooleansAndExponents() {
        assertEquals(ConversationEventJsonStructure.Verdict.OK,
                ConversationEventJsonStructure.inspect("{\"a\":-1.5e10,\"b\":true,\"c\":null}"));
    }
}
