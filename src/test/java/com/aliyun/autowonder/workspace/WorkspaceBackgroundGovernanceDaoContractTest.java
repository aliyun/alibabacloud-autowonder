package com.aliyun.autowonder.workspace;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertTrue;

class WorkspaceBackgroundGovernanceDaoContractTest {

    @Test
    void everyCandidateBranchRequiresADeletedWorkspace() throws Exception {
        String xml = new String(getClass()
                .getResourceAsStream("/mapping/WorkspaceBackgroundGovernanceDao.xml")
                .readAllBytes(), StandardCharsets.UTF_8);

        // Three residual sources, one join each: an active workspace can never be picked up, so the
        // sweep cannot pause or disable something a live workspace still needs.
        assertTrue(xml.contains("FROM external_project_binding b"));
        assertTrue(xml.contains("o.id = b.tenant_id AND o.is_deleted = 1"));
        assertTrue(xml.contains("FROM scheduled_task t"));
        assertTrue(xml.contains("o2.id = t.workspace_id AND o2.is_deleted = 1"));
        assertTrue(xml.contains("FROM dispatch d"));
        assertTrue(xml.contains("o3.id = d.tenant_id AND o3.is_deleted = 1"));
        // A workspace with nothing left to stop drops out, which makes repeated sweeps converge.
        assertTrue(xml.contains("b.enabled = 1"));
        assertTrue(xml.contains("t.status = 'ACTIVE'"));
        assertTrue(xml.contains("d.status IN"));
    }
}
