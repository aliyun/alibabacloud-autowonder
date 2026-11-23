package com.aliyun.autowonder.conversation;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V083 与 canonical schema 的契约测试。
 *
 * <p>`docs/autowonder-schema.sql` 是新建数据库（本地、e2e）的唯一来源，`docs/migration/V116`
 * 是存量库的增量路径；两者必须描述同一结构，否则新环境会因缺列/缺表直接不可用。
 */
class ConversationEventDisplaySchemaContractTest {

    private static final Path SCHEMA = Path.of("docs/autowonder-schema.sql");
    private static final Path MIGRATION =
            Path.of("docs/migration/V116__conversation_event_display_isolation.sql");
    private static final String DISPLAY_TABLE = "conversation_event_display";
    private static final String SCAN_TABLE = "conversation_event_display_scan";

    @Test
    void migrationAddsTheQueueClassColumnAndCanonicalSchemaCarriesIt() throws Exception {
        String migration = read(MIGRATION);
        String schema = read(SCHEMA);

        assertTrue(migration.contains("ADD COLUMN queue_class VARCHAR(16) NOT NULL DEFAULT 'REALTIME'"),
                "迁移必须新增 queue_class，且默认 REALTIME");
        assertTrue(columnNames(tableBlock(schema, DISPLAY_TABLE)).contains("queue_class"),
                "canonical schema 的 conversation_event_display 必须包含 queue_class，"
                        + "否则新库执行 insertTask/listClaimableIdsByClass 会 Unknown column");
    }

    @Test
    void claimAndTurnIndexesMatchBetweenMigrationAndCanonicalSchema() throws Exception {
        String migration = read(MIGRATION);
        String schema = read(SCHEMA);

        List<String> claimColumns = indexColumns(migration, "idx_display_claim_class");
        assertEquals(claimColumns, indexColumns(schema, "idx_display_claim_class"),
                "认领索引必须与 ORDER BY (turn_id DESC, id ASC) 对齐且两处一致");
        assertEquals(List.of("status", "queue_class", "turn_id", "id"), claimColumns);

        List<String> turnColumns = indexColumns(migration, "idx_display_turn_class");
        assertEquals(turnColumns, indexColumns(schema, "idx_display_turn_class"));
        assertEquals(List.of("tenant_id", "conversation_id", "turn_id", "status", "queue_class"),
                turnColumns);
    }

    @Test
    void scanCheckpointTableIsIdenticalInBothSources() throws Exception {
        String migration = read(MIGRATION);
        String schema = read(SCHEMA);

        Set<String> migrationColumns = columnNames(tableBlock(migration, SCAN_TABLE));
        Set<String> schemaColumns = columnNames(tableBlock(schema, SCAN_TABLE));

        assertEquals(migrationColumns, schemaColumns,
                "历史发现 checkpoint 表在迁移与 canonical schema 中必须同构");
        assertEquals(new LinkedHashSet<>(List.of(
                        "scan_key", "last_raw_id", "high_water_raw_id", "generation", "quiet_until",
                        "gmt_modified")),
                schemaColumns);
        assertTrue(migration.toUpperCase(Locale.ROOT).contains("PRIMARY KEY (SCAN_KEY)"));
        assertTrue(schema.toUpperCase(Locale.ROOT).contains("PRIMARY KEY (SCAN_KEY)"));
    }

    private static String read(Path path) throws Exception {
        return Files.readString(path, StandardCharsets.UTF_8);
    }

    private static String tableBlock(String sql, String table) {
        Pattern pattern = Pattern.compile(
                "(?is)CREATE TABLE IF NOT EXISTS `?" + Pattern.quote(table) + "`?\\s*\\((.*?)\\R\\)\\s*ENGINE");
        Matcher matcher = pattern.matcher(sql);
        assertTrue(matcher.find(), "both sources must declare CREATE TABLE " + table);
        return matcher.group(1);
    }

    private static Set<String> columnNames(String block) {
        Set<String> columns = new LinkedHashSet<>();
        for (String raw : block.split("\\R")) {
            String line = raw.trim();
            if (line.isEmpty()) {
                continue;
            }
            String upper = line.toUpperCase(Locale.ROOT);
            if (upper.startsWith("PRIMARY KEY") || upper.startsWith("UNIQUE KEY")
                    || upper.startsWith("KEY ") || upper.startsWith("CONSTRAINT")) {
                continue;
            }
            columns.add(line.split("\\s+")[0].replace("`", "").toLowerCase(Locale.ROOT));
        }
        return columns;
    }

    private static List<String> indexColumns(String sql, String index) {
        Matcher matcher = Pattern.compile(
                "(?is)" + Pattern.quote(index) + "\\s*\\(([^)]*)\\)").matcher(sql);
        assertTrue(matcher.find(), "both sources must declare index " + index);
        List<String> columns = new ArrayList<>();
        for (String part : matcher.group(1).split(",")) {
            columns.add(part.trim().replace("`", "").toLowerCase(Locale.ROOT));
        }
        return columns;
    }
}
