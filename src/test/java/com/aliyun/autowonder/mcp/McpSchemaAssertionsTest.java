package com.aliyun.autowonder.mcp;

import com.aliyun.autowonder.mcp.dto.McpToolVO;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves the traversal and rule set themselves: every supported schema position is reached, JSON
 * Pointers stay RFC 6901 correct, and legal constructs such as boolean schemas, nullable type unions
 * or business data that merely looks like a keyword are not reported.
 */
class McpSchemaAssertionsTest {

    private static final String PROFILE = "unit";
    private static final String TOOL = "autowonder.synthetic";

    @Test
    void objectTypedNegationRuleReportsTheExactPointer() {
        Map<String, Object> schema = objectSchema(Map.of(
                "type", "object",
                "oneOf", List.of(
                        Map.of("required", List.of("fileName"),
                                "not", Map.of("required", List.of("files"))))));

        List<String> violations = check(schema);

        assertEquals(1, violations.size(), violations.toString());
        assertTrue(violations.get(0).contains("/inputSchema/oneOf/0/not"), violations.get(0));
        assertTrue(violations.get(0).contains(McpSchemaAssertions.RULE_NOT_OBJECT), violations.get(0));
        assertTrue(violations.get(0).contains(TOOL), violations.get(0));
        assertTrue(violations.get(0).contains(PROFILE), violations.get(0));
    }

    @Test
    void objectTypedNegationIsAcceptedInBothSpellings() {
        assertTrue(check(objectSchema(Map.of("not",
                Map.of("type", "object", "required", List.of("files"))))).isEmpty());
        assertTrue(check(objectSchema(Map.of("not",
                Map.of("type", List.of("object", "null"), "required", List.of("files"))))).isEmpty());
    }

    @Test
    void escapedJsonPointerNamesStayAddressable() {
        Map<String, Object> nested = objectSchema(Map.of(
                "type", "object",
                "additionalProperties", Map.of("not", Map.of("required", List.of("x")))));
        Map<String, Object> root = objectSchema(Map.of(
                "type", "object",
                "properties", Map.of("a/b~c", nested)));

        List<String> violations = check(root);

        assertEquals(1, violations.size(), violations.toString());
        assertTrue(violations.get(0).contains("/inputSchema/properties/a~1b~0c/additionalProperties/not"),
                violations.get(0));
    }

    @Test
    void arraysMustDeclareTheirElementContract() {
        List<String> missingItems = check(objectSchema(Map.of(
                "type", "object", "properties", Map.of("items", Map.of("type", "array")))));
        assertEquals(1, missingItems.size(), missingItems.toString());
        assertTrue(missingItems.get(0).contains(McpSchemaAssertions.RULE_ARRAY_ITEMS));

        List<String> nullableArray = check(objectSchema(Map.of(
                "type", "object", "properties", Map.of("items", Map.of("type", List.of("array", "null"))))));
        assertEquals(1, nullableArray.size(), nullableArray.toString());
        assertTrue(nullableArray.get(0).contains("/inputSchema/properties/items"), nullableArray.get(0));

        assertTrue(check(objectSchema(Map.of(
                "type", "object",
                "properties", Map.of("items", Map.of("type", "array",
                        "items", Map.of("type", "string")))))).isEmpty());
        assertTrue(check(objectSchema(Map.of(
                "type", "object",
                "properties", Map.of("items", Map.of("type", "array",
                        "prefixItems", List.of(Map.of("type", "string"))))))).isEmpty());
    }

    @Test
    void businessDataThatLooksLikeASchemaKeywordIsNotWalked() {
        Map<String, Object> schema = objectSchema(Map.of(
                "type", "object",
                "properties", Map.of("payload",
                        Map.of("type", "object",
                                "description", "value not: {required: [files]} without type",
                                "default", Map.of("not", Map.of("required", List.of("files"))),
                                "examples", List.of(Map.of("items", Map.of("type", "array"))),
                                "enum", List.of(Map.of("not", Map.of("required", List.of("files")))),
                                "const", Map.of("items", Map.of("type", "array"))))));

        assertTrue(check(schema).isEmpty(), check(schema).toString());
    }

    @Test
    void booleanAndFreeFormSchemasAreLegal() {
        Map<String, Object> schema = objectSchema(Map.of(
                "type", "object",
                "properties", new LinkedHashMap<>(Map.of(
                        "anything", true,
                        "closed", false,
                        "freeMap", Map.of("type", "object"))),
                "additionalProperties", Map.of("type", "object")));

        assertTrue(check(schema).isEmpty(), check(schema).toString());
    }

    @Test
    void nullableUnionsAndOptionalFieldsArePreserved() {
        Map<String, Object> schema = objectSchema(Map.of(
                "type", "object",
                "properties", Map.of(
                        "description", Map.of("type", List.of("string", "null")),
                        "sdlcId", Map.of("type", List.of("integer", "null"))),
                "required", List.of()));

        assertTrue(check(schema).isEmpty(), check(schema).toString());
        assertTrue(McpSchemaAssertions.isValidInstance(schema, Map.of("description", "x", "sdlcId", 3)));
        assertTrue(McpSchemaAssertions.isValidInstance(schema, mapWithNull("description")));
        assertFalse(McpSchemaAssertions.isValidInstance(schema, Map.of("description", 3)));
    }

    @Test
    void draft7TupleItemsAndSchemaFormDependenciesAreWalked() {
        Map<String, Object> schema = objectSchema(Map.of(
                "type", "object",
                "items", List.of(Map.of("type", "object",
                        "not", Map.of("required", List.of("a")))),
                "dependencies", Map.of(
                        "a", List.of("b"),
                        "c", Map.of("not", Map.of("required", List.of("d"))))));

        // Tuple items and dependencies are Draft-7 forms, so only the walk-based rules apply.
        List<String> violations = McpSchemaAssertions.checkSchemaRules(
                PROFILE, TOOL, "input", schema);

        assertEquals(2, violations.size(), violations.toString());
        assertTrue(violations.stream().anyMatch(v -> v.contains("/inputSchema/items/0/not")),
                violations.toString());
        assertTrue(violations.stream().anyMatch(v -> v.contains("/inputSchema/dependencies/c/not")),
                violations.toString());
    }

    @Test
    void duplicateAndBlankToolNamesAreReported() {
        McpToolVO first = tool(TOOL, objectSchema(Map.of("type", "object")));
        McpToolVO duplicate = tool(TOOL, objectSchema(Map.of("type", "object")));
        McpToolVO blank = tool(" ", objectSchema(Map.of("type", "object")));

        List<String> violations = McpSchemaAssertions.checkCatalog(PROFILE,
                List.of(first, duplicate, blank));

        assertEquals(2, violations.size(), violations.toString());
        assertTrue(violations.stream().allMatch(v -> v.contains(McpSchemaAssertions.RULE_TOOL_NAME)));
    }

    @Test
    void rootAndOutputSchemasMustStayObjectShells() {
        List<String> inputViolations = McpSchemaAssertions.checkSchemaDocument(
                PROFILE, TOOL, "input", Map.of("type", "array", "items", Map.of("type", "string")));
        assertEquals(1, inputViolations.size(), inputViolations.toString());
        assertTrue(inputViolations.get(0).contains(McpSchemaAssertions.RULE_ROOT_OBJECT));

        McpToolVO invalidOutput = tool(TOOL, objectSchema(Map.of("type", "object")));
        invalidOutput.setOutputSchema(Map.of("type", "string"));
        List<String> outputViolations = McpSchemaAssertions.checkCatalog(PROFILE, List.of(invalidOutput));
        assertEquals(1, outputViolations.size(), outputViolations.toString());
        assertTrue(outputViolations.get(0).contains("/outputSchema"));
        assertTrue(outputViolations.get(0).contains(McpSchemaAssertions.RULE_ROOT_OBJECT));
    }

    @Test
    void standardStructureRulesCatchInvalidDeclarations() {
        List<String> badType = McpSchemaAssertions.checkSchemaRules(PROFILE, TOOL, "input",
                objectSchema(Map.of("type", 123)));
        assertEquals(1, badType.size(), badType.toString());
        assertTrue(badType.get(0).contains(McpSchemaAssertions.RULE_STANDARD_STRUCTURE), badType.get(0));
        assertTrue(badType.get(0).contains("/inputSchema/type"), badType.get(0));

        List<String> duplicateRequired = McpSchemaAssertions.checkSchemaRules(PROFILE, TOOL, "input",
                objectSchema(Map.of("type", "object", "required", List.of("a", "a"),
                        "properties", Map.of("a", Map.of("type", "string")))));
        assertEquals(1, duplicateRequired.size(), duplicateRequired.toString());
        assertTrue(duplicateRequired.get(0).contains("/inputSchema/required"), duplicateRequired.get(0));

        List<String> badProperties = McpSchemaAssertions.checkSchemaRules(PROFILE, TOOL, "input",
                objectSchema(Map.of("type", "object", "properties", List.of())));
        assertEquals(1, badProperties.size(), badProperties.toString());
        assertTrue(badProperties.get(0).contains("/inputSchema/properties"), badProperties.get(0));

        List<String> emptyCombinator = McpSchemaAssertions.checkSchemaRules(PROFILE, TOOL, "input",
                objectSchema(Map.of("type", "object", "oneOf", List.of())));
        assertEquals(1, emptyCombinator.size(), emptyCombinator.toString());
        assertTrue(emptyCombinator.get(0).contains("/inputSchema/oneOf"), emptyCombinator.get(0));
    }

    @Test
    void standardValidationRejectsUncompilableSchema() {
        // An invalid regular expression fails at Draft 2020-12 compile time, independently of the
        // compatibility rules, so the standard layer is proven to run its own real validator.
        List<String> violations = check(objectSchema(Map.of(
                "type", "object",
                "properties", Map.of("name", Map.of("type", "string", "pattern", "[")))));

        assertEquals(1, violations.size(), violations.toString());
        assertTrue(violations.get(0).contains(McpSchemaAssertions.RULE_STANDARD), violations.get(0));
    }

    @Test
    void realValidatorEnforcesTheOneOfModes() {
        Map<String, Object> schema = objectSchema(Map.of(
                "type", "object",
                "properties", Map.of(
                        "fileName", Map.of("type", "string"),
                        "contentBase64", Map.of("type", "string"),
                        "files", Map.of("type", "object")),
                "oneOf", List.of(
                        Map.of("required", List.of("fileName", "contentBase64"),
                                "not", Map.of("type", "object", "required", List.of("files"))),
                        Map.of("required", List.of("files"),
                                "not", Map.of("type", "object", "required", List.of("contentBase64"))))));

        assertTrue(McpSchemaAssertions.isValidInstance(schema,
                Map.of("fileName", "a.zip", "contentBase64", "AA==")));
        assertTrue(McpSchemaAssertions.isValidInstance(schema, Map.of("files", Map.of("a", "AA=="))));
        assertFalse(McpSchemaAssertions.isValidInstance(schema, Map.of()));
        assertFalse(McpSchemaAssertions.isValidInstance(schema,
                Map.of("files", Map.of("a", "AA=="), "contentBase64", "AA==")));
    }

    private static List<String> check(Map<String, Object> schema) {
        return McpSchemaAssertions.checkSchemaDocument(PROFILE, TOOL, "input", schema);
    }

    private static McpToolVO tool(String name, Map<String, Object> inputSchema) {
        return new McpToolVO(name, "synthetic tool", inputSchema);
    }

    private static Map<String, Object> objectSchema(Map<String, Object> body) {
        Map<String, Object> schema = new LinkedHashMap<>();
        if (!body.containsKey("type")) {
            schema.put("type", "object");
        }
        if (!body.containsKey("properties")) {
            schema.put("properties", Map.of());
        }
        schema.putAll(body);
        return schema;
    }

    private static Map<String, Object> mapWithNull(String key) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put(key, null);
        return map;
    }
}
