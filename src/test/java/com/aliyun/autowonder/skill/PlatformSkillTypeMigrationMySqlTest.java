package com.aliyun.autowonder.skill;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.support.EncodedResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.MySQLContainer;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class PlatformSkillTypeMigrationMySqlTest {

    @Test
    void collisionWithExistingGeneratedNamesPreservesEveryRowAndRerunsSafely() throws Exception {
        Assumptions.assumeTrue(DockerClientFactory.instance().isDockerAvailable(),
                "Docker is required for the historical MySQL skill fixture");

        try (MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.4.4")) {
            mysql.start();
            try (Connection connection = DriverManager.getConnection(
                    mysql.getJdbcUrl(), mysql.getUsername(), mysql.getPassword())) {
                ScriptUtils.executeSqlScript(connection, new EncodedResource(
                        new ClassPathResource("schema/legacy-skill-v118-fixture.sql"), StandardCharsets.UTF_8));
                EncodedResource migration = new EncodedResource(new FileSystemResource(
                        "docs/migration/V118__normalize_platform_skill_type.sql"), StandardCharsets.UTF_8);

                ScriptUtils.executeSqlScript(connection, migration);
                List<SkillRow> migrated = readRows(connection);
                assertEquals(List.of(
                        new SkillRow(101, 1, "SKILL", "Build (legacy-101-2)", false, "codex-skill"),
                        new SkillRow(102, 1, "SKILL", "build", false, null),
                        new SkillRow(103, 1, "SKILL", "Build (legacy-101)", false, null),
                        new SkillRow(104, 1, "SKILL", "Build (legacy-101-1)", false, null),
                        new SkillRow(105, 1, "SKILL", "#deleted-105-2", true, null),
                        new SkillRow(106, 1, "SKILL", "#deleted-105", true, null),
                        new SkillRow(107, 1, "SKILL", "#deleted-105-1", true, null),
                        new SkillRow(108, 1, "SKILL", "构".repeat(115) + " (legacy-108)", false, null),
                        new SkillRow(109, 1, "SKILL", "构".repeat(128), false, null),
                        new SkillRow(110, 2, "SKILL", "Build", false, null),
                        new SkillRow(111, 1, "MCP", "Other", false, null)), migrated);

                ScriptUtils.executeSqlScript(connection, migration);
                assertEquals(migrated, readRows(connection));
            }
        }
    }

    private List<SkillRow> readRows(Connection connection) throws Exception {
        try (Statement statement = connection.createStatement();
             ResultSet rows = statement.executeQuery("""
                     SELECT id, tenant_id, type, name, is_deleted,
                            JSON_UNQUOTE(JSON_EXTRACT(install_spec, '$.kind')) AS install_kind
                     FROM skill ORDER BY id
                     """)) {
            List<SkillRow> result = new ArrayList<>();
            while (rows.next()) {
                result.add(new SkillRow(rows.getLong("id"), rows.getLong("tenant_id"), rows.getString("type"),
                        rows.getString("name"), rows.getBoolean("is_deleted"), rows.getString("install_kind")));
            }
            return result;
        }
    }

    private record SkillRow(long id, long tenantId, String type, String name, boolean deleted, String installKind) {
    }
}
