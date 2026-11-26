package com.aliyun.autowonder.agent;

import com.aliyun.autowonder.agent.dto.AgentVO;
import com.aliyun.autowonder.agent.dto.UpdateAgentTagsRequest;
import com.aliyun.autowonder.audit.AuditLogRecord;
import com.aliyun.autowonder.audit.AuditLogService;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AgentTagServiceTest {

    private static final long TENANT = 1L;
    private static final long USER = 9L;
    private static final long AGENT_ID = 100L;

    AgentTagDao tagDao;
    AuditLogService auditLogService;
    AgentTagService service;

    @BeforeEach
    void setUp() {
        tagDao = mock(AgentTagDao.class);
        auditLogService = mock(AuditLogService.class);
        service = new AgentTagService(tagDao, auditLogService);
    }

    private AgentDO agent(String kind) {
        AgentDO agent = new AgentDO();
        agent.setId(AGENT_ID);
        agent.setTenantId(TENANT);
        agent.setKind(kind);
        return agent;
    }

    private UpdateAgentTagsRequest request(List<String> system, List<String> custom) {
        UpdateAgentTagsRequest req = new UpdateAgentTagsRequest();
        req.setSystemTags(system);
        req.setCustomTags(custom);
        return req;
    }

    private AgentTagDO row(String type, String code, String name) {
        AgentTagDO row = new AgentTagDO();
        row.setTenantId(TENANT);
        row.setAssetType("AGENT");
        row.setAssetId(AGENT_ID);
        row.setTagType(type);
        row.setTagCode(code);
        row.setTagName(name);
        return row;
    }

    private void assertCode(ErrorCode expected, Executable executable) {
        BizException ex = assertThrows(BizException.class, () -> executable.run());
        assertEquals(expected.getCode(), ex.getCode());
    }

    private interface Executable {
        void run();
    }

    @Test
    void platformAgentTagsAreRejectedWithoutTouchingStorage() {
        assertCode(ErrorCode.AGENT_PLATFORM_TAG_LOCKED, () ->
                service.replaceTags(agent("PLATFORM"), request(List.of(), List.of("x")), TENANT, USER));

        verifyNoInteractions(tagDao);
    }

    @Test
    void nullRequestIsRejected() {
        assertCode(ErrorCode.PARAM_INVALID, () -> service.replaceTags(agent("STANDARD"), null, TENANT, USER));
    }

    @Test
    void unknownSystemCodeIsRejectedWithTheOffendingValue() {
        BizException ex = assertThrows(BizException.class, () -> service.replaceTags(
                agent("STANDARD"), request(List.of(" NOT_A_TAG "), List.of()), TENANT, USER));

        assertEquals(ErrorCode.AGENT_TAG_INVALID_SYSTEM_CODE.getCode(), ex.getCode());
        assertEquals("error.agent_tag_invalid_system_code", ex.getMessageKey());
        assertEquals("NOT_A_TAG", ex.getMessageArgs()[0]);
    }

    @Test
    void overlongCustomTagIsRejected() {
        String tooLong = "a".repeat(AgentTagService.MAX_AGENT_TAG_LENGTH + 1);

        BizException ex = assertThrows(BizException.class, () -> service.replaceTags(
                agent("STANDARD"), request(List.of(), List.of(tooLong)), TENANT, USER));

        assertEquals(ErrorCode.AGENT_TAG_TOO_LONG.getCode(), ex.getCode());
        assertEquals(AgentTagService.MAX_AGENT_TAG_LENGTH, ex.getMessageArgs()[0]);
    }

    @Test
    void customTagMatchingChineseSystemNameIsRejected() {
        assertCode(ErrorCode.AGENT_TAG_SYSTEM_CONFLICT, () -> service.replaceTags(
                agent("STANDARD"), request(List.of(), List.of("  需求澄清 ")), TENANT, USER));
    }

    @Test
    void customTagMatchingEnglishSystemNameCaseInsensitivelyIsRejected() {
        assertCode(ErrorCode.AGENT_TAG_SYSTEM_CONFLICT, () -> service.replaceTags(
                agent("STANDARD"), request(List.of(), List.of("prototype design")), TENANT, USER));
    }

    @Test
    void moreThanFiftyTagsIsRejected() {
        List<String> custom = new ArrayList<>();
        for (int index = 0; index <= AgentTagService.MAX_AGENT_TAGS; index++) {
            custom.add("tag-" + index);
        }

        BizException ex = assertThrows(BizException.class, () -> service.replaceTags(
                agent("STANDARD"), request(List.of(), custom), TENANT, USER));

        assertEquals(ErrorCode.AGENT_TAG_TOO_MANY.getCode(), ex.getCode());
        assertEquals(AgentTagService.MAX_AGENT_TAGS, ex.getMessageArgs()[0]);
    }

    @Test
    void updateTrimsDedupesSortsAndWritesOneBatchWithAudit() {
        when(tagDao.listByAgent(TENANT, AGENT_ID)).thenReturn(List.of());

        service.replaceTags(agent("STANDARD"), request(
                Arrays.asList(" prototype_design ", "REQ_CLARIFY", "req_clarify", null, "  "),
                Arrays.asList(" 报表 ", "报表", "", null, "React")), TENANT, USER);

        verify(tagDao).deleteByAgent(TENANT, AGENT_ID);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<AgentTagDO>> rows = ArgumentCaptor.forClass(List.class);
        verify(tagDao).insertBatch(rows.capture());
        List<AgentTagDO> written = rows.getValue();
        assertEquals(4, written.size());
        assertEquals("SYSTEM", written.get(0).getTagType());
        assertEquals("REQ_CLARIFY", written.get(0).getTagCode());
        assertEquals("REQ_CLARIFY", written.get(0).getTagName());
        assertEquals("PROTOTYPE_DESIGN", written.get(1).getTagCode());
        assertEquals("CUSTOM", written.get(2).getTagType());
        assertNull(written.get(2).getTagCode());
        assertEquals("报表", written.get(2).getTagName());
        assertEquals("React", written.get(3).getTagName());
        assertEquals(Long.valueOf(USER), written.get(0).getCreatorId());
        assertEquals("AGENT", written.get(0).getAssetType());
        assertEquals(Long.valueOf(AGENT_ID), written.get(0).getAssetId());

        AuditLogRecord record = captureAudit();
        assertEquals("agent", record.getModule());
        assertEquals("agent.tag.update", record.getAction());
        assertEquals("AGENT", record.getTargetType());
        assertEquals(Long.valueOf(AGENT_ID), record.getTargetId());
        assertEquals("HUMAN", record.getActorType());
        assertEquals(Long.valueOf(USER), record.getActorId());
        assertEquals(4, asList(record.getDetail().get("added")).size());
        assertEquals(0, asList(record.getDetail().get("removed")).size());
        assertEquals(List.of("REQ_CLARIFY", "PROTOTYPE_DESIGN"), record.getDetail().get("systemTags"));
        assertEquals(List.of("报表", "React"), record.getDetail().get("customTags"));
    }

    @Test
    void unchangedTagSetSkipsWriteAndAuditEvenWhenOrderDiffers() {
        when(tagDao.listByAgent(TENANT, AGENT_ID)).thenReturn(List.of(
                row("CUSTOM", null, "React"),
                row("SYSTEM", "PROTOTYPE_DESIGN", "PROTOTYPE_DESIGN"),
                row("SYSTEM", "REQ_CLARIFY", "REQ_CLARIFY")));

        service.replaceTags(agent("STANDARD"), request(
                List.of("REQ_CLARIFY", "PROTOTYPE_DESIGN"), List.of("React")), TENANT, USER);

        verify(tagDao, never()).deleteByAgent(anyLong(), anyLong());
        verify(tagDao, never()).insertBatch(anyList());
        verifyNoInteractions(auditLogService);
    }

    @Test
    void auditListsAddedAndRemovedTagsWithSystemCodes() {
        when(tagDao.listByAgent(TENANT, AGENT_ID)).thenReturn(List.of(
                row("SYSTEM", "REQ_CLARIFY", "REQ_CLARIFY"),
                row("CUSTOM", null, "旧标签")));

        service.replaceTags(agent("STANDARD"), request(List.of("PROTOTYPE_DESIGN"), List.of()), TENANT, USER);

        AuditLogRecord record = captureAudit();
        List<Map<String, Object>> added = asMaps(record.getDetail().get("added"));
        List<Map<String, Object>> removed = asMaps(record.getDetail().get("removed"));
        assertEquals(1, added.size());
        assertEquals("SYSTEM", added.get(0).get("type"));
        assertEquals("PROTOTYPE_DESIGN", added.get(0).get("name"));
        assertEquals(2, removed.size());
        assertTrue(removed.stream().anyMatch(ref -> "SYSTEM".equals(ref.get("type"))
                && "REQ_CLARIFY".equals(ref.get("name"))));
        assertTrue(removed.stream().anyMatch(ref -> "CUSTOM".equals(ref.get("type"))
                && "旧标签".equals(ref.get("name"))));
        assertEquals(List.of("PROTOTYPE_DESIGN"), record.getDetail().get("systemTags"));
        assertEquals(List.of(), record.getDetail().get("customTags"));
    }

    @Test
    void clearingAllTagsIsAllowedAndDeletesRows() {
        when(tagDao.listByAgent(TENANT, AGENT_ID)).thenReturn(List.of(row("CUSTOM", null, "React")));

        service.replaceTags(agent("STANDARD"), request(null, null), TENANT, USER);

        verify(tagDao).deleteByAgent(TENANT, AGENT_ID);
        verify(tagDao, never()).insertBatch(anyList());
        assertEquals(1, asList(captureAudit().getDetail().get("removed")).size());
    }

    @Test
    void auditFailureNeverBlocksTagWrites() {
        AgentTagService withoutAudit = new AgentTagService(tagDao);
        when(tagDao.listByAgent(TENANT, AGENT_ID)).thenReturn(null);

        assertDoesNotThrow(() -> withoutAudit.replaceTags(
                agent("STANDARD"), request(List.of("REQ_CLARIFY"), List.of("React")), TENANT, USER));

        verify(tagDao).insertBatch(anyList());
    }

    @Test
    void fillTagsGroupsRowsAndOrdersSystemTagsByEnum() {
        AgentVO first = new AgentVO();
        first.setId(1L);
        AgentVO second = new AgentVO();
        second.setId(2L);
        AgentVO third = new AgentVO();
        third.setId(3L);
        List<AgentVO> vos = Arrays.asList(first, null, second, third);

        AgentTagDO prototype = row("SYSTEM", "PROTOTYPE_DESIGN", "PROTOTYPE_DESIGN");
        prototype.setAssetId(1L);
        AgentTagDO requirement = row("SYSTEM", null, "REQ_CLARIFY");
        requirement.setAssetId(1L);
        AgentTagDO unknown = row("SYSTEM", "UNKNOWN", "UNKNOWN");
        unknown.setAssetId(1L);
        AgentTagDO custom = row("CUSTOM", null, "报表");
        custom.setAssetId(1L);
        AgentTagDO brokenAsset = row("CUSTOM", null, "ignored");
        brokenAsset.setAssetId(null);
        AgentTagDO secondAgent = row("CUSTOM", null, "React");
        secondAgent.setAssetId(2L);
        AgentTagDO otherType = new AgentTagDO();
        otherType.setAssetId(2L);
        otherType.setTagType("OTHER");
        otherType.setTagName("ignored");
        AgentTagDO namelessCustom = new AgentTagDO();
        namelessCustom.setAssetId(3L);
        namelessCustom.setTagType("CUSTOM");
        AgentTagDO namelessSystem = new AgentTagDO();
        namelessSystem.setAssetId(3L);
        namelessSystem.setTagType("SYSTEM");

        when(tagDao.listByAgentIds(eq(TENANT), anyList())).thenReturn(Arrays.asList(
                prototype, requirement, unknown, custom, null, brokenAsset, secondAgent, otherType,
                namelessCustom, namelessSystem));

        service.fillTags(vos, TENANT);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Long>> ids = ArgumentCaptor.forClass(List.class);
        verify(tagDao).listByAgentIds(eq(TENANT), ids.capture());
        assertEquals(List.of(1L, 2L, 3L), ids.getValue());
        assertEquals(List.of("REQ_CLARIFY", "PROTOTYPE_DESIGN", "UNKNOWN"), first.getSystemTags());
        assertEquals(List.of("报表"), first.getCustomTags());
        assertEquals(List.of(), second.getSystemTags());
        assertEquals(List.of("React"), second.getCustomTags());
        assertEquals(List.of(), third.getSystemTags());
        assertEquals(List.of(), third.getCustomTags());
    }

    @Test
    void existingRowsWithMissingValuesAreToleratedAndDiffedSafely() {
        AgentTagDO nullSystem = new AgentTagDO();
        nullSystem.setTagType("SYSTEM");
        AgentTagDO blankCustom = new AgentTagDO();
        blankCustom.setTagType("CUSTOM");
        blankCustom.setTagName("   ");
        AgentTagDO kept = row("CUSTOM", null, "keep");
        when(tagDao.listByAgent(TENANT, AGENT_ID)).thenReturn(
                Arrays.asList(null, nullSystem, blankCustom, kept));

        service.replaceTags(agent("STANDARD"), request(List.of(), List.of("keep", "add")), TENANT, USER);

        verify(tagDao).deleteByAgent(TENANT, AGENT_ID);
        AuditLogRecord record = captureAudit();
        assertEquals(1, asList(record.getDetail().get("added")).size());
        assertEquals(0, asList(record.getDetail().get("removed")).size());
        assertEquals(List.of("keep", "add"), record.getDetail().get("customTags"));
    }

    @Test
    void fillTagsChunksLargeIdSetsAndToleratesNullRows() {
        List<AgentVO> vos = new ArrayList<>();
        for (long id = 1; id <= 401; id++) {
            AgentVO vo = new AgentVO();
            vo.setId(id);
            vos.add(vo);
        }
        when(tagDao.listByAgentIds(eq(TENANT), anyList())).thenReturn(null);

        service.fillTags(vos, TENANT);

        verify(tagDao, times(3)).listByAgentIds(eq(TENANT), anyList());
        assertTrue(vos.stream().allMatch(vo -> vo.getSystemTags().isEmpty() && vo.getCustomTags().isEmpty()));
    }

    @Test
    void fillTagsIgnoresEmptyInput() {
        service.fillTags(Collections.emptyList(), TENANT);

        verifyNoInteractions(tagDao);
    }

    @Test
    void listTagOptionsDelegatesWithLimitAndNormalizesNull() {
        when(tagDao.listCustomTagOptions(TENANT, AgentTagService.MAX_TAG_OPTIONS))
                .thenReturn(List.of("报表"));
        assertEquals(List.of("报表"), service.listTagOptions(TENANT));

        when(tagDao.listCustomTagOptions(TENANT, AgentTagService.MAX_TAG_OPTIONS)).thenReturn(null);
        assertEquals(List.of(), service.listTagOptions(TENANT));
        verify(tagDao, times(2)).listCustomTagOptions(eq(TENANT), anyInt());
    }

    private AuditLogRecord captureAudit() {
        ArgumentCaptor<AuditLogRecord> captor = ArgumentCaptor.forClass(AuditLogRecord.class);
        verify(auditLogService).record(captor.capture());
        return captor.getValue();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> asMaps(Object value) {
        return (List<Map<String, Object>>) value;
    }

    private List<?> asList(Object value) {
        return (List<?>) value;
    }

    @Test
    void systemTagLookupIsCaseInsensitiveAndTrimmed() {
        assertEquals(AgentSystemTag.REQ_CLARIFY, AgentSystemTag.fromCode(" req_clarify "));
        assertNull(AgentSystemTag.fromCode("  "));
        assertNull(AgentSystemTag.fromCode(null));
        assertTrue(AgentSystemTag.REQ_CLARIFY.matchesDisplayName(" 需求澄清"));
        assertTrue(AgentSystemTag.PROTOTYPE_DESIGN.matchesDisplayName("PROTOTYPE DESIGN"));
        assertTrue(!AgentSystemTag.REQ_CLARIFY.matchesDisplayName(null));
    }
}
