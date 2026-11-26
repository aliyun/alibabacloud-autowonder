package com.aliyun.autowonder.insights;

import com.aliyun.autowonder.common.error.KeyedIllegalArgumentException;
import com.aliyun.autowonder.common.web.GlobalExceptionHandler;
import com.aliyun.autowonder.context.AutoWonderContext;
import com.aliyun.autowonder.insights.dto.StageDurationPlanVO;
import com.aliyun.autowonder.insights.dto.StageDurationVO;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.time.LocalDate;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class StageDurationControllerTest {
    private final StageDurationService service = mock(StageDurationService.class);
    private final MockMvc http = MockMvcBuilders.standaloneSetup(new StageDurationController(service))
            .setControllerAdvice(new GlobalExceptionHandler()).build();

    @AfterEach
    void cleanup() { AutoWonderContext.destroy(); }

    @Test
    void scopesFiltersToTheCurrentWorkspaceAndParsesDates() throws Exception {
        AutoWonderContext.get().setCurrentWorkspaceId(9L);
        when(service.get(9, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 7), 7L, 5L, "stage", null, null, null, false, null)).thenReturn(new StageDurationVO());
        http.perform(get("/api/insights/stage-duration").param("start_date", "2026-01-01").param("end_date", "2026-01-07")
                        .param("squad_id", "7").param("sdlc_id", "5").param("workspaceId", "99"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true));
        verify(service).get(9, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 7), 7L, 5L, "stage", null, null, null, false, null);
    }

    @Test
    void passesVersionGroupingWithoutAcceptingAnotherWorkspace() throws Exception {
        AutoWonderContext.get().setCurrentWorkspaceId(9L);
        http.perform(get("/api/insights/stage-duration").param("start_date", "2026-01-01").param("end_date", "2026-01-07")
                        .param("group_by", "agent_version").param("exclude_canceled_workitems", "true").param("workspaceId", "99"))
                .andExpect(status().isOk());
        verify(service).get(9, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 7), null, null, "agent_version", null, null, null, true, null);
    }

    @Test
    void planUsesTheAuthorizedWorkspaceAndForwardsEveryFilter() throws Exception {
        http.perform(get("/api/insights/stage-duration/plan").param("start_date", "2026-01-01").param("end_date", "2026-01-07"))
                .andExpect(status().isForbidden());
        AutoWonderContext.get().setCurrentWorkspaceId(9L);
        var plan = new StageDurationPlanVO();
        plan.setMode("sharded");
        plan.setExecutionCount(1200);
        var shard = new StageDurationPlanVO.Shard();
        shard.setSdlcId(5L);
        shard.setSdlcName("Flow 5");
        shard.setExecutionCount(1200);
        plan.setShards(java.util.List.of(shard));
        when(service.plan(9, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 7), 7L, 5L, null, null, null, true)).thenReturn(plan);
        http.perform(get("/api/insights/stage-duration/plan").param("start_date", "2026-01-01").param("end_date", "2026-01-07")
                        .param("squad_id", "7").param("sdlc_id", "5").param("exclude_canceled_workitems", "true").param("workspaceId", "99"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.mode").value("sharded"))
                .andExpect(jsonPath("$.data.shards[0].sdlcId").value(5));
        verify(service).plan(9, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 7), 7L, 5L, null, null, null, true);
        http.perform(get("/api/insights/stage-duration/plan").param("start_date", "bad").param("end_date", "2026-01-07"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void forwardsTheSnapshotAnchorToTheAggregateQuery() throws Exception {
        AutoWonderContext.get().setCurrentWorkspaceId(9L);
        http.perform(get("/api/insights/stage-duration").param("start_date", "2026-01-01").param("end_date", "2026-01-07")
                        .param("max_dispatch_id", "42"))
                .andExpect(status().isOk());
        verify(service).get(9, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 7), null, null, "stage", null, null, null, false, 42L);
    }

    @Test
    void versionComparisonAcceptsSharedDatesAndCannotChooseAnotherWorkspace() throws Exception {
        http.perform(get("/api/insights/stage-duration/versions").param("agent_id", "7"))
                .andExpect(status().isForbidden());
        AutoWonderContext.get().setCurrentWorkspaceId(9L);
        http.perform(get("/api/insights/stage-duration/versions").param("agent_id", "7").param("workspaceId", "99"))
                .andExpect(status().isOk());
        verify(service).versions(9, 7, false);
        http.perform(get("/api/insights/stage-duration/version-samples").param("agent_id", "7")
                        .param("version_ids", "70,71").param("start_date", "2026-01-01").param("end_date", "2026-01-07").param("workspaceId", "99"))
                .andExpect(status().isOk());
        verify(service).versionSamples(9, 7, java.util.List.of(70L, 71L), LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 7), false);
        http.perform(get("/api/insights/stage-duration/version-samples").param("agent_id", "7").param("version_ids", "70,71"))
                .andExpect(status().isOk());
        verify(service).versionSamples(9, 7, java.util.List.of(70L, 71L), null, null, false);
        http.perform(get("/api/insights/stage-duration").param("start_date", "2026-01-01")
                        .param("end_date", "2026-01-07").param("agent_id", "7"))
                .andExpect(status().isOk());
        verify(service).get(9, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 7), null, null, "stage", 7L, null, null, false, null);
    }

    @Test
    void rejectsMalformedOrPartialVersionDatesWithoutQueryingOrAcceptingAnotherWorkspace() throws Exception {
        http.perform(get("/api/insights/stage-duration/version-samples").param("agent_id", "7").param("version_ids", "70"))
                .andExpect(status().isForbidden());
        AutoWonderContext.get().setCurrentWorkspaceId(9L);
        for (String[] dates : new String[][]{{"bad", "2026-01-07"}, {"2026-01-01", ""}, {"", "2026-01-07"}}) {
            http.perform(get("/api/insights/stage-duration/version-samples").param("agent_id", "7").param("version_ids", "70")
                            .param("start_date", dates[0]).param("end_date", dates[1]))
                    .andExpect(status().isBadRequest());
        }
        http.perform(get("/api/insights/stage-duration/version-samples").param("agent_id", "7").param("version_ids", "70").param("start_date", "2026-01-01"))
                .andExpect(status().isBadRequest());
        http.perform(get("/api/insights/stage-duration/version-samples").param("agent_id", "7").param("version_ids", "70").param("end_date", "2026-01-07"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    void rejectsMissingMembershipAndMalformedDatesBeforeQuerying() throws Exception {
        http.perform(get("/api/insights/stage-duration").param("start_date", "2026-01-01").param("end_date", "2026-01-07"))
                .andExpect(status().isForbidden());
        AutoWonderContext.get().setCurrentWorkspaceId(9L);
        http.perform(get("/api/insights/stage-duration").param("start_date", "bad").param("end_date", "2026-01-07"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    void recoveryIsExplicitAndUsesTheAuthorizedWorkspaceAndValidatedDates() throws Exception {
        http.perform(post("/api/insights/stage-duration/recover-snapshots").param("start_date", "2026-01-01").param("end_date", "2026-01-07"))
                .andExpect(status().isForbidden());
        AutoWonderContext.get().setCurrentWorkspaceId(9L);
        http.perform(post("/api/insights/stage-duration/recover-snapshots").param("start_date", "invalid").param("end_date", "2026-01-07"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
        when(service.recoverSnapshots(9, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 7), 7L, 5L, null))
                .thenReturn(new StageDurationVO.Recovery(20, 17, 2, 1, 5, 21L));
        http.perform(post("/api/insights/stage-duration/recover-snapshots").param("start_date", "2026-01-01").param("end_date", "2026-01-07")
                        .param("squad_id", "7").param("sdlc_id", "5").param("workspaceId", "99"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.checked").value(20)).andExpect(jsonPath("$.data.remaining").value(5));
        verify(service).recoverSnapshots(9, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 7), 7L, 5L, null);
    }

    @Test
    void forwardsTheRecoveryCursorAndScopesHistoricalWorkersToCurrentWorkspace() throws Exception {
        AutoWonderContext.get().setCurrentWorkspaceId(9L);
        http.perform(post("/api/insights/stage-duration/recover-snapshots").param("start_date", "2026-01-01")
                        .param("end_date", "2026-01-07").param("before_dispatch_id", "21"))
                .andExpect(status().isOk());
        verify(service).recoverSnapshots(9, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 7), null, null, 21L);
        http.perform(get("/api/insights/stage-duration/workers").param("workspaceId", "99")).andExpect(status().isOk());
        verify(service).workers(9, false);
    }

    @Test
    void rendersRangeErrorsInBothLanguagesWithoutChangingTheErrorCode() throws Exception {
        AutoWonderContext.get().setCurrentWorkspaceId(9L);
        when(service.get(anyLong(), any(), any(), any(), any(), any(), any(), any(), any(), anyBoolean(), any())).thenThrow(new KeyedIllegalArgumentException(
                "insights.stage_duration_range_too_large", new Object[]{5000}, "Diagnostic remains original"));
        http.perform(get("/api/insights/stage-duration").param("start_date", "2026-01-01").param("end_date", "2026-01-07")
                        .header("Accept-Language", "en-US"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value("10001"))
                .andExpect(jsonPath("$.message").value("The selected range exceeds 5,000 executions. Narrow the dates or filter by squad or workflow."));
        http.perform(get("/api/insights/stage-duration").param("start_date", "2026-01-01").param("end_date", "2026-01-07")
                        .header("Accept-Language", "zh-CN"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value("10001"))
                .andExpect(jsonPath("$.message").value("所选范围超过 5,000 次执行，请缩小日期范围或按小队、流程筛选。"));
    }
}
