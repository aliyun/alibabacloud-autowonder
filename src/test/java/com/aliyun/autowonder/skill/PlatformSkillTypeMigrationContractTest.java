package com.aliyun.autowonder.skill;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 存量 CODEX_SKILL 归一的迁移契约：唯一键 uk_type_name 不含 is_deleted，
 * 迁移必须先处理同名冲突再改类型，且不得删除或覆盖客户数据。
 */
class PlatformSkillTypeMigrationContractTest {

    private static final Path MIGRATION = Path.of("docs/migration/V118__normalize_platform_skill_type.sql");

    private static String read() throws IOException {
        return Files.readString(MIGRATION, StandardCharsets.UTF_8);
    }

    private static List<String> statements(String sql) {
        List<String> result = new ArrayList<>();
        for (String raw : sql.split(";")) {
            StringBuilder builder = new StringBuilder();
            for (String line : raw.split("\n")) {
                if (!line.trim().startsWith("--")) {
                    builder.append(line).append('\n');
                }
            }
            String statement = builder.toString().trim();
            if (!statement.isEmpty()) {
                result.add(statement);
            }
        }
        return result;
    }

    @Test
    void migrationNormalizesLegacyTypeWithoutDeletingCustomerRows() throws IOException {
        String sql = read();

        assertFalse(sql.contains("DELETE FROM"), "存量数据不得删除");
        assertFalse(sql.contains("TRUNCATE"), "存量数据不得清空");
        assertFalse(sql.contains("DROP TABLE"), "迁移不应删除表");
        assertFalse(sql.contains("install_spec"), "installSpec 属执行器协议字段，迁移不得改写");
        assertTrue(sql.contains("legacy.type = 'SKILL'"), "必须把 CODEX_SKILL 归一为 SKILL");
    }

    @Test
    void conflictResolutionRunsBeforeTypeNormalization() throws IOException {
        String sql = read();
        int rename = sql.indexOf("' (legacy-'");
        int normalize = sql.indexOf("UPDATE /*+");

        assertTrue(rename > 0, "同名 SKILL 冲突必须显式改名保留");
        assertTrue(normalize > rename, "先解决唯一键冲突，再统一改类型");
        assertTrue(sql.contains("128 - CHAR_LENGTH(CONCAT(' (legacy-', id, ')'))"),
                "改名必须按后缀实际长度精确截断，保证结果落在 VARCHAR(128) 内");
        assertTrue(sql.contains("'#deleted-'"), "软删除行按 V044 约定墓碑化名称以释放唯一键槽位");
    }

    @Test
    void releaseOrderGuidanceMatchesReadCompatCode() throws IOException {
        String sql = read();

        assertTrue(sql.contains("rerun once all old writers are upgraded"),
                "同窗口顺序下必须要求新代码发布后重跑本迁移");
    }

    @Test
    void renameAndNormalizationAreOneAtomicUpdateScopedToLegacyType() throws IOException {
        List<String> statements = statements(read());

        assertEquals(1, statements.size(), "改名和类型归一必须一起提交");
        assertTrue(statements.get(0).endsWith("WHERE legacy.type = 'CODEX_SKILL'"),
                "重复执行时只处理尚未归一的记录");
    }
}
