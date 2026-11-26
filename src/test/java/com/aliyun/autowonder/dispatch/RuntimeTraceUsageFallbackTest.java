package com.aliyun.autowonder.dispatch;

import com.aliyun.autowonder.aiusage.DispatchAiUsageDO;
import com.aliyun.autowonder.aiusage.DispatchAiUsageDao;
import com.aliyun.autowonder.dispatch.dto.RuntimeTraceVO;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class RuntimeTraceUsageFallbackTest {

    private static final long TENANT = 1L;
    private static final long DISPATCH = 44L;

    @Test
    void providerReportedTraceIsLeftUntouched() {
        DispatchAiUsageDao usageDao = mock(DispatchAiUsageDao.class);
        RuntimeTraceVO trace = trace();
        trace.getTokenUsage().setAvailable(true);
        trace.getTokenUsage().setCredits(0.25D);

        new RuntimeTraceUsageFallback(usageDao).apply(TENANT, DISPATCH, trace);

        assertEquals(0.25D, trace.getTokenUsage().getCredits(), 1e-9);
        verifyNoInteractions(usageDao);
    }

    @Test
    void noAttributedRowsKeepTheTraceUnavailable() {
        DispatchAiUsageDao usageDao = mock(DispatchAiUsageDao.class);
        when(usageDao.listByDispatchIds(TENANT, List.of(DISPATCH))).thenReturn(List.of());
        RuntimeTraceVO trace = trace();

        new RuntimeTraceUsageFallback(usageDao).apply(TENANT, DISPATCH, trace);

        assertFalse(trace.getTokenUsage().isAvailable());
        assertNull(trace.getTokenUsage().getCredits());
    }

    @Test
    void nullRowsAndNullEntriesAreIgnored() {
        DispatchAiUsageDao usageDao = mock(DispatchAiUsageDao.class);
        when(usageDao.listByDispatchIds(TENANT, List.of(DISPATCH))).thenReturn(null);
        RuntimeTraceVO nullRows = trace();
        new RuntimeTraceUsageFallback(usageDao).apply(TENANT, DISPATCH, nullRows);
        assertFalse(nullRows.getTokenUsage().isAvailable());

        when(usageDao.listByDispatchIds(TENANT, List.of(DISPATCH)))
                .thenReturn(Arrays.asList((DispatchAiUsageDO) null));
        RuntimeTraceVO nullEntry = trace();
        new RuntimeTraceUsageFallback(usageDao).apply(TENANT, DISPATCH, nullEntry);
        assertFalse(nullEntry.getTokenUsage().isAvailable());
    }

    @Test
    void unattributedRowsOnlyFillTheTraceTotal() {
        DispatchAiUsageDao usageDao = mock(DispatchAiUsageDao.class);
        DispatchAiUsageDO blankStep = usage(" ", -5L, null, null);
        when(usageDao.listByDispatchIds(TENANT, List.of(DISPATCH))).thenReturn(List.of(blankStep));
        RuntimeTraceVO trace = trace();
        RuntimeTraceVO.Turn turn = trace.getSessions().get(0).getTurns().get(0);
        turn.setStepId(null);

        new RuntimeTraceUsageFallback(usageDao).apply(TENANT, DISPATCH, trace);

        assertTrue(trace.getTokenUsage().isAvailable());
        assertEquals("AVAILABLE", trace.getTokenUsage().getAvailability());
        assertEquals(RuntimeTraceUsageFallback.TOKEN_PROXY_SOURCE, trace.getTokenUsage().getSource());
        assertEquals(0L, trace.getTokenUsage().getInputTokens());
        assertEquals(0.0D, trace.getTokenUsage().getCredits(), 1e-9);
        assertFalse(turn.getTokenUsage().isAvailable());
        assertFalse(trace.getSessions().get(0).getTokenUsage().isAvailable());
    }

    @Test
    void singleTurnStepReceivesTheAttributedUsage() {
        DispatchAiUsageDao usageDao = mock(DispatchAiUsageDao.class);
        when(usageDao.listByDispatchIds(TENANT, List.of(DISPATCH))).thenReturn(List.of(
                usage("400554", 1000L, 100L, "1.5"),
                usage("400554", 2000L, 200L, "0.25")));
        RuntimeTraceVO trace = trace();
        RuntimeTraceVO.Turn turn = trace.getSessions().get(0).getTurns().get(0);
        turn.setStepId("400554");

        new RuntimeTraceUsageFallback(usageDao).apply(TENANT, DISPATCH, trace);

        assertEquals(1.75D, turn.getTokenUsage().getCredits(), 1e-9);
        assertEquals(1.75D, turn.getUsage().getCredits(), 1e-9);
        assertEquals(1.75D, turn.getObservations().get(0).getUsage().getCredits(), 1e-9);
        assertEquals(1.75D, trace.getSessions().get(0).getTokenUsage().getCredits(), 1e-9);
        assertEquals(3300L, trace.getTokenUsage().getTotalTokens());
    }

    @Test
    void onlyOneTurnOwnerKeepsAttributionWhenAStepIsReused() {
        DispatchAiUsageDao usageDao = mock(DispatchAiUsageDao.class);
        when(usageDao.listByDispatchIds(TENANT, List.of(DISPATCH)))
                .thenReturn(List.of(usage("400554", 10L, 5L, "0.5")));
        RuntimeTraceVO trace = trace();
        RuntimeTraceVO.Session session = trace.getSessions().get(0);
        session.getTurns().get(0).setStepId("400554");
        RuntimeTraceVO.Turn second = new RuntimeTraceVO.Turn();
        second.setTurnId("turn-2");
        second.setStepId("400554");
        session.getTurns().add(second);

        new RuntimeTraceUsageFallback(usageDao).apply(TENANT, DISPATCH, trace);

        assertTrue(trace.getTokenUsage().isAvailable());
        assertFalse(session.getTurns().get(0).getTokenUsage().isAvailable());
        assertFalse(second.getTokenUsage().isAvailable());
        assertFalse(session.getTokenUsage().isAvailable());
    }

    @Test
    void providerUsageOnTheTurnIsNotOverwritten() {
        DispatchAiUsageDao usageDao = mock(DispatchAiUsageDao.class);
        when(usageDao.listByDispatchIds(TENANT, List.of(DISPATCH)))
                .thenReturn(List.of(usage("400554", 10L, 5L, "0.5")));
        RuntimeTraceVO trace = trace();
        RuntimeTraceVO.Turn turn = trace.getSessions().get(0).getTurns().get(0);
        turn.setStepId("400554");
        RuntimeTraceVO.TokenUsage provider = new RuntimeTraceVO.TokenUsage();
        provider.setAvailable(true);
        provider.setInputTokens(7L);
        turn.setUsage(provider);

        new RuntimeTraceUsageFallback(usageDao).apply(TENANT, DISPATCH, trace);

        assertEquals(7L, turn.getUsage().getInputTokens());
        assertFalse(turn.getTokenUsage().isAvailable());
        assertEquals(7L, trace.getSessions().get(0).getTokenUsage().getInputTokens());
    }

    @Test
    void traceWithoutSessionsStillShowsTheDispatchTotal() {
        DispatchAiUsageDao usageDao = mock(DispatchAiUsageDao.class);
        when(usageDao.listByDispatchIds(TENANT, List.of(DISPATCH)))
                .thenReturn(List.of(usage("400554", 10L, 5L, "0.5")));
        RuntimeTraceVO trace = new RuntimeTraceVO();
        trace.setSessions(null);

        new RuntimeTraceUsageFallback(usageDao).apply(TENANT, DISPATCH, trace);

        assertTrue(trace.getTokenUsage().isAvailable());
        assertEquals(15L, trace.getTokenUsage().getTotalTokens());
    }

    @Test
    void turnWithoutObservationsReceivesUsageWithoutFailing() {
        DispatchAiUsageDao usageDao = mock(DispatchAiUsageDao.class);
        when(usageDao.listByDispatchIds(TENANT, List.of(DISPATCH)))
                .thenReturn(List.of(usage("400554", 10L, 5L, "0.5")));
        RuntimeTraceVO trace = trace();
        RuntimeTraceVO.Turn turn = trace.getSessions().get(0).getTurns().get(0);
        turn.setStepId("400554");
        turn.setObservations(null);

        new RuntimeTraceUsageFallback(usageDao).apply(TENANT, DISPATCH, trace);

        assertEquals(0.5D, turn.getTokenUsage().getCredits(), 1e-9);
    }

    @Test
    void nullTraceAndMissingUsageContainerAreIgnored() {
        DispatchAiUsageDao usageDao = mock(DispatchAiUsageDao.class);
        RuntimeTraceUsageFallback fallback = new RuntimeTraceUsageFallback(usageDao);
        fallback.apply(TENANT, DISPATCH, null);
        RuntimeTraceVO trace = new RuntimeTraceVO();
        trace.setTokenUsage(null);
        fallback.apply(TENANT, DISPATCH, trace);
        verifyNoInteractions(usageDao);
    }

    @Test
    void nullBlankAndReusedStepIdsOnTurnsAreSkipped() {
        DispatchAiUsageDao usageDao = mock(DispatchAiUsageDao.class);
        when(usageDao.listByDispatchIds(TENANT, List.of(DISPATCH)))
                .thenReturn(List.of(usage(null, 10L, 5L, "0.1"), usage("400554", 10L, 5L, "0.5")));
        RuntimeTraceVO trace = trace();
        RuntimeTraceVO.Session session = trace.getSessions().get(0);
        session.getTurns().get(0).setStepId("400554");
        RuntimeTraceVO.Turn blank = new RuntimeTraceVO.Turn();
        blank.setStepId(" ");
        RuntimeTraceVO.Turn missing = new RuntimeTraceVO.Turn();
        missing.setStepId(null);
        session.getTurns().addAll(List.of(blank, missing));

        new RuntimeTraceUsageFallback(usageDao).apply(TENANT, DISPATCH, trace);

        assertEquals(0.5D, session.getTurns().get(0).getTokenUsage().getCredits(), 1e-9);
        assertFalse(blank.getTokenUsage().isAvailable());
        assertFalse(missing.getTokenUsage().isAvailable());
    }

    @Test
    void nullSessionsAndNullTurnListsAreSkipped() {
        DispatchAiUsageDao usageDao = mock(DispatchAiUsageDao.class);
        when(usageDao.listByDispatchIds(TENANT, List.of(DISPATCH)))
                .thenReturn(List.of(usage("400554", 10L, 5L, "0.5")));
        RuntimeTraceVO trace = trace();
        RuntimeTraceVO.Session session = trace.getSessions().get(0);
        session.getTurns().get(0).setStepId("400554");
        RuntimeTraceVO.Session empty = new RuntimeTraceVO.Session();
        empty.setTurns(null);
        trace.getSessions().addAll(Arrays.asList(null, empty));

        new RuntimeTraceUsageFallback(usageDao).apply(TENANT, DISPATCH, trace);

        assertTrue(trace.getTokenUsage().isAvailable());
        assertEquals(0.5D, session.getTurns().get(0).getTokenUsage().getCredits(), 1e-9);
        assertFalse(empty.getTokenUsage().isAvailable());
    }

    @Test
    void turnsWithoutAnyUsageContainerReportNoProviderUsage() {
        DispatchAiUsageDao usageDao = mock(DispatchAiUsageDao.class);
        when(usageDao.listByDispatchIds(TENANT, List.of(DISPATCH)))
                .thenReturn(List.of(usage("400554", 10L, 5L, "0.5")));
        RuntimeTraceVO trace = trace();
        RuntimeTraceVO.Turn nullContainers = trace.getSessions().get(0).getTurns().get(0);
        nullContainers.setStepId("other");
        nullContainers.setTokenUsage(null);
        nullContainers.setUsage(null);
        RuntimeTraceVO.Turn unavailableContainers = new RuntimeTraceVO.Turn();
        unavailableContainers.setStepId("400554");
        unavailableContainers.setTokenUsage(new RuntimeTraceVO.TokenUsage());
        unavailableContainers.setUsage(new RuntimeTraceVO.TokenUsage());
        trace.getSessions().get(0).getTurns().add(unavailableContainers);

        new RuntimeTraceUsageFallback(usageDao).apply(TENANT, DISPATCH, trace);

        assertEquals(0.5D, unavailableContainers.getTokenUsage().getCredits(), 1e-9);
        assertNull(nullContainers.getTokenUsage());
    }

    private static RuntimeTraceVO trace() {
        RuntimeTraceVO trace = new RuntimeTraceVO();
        trace.setDispatchId(DISPATCH);
        RuntimeTraceVO.Session session = new RuntimeTraceVO.Session();
        session.setSessionId("s1");
        RuntimeTraceVO.Turn turn = new RuntimeTraceVO.Turn();
        turn.setTurnId("turn-1");
        turn.setObservations(new ArrayList<>(List.of(new RuntimeTraceVO.Observation())));
        session.getTurns().add(turn);
        trace.getSessions().add(session);
        return trace;
    }

    private static DispatchAiUsageDO usage(String stepId, Long input, Long output, String credits) {
        DispatchAiUsageDO usage = new DispatchAiUsageDO();
        usage.setStepId(stepId);
        usage.setInputTokens(input);
        usage.setOutputTokens(output);
        usage.setCredits(credits == null ? null : new BigDecimal(credits));
        return usage;
    }
}
