package com.aliyun.autowonder.prd;

import org.springframework.core.io.ClassPathResource;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

final class PrdPrompts {
    static final String VERSION = "prd-design-v4";
    static final String PREPARE = load("prepare");
    static final String DESIGN = load("design");
    static final String HANDOFF = load("handoff");

    private static String load(String phase) {
        try (var input = new ClassPathResource("prd-prompts/" + phase + ".md").getInputStream()) {
            return "[" + VERSION + " / " + phase + "]\n" + new String(input.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot load PRD prompt " + phase, e);
        }
    }
}
