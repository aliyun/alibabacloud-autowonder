package com.aliyun.autowonder.integration;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertTrue;

class ExternalProjectBindingDaoContractTest {

    @Test
    void enabledBindingsAreJoinedToTheLiveWorkspaceRow() throws Exception {
        String xml = new String(getClass()
                .getResourceAsStream("/mapping/ExternalProjectBindingDao.xml")
                .readAllBytes(), StandardCharsets.UTF_8);

        int listEnabled = xml.indexOf("<select id=\"listEnabled\"");
        int statementEnd = xml.indexOf("</select>", listEnabled);
        String statement = xml.substring(listEnabled, statementEnd);
        // Every Aone poller and the outbox dispatcher read work through this query; without the
        // workspace join a deleted workspace with a still-enabled binding keeps being scheduled.
        assertTrue(statement.contains("INNER JOIN `org` o"));
        assertTrue(statement.contains("o.id = b.tenant_id"));
        assertTrue(statement.contains("o.is_deleted = 0"));
        assertTrue(statement.contains("b.enabled = 1"));
        assertTrue(statement.contains("b.is_deleted = 0"));
    }
}
