package com.aliyun.autowonder.artifact;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class EventLogArchiveTest {

    private static String sha256(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    private static byte[] decode(byte[] input, long maxBytes) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        EventLogArchive.decode(new ByteArrayInputStream(input), output, maxBytes);
        return output.toByteArray();
    }

    private static byte[] decode(String input) throws Exception {
        return decode(input.getBytes(StandardCharsets.UTF_8), 1 << 20);
    }

    private static String line(String record) {
        return record + "\n";
    }

    private static String toolRecord(String body, String extras) throws Exception {
        return line("{\"$awEvents\":\"tool\",\"id\":\"" + sha256(body) + "\",\"body\":\"" + body + "\"" + extras + "}");
    }

    @Test
    void reconstructsPlainMessageAndToolRecordsAndResetsDictionary() throws Exception {
        String body = "x".repeat(1024);
        String compact = line("{\"$awEvents\":\"messages\",\"template\":[\"a\",\"b\",\"c\"],\"rows\":[[\"x\",\"y\"]]}")
                + toolRecord(body, ",\"prefix\":\"<\",\"suffix\":\">\"")
                + line("{\"$awEvents\":\"reset\"}")
                + line("plain diagnostic line");
        String expected = "axbyc<" + body + ">plain diagnostic line\n";
        assertArrayEquals(expected.getBytes(StandardCharsets.UTF_8), decode(compact));
        assertThrows(IllegalArgumentException.class,
                () -> decode(compact + line("{\"$awEvents\":\"tool\",\"id\":\"" + sha256(body) + "\"}")));
    }

    @Test
    void emptyInputProducesNoBytes() throws Exception {
        assertArrayEquals(new byte[0], decode(new byte[0], 1 << 20));
    }

    @Test
    void rejectsDecodedInputBeyondDeclaredBudgetAndInvalidReadLine() {
        assertThrows(IllegalArgumentException.class,
                () -> decode(line("0123456789").getBytes(StandardCharsets.UTF_8), 5));
        assertThrows(IllegalArgumentException.class, () -> decode("plain\rdiagnostics\n"));
        assertThrows(IllegalArgumentException.class, () -> decode("{\"a\":1}"));
    }

    @Test
    void rejectsMalformedMessageTemplatesAndRows() {
        for (String record : List.of(
                "{\"$awEvents\":\"messages\",\"rows\":[[\"a\"]]}",
                "{\"$awEvents\":\"messages\",\"template\":\"x\",\"rows\":[[\"a\"]]}",
                "{\"$awEvents\":\"messages\",\"template\":[\"a\"],\"rows\":[[\"a\"]]}",
                "{\"$awEvents\":\"messages\",\"template\":[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\",\"g\",\"h\"],\"rows\":[[\"a\"]]}",
                "{\"$awEvents\":\"messages\",\"template\":[\"a\",\"b\"]}",
                "{\"$awEvents\":\"messages\",\"template\":[\"a\",\"b\"],\"rows\":{}}",
                "{\"$awEvents\":\"messages\",\"template\":[\"a\",\"b\"],\"rows\":[]}",
                "{\"$awEvents\":\"messages\",\"template\":[\"a\",\"b\"],\"rows\":[[\"a\",\"b\"]]}",
                "{\"$awEvents\":\"messages\",\"template\":[\"a\",\"b\"],\"rows\":[5]}",
                "{\"$awEvents\":\"messages\",\"template\":[\"a\",5],\"rows\":[[\"b\"]]}",
                "{\"$awEvents\":5}",
                "{\"$awEvents\":\"future\"}",
                "{\"$awEvents\":")) {
            assertThrows(IllegalArgumentException.class, () -> decode(record), record);
        }
        StringBuilder manyRows = new StringBuilder("{\"$awEvents\":\"messages\",\"template\":[\"a\",\"b\"],\"rows\":[");
        for (int i = 0; i < 129; i++) {
            manyRows.append(i == 0 ? "[\"b\"]" : ",[\"b\"]");
        }
        manyRows.append("]}");
        assertThrows(IllegalArgumentException.class, () -> decode(manyRows.toString()));
    }

    @Test
    void rejectsToolBodiesViolatingDictionaryRules() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> decode(line("{\"$awEvents\":\"tool\",\"id\":\""
                + "z".repeat(64) + "\",\"body\":\"" + "z".repeat(1024) + "\"}")));
        assertThrows(IllegalArgumentException.class,
                () -> decode(toolRecord("y".repeat(100), "")));
        String body = "w".repeat(2048);
        String record = toolRecord(body, ",\"prefix\":\"p\",\"suffix\":\"s\"");
        assertThrows(IllegalArgumentException.class, () -> decode(record + record));
    }

    @Test
    void rejectsDictionaryOverBodyCountAndByteLimits() throws Exception {
        String extras = ",\"prefix\":\"p\",\"suffix\":\"s\"";
        StringBuilder overCount = new StringBuilder();
        for (int i = 0; i < 1025; i++) {
            String body = String.format(java.util.Locale.ROOT, "%05d", i) + "b".repeat(1019);
            overCount.append(toolRecord(body, extras));
        }
        assertThrows(IllegalArgumentException.class, () -> decode(overCount.toString()));

        StringBuilder overBytes = new StringBuilder();
        for (int i = 0; i < 17; i++) {
            String body = String.valueOf((char) ('a' + i)).repeat(1 << 20);
            overBytes.append(toolRecord(body, extras));
        }
        assertThrows(IllegalArgumentException.class, () -> decode(overBytes.toString()));
    }
}
