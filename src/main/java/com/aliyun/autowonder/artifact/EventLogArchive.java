package com.aliyun.autowonder.artifact;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;

/** Reconstructs the original JSONL bytes, rather than reserializing parsed events. */
final class EventLogArchive {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int DICTIONARY_BYTES = 16 << 20;

    static void decode(InputStream input, OutputStream output, long maxBytes) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8));
        Map<String, String> bodies = new HashMap<>();
        long inputBytes = 0;
        int bodyBytes = 0;
        String line;
        while ((line = readLine(reader)) != null) {
            inputBytes += line.getBytes(StandardCharsets.UTF_8).length + 1L;
            if (inputBytes > maxBytes) throw invalid();
            if (!line.startsWith("{\"$awEvents\":")) {
                write(output, line + "\n");
                continue;
            }
            JsonNode record;
            try {
                record = JSON.readTree(line);
            } catch (IOException failure) {
                throw invalid();
            }
            switch (text(record.get("$awEvents"))) {
                case "messages" -> {
                    JsonNode template = record.get("template");
                    JsonNode rows = record.get("rows");
                    if (template == null || !template.isArray() || template.size() < 2 || template.size() > 7
                            || rows == null || !rows.isArray() || rows.isEmpty() || rows.size() > 128) throw invalid();
                    for (JsonNode row : rows) {
                        if (!row.isArray() || row.size() + 1 != template.size()) throw invalid();
                        for (int i = 0; i < row.size(); i++) {
                            write(output, text(template.get(i)));
                            write(output, text(row.get(i)));
                        }
                        write(output, text(template.get(template.size() - 1)));
                    }
                }
                case "tool" -> {
                    String id = text(record.get("id"));
                    if (!id.matches("[a-f0-9]{64}")) throw invalid();
                    if (record.has("body")) {
                        String body = text(record.get("body"));
                        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                        if (bytes.length < 1024 || bytes.length > 1 << 20 || bodies.containsKey(id)
                                || bodies.size() >= 1024 || bodyBytes + bytes.length > DICTIONARY_BYTES
                                || !id.equals(sha256(bytes))) throw invalid();
                        bodies.put(id, body);
                        bodyBytes += bytes.length;
                    }
                    String body = bodies.get(id);
                    if (body == null) throw invalid();
                    write(output, text(record.get("prefix")));
                    write(output, body);
                    write(output, text(record.get("suffix")));
                }
                case "reset" -> {
                    bodies.clear();
                    bodyBytes = 0;
                }
                default -> throw invalid();
            }
        }
    }

    private static String readLine(BufferedReader input) throws IOException {
        StringBuilder line = new StringBuilder();
        int value;
        while ((value = input.read()) != -1) {
            if (value == '\n') return line.toString();
            if (value == '\r' || line.length() >= 24 << 20) throw invalid();
            line.append((char) value);
        }
        if (!line.isEmpty()) throw invalid();
        return null;
    }

    private static String text(JsonNode node) {
        if (node == null || !node.isTextual()) throw invalid();
        return node.textValue();
    }

    private static void write(OutputStream output, String value) throws IOException {
        output.write(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("invalid lossless event archive");
    }
}
