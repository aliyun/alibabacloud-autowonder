package com.aliyun.autowonder.mcp;

import com.aliyun.autowonder.mcp.dto.McpToolVO;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Test-only structural gate for every tool schema the MCP service actually generates.
 *
 * <p>Two layers stay separate. The standard layer compiles each schema with a real Draft 2020-12
 * validator (offline meta-schema bundled with the library). The compatibility layer only reports
 * practices a specific model chain rejects, e.g. a {@code not} that constrains an object through
 * {@code required} without declaring {@code type:object}, which Qwen4-Max rejects before the first
 * tool call. Nothing here rewrites a schema: the production catalog is never altered in transit.
 */
final class McpSchemaAssertions {

    static final String RULE_STANDARD = "MCP-SCHEMA-STANDARD-001";
    static final String RULE_STANDARD_STRUCTURE = "MCP-SCHEMA-STANDARD-002";
    static final String RULE_NOT_OBJECT = "MCP-NOT-OBJECT-001";
    static final String RULE_ARRAY_ITEMS = "MCP-ARRAY-ITEMS-001";
    static final String RULE_ROOT_OBJECT = "MCP-ROOT-OBJECT-001";
    static final String RULE_TOOL_NAME = "MCP-TOOL-NAME-001";

    private static final Set<String> JSON_TYPES = Set.of(
            "object", "array", "string", "number", "integer", "boolean", "null");
    private static final List<String> COMBINATOR_KEYWORDS =
            List.of("allOf", "anyOf", "oneOf", "prefixItems");

    /** Positions whose value maps property names to sub-schemas. */
    private static final List<String> SCHEMA_MAPS = List.of(
            "properties", "patternProperties", "$defs", "definitions", "dependentSchemas");

    /** Positions whose value is a single schema, a boolean schema, or a Draft-7 tuple array. */
    private static final List<String> SCHEMA_OR_BOOLEAN = List.of(
            "items", "additionalProperties", "unevaluatedProperties", "unevaluatedItems", "not",
            "if", "then", "else", "contains", "propertyNames", "additionalItems");

    /** Positions whose value is a list of sub-schemas. */
    private static final List<String> SCHEMA_ARRAYS = List.of(
            "allOf", "anyOf", "oneOf", "prefixItems");

    private static final JsonSchemaFactory FACTORY =
            JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private McpSchemaAssertions() {
    }

    static void assertCatalog(String profile, Collection<McpToolVO> tools) {
        List<String> violations = checkCatalog(profile, tools);
        if (!violations.isEmpty()) {
            throw new AssertionError(violations.size() + " MCP schema violation(s) [" + profile + "]"
                    + System.lineSeparator() + String.join(System.lineSeparator(), violations));
        }
    }

    static List<String> checkCatalog(String profile, Collection<McpToolVO> tools) {
        List<String> violations = new ArrayList<>();
        Set<String> names = new HashSet<>();
        for (McpToolVO tool : tools) {
            String name = tool == null ? null : tool.getName();
            if (name == null || name.isBlank()) {
                violations.add(profile + " | tool=<unnamed> | / | rule=" + RULE_TOOL_NAME
                        + " | tool name must be unique and non-empty");
                continue;
            }
            if (!names.add(name)) {
                violations.add(profile + " | tool=" + name + " | / | rule=" + RULE_TOOL_NAME
                        + " | duplicate tool name");
            }
            violations.addAll(checkSchemaDocument(profile, name, "input", tool.getInputSchema()));
            if (tool.getOutputSchema() != null) {
                violations.addAll(checkSchemaDocument(profile, name, "output", tool.getOutputSchema()));
            }
        }
        return violations;
    }

    static List<String> checkSchemaDocument(String profile, String toolName, String side,
                                            Map<String, Object> schema) {
        List<String> violations = new ArrayList<>();
        String base = "/" + side + "Schema";
        if (schema == null) {
            violations.add(format(profile, toolName, base, RULE_ROOT_OBJECT, "schema is missing"));
            return violations;
        }
        try {
            FACTORY.getSchema(MAPPER.valueToTree(schema));
        } catch (RuntimeException failure) {
            violations.add(format(profile, toolName, base, RULE_STANDARD,
                    "schema does not compile under Draft 2020-12: " + failure.getMessage()));
            return violations;
        }
        if (!declaresType(schema.get("type"), "object")) {
            violations.add(format(profile, toolName, base, RULE_ROOT_OBJECT,
                    "root type must be object"));
        }
        walk(profile, toolName, base, schema, "", violations);
        return violations;
    }

    /** All walk-based rules without the external validator; used for dialect-specific positions. */
    static List<String> checkSchemaRules(String profile, String toolName, String side,
                                         Map<String, Object> schema) {
        List<String> violations = new ArrayList<>();
        walk(profile, toolName, "/" + side + "Schema", schema, "", violations);
        return violations;
    }

    static Set<ValidationMessage> validateInstance(Map<String, Object> schema, Object instance) {
        JsonSchema compiled = FACTORY.getSchema(MAPPER.valueToTree(schema));
        return compiled.validate(MAPPER.valueToTree(instance));
    }

    static boolean isValidInstance(Map<String, Object> schema, Object instance) {
        return validateInstance(schema, instance).isEmpty();
    }

    static void assertInstanceValid(Map<String, Object> schema, Object instance, String message) {
        Set<ValidationMessage> errors = validateInstance(schema, instance);
        if (!errors.isEmpty()) {
            throw new AssertionError(message + " should be valid but got " + errors);
        }
    }

    static void assertInstanceInvalid(Map<String, Object> schema, Object instance, String message) {
        Set<ValidationMessage> errors = validateInstance(schema, instance);
        if (errors.isEmpty()) {
            throw new AssertionError(message + " should be invalid against its schema");
        }
    }

    private static void walk(String profile, String toolName, String base, Object node,
                             String pointer, List<String> violations) {
        if (!(node instanceof Map<?, ?> raw)) {
            return; // boolean schemas are legal and carry none of these rules
        }
        Map<?, ?> schema = raw;
        checkStandardStructure(profile, toolName, base, schema, pointer, violations);
        checkObjectTypedNegation(profile, toolName, base, schema, pointer, violations);
        checkArrayItems(profile, toolName, base, schema, pointer, violations);

        for (String container : SCHEMA_MAPS) {
            Object value = schema.get(container);
            if (value instanceof Map<?, ?> entries) {
                for (Map.Entry<?, ?> entry : entries.entrySet()) {
                    walk(profile, toolName, base, entry.getValue(),
                            pointer + "/" + container + "/" + escape(String.valueOf(entry.getKey())),
                            violations);
                }
            }
        }
        for (String child : SCHEMA_OR_BOOLEAN) {
            Object value = schema.get(child);
            if (value instanceof Map<?, ?> || value instanceof Boolean) {
                walk(profile, toolName, base, value, pointer + "/" + child, violations);
            }
        }
        for (String branch : SCHEMA_ARRAYS) {
            Object value = schema.get(branch);
            if (value instanceof List<?> list) {
                for (int i = 0; i < list.size(); i++) {
                    walk(profile, toolName, base, list.get(i),
                            pointer + "/" + branch + "/" + i, violations);
                }
            }
        }
        Object items = schema.get("items");
        if (items instanceof List<?> tuple) {
            // Draft-7 tuple form: only reachable when a schema opts into that dialect.
            for (int i = 0; i < tuple.size(); i++) {
                walk(profile, toolName, base, tuple.get(i),
                        pointer + "/items/" + i, violations);
            }
        }
        Object dependencies = schema.get("dependencies");
        if (dependencies instanceof Map<?, ?> entries) {
            for (Map.Entry<?, ?> entry : entries.entrySet()) {
                if (entry.getValue() instanceof Map<?, ?>) {
                    // The string-array form is a property dependency, not a schema.
                    walk(profile, toolName, base, entry.getValue(),
                            pointer + "/dependencies/" + escape(String.valueOf(entry.getKey())),
                            violations);
                }
            }
        }
    }

    /**
     * The subset of Draft 2020-12 structural rules the catalog relies on, so a hand-built
     * regression can prove them independently of the external validator's error surface.
     */
    private static void checkStandardStructure(String profile, String toolName, String base,
                                               Map<?, ?> schema, String pointer,
                                               List<String> violations) {
        Object type = schema.get("type");
        if (type != null && !validTypeDeclaration(type)) {
            violations.add(format(profile, toolName, base + pointer + "/type", RULE_STANDARD_STRUCTURE,
                    "type must be a JSON Schema type name or a non-empty array of unique names"));
        }
        Object required = schema.get("required");
        if (required != null && !validRequired(required)) {
            violations.add(format(profile, toolName, base + pointer + "/required",
                    RULE_STANDARD_STRUCTURE, "required must be an array of unique strings"));
        }
        Object properties = schema.get("properties");
        if (properties != null && !(properties instanceof Map<?, ?>)) {
            violations.add(format(profile, toolName, base + pointer + "/properties",
                    RULE_STANDARD_STRUCTURE, "properties must be an object of sub-schemas"));
        }
        for (String keyword : COMBINATOR_KEYWORDS) {
            Object value = schema.get(keyword);
            if (value != null && (!(value instanceof List<?> list) || list.isEmpty())) {
                violations.add(format(profile, toolName, base + pointer + "/" + keyword,
                        RULE_STANDARD_STRUCTURE, keyword + " must be a non-empty array of sub-schemas"));
            }
        }
    }

    private static boolean validTypeDeclaration(Object type) {
        if (type instanceof String name) {
            return JSON_TYPES.contains(name);
        }
        if (!(type instanceof List<?> values) || values.isEmpty()) {
            return false;
        }
        Set<Object> seen = new HashSet<>();
        for (Object value : values) {
            if (!(value instanceof String name) || !JSON_TYPES.contains(name) || !seen.add(name)) {
                return false;
            }
        }
        return true;
    }

    private static boolean validRequired(Object required) {
        if (!(required instanceof List<?> names)) {
            return false;
        }
        Set<Object> seen = new HashSet<>();
        for (Object name : names) {
            if (!(name instanceof String) || !seen.add(name)) {
                return false;
            }
        }
        return true;
    }

    private static void checkObjectTypedNegation(String profile, String toolName, String base,
                                                 Map<?, ?> schema, String pointer,
                                                 List<String> violations) {        Object negation = schema.get("not");
        if (negation instanceof Map<?, ?> negated
                && negated.containsKey("required")
                && !declaresType(negated.get("type"), "object")) {
            violations.add(format(profile, toolName, base + pointer + "/not", RULE_NOT_OBJECT,
                    "not.required constrains an object, declare type:object"));
        }
    }

    private static void checkArrayItems(String profile, String toolName, String base,
                                        Map<?, ?> schema, String pointer,
                                        List<String> violations) {
        if (declaresArray(schema.get("type"))
                && !schema.containsKey("items")
                && !schema.containsKey("prefixItems")) {
            violations.add(format(profile, toolName, base + pointer, RULE_ARRAY_ITEMS,
                    "array schema must declare items (or prefixItems) for its element contract"));
        }
    }

    private static boolean declaresType(Object type, String expected) {
        if (expected.equals(type)) {
            return true;
        }
        return type instanceof Collection<?> values && values.contains(expected);
    }

    private static boolean declaresArray(Object type) {
        return declaresType(type, "array");
    }

    private static String escape(String token) {
        return token.replace("~", "~0").replace("/", "~1");
    }

    private static String format(String profile, String toolName, String pointer, String rule,
                                 String reason) {
        return profile + " | tool=" + toolName + " | " + pointer + " | rule=" + rule
                + " | " + reason;
    }
}
