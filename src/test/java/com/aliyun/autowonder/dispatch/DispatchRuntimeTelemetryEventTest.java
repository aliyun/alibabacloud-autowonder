package com.aliyun.autowonder.dispatch;

import com.aliyun.autowonder.json.JSONObject;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import org.mockito.ArgumentCaptor;

class DispatchRuntimeTelemetryEventTest {

    private DispatchDao dispatchDao;
    private DispatchRuntimeEventDao runtimeEventDao;
    private DispatchService service;

    @BeforeEach
    void setUp() {
        dispatchDao = mock(DispatchDao.class);
        runtimeEventDao = mock(DispatchRuntimeEventDao.class);
        service = new DispatchService(dispatchDao, runtimeEventDao,
                mock(com.aliyun.autowonder.workitem.WorkitemDao.class),
                mock(com.aliyun.autowonder.agent.AgentDao.class),
                mock(com.aliyun.autowonder.agent.AgentVersionDao.class),
                mock(ExecutorSelector.class),
                mock(PackageContextAssembler.class),
                mock(com.aliyun.autowonder.taskpackage.TaskPackager.class),
                mock(DispatchTransport.class),
                mock(SdlcDriver.class),
                null);
    }

    @Test
    void persistsStructuredTelemetryEventsForEvolution() {
        DispatchDO dispatch = new DispatchDO();
        dispatch.setId(44L);
        dispatch.setTenantId(1L);
        dispatch.setWorkitemId(10L);
        dispatch.setAgentId(7L);
        dispatch.setStatus(DispatchStatus.RUNNING);
        dispatch.setVersion(1);
        when(dispatchDao.findById(44L)).thenReturn(dispatch);

        JSONObject frame = new JSONObject();
        frame.put("runtimeEvent", new JSONObject()
                .fluentPut("eventId", "44:7")
                .fluentPut("seq", 7L)
                .fluentPut("eventType", "skill.loaded")
                .fluentPut("name", "checkout-safety")
                .fluentPut("provider", "codex"));

        service.onProgress(1L, 44L, frame);

        verify(runtimeEventDao).insert(argThat(e -> "44:7".equals(e.getEventId())
                && Long.valueOf(7L).equals(e.getSeq())
                && "skill.loaded".equals(e.getEventType())
                && e.getDetailJson().contains("\"name\":\"checkout-safety\"")));
    }

    @Test
    void restartedSequenceIsIsolatedByAuthenticatedExecutorAndReplayKeepsItsKey() {
        DispatchDO dispatch = new DispatchDO();
        dispatch.setId(44L);
        dispatch.setTenantId(1L);
        dispatch.setWorkitemId(10L);
        dispatch.setAgentId(7L);
        dispatch.setStatus(DispatchStatus.RUNNING);
        dispatch.setExecutorId(51L);
        when(dispatchDao.findById(44L)).thenReturn(dispatch);
        JSONObject frame = new JSONObject().fluentPut("runtimeEvent", new JSONObject()
                .fluentPut("eventId", "44:7")
                .fluentPut("seq", 7L)
                .fluentPut("runtimeId", "untrusted-runtime-id")
                .fluentPut("eventType", "step.started"));

        org.junit.jupiter.api.Assertions.assertTrue(service.onProgress(1L, 51L, 44L, frame));
        dispatch.setExecutorId(52L);
        org.junit.jupiter.api.Assertions.assertTrue(service.onProgress(1L, 52L, 44L, frame));
        org.junit.jupiter.api.Assertions.assertTrue(service.onProgress(1L, 52L, 44L, frame));

        ArgumentCaptor<DispatchRuntimeEventDO> events = ArgumentCaptor.forClass(DispatchRuntimeEventDO.class);
        verify(runtimeEventDao, times(3)).insert(events.capture());
        var recorded = events.getAllValues();
        org.junit.jupiter.api.Assertions.assertNotEquals(recorded.get(0).getEventId(), recorded.get(1).getEventId());
        org.junit.jupiter.api.Assertions.assertEquals(recorded.get(1).getEventId(), recorded.get(2).getEventId());
        recorded.forEach(event -> {
            org.junit.jupiter.api.Assertions.assertEquals("44:7",
                    com.aliyun.autowonder.json.JSON.parseObject(event.getDetailJson()).getString("eventId"));
            org.junit.jupiter.api.Assertions.assertEquals(7L, event.getSeq());
            org.junit.jupiter.api.Assertions.assertTrue(event.getEventId().length() <= 128);
        });
    }

    @Test
    void lockedProgressRejectsFormerOwnerAndPublishesOnlyAfterCommit() {
        var previous = new DispatchDO();
        previous.setId(44L);
        previous.setTenantId(1L);
        previous.setExecutorId(51L);
        previous.setStatus(DispatchStatus.RUNNING);
        var current = new DispatchDO();
        current.setId(44L);
        current.setTenantId(1L);
        current.setExecutorId(52L);
        current.setStatus(DispatchStatus.RUNNING);
        when(dispatchDao.findById(44L)).thenReturn(previous);
        when(dispatchDao.findByIdForUpdate(1L, 44L)).thenReturn(current);
        var manager = mock(org.springframework.transaction.PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenReturn(mock(org.springframework.transaction.TransactionStatus.class));
        var committed = new java.util.concurrent.atomic.AtomicBoolean();
        doAnswer(call -> { committed.set(true); return null; }).when(manager).commit(any());
        service.setTransactionManager(manager);
        var publisher = mock(DispatchLiveActivityPublisher.class);
        service.setLiveActivityPublisher(publisher);
        doAnswer(call -> { org.junit.jupiter.api.Assertions.assertTrue(committed.get()); return null; })
                .when(publisher).publish(any(), any());
        var frame = new JSONObject().fluentPut("runtimeEvent", new JSONObject()
                .fluentPut("eventId", "44:7").fluentPut("eventType", "step.started"));

        org.junit.jupiter.api.Assertions.assertFalse(service.onProgress(1L, 51L, 44L, frame));
        verifyNoInteractions(runtimeEventDao, publisher);
        committed.set(false);
        org.junit.jupiter.api.Assertions.assertTrue(service.onProgress(1L, 52L, 44L, frame));
        verify(publisher).publish(any(), any());
        verify(dispatchDao, never()).findById(44L);

        clearInvocations(publisher);
        doThrow(new IllegalStateException("commit failed")).when(manager).commit(any());
        org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class,
                () -> service.onProgress(1L, 52L, 44L, frame));
        verifyNoInteractions(publisher);
    }

    @Test
    void lostRunningTransitionDoesNotAuthorizeGuidanceDelivery() {
        var dispatch = new DispatchDO();
        dispatch.setId(44L);
        dispatch.setTenantId(1L);
        dispatch.setExecutorId(52L);
        dispatch.setStatus(DispatchStatus.ACKED);
        dispatch.setVersion(1);
        when(dispatchDao.findById(44L)).thenReturn(dispatch);

        org.junit.jupiter.api.Assertions.assertFalse(service.onProgress(1L, 52L, 44L, null));
    }

    @Test
    void formerExecutorCannotRecordProgressWhilePendingOrAfterReassignment() {
        DispatchDO dispatch = new DispatchDO();
        dispatch.setId(44L);
        dispatch.setTenantId(1L);
        dispatch.setStatus(DispatchStatus.PENDING);
        when(dispatchDao.findById(44L)).thenReturn(dispatch);
        JSONObject frame = new JSONObject().fluentPut("runtimeEvent", new JSONObject()
                .fluentPut("eventId", "44:7").fluentPut("seq", 7L)
                .fluentPut("eventType", "step.started"));

        org.junit.jupiter.api.Assertions.assertFalse(service.onProgress(1L, 51L, 44L, frame));
        dispatch.setExecutorId(52L);
        dispatch.setStatus(DispatchStatus.RUNNING);
        org.junit.jupiter.api.Assertions.assertFalse(service.onProgress(1L, 51L, 44L, frame));
        org.junit.jupiter.api.Assertions.assertFalse(service.onProgress(2L, 52L, 44L, frame));
        verifyNoInteractions(runtimeEventDao);
        verify(dispatchDao, times(3)).findById(44L);
        verifyNoMoreInteractions(dispatchDao);

        dispatch.setStatus(DispatchStatus.SUCCEEDED);
        org.junit.jupiter.api.Assertions.assertFalse(service.onProgress(1L, 52L, 44L, frame));
        verify(runtimeEventDao).insert(argThat(event -> event.getEventId().startsWith("runtime:52:")));
    }

    @Test
    void persistsCompactLifecycleAndTiming() {
        DispatchDO dispatch = new DispatchDO();
        dispatch.setId(44L);
        dispatch.setTenantId(1L);
        dispatch.setWorkitemId(10L);
        dispatch.setAgentId(7L);
        dispatch.setStatus(DispatchStatus.RUNNING);
        when(dispatchDao.findById(44L)).thenReturn(dispatch);
        for (String type : new String[]{"context.compact_started", "context.compact_completed"}) {
            JSONObject detail = new JSONObject().fluentPut("eventType", type)
                    .fluentPut("provider", "qodercn").fluentPut("sessionId", "session-1")
                    .fluentPut("trigger", "manual");
            if (type.endsWith("completed")) detail.put("durationMs", 1234L);
            service.onProgress(1L, 44L, new JSONObject().fluentPut("runtimeEvent", detail));
            verify(runtimeEventDao).insert(argThat(e -> type.equals(e.getEventType())
                    && e.getDetailJson().contains("session-1")
                    && e.getDetailJson().contains("manual")
                    && (!type.endsWith("completed") || e.getDetailJson().contains("1234"))));
        }
        org.junit.jupiter.api.Assertions.assertFalse(DispatchService.isRuntimeEventType("context.unknown"));
    }

    @Test
    void acceptsTheWholeCanonicalRuntimeVocabulary() {
        for (String eventType : new String[]{
                "workspace.created", "bootstrap.generated", "repo.prepared", "upload.completed",
                "plugin.loaded", "subagent.completed", "session.resumed", "turn.started", "llm.usage",
                "mcp.call", "cli.call", "bash.result"
        }) {
            org.junit.jupiter.api.Assertions.assertTrue(DispatchService.isRuntimeEventType(eventType), eventType);
        }
    }

    @Test
    void canonicalRuntimeEventDoesNotInheritOuterProgressName() {
        DispatchDO dispatch = new DispatchDO();
        dispatch.setId(45L);
        dispatch.setTenantId(1L);
        dispatch.setWorkitemId(10L);
        dispatch.setAgentId(7L);
        dispatch.setStatus(DispatchStatus.RUNNING);
        when(dispatchDao.findById(45L)).thenReturn(dispatch);

        JSONObject frame = new JSONObject()
                .fluentPut("name", "performance")
                .fluentPut("runtimeEvent", new JSONObject()
                        .fluentPut("eventId", "45:1")
                        .fluentPut("eventType", "llm.started")
                        .fluentPut("model", "qmodel_latest"));

        service.onProgress(1L, 45L, frame);

        ArgumentCaptor<DispatchRuntimeEventDO> captor = ArgumentCaptor.forClass(DispatchRuntimeEventDO.class);
        verify(runtimeEventDao).insert(captor.capture());
        org.junit.jupiter.api.Assertions.assertFalse(captor.getValue().getDetailJson().contains("performance"));
    }
}
