package com.aliyun.autowonder.workitem;

import com.aliyun.autowonder.agent.AgentDao;
import com.aliyun.autowonder.common.result.PageResult;
import com.aliyun.autowonder.dispatch.AgentSdlcResolver;
import com.aliyun.autowonder.dispatch.DispatchDO;
import com.aliyun.autowonder.dispatch.DispatchDao;
import com.aliyun.autowonder.dispatch.DispatchRuntimeEventDao;
import com.aliyun.autowonder.executor.ExecutorDao;
import com.aliyun.autowonder.guidance.GuidanceDao;
import com.aliyun.autowonder.integration.common.ExternalWorkitemLinkDao;
import com.aliyun.autowonder.squad.SquadMemberDao;
import com.aliyun.autowonder.squad.SquadNameResolver;
import com.aliyun.autowonder.statemachine.StatusNodeDao;
import com.aliyun.autowonder.statemachine.StatusTemplateDao;
import com.aliyun.autowonder.statemachine.StatusTransitionDao;
import com.aliyun.autowonder.user.UserDao;
import com.aliyun.autowonder.websocket.PresenceManager;
import com.aliyun.autowonder.workitem.dto.WorkitemVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 工作台列表扩展查询：多分类/关系并集/最近更新排序与原查询保持向后兼容，
 * 并按页批量投影本轮计时字段。
 */
class WorkitemServiceWorkbenchListTest {

    private WorkitemDao workitemDao;
    private WorkitemCommentDao commentDao;
    private WorkitemEventDao eventDao;
    private DispatchDao dispatchDao;
    private SquadNameResolver squadNameResolver;
    private WorkitemService service;

    @BeforeEach
    void setUp() {
        workitemDao = mock(WorkitemDao.class);
        commentDao = mock(WorkitemCommentDao.class);
        eventDao = mock(WorkitemEventDao.class);
        dispatchDao = mock(DispatchDao.class);
        squadNameResolver = mock(SquadNameResolver.class);
        service = new WorkitemService(
                workitemDao, commentDao, eventDao,
                mock(StatusTemplateDao.class), mock(StatusNodeDao.class), mock(StatusTransitionDao.class),
                mock(com.aliyun.autowonder.sdlc.SdlcDao.class), mock(com.aliyun.autowonder.sdlc.SdlcStepDao.class),
                dispatchDao, mock(DispatchRuntimeEventDao.class), mock(AgentDao.class),
                mock(AgentSdlcResolver.class), mock(SquadMemberDao.class), mock(ExecutorDao.class),
                mock(UserDao.class), mock(GuidanceDao.class), mock(PresenceManager.class),
                mock(ExternalWorkitemLinkDao.class), mock(ApplicationEventPublisher.class));
        service.setSquadNameResolver(squadNameResolver);
    }

    /** workitemDao.listExtended 共 24 个参数（旧 list 21 + 3 个扩展参数）。 */
    @SuppressWarnings("unchecked")
    private void stubExtendedRows(List<WorkitemDO> rows) {
        when(workitemDao.listExtended(
                any(), any(), any(), any(), any(), any(), any(), anyBoolean(),
                any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), anyBoolean(), any(), anyInt(), anyInt()))
                .thenReturn(rows);
    }

    @Test
    void extended_query_forwards_normalized_multi_value_params() {
        WorkitemDO row = new WorkitemDO();
        row.setId(1L);
        row.setTenantId(100L);
        row.setAssigneeType("HUMAN");
        row.setAssigneeRef(7L);
        stubExtendedRows(List.of(row));

        PageResult<WorkitemVO> page = service.list(null, null, null, "HUMAN", 7L, false, null,
                100L, 7L, null, null, null, null, null, null, null, null, false,
                " new, IN_PROGRESS ,bogus ", "created,watched,commented,hacked", "updated", 1, 5);

        assertEquals(1, page.getList().size());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<String>> categories = ArgumentCaptor.forClass(List.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<String>> scopes = ArgumentCaptor.forClass(List.class);
        verify(workitemDao).countExtended(
                any(), any(), any(), any(), categories.capture(), any(), any(), anyBoolean(),
                any(), scopes.capture(), any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), anyBoolean(), any());
        assertEquals(List.of("NEW", "IN_PROGRESS"), categories.getValue());
        assertEquals(List.of("CREATED", "WATCHED", "COMMENTED"), scopes.getValue());
        verify(workitemDao, never()).count(
                any(), any(), any(), any(), any(), any(), anyBoolean(),
                any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), anyBoolean());
    }

    @Test
    void unknown_extension_values_fall_back_to_legacy_query() {
        when(workitemDao.count(
                any(), any(), any(), any(), any(), any(), anyBoolean(),
                any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), anyBoolean()))
                .thenReturn(1L);
        when(workitemDao.list(
                any(), any(), any(), any(), any(), any(), anyBoolean(),
                any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), anyBoolean(),
                anyInt(), anyInt()))
                .thenReturn(List.of());

        service.list(null, null, null, null, null, false, null, 100L, 7L, null, null, null, null, null,
                null, null, null, false, "nope", "also-nope", "created", 1, 20);

        verify(workitemDao).count(
                any(), any(), any(), any(), any(), any(), anyBoolean(),
                any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), anyBoolean());
        verify(workitemDao, never()).countExtended(
                any(), any(), any(), any(), any(), any(), any(), anyBoolean(),
                any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void extended_query_projects_agent_round_timing_and_squad() {
        Date started = new Date(1_700_000_000_000L);
        WorkitemDO row = new WorkitemDO();
        row.setId(1L);
        row.setTenantId(100L);
        row.setAssigneeType("AGENT");
        row.setAssigneeRef(40013L);
        stubExtendedRows(List.of(row));

        DispatchDO otherAgent = new DispatchDO();
        otherAgent.setId(1L);
        otherAgent.setWorkitemId(1L);
        otherAgent.setAgentId(40014L);
        otherAgent.setStatus("SUCCEEDED");
        otherAgent.setGmtCreate(new Date(1_600_000_000_000L));
        DispatchDO currentAgent = new DispatchDO();
        currentAgent.setId(2L);
        currentAgent.setWorkitemId(1L);
        currentAgent.setAgentId(40013L);
        currentAgent.setStatus("RUNNING");
        currentAgent.setGmtCreate(started);
        when(dispatchDao.listByWorkitemIds(anyLong(), any())).thenReturn(List.of(otherAgent, currentAgent));
        when(dispatchDao.listLatestByWorkitemIds(anyLong(), any())).thenReturn(List.of(currentAgent));
        when(squadNameResolver.resolve(anyLong(), any(), any()))
                .thenReturn(Map.of(40013L, new SquadNameResolver.SquadLabel("交付小队", true)));

        PageResult<WorkitemVO> page = service.list(null, null, null, null, null, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, null, "CREATED", "UPDATED", 1, 5);

        WorkitemVO vo = page.getList().get(0);
        assertEquals(started, vo.getRoundStartedAt());
        assertNull(vo.getRoundEndedAt());
        assertEquals("交付小队", vo.getAssigneeSquadName());
    }

    @Test
    void paused_agent_round_stops_at_last_update() {
        Date started = new Date(1_700_000_000_000L);
        Date pausedAt = new Date(1_700_000_300_000L);
        WorkitemDO row = new WorkitemDO();
        row.setId(1L);
        row.setTenantId(100L);
        row.setAssigneeType("AGENT");
        row.setAssigneeRef(40013L);
        stubExtendedRows(List.of(row));

        DispatchDO paused = new DispatchDO();
        paused.setId(3L);
        paused.setWorkitemId(1L);
        paused.setAgentId(40013L);
        paused.setStatus("PAUSED");
        paused.setGmtCreate(started);
        paused.setGmtModified(pausedAt);
        when(dispatchDao.listByWorkitemIds(anyLong(), any())).thenReturn(List.of(paused));

        PageResult<WorkitemVO> page = service.list(null, null, null, null, null, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, null, "CREATED", "UPDATED", 1, 5);

        assertEquals(started, page.getList().get(0).getRoundStartedAt());
        assertEquals(pausedAt, page.getList().get(0).getRoundEndedAt());
    }

    @Test
    void human_round_start_uses_latest_assignment_to_current_assignee() {
        WorkitemDO row = new WorkitemDO();
        row.setId(1L);
        row.setTenantId(100L);
        row.setAssigneeType("HUMAN");
        row.setAssigneeRef(7L);
        stubExtendedRows(List.of(row));

        Date firstAssign = new Date(1_700_000_000_000L);
        Date latestAssign = new Date(1_700_000_600_000L);
        WorkitemEventDO first = assignEvent(1L, 7L, "HUMAN", firstAssign);
        WorkitemEventDO otherUser = assignEvent(2L, 9L, "HUMAN", new Date(1_700_000_300_000L));
        WorkitemEventDO wrongType = assignEvent(3L, 7L, "AGENT", new Date(1_700_000_400_000L));
        WorkitemEventDO latest = assignEvent(4L, 7L, "HUMAN", latestAssign);
        when(eventDao.listAssignEventsByWorkitemIds(anyLong(), any()))
                .thenReturn(List.of(first, otherUser, wrongType, latest));

        PageResult<WorkitemVO> page = service.list(null, null, null, "HUMAN", 7L, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, "NEW", null, "UPDATED", 1, 5);

        assertEquals(latestAssign, page.getList().get(0).getRoundStartedAt());
    }

    /** E2E-WB-1：MySQL json 列取回的详情带空格，必须按 JSON 解析而非序列化文本字面量匹配。 */
    @Test
    void human_round_start_accepts_mysql_normalized_detail_json() {
        stubExtendedRows(List.of(humanRow(1L, 7L, 100L)));
        Date assignedAt = new Date(1_700_000_600_000L);
        WorkitemEventDO humanEvent = assignEvent(1L, 7L, "HUMAN", assignedAt);
        humanEvent.setDetailJson("{\"toType\": \"HUMAN\", \"fromType\": \"HUMAN\"}");
        WorkitemEventDO agentEvent = assignEvent(2L, 7L, "AGENT", new Date(1_700_000_900_000L));
        agentEvent.setDetailJson("{\"toType\": \"AGENT\", \"fromType\": \"HUMAN\"}");
        when(eventDao.listAssignEventsByWorkitemIds(anyLong(), any()))
                .thenReturn(List.of(humanEvent, agentEvent));

        PageResult<WorkitemVO> page = service.list(null, null, null, "HUMAN", 7L, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, "NEW", null, "UPDATED", 1, 5);

        assertEquals(assignedAt, page.getList().get(0).getRoundStartedAt());
    }

    /** 事件详情非法时按不匹配处理，不得抛异常影响列表。 */
    @Test
    void malformed_assignment_detail_is_ignored() {
        stubExtendedRows(List.of(humanRow(1L, 7L, 100L)));
        WorkitemEventDO malformed = assignEvent(1L, 7L, "HUMAN", new Date(1_700_000_600_000L));
        malformed.setDetailJson("toType=HUMAN");
        when(eventDao.listAssignEventsByWorkitemIds(anyLong(), any())).thenReturn(List.of(malformed));

        PageResult<WorkitemVO> page = service.list(null, null, null, "HUMAN", 7L, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, "NEW", null, "UPDATED", 1, 5);

        assertNull(page.getList().get(0).getRoundStartedAt());
    }

    @Test
    void blank_extension_values_keep_the_legacy_query() {
        when(workitemDao.count(
                any(), any(), any(), any(), any(), any(), anyBoolean(),
                any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), anyBoolean()))
                .thenReturn(0L);
        when(workitemDao.list(
                any(), any(), any(), any(), any(), any(), anyBoolean(),
                any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), anyBoolean(),
                anyInt(), anyInt()))
                .thenReturn(List.of());

        service.list(null, null, null, null, null, false, null, 100L, 7L, null, null, null, null, null,
                null, null, null, false, "   ", " , ", "\t", 1, 20);

        verify(workitemDao).count(
                any(), any(), any(), any(), any(), any(), anyBoolean(),
                any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), anyBoolean());
        verify(workitemDao, never()).countExtended(
                any(), any(), any(), any(), any(), any(), any(), anyBoolean(),
                any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void agent_round_without_matching_dispatch_has_no_timing() {
        stubExtendedRows(List.of(agentRow(40013L, 100L)));
        DispatchDO otherAgent = dispatch(1L, 1L, 40014L, "RUNNING", 1_600_000_000_000L, null);
        when(dispatchDao.listByWorkitemIds(anyLong(), any())).thenReturn(List.of(otherAgent));
        when(squadNameResolver.resolve(anyLong(), any(), any())).thenReturn(null);

        PageResult<WorkitemVO> page = service.list(null, null, null, null, null, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, null, "CREATED", "UPDATED", 1, 5);

        WorkitemVO vo = page.getList().get(0);
        assertNull(vo.getRoundStartedAt());
        assertNull(vo.getRoundEndedAt());
        assertNull(vo.getAssigneeSquadName());
    }

    @Test
    void terminal_agent_dispatch_freezes_the_round_at_last_update() {
        Date started = new Date(1_700_000_000_000L);
        Date ended = new Date(1_700_000_300_000L);
        stubExtendedRows(List.of(agentRow(40013L, 100L)));
        when(dispatchDao.listByWorkitemIds(anyLong(), any()))
                .thenReturn(List.of(dispatch(5L, 1L, 40013L, "SUCCEEDED", started.getTime(), ended)));

        PageResult<WorkitemVO> page = service.list(null, null, null, null, null, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, null, "CREATED", "UPDATED", 1, 5);

        assertEquals(started, page.getList().get(0).getRoundStartedAt());
        assertEquals(ended, page.getList().get(0).getRoundEndedAt());
    }

    @Test
    void dispatch_without_id_does_not_replace_the_current_round() {
        Date firstSeen = new Date(1_700_000_000_000L);
        Date later = new Date(1_700_000_300_000L);
        stubExtendedRows(List.of(agentRow(40013L, 100L)));
        when(dispatchDao.listByWorkitemIds(anyLong(), any())).thenReturn(List.of(
                dispatch(null, 1L, 40013L, "RUNNING", firstSeen.getTime(), null),
                dispatch(7L, 1L, 40013L, "RUNNING", later.getTime(), null)));

        PageResult<WorkitemVO> page = service.list(null, null, null, null, null, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, null, "CREATED", "UPDATED", 1, 5);

        assertEquals(firstSeen, page.getList().get(0).getRoundStartedAt());
    }

    @Test
    void null_dispatch_id_never_wins_the_comparison() {
        Date identified = new Date(1_700_000_000_000L);
        stubExtendedRows(List.of(agentRow(40013L, 100L)));
        when(dispatchDao.listByWorkitemIds(anyLong(), any())).thenReturn(List.of(
                dispatch(7L, 1L, 40013L, "RUNNING", identified.getTime(), null),
                dispatch(null, 1L, 40013L, "RUNNING", 1_700_000_300_000L, null)));

        PageResult<WorkitemVO> page = service.list(null, null, null, null, null, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, null, "CREATED", "UPDATED", 1, 5);

        assertEquals(identified, page.getList().get(0).getRoundStartedAt());
    }

    /** QA-F1：同一数字员工多次派发时按派发 id 取最新一次，不能被更早的轮次覆盖。 */
    @Test
    void latest_agent_dispatch_wins_the_round_timing() {
        Date earlier = new Date(1_700_000_000_000L);
        Date later = new Date(1_700_000_600_000L);
        stubExtendedRows(List.of(agentRow(40013L, 100L)));
        when(dispatchDao.listByWorkitemIds(anyLong(), any())).thenReturn(List.of(
                dispatch(7L, 1L, 40013L, "RUNNING", earlier.getTime(), null),
                dispatch(9L, 1L, 40013L, "RUNNING", later.getTime(), null)));

        PageResult<WorkitemVO> page = service.list(null, null, null, null, null, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, null, "CREATED", "UPDATED", 1, 5);

        assertEquals(later, page.getList().get(0).getRoundStartedAt());
    }

    /** QA-F1：id 更大者先出现时，后出现的小 id 派发不得替换当前轮次。 */
    @Test
    void smaller_dispatch_id_does_not_replace_the_newer_round() {
        Date identified = new Date(1_700_000_000_000L);
        Date laterButSmallerId = new Date(1_700_000_900_000L);
        stubExtendedRows(List.of(agentRow(40013L, 100L)));
        when(dispatchDao.listByWorkitemIds(anyLong(), any())).thenReturn(List.of(
                dispatch(9L, 1L, 40013L, "RUNNING", identified.getTime(), null),
                dispatch(7L, 1L, 40013L, "RUNNING", laterButSmallerId.getTime(), null)));

        PageResult<WorkitemVO> page = service.list(null, null, null, null, null, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, null, "CREATED", "UPDATED", 1, 5);

        assertEquals(identified, page.getList().get(0).getRoundStartedAt());
    }

    /** NB2：仅 sortBy=UPDATED 一个扩展参数也应走扩展查询，而不是回落旧查询。 */
    @Test
    void updated_sort_alone_triggers_the_extended_query() {
        when(workitemDao.countExtended(
                any(), any(), any(), any(), any(), any(), any(), anyBoolean(),
                any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), anyBoolean(), any()))
                .thenReturn(0L);
        stubExtendedRows(List.of());

        service.list(null, null, null, null, null, false, null, 100L, 7L, null, null, null, null, null,
                null, null, null, false, null, null, "UPDATED", 1, 20);

        verify(workitemDao).countExtended(
                any(), any(), any(), any(), any(), any(), any(), anyBoolean(),
                any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), anyBoolean(), any());
        verify(workitemDao, never()).count(
                any(), any(), any(), any(), any(), any(), anyBoolean(),
                any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), anyBoolean());
    }

    @Test
    void incomplete_assignment_events_are_ignored() {
        stubExtendedRows(List.of(humanRow(1L, 7L, 100L)));
        Date valid = new Date(1_700_000_600_000L);
        WorkitemEventDO noWorkitem = assignEvent(2L, 7L, "HUMAN", new Date(1_700_000_100_000L));
        noWorkitem.setWorkitemId(null);
        WorkitemEventDO noTime = assignEvent(3L, 7L, "HUMAN", null);
        WorkitemEventDO noDetail = assignEvent(4L, 7L, "HUMAN", new Date(1_700_000_200_000L));
        noDetail.setDetailJson(null);
        WorkitemEventDO noToVal = assignEvent(5L, 7L, "HUMAN", new Date(1_700_000_300_000L));
        noToVal.setToVal(null);
        WorkitemEventDO otherWorkitem = assignEvent(6L, 7L, "HUMAN", new Date(1_700_000_400_000L));
        otherWorkitem.setWorkitemId(999L);
        when(eventDao.listAssignEventsByWorkitemIds(anyLong(), any())).thenReturn(java.util.Arrays.asList(
                null,
                noWorkitem,
                noTime,
                noDetail,
                noToVal,
                assignEvent(7L, 7L, "AGENT", new Date(1_700_000_450_000L)),
                otherWorkitem,
                assignEvent(8L, 9L, "HUMAN", new Date(1_700_000_500_000L)),
                assignEvent(9L, 7L, "HUMAN", valid)));

        PageResult<WorkitemVO> page = service.list(null, null, null, "HUMAN", 7L, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, "NEW", null, "UPDATED", 1, 5);

        assertEquals(valid, page.getList().get(0).getRoundStartedAt());
    }

    @Test
    void rows_without_agent_reference_have_no_round_fields() {
        WorkitemDO unassigned = new WorkitemDO();
        unassigned.setId(1L);
        unassigned.setTenantId(100L);
        WorkitemDO agentWithoutRef = new WorkitemDO();
        agentWithoutRef.setId(2L);
        agentWithoutRef.setTenantId(100L);
        agentWithoutRef.setAssigneeType("AGENT");
        stubExtendedRows(List.of(unassigned, agentWithoutRef));

        PageResult<WorkitemVO> page = service.list(null, null, null, null, null, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, "NEW", null, "UPDATED", 1, 5);

        for (WorkitemVO vo : page.getList()) {
            assertNull(vo.getRoundStartedAt());
            assertNull(vo.getAssigneeSquadName());
        }
        verify(eventDao, never()).listAssignEventsByWorkitemIds(anyLong(), any());
    }

    @Test
    void extended_query_without_resolver_skips_squad_projection() {
        Date started = new Date(1_700_000_000_000L);
        service.setSquadNameResolver(null);
        stubExtendedRows(List.of(agentRow(40013L, 100L)));
        when(dispatchDao.listByWorkitemIds(anyLong(), any()))
                .thenReturn(List.of(dispatch(5L, 1L, 40013L, "RUNNING", started.getTime(), null)));

        PageResult<WorkitemVO> page = service.list(null, null, null, null, null, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, null, "CREATED", "UPDATED", 1, 5);

        assertEquals(started, page.getList().get(0).getRoundStartedAt());
        assertNull(page.getList().get(0).getAssigneeSquadName());
    }

    @Test
    void extended_query_without_row_tenant_skips_squad_projection() {
        Date started = new Date(1_700_000_000_000L);
        stubExtendedRows(List.of(agentRow(40013L, null)));
        when(dispatchDao.listByWorkitemIds(anyLong(), any()))
                .thenReturn(List.of(dispatch(5L, 1L, 40013L, "RUNNING", started.getTime(), null)));

        PageResult<WorkitemVO> page = service.list(null, null, null, null, null, false, null, 100L, 7L,
                null, null, null, null, null, null, null, null, false, null, "CREATED", "UPDATED", 1, 5);

        assertEquals(started, page.getList().get(0).getRoundStartedAt());
        assertNull(page.getList().get(0).getAssigneeSquadName());
    }

    private static WorkitemDO agentRow(Long assigneeRef, Long tenantId) {
        WorkitemDO row = new WorkitemDO();
        row.setId(1L);
        row.setTenantId(tenantId);
        row.setAssigneeType("AGENT");
        row.setAssigneeRef(assigneeRef);
        return row;
    }

    private static WorkitemDO humanRow(Long id, Long assigneeRef, Long tenantId) {
        WorkitemDO row = new WorkitemDO();
        row.setId(id);
        row.setTenantId(tenantId);
        row.setAssigneeType("HUMAN");
        row.setAssigneeRef(assigneeRef);
        return row;
    }

    private static DispatchDO dispatch(Long id, Long workitemId, Long agentId, String status,
                                       Long createdMs, Date modified) {
        DispatchDO dispatch = new DispatchDO();
        dispatch.setId(id);
        dispatch.setWorkitemId(workitemId);
        dispatch.setAgentId(agentId);
        dispatch.setStatus(status);
        dispatch.setGmtCreate(createdMs == null ? null : new Date(createdMs));
        dispatch.setGmtModified(modified);
        return dispatch;
    }

    private static WorkitemEventDO assignEvent(Long id, Long toRef, String toType, Date time) {
        WorkitemEventDO event = new WorkitemEventDO();
        event.setId(id);
        event.setWorkitemId(1L);
        event.setEventType("ASSIGN");
        event.setToVal(String.valueOf(toRef));
        event.setDetailJson("{\"toType\":\"" + toType + "\"}");
        event.setGmtCreate(time);
        return event;
    }
}
