package com.aliyun.autowonder.mcp;

import com.aliyun.autowonder.json.JSON;
import com.aliyun.autowonder.json.JSONArray;
import com.aliyun.autowonder.mcp.dto.PlatformSkillVO;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PlatformSkillCatalogWorkbenchCreateTest {

    private final PlatformSkillCatalog catalog = new PlatformSkillCatalog();

    @Test
    void workbenchCreateSkillShipsBundledInstructions() {
        PlatformSkillVO skill = catalog.get(PlatformSkillCatalog.WORKBENCH_CREATE_SKILL_ID);
        assertEquals("AutoWonder 工作台智能新建工单", skill.getName());
        String spec = skill.getInstallSpec();
        assertTrue(spec.contains("\"instructions\""));
        // 正文来自 classpath 资源，而不是仅回落下发描述。
        assertTrue(spec.contains("工作台智能新建工单"));
        assertTrue(spec.contains("autowonder.create_workitem"));
    }

    @Test
    void workbenchCreateSkillUsesOnlyExistingMutations() {
        PlatformSkillVO skill = catalog.get(PlatformSkillCatalog.WORKBENCH_CREATE_SKILL_ID);
        JSONArray tools = JSON.parseObject(skill.getInstallSpec()).getJSONArray("tools");
        Set<String> names = new LinkedHashSet<>();
        tools.forEach(tool -> names.add(String.valueOf(tool)));
        assertTrue(names.contains("autowonder.create_workitem"));
        assertTrue(names.contains("autowonder.assign_workitem"));
        assertTrue(names.contains("autowonder.list_workitems"));
        assertEquals(12, names.size());
    }
}
