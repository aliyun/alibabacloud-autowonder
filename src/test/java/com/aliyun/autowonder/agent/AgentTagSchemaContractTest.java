package com.aliyun.autowonder.agent;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentTagSchemaContractTest {

    private static final Path MIGRATION = Path.of("docs/migration/V130__agent_tags.sql");

    @Test
    void fullSchemaAndMigrationDeclareTheSameAssetTagTable() throws Exception {
        String schema = Files.readString(Path.of("docs/autowonder-schema.sql"));
        String migration = Files.readString(MIGRATION);

        String schemaTable = tableDefinition(schema);
        String migrationTable = tableDefinition(migration);
        for (String column : new String[]{"tenant_id", "asset_type", "asset_id", "tag_type",
                "tag_code", "tag_name", "gmt_create", "creator_id"}) {
            assertTrue(schemaTable.contains("`" + column + "`"), "schema missing " + column);
            assertTrue(migrationTable.contains("`" + column + "`"), "migration missing " + column);
        }
        assertTrue(schemaTable.contains("UNIQUE KEY `uk_tenant_asset_tag` (`tenant_id`, `asset_type`, `asset_id`, `tag_type`, `tag_name`)"));
        assertTrue(migrationTable.contains("UNIQUE KEY `uk_tenant_asset_tag` (`tenant_id`, `asset_type`, `asset_id`, `tag_type`, `tag_name`)"));
        Pattern exactName = Pattern.compile("(?i)`tag_name`\\s+VARCHAR\\(64\\)\\s+COLLATE utf8mb4_bin");
        assertTrue(exactName.matcher(schemaTable).find(), "fresh schema must preserve exact custom tag names");
        assertTrue(exactName.matcher(migrationTable).find(), "migration must preserve exact custom tag names");
    }

    @Test
    void migrationIsRepeatableAndHasNoBackfill() throws Exception {
        String migration = Files.readString(MIGRATION);

        assertTrue(migration.contains("CREATE TABLE IF NOT EXISTS `asset_tag`"),
                "migration must be safe to re-run");
        assertTrue(!migration.toUpperCase(java.util.Locale.ROOT).contains("INSERT INTO"),
                "new tags need no backfill; every worker starts untagged");
    }

    private static String tableDefinition(String sql) {
        var matcher = Pattern.compile(
                "(?is)CREATE TABLE IF NOT EXISTS `asset_tag`\\s*\\((.*?)\\)\\s*ENGINE=").matcher(sql);
        assertTrue(matcher.find(), "missing asset_tag table");
        return matcher.group(1);
    }
}
