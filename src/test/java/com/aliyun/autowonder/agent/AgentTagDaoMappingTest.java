package com.aliyun.autowonder.agent;

import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentTagDaoMappingTest {

    private String xml() throws Exception {
        try (InputStream in = getClass().getClassLoader().getResourceAsStream("mapping/AgentTagDao.xml")) {
            assertNotNull(in);
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private String body(String xml, String tag, String id) {
        String startTag = "<" + tag + " id=\"" + id + "\"";
        int start = xml.indexOf(startTag);
        assertTrue(start >= 0, "Missing " + tag + " " + id);
        int bodyStart = xml.indexOf('>', start) + 1;
        int bodyEnd = xml.indexOf("</" + tag + ">", bodyStart);
        assertTrue(bodyStart > 0 && bodyEnd > bodyStart, "Malformed " + tag + " " + id);
        return xml.substring(bodyStart, bodyEnd).replaceAll("\\s+", " ").trim();
    }

    @Test
    void batchLookupIsTenantAndAssetScopedWithIdOrdering() throws Exception {
        String query = body(xml(), "select", "listByAgentIds");

        assertTrue(query.contains("tenant_id = #{tenantId}"), "tag lookup must stay tenant scoped");
        assertTrue(query.contains("asset_type = 'AGENT'"), "tag lookup must stay in the AGENT asset type");
        assertTrue(query.contains("asset_id IN"), "list fill must batch agent ids");
        assertTrue(query.contains("<foreach collection=\"agentIds\""), "list fill must use one IN query");
        assertTrue(query.contains("ORDER BY id ASC"), "custom tags need creation order");
    }

    @Test
    void singleAgentLookupAndDeleteAreTenantScoped() throws Exception {
        String xml = xml();
        String lookup = body(xml, "select", "listByAgent");
        String delete = body(xml, "delete", "deleteByAgent");

        assertTrue(lookup.contains("tenant_id = #{tenantId}"));
        assertTrue(lookup.contains("asset_id = #{agentId}"));
        assertTrue(delete.contains("tenant_id = #{tenantId}"));
        assertTrue(delete.contains("asset_id = #{agentId}"));
        assertTrue(delete.contains("asset_type = 'AGENT'"));
    }

    @Test
    void insertBatchCarriesTagTypeCodeAndNameWithCreator() throws Exception {
        String insert = body(xml(), "insert", "insertBatch");

        assertTrue(insert.contains("tag_type"));
        assertTrue(insert.contains("tag_code"));
        assertTrue(insert.contains("tag_name"));
        assertTrue(insert.contains("creator_id"));
        assertTrue(insert.contains("<foreach collection=\"tags\""));
    }

    @Test
    void customTagOptionsAggregateByUsageWithHardLimit() throws Exception {
        String query = body(xml(), "select", "listCustomTagOptions");

        assertTrue(query.contains("tag_type = 'CUSTOM'"));
        assertTrue(query.contains("GROUP BY tag_name"));
        assertTrue(query.contains("ORDER BY COUNT(*) DESC, tag_name ASC"));
        assertTrue(query.contains("LIMIT #{limit}"));
    }
}
