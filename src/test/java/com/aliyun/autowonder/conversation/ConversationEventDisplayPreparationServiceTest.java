package com.aliyun.autowonder.conversation;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ConversationEventDisplayPreparationServiceTest {

    private final ConversationEventDisplayDao displayDao = mock(ConversationEventDisplayDao.class);
    private final ConversationEventContentSegmentDao segmentDao = mock(ConversationEventContentSegmentDao.class);
    private final AgentConversationTurnEventDao eventDao = mock(AgentConversationTurnEventDao.class);
    private final AgentConversationTurnDao turnDao = mock(AgentConversationTurnDao.class);
    private final AgentConversationDao conversationDao = mock(AgentConversationDao.class);
    private final PlatformTransactionManager transactionManager = mock(PlatformTransactionManager.class);
    private final TransactionStatus transactionStatus = mock(TransactionStatus.class);
    private final ConversationBrowserEventPublisher publisher = mock(ConversationBrowserEventPublisher.class);
    private ConversationEventDisplayPreparationService service;

    @BeforeEach
    void setUp() {
        when(transactionManager.getTransaction(any())).thenReturn(transactionStatus);
        service = new ConversationEventDisplayPreparationService(displayDao, segmentDao, eventDao,
                turnDao, conversationDao, transactionManager);
        service.setPublisher(publisher);
        when(displayDao.markFailedIfCurrent(anyLong(), anyLong(), anyString(), anyInt(), anyString(), any())).thenReturn(1);
    }

    private ConversationEventDisplayDO candidate(long id, long turnId) {
        var row = new ConversationEventDisplayDO();
        row.setId(id); row.setTurnId(turnId);
        return row;
    }

    private ConversationEventDisplayDO display() {
        var row = new ConversationEventDisplayDO();
        row.setId(50L); row.setTenantId(1L); row.setConversationId(2L); row.setTurnId(7L);
        row.setDispatchAttempt(1); row.setEventSeq(3L); row.setEventType("tool_result");
        row.setStatus(ConversationEventDisplayDO.STATUS_PREPARING);
        row.setQueueClass("LARGE");
        row.setProjectionVersion("v1"); row.setAttemptCount(1);
        row.setGmtCreate(new java.util.Date());
        return row;
    }

    private AgentConversationTurnEventDO meta(int index, int count, long bytes) {
        var meta = new AgentConversationTurnEventDO();
        meta.setId(100L + index); meta.setChunkIndex(index); meta.setChunkCount(count);
        meta.setPayloadBytes(bytes); meta.setPayloadChars(bytes);
        return meta;
    }

    private AgentConversationTurnEventDO chunk(int index, String fragment) {
        var chunk = new AgentConversationTurnEventDO();
        chunk.setId(100L + index); chunk.setChunkIndex(index); chunk.setPayloadFragment(fragment);
        return chunk;
    }

    private void stubTurnAndConversation(String channel) {
        var turn = new AgentConversationTurnDO();
        turn.setId(7L); turn.setStatus("PROCESSING");
        when(turnDao.findByConversationTurn(1L, 2L, 7L)).thenReturn(turn);
        when(turnDao.findByConversationTurnForUpdate(1L, 2L, 7L)).thenReturn(turn);
        var conversation = new AgentConversationDO();
        conversation.setId(2L); conversation.setChannel(channel);
        when(conversationDao.findById(1L, 2L)).thenReturn(conversation);
    }

    @Test
    void publishesReadyWithBoundedSegmentsAndMonotonicSequence() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta(0, 2, 2L)))
                .thenReturn(List.of(meta(1, 2, 2L)))
                .thenReturn(List.of());
        when(eventDao.listChunkPayloads(1L, 7L, 1, 3L, -1, 32, 33554448))
                .thenReturn(List.of(chunk(0, "hello "), chunk(1, "world")));
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(4L);

        service.prepare(50L);

        verify(segmentDao).insertBatch(org.mockito.ArgumentMatchers.argThat(items ->
                items.size() == 1 && "hello world".equals(com.aliyun.autowonder.json.JSON
                        .parseObject(items.get(0).getContent()).getString("text"))));
        verify(displayDao).markReady(eq(50L), eq(5L), eq("hello world"), eq(11L), eq(1),
                eq(false), eq(false), eq("v2-semantic"), any());
        verify(displayDao, never()).markFailedIfCurrent(anyLong(), anyLong(), anyString(), anyInt(), anyString(), any());
        verify(publisher).publishDisplayAvailable(2L, 7L, 50L, 5L, "READY", "READY", "tool_result");
    }

    @Test
    void missingSlicesRetryInsteadOfPublishingAPartialEvent() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(1L, 7L, 1, 3L, -1, 32))
                .thenReturn(List.of(meta(0, 3, 2L)))
                .thenReturn(List.of());

        service.prepare(50L);

        verify(displayDao).scheduleRetry(eq(50L), any(), anyString(), any());
        verify(displayDao, never()).markReady(anyLong(), anyLong(), any(), anyLong(), anyInt(),
                anyBoolean(), anyBoolean(), anyString(), any());
        verifyNoInteractions(publisher);
    }

    @Test
    void inconsistentSliceCountIsPermanentlyFailedAndPublished() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(1L, 7L, 1, 3L, -1, 32))
                .thenReturn(List.of(meta(0, 2, 2L), meta(1, 3, 2L)));
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(1L);

        service.prepare(50L);

        verify(displayDao).markFailedIfCurrent(eq(50L), eq(2L), anyString(), anyInt(), anyString(), any());
        verify(publisher).publishDisplayAvailable(2L, 7L, 50L, 2L, "UNAVAILABLE", "UNAVAILABLE", "tool_result");
    }

    @Test
    void oversizedRawEventIsNotReadIntoMemory() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(1L, 7L, 1, 3L, -1, 32))
                .thenReturn(List.of(meta(0, 1, ConversationEventDisplayBudget.MAX_EVENT_BYTES + 1)));
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(0L);

        service.prepare(50L);

        verify(eventDao, never()).listChunkPayloads(anyLong(), anyLong(), anyInt(), anyLong(),
                anyInt(), anyInt(), anyInt());
        verify(displayDao).markFailedIfCurrent(eq(50L), eq(1L), anyString(), anyInt(), anyString(), any());
    }

    @Test
    void removedSourceTurnIsMarkedWithoutPublishing() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        when(turnDao.findByConversationTurn(1L, 2L, 7L)).thenReturn(null);

        service.prepare(50L);

        verify(displayDao).markSourceRemoved(50L);
        verifyNoInteractions(publisher);
    }

    @Test
    void claimFailureSkipsPreparation() {
        when(displayDao.listClaimablePage(any(), anyString(), anyLong(), anyLong(), eq(20))).thenReturn(List.of(candidate(50L, 7L), candidate(51L, 7L)));
        when(displayDao.claim(eq(50L), any(), any(), anyString())).thenReturn(1);
        when(displayDao.claim(eq(51L), any(), any(), anyString())).thenReturn(0);
        when(displayDao.findById(50L)).thenReturn(null);

        assertEquals(1, service.processRealtimeDue(20));
        verify(displayDao, never()).findById(51L);
    }

    @Test
    void realtimeAndHistoryClaimTheirOwnQueueClasses() {
        service.processRealtimeDue(10);
        service.markDirty(1L, 2L, 7L, 1, 3L, "text");
        service.processRealtimeDue(10);
        service.processHistoryDue(10);

        verify(displayDao, org.mockito.Mockito.times(2)).listClaimablePage(any(),
                eq(ConversationEventDisplayDO.CLASS_REALTIME), eq(0L), eq(0L), eq(10));
        verify(displayDao, org.mockito.Mockito.times(2)).listClaimablePage(any(),
                eq(ConversationEventDisplayDO.CLASS_INTERACTIVE), eq(0L), eq(0L), eq(10));
        verify(displayDao).listClaimablePage(any(),
                eq(ConversationEventDisplayDO.CLASS_HISTORY), eq(0L), eq(0L), eq(10));
    }

    @Test
    void retryStopsAfterTheThirdAttempt() {
        var row = display();
        row.setAttemptCount(3);
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(1L, 7L, 1, 3L, -1, 32)).thenReturn(List.of(meta(0, 2, 2L)));
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(0L);

        service.prepare(50L);

        verify(displayDao).markFailedIfCurrent(eq(50L), eq(1L), anyString(), anyInt(), anyString(), any());
        verify(displayDao, never()).scheduleRetry(anyLong(), any(), anyString(), any());
    }

    @Test
    void markDirtyWritesALightweightPreparingTask() {
        service.markDirty(1L, 2L, 7L, 1, 3L, "tool_result");

        verify(displayDao).insertTask(org.mockito.ArgumentMatchers.argThat(row ->
                row.getStatus().equals(ConversationEventDisplayDO.STATUS_PREPARING)
                        && row.getEventSeq() == 3L
                        && ConversationEventDisplayDO.CLASS_REALTIME.equals(row.getQueueClass())
                        && "v2-semantic".equals(row.getProjectionVersion())
                        && row.getGmtCreate() != null));
        verify(displayDao).rearmFailed(eq(1L), eq(2L), eq(7L), eq(1), eq(3L), any());
    }

    @Test
    void dirtyMarkRequestsASameConnectionSavepointInsteadOfAnIndependentTransaction() {
        service.markDirty(1L, 2L, 7L, 1, 3L, "text");

        verify(transactionManager).getTransaction(org.mockito.ArgumentMatchers.argThat(definition ->
                definition.getPropagationBehavior() == org.springframework.transaction.TransactionDefinition.PROPAGATION_NESTED));
    }

    @Test
    void aNewSliceClearsTheIncompleteRetryAndLargeEventsHaveTheirOwnLane() {
        service.markDirty(1L, 2L, 7L, 1, 3L, "tool_result", true, true);

        verify(displayDao).wakePending(eq(1L), eq(2L), eq(7L), eq(1), eq(3L), eq("LARGE"), any());
        verify(displayDao).insertTask(org.mockito.ArgumentMatchers.argThat(row ->
                "LARGE".equals(row.getQueueClass())));
        service.processLargeDue(1);
        verify(displayDao).listClaimablePage(any(), eq("LARGE"), eq(0L), eq(0L), eq(1));
    }

    @Test
    void duplicateSliceDoesNotResetRetryAttemptsOrReviveAPermanentlyInvalidEvent() {
        service.markDirty(1L, 2L, 7L, 1, 3L, "tool_result", true, false);

        verify(displayDao, never()).wakePending(anyLong(), anyLong(), anyLong(), anyInt(), anyLong(), anyString(), any());
        verify(displayDao, never()).rearmFailed(anyLong(), anyLong(), anyLong(), anyInt(), anyLong(), any());
    }

    @Test
    void emptyRealtimeQueueBacksOffUntilCommittedInboundWorkWakesIt() {
        service.processRealtimeDue(20);
        service.processRealtimeDue(20);
        verify(displayDao, org.mockito.Mockito.times(2)).listClaimablePage(any(), anyString(), anyLong(), anyLong(), eq(20));
        service.markDirty(1L, 2L, 7L, 1, 3L, "text");
        service.processRealtimeDue(20);
        verify(displayDao, org.mockito.Mockito.times(4)).listClaimablePage(
                any(), anyString(), anyLong(), anyLong(), eq(20));
    }

    @Test
    void failedRealtimeQueryBacksOffInsteadOfRetryingAtTheSchedulerFrequency() {
        when(displayDao.listClaimablePage(any(), anyString(), anyLong(), anyLong(), eq(20)))
                .thenThrow(new IllegalStateException("database unavailable"));
        org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class,
                () -> service.processRealtimeDue(20));
        service.markDirty(1L, 2L, 7L, 1, 3L, "text");
        org.junit.jupiter.api.Assertions.assertDoesNotThrow(() -> service.processRealtimeDue(20));
        verify(displayDao).listClaimablePage(any(), anyString(), anyLong(), anyLong(), eq(20));
    }

    @Test
    void openedLargeEventsMoveOutOfTheRealtimeLaneBeforePayloadReads() {
        var row = display(); row.setQueueClass("INTERACTIVE");
        when(displayDao.findById(50L)).thenReturn(row);
        when(eventDao.listChunkMeta(1L, 7L, 1, 3L, -1, 1))
                .thenReturn(List.of(meta(0, 2, 1000)));

        service.prepare(50L);

        verify(displayDao).requeueLarge(eq(50L), anyString(), any());
        verify(eventDao, never()).listChunkPayloads(anyLong(), anyLong(), anyInt(), anyLong(), anyInt(), anyInt(), anyInt());
        verifyNoInteractions(segmentDao, turnDao, conversationDao);
    }

    @Test
    void largeProjectionPermitAlsoProtectsAgainstConcurrentRecoveryPreparation() {
        when(displayDao.findById(50L)).thenReturn(display());
        org.junit.jupiter.api.Assertions.assertTrue(service.tryAcquireLargeProjection());
        try {
            service.prepare(50L);
            verify(displayDao).requeueLarge(eq(50L), anyString(), any());
            verifyNoInteractions(eventDao, segmentDao, turnDao, conversationDao);
        } finally {
            service.releaseLargeProjection();
        }
    }

    @Test
    void staleThirdAttemptCannotPublishFailureAfterNewSlicesResetItsGeneration() {
        var row = display(); row.setAttemptCount(3);
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(1L, 7L, 1, 3L, -1, 32))
                .thenReturn(List.of(meta(0, 2, 10)));
        when(displayDao.markFailedIfCurrent(eq(50L), anyLong(), anyString(), eq(3), anyString(), any())).thenReturn(0);

        service.prepare(50L);

        verify(displayDao).releaseLease(eq(50L), anyString());
        verifyNoInteractions(publisher);
    }

    @Test
    void realtimeCandidateCursorAdvancesPastThePreviousPage() {
        when(displayDao.listClaimablePage(any(), eq("REALTIME"), eq(0L), eq(0L), eq(1)))
                .thenReturn(List.of(candidate(50L, 7L)));
        when(displayDao.listClaimablePage(any(), eq("REALTIME"), eq(7L), eq(50L), eq(1)))
                .thenReturn(List.of(candidate(51L, 8L)));

        service.processRealtimeDue(1);
        service.markDirty(1L, 2L, 7L, 1, 3L, "text");
        service.processRealtimeDue(1);

        verify(displayDao).listClaimablePage(any(), eq("REALTIME"), eq(7L), eq(50L), eq(1));
        verify(displayDao).claim(eq(51L), any(), any(), anyString());
    }

    @Test
    void backfillCreatesMissingLogicalKeysUntilExhausted() {
        var key = new ConversationEventDisplayDO();
        key.setDispatchAttempt(1); key.setEventSeq(3L);
        when(displayDao.listMissingLogicalKeys(1L, 2L, 7L, 1, -1L, -1))
                .thenReturn(List.of(key))
                .thenReturn(List.of());
        when(displayDao.insertFromFirstRawChunk(1L, 2L, 7L, 1, 3L, "v2-semantic",
                ConversationEventDisplayDO.CLASS_INTERACTIVE)).thenReturn(1);

        assertEquals(1, service.backfillTurn(1L, 2L, 7L));
    }

    @Test
    void backfillStopsWhenInsertFails() {
        var key = new ConversationEventDisplayDO();
        key.setDispatchAttempt(1); key.setEventSeq(3L);
        when(displayDao.listMissingLogicalKeys(1L, 2L, 7L, 1, -1L, -1)).thenReturn(List.of(key));
        when(displayDao.insertFromFirstRawChunk(anyLong(), anyLong(), anyLong(), anyInt(), anyLong(),
                anyString(), anyString())).thenThrow(new IllegalStateException("duplicate"));

        assertEquals(0, service.backfillTurn(1L, 2L, 7L));
    }

    private AgentConversationTurnEventDO rawKey(long id, long turnId, int attempt, long seq,
            String eventType, java.util.Date created) {
        var row = new AgentConversationTurnEventDO();
        row.setId(id); row.setTenantId(1L); row.setConversationId(2L); row.setTurnId(turnId);
        row.setDispatchAttempt(attempt); row.setEventSeq(seq); row.setEventType(eventType);
        row.setGmtCreate(created);
        return row;
    }

    @Test
    void historyScanUsesThePersistedCheckpointAndNeverRescansFromZero() {
        var scan = new ConversationEventDisplayScanDO();
        scan.setScanKey(ConversationEventDisplayScanDO.SCAN_KEY_RAW);
        scan.setLastRawId(500L); scan.setHighWaterRawId(500L); scan.setGeneration(2L);
        when(displayDao.findScan(ConversationEventDisplayScanDO.SCAN_KEY_RAW)).thenReturn(scan);
        when(eventDao.listRawKeysAfter(500L, 200)).thenReturn(List.of());

        service.scanHistoryBatch(200, 500L);

        verify(eventDao).listRawKeysAfter(500L, 200);
        verify(eventDao, never()).listRawKeysAfter(0L, 200);
    }

    @Test
    void historyScanTagsRecentEventsRealtimeAndOldEventsHistory() {
        when(displayDao.findScan(ConversationEventDisplayScanDO.SCAN_KEY_RAW))
                .thenReturn(null).thenReturn(new ConversationEventDisplayScanDO());
        java.util.Date now = new java.util.Date();
        java.util.Date old = new java.util.Date(now.getTime() - 2L * 60L * 60L * 1000L);
        when(eventDao.listRawKeysAfter(0L, 200)).thenReturn(List.of(
                rawKey(10L, 7L, 1, 1L, "text", now),
                rawKey(11L, 8L, 1, 1L, "text", old)));

        service.scanHistoryBatch(200, 500L);

        verify(displayDao).insertFromFirstRawChunk(1L, 2L, 7L, 1, 1L,
                ConversationEventDisplayBudget.PROJECTION_VERSION,
                ConversationEventDisplayDO.CLASS_REALTIME);
        verify(displayDao).insertFromFirstRawChunk(1L, 2L, 8L, 1, 1L,
                ConversationEventDisplayBudget.PROJECTION_VERSION,
                ConversationEventDisplayDO.CLASS_HISTORY);
        verify(displayDao).advanceScan(eq(ConversationEventDisplayScanDO.SCAN_KEY_RAW), eq(0L),
                eq(11L), anyLong(), any(), any());
    }

    @Test
    void historyScanWrapsToZeroAndAdvancesGenerationAtTheEnd() {
        var scan = new ConversationEventDisplayScanDO();
        scan.setLastRawId(90L); scan.setHighWaterRawId(90L); scan.setGeneration(4L);
        when(displayDao.findScan(ConversationEventDisplayScanDO.SCAN_KEY_RAW)).thenReturn(scan);
        when(eventDao.listRawKeysAfter(90L, 200))
                .thenReturn(List.of(rawKey(91L, 7L, 1, 1L, "text", new java.util.Date())));

        service.scanHistoryBatch(200, 500L);

        verify(displayDao).advanceScan(eq(ConversationEventDisplayScanDO.SCAN_KEY_RAW), eq(0L),
                eq(91L), eq(5L), any(), any());
    }

    @Test
    void historyScanSurvivesOneBadLogicalKeyAndKeepsGoing() {
        var scan = new ConversationEventDisplayScanDO();
        when(displayDao.findScan(ConversationEventDisplayScanDO.SCAN_KEY_RAW)).thenReturn(scan);
        java.util.Date now = new java.util.Date();
        when(eventDao.listRawKeysAfter(0L, 200)).thenReturn(List.of(
                rawKey(10L, 7L, 1, 1L, "text", now),
                rawKey(11L, 7L, 1, 2L, "text", now)));
        when(displayDao.insertFromFirstRawChunk(eq(1L), eq(2L), eq(7L), eq(1), eq(1L), anyString(),
                anyString())).thenThrow(new IllegalStateException("deadlock"));
        when(displayDao.insertFromFirstRawChunk(eq(1L), eq(2L), eq(7L), eq(1), eq(2L), anyString(),
                anyString())).thenReturn(1);

        assertEquals(1, service.scanHistoryBatch(200, 500L));
        verify(displayDao).advanceScan(eq(ConversationEventDisplayScanDO.SCAN_KEY_RAW), eq(0L),
                eq(11L), anyLong(), any(), any());
    }

    @Test
    void historyScanIsDeferredWhileTheQuietWindowIsOpen() {
        var scan = new ConversationEventDisplayScanDO();
        scan.setHighWaterRawId(500L); scan.setGeneration(2L);
        scan.setQuietUntil(new java.util.Date(System.currentTimeMillis() + 30_000L));
        when(displayDao.findScan(ConversationEventDisplayScanDO.SCAN_KEY_RAW)).thenReturn(scan);

        assertEquals(0, service.scanHistoryBatch(200, 500L));

        verify(eventDao, never()).listRawKeysAfter(anyLong(), anyInt());
        verify(displayDao, never()).advanceScan(anyString(), anyLong(), anyLong(), anyLong(),
                any(), any());
    }

    @Test
    void aQuietFullPassSchedulesTheNextScanLaterInsteadOfRescanningEveryTick() {
        when(displayDao.findScan(ConversationEventDisplayScanDO.SCAN_KEY_RAW))
                .thenReturn(new ConversationEventDisplayScanDO());
        var row = rawKey(11L, 7L, 1, 1L, "text", new java.util.Date());
        when(eventDao.listRawKeysAfter(0L, 200)).thenReturn(List.of(row));
        when(displayDao.insertFromFirstRawChunk(anyLong(), anyLong(), anyLong(), anyInt(),
                anyLong(), anyString(), anyString())).thenReturn(0);

        service.scanHistoryBatch(200, 500L);

        verify(displayDao).advanceScan(eq(ConversationEventDisplayScanDO.SCAN_KEY_RAW), eq(0L),
                eq(11L), eq(1L), org.mockito.ArgumentMatchers.argThat(quiet ->
                        quiet != null && quiet.after(new java.util.Date())), any());
    }

    @Test
    void historyScanIsSkippedWhenTheTableIsEmpty() {
        when(displayDao.findScan(ConversationEventDisplayScanDO.SCAN_KEY_RAW))
                .thenReturn(new ConversationEventDisplayScanDO());
        when(eventDao.listRawKeysAfter(0L, 200)).thenReturn(List.of());

        assertEquals(0, service.scanHistoryBatch(200, 500L));
        verify(displayDao, never()).advanceScan(anyString(), anyLong(), anyLong(), anyLong(), any(), any());
    }

    @Test
    void queueSnapshotReportsClassCountsWithoutContent() {
        when(displayDao.findScan(ConversationEventDisplayScanDO.SCAN_KEY_RAW))
                .thenReturn(new ConversationEventDisplayScanDO());
        when(displayDao.countByQueueClass(ConversationEventDisplayDO.CLASS_REALTIME)).thenReturn(3);
        when(displayDao.countByQueueClass(ConversationEventDisplayDO.CLASS_INTERACTIVE)).thenReturn(1);
        when(displayDao.countByQueueClass(ConversationEventDisplayDO.CLASS_HISTORY)).thenReturn(9);

        assertEquals("realtime=3 interactive=1 history=9 rawCursor=0 rawHighWater=0",
                service.queueSnapshot());
    }

    @Test
    void queueSnapshotToleratesAMissingCheckpointAndReportsRealValues() {
        var stored = new ConversationEventDisplayScanDO();
        stored.setLastRawId(123L); stored.setHighWaterRawId(456L);
        when(displayDao.findScan(ConversationEventDisplayScanDO.SCAN_KEY_RAW))
                .thenReturn(null).thenReturn(stored);

        assertEquals("realtime=0 interactive=0 history=0 rawCursor=0 rawHighWater=0",
                service.queueSnapshot());
        assertEquals("realtime=0 interactive=0 history=0 rawCursor=123 rawHighWater=456",
                service.queueSnapshot());
    }

    @Test
    void historyScanNormalisesMissingFieldsAndSkipsDuplicateLogicalKeys() {
        var scan = new ConversationEventDisplayScanDO();
        scan.setLastRawId(10L); scan.setHighWaterRawId(null); scan.setGeneration(null);
        when(displayDao.findScan(ConversationEventDisplayScanDO.SCAN_KEY_RAW)).thenReturn(scan);
        java.util.Date now = new java.util.Date();
        var missingFields = new AgentConversationTurnEventDO();
        missingFields.setId(13L); missingFields.setTenantId(1L); missingFields.setConversationId(2L);
        missingFields.setTurnId(7L); missingFields.setEventType("text"); missingFields.setGmtCreate(now);
        when(eventDao.listRawKeysAfter(10L, 200)).thenReturn(List.of(
                rawKey(11L, 7L, 1, 1L, "text", null),
                rawKey(12L, 7L, 1, 1L, "text", now),
                missingFields));

        service.scanHistoryBatch(200, 500L);

        // 无 gmt_create 的旧事件按历史通道处理；缺失 attempt/seq 归一为 0。
        verify(displayDao).insertFromFirstRawChunk(1L, 2L, 7L, 1, 1L,
                ConversationEventDisplayBudget.PROJECTION_VERSION,
                ConversationEventDisplayDO.CLASS_HISTORY);
        verify(displayDao).insertFromFirstRawChunk(1L, 2L, 7L, 0, 0L,
                ConversationEventDisplayBudget.PROJECTION_VERSION,
                ConversationEventDisplayDO.CLASS_REALTIME);
        // 同批次重复逻辑键只补建一次。
        verify(displayDao, org.mockito.Mockito.times(1)).insertFromFirstRawChunk(anyLong(),
                anyLong(), anyLong(), eq(1), eq(1L), anyString(), anyString());
    }

    @Test
    void cleanupDeletesDerivedRowsWhoseTurnIsGone() {
        when(displayDao.listExpiredIds(any(), eq(500))).thenReturn(List.of(1L, 2L));
        when(displayDao.deleteByIds(List.of(1L, 2L))).thenReturn(2);

        assertEquals(2, service.cleanupExpired(30, 500));
        verify(segmentDao).deleteByDisplayIds(List.of(1L, 2L));
    }

    @Test
    void cleanupWithoutExpiredRowsIsANoop() {
        when(displayDao.listExpiredIds(any(), eq(500))).thenReturn(List.of());

        assertEquals(0, service.cleanupExpired(30, 500));
        verifyNoInteractions(segmentDao);
    }

    @Test
    void crashedPreparationReleasesTheLeaseForTheNextWorker() {
        when(displayDao.listClaimablePage(any(), anyString(), anyLong(), anyLong(), eq(20))).thenReturn(List.of(candidate(50L, 7L)));
        when(displayDao.claim(eq(50L), any(), any(), anyString())).thenReturn(1);
        when(displayDao.findById(50L)).thenThrow(new IllegalStateException("database gone"));

        assertEquals(1, service.processRealtimeDue(20));
        verify(displayDao).releaseLease(eq(50L), anyString());
    }

    @Test
    void missingConversationMarksTheSourceRemoved() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        var turn = new AgentConversationTurnDO();
        turn.setId(7L); turn.setStatus("PROCESSING");
        when(turnDao.findByConversationTurn(1L, 2L, 7L)).thenReturn(turn);
        when(conversationDao.findById(1L, 2L)).thenReturn(null);

        service.prepare(50L);

        verify(displayDao).markSourceRemoved(50L);
        verifyNoInteractions(publisher);
    }

    @Test
    void terminalTurnWithMissingSlicesFailsAfterFiveMinutes() {
        var row = display();
        row.setAttemptCount(1);
        row.setGmtCreate(new java.util.Date(System.currentTimeMillis()
                - ConversationEventDisplayBudget.MISSING_CHUNK_FAILED_MS - 1000L));
        when(displayDao.findById(50L)).thenReturn(row);
        var turn = new AgentConversationTurnDO();
        turn.setId(7L); turn.setStatus("FAILED");
        when(turnDao.findByConversationTurn(1L, 2L, 7L)).thenReturn(turn);
        when(turnDao.findByConversationTurnForUpdate(1L, 2L, 7L)).thenReturn(turn);
        var conversation = new AgentConversationDO();
        conversation.setId(2L); conversation.setChannel("WORKITEM_CLARIFICATION");
        when(conversationDao.findById(1L, 2L)).thenReturn(conversation);
        when(eventDao.listChunkMeta(1L, 7L, 1, 3L, -1, 32)).thenReturn(List.of(meta(0, 2, 2L)));
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(0L);

        service.prepare(50L);

        verify(displayDao).markFailedIfCurrent(eq(50L), eq(1L), anyString(), anyInt(), anyString(), any());
        verify(displayDao, never()).scheduleRetry(anyLong(), any(), anyString(), any());
    }

    @Test
    void businessControlEventsArePublishedWithoutADisplayNotification() {
        var row = display();
        row.setEventType("status");
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta(0, 1, 2L)));
        when(eventDao.listChunkPayloads(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32), anyInt()))
                .thenReturn(List.of(chunk(0, "{\"status\":\"DONE\"}")));
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(0L);

        service.prepare(50L);

        verify(displayDao).markReady(eq(50L), eq(1L), any(), anyLong(), anyInt(), anyBoolean(),
                anyBoolean(), anyString(), any());
        verifyNoInteractions(publisher);
    }

    @Test
    void unknownOrAlreadyPreparedRowsAreSkipped() {
        when(displayDao.findById(50L)).thenReturn(null);
        service.prepare(50L);

        var ready = display();
        ready.setStatus(ConversationEventDisplayDO.STATUS_READY);
        when(displayDao.findById(51L)).thenReturn(ready);
        service.prepare(51L);

        verify(displayDao, never()).markReady(anyLong(), anyLong(), any(), anyLong(), anyInt(),
                anyBoolean(), anyBoolean(), anyString(), any());
        verifyNoInteractions(publisher);
    }

    /** CR-2：中部空档是乱序/迟到，不是结构损坏，先重试而不是永久失败。 */
    @Test
    void gapInChunkIndexIsRetriedUntilTheMissingSliceArrives() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta(0, 3, 2L), meta(2, 3, 2L)))
                .thenReturn(List.of());

        service.prepare(50L);

        verify(displayDao).scheduleRetry(eq(50L), any(), anyString(), any());
        verify(displayDao, never()).markFailedIfCurrent(anyLong(), anyLong(), anyString(), anyInt(), anyString(), any());
    }

    /** CR-2：补片到达后同一逻辑键可以完整发布。 */
    @Test
    void lateSliceCompletesAfterGapRetry() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta(0, 3, 2L), meta(1, 3, 2L), meta(2, 3, 2L)))
                .thenReturn(List.of());
        when(eventDao.listChunkPayloads(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32), anyInt()))
                .thenReturn(List.of(chunk(0, "a"), chunk(1, "b"), chunk(2, "c")));
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(3L);

        service.prepare(50L);

        verify(displayDao).markReady(eq(50L), eq(4L), eq("abc"), eq(3L), eq(1),
                eq(false), eq(false), eq("v2-semantic"), any());
    }

    /** CR-2：迟到补片会重新武装永久失败的同一逻辑键。 */
    @Test
    void lateSliceRearmsAPermanentlyFailedRow() {
        service.markDirty(1L, 2L, 7L, 1, 3L, "tool_result");

        verify(displayDao).insertTask(org.mockito.ArgumentMatchers.any());
        verify(displayDao).rearmFailed(eq(1L), eq(2L), eq(7L), eq(1), eq(3L), any());
    }

    @Test
    void invalidChunkCountIsAPermanentHardRejection() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta(0, 0, 2L)));
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(0L);

        service.prepare(50L);

        verify(displayDao).markFailedIfCurrent(eq(50L), eq(1L), anyString(), anyInt(), anyString(), any());
    }

    @Test
    void emptyPayloadPageIsRetriedInsteadOfPublishing() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta(0, 1, 2L)));
        when(eventDao.listChunkPayloads(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32), anyInt()))
                .thenReturn(List.of());

        service.prepare(50L);

        verify(displayDao).scheduleRetry(eq(50L), any(), anyString(), any());
    }

    @Test
    void platformProjectionRejectionIsPublishedAsUnavailable() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation(PlatformConversationChannel.CHANNEL);
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta(0, 1, 7L)));
        when(eventDao.listChunkPayloads(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32), anyInt()))
                .thenReturn(List.of(chunk(0, "{broken")));
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(0L);

        service.prepare(50L);

        verify(displayDao).markFailedIfCurrent(eq(50L), eq(1L), anyString(), anyInt(), anyString(), any());
    }

    @Test
    void publishSkipsWhenTheTurnDisappearsDuringPublication() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        var turn = new AgentConversationTurnDO();
        turn.setId(7L); turn.setStatus("PROCESSING");
        when(turnDao.findByConversationTurn(1L, 2L, 7L)).thenReturn(turn);
        when(turnDao.findByConversationTurnForUpdate(1L, 2L, 7L)).thenReturn(null);
        var conversation = new AgentConversationDO();
        conversation.setId(2L); conversation.setChannel("WORKITEM_CLARIFICATION");
        when(conversationDao.findById(1L, 2L)).thenReturn(conversation);
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta(0, 1, 2L)));
        when(eventDao.listChunkPayloads(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32), anyInt()))
                .thenReturn(List.of(chunk(0, "body")));

        service.prepare(50L);

        verify(displayDao).markSourceRemoved(50L);
        verify(displayDao, never()).markReady(anyLong(), anyLong(), any(), anyLong(), anyInt(),
                anyBoolean(), anyBoolean(), anyString(), any());
    }

    @Test
    void notificationRunsAfterCommitWhenATransactionIsActive() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta(0, 1, 2L)));
        when(eventDao.listChunkPayloads(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32), anyInt()))
                .thenReturn(List.of(chunk(0, "body")));
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(0L);

        org.springframework.transaction.support.TransactionSynchronizationManager.initSynchronization();
        org.springframework.transaction.support.TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            service.prepare(50L);
            verifyNoInteractions(publisher);
            org.springframework.transaction.support.TransactionSynchronizationManager.getSynchronizations()
                    .forEach(org.springframework.transaction.support.TransactionSynchronization::afterCommit);
            verify(publisher).publishDisplayAvailable(2L, 7L, 50L, 1L, "READY", "READY", "tool_result");
        } finally {
            org.springframework.transaction.support.TransactionSynchronizationManager.clearSynchronization();
            org.springframework.transaction.support.TransactionSynchronizationManager.setActualTransactionActive(false);
        }
    }

    @Test
    void notificationIsSkippedWithoutAPublisher() {
        service.setPublisher(null);
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta(0, 1, 2L)));
        when(eventDao.listChunkPayloads(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32), anyInt()))
                .thenReturn(List.of(chunk(0, "body")));
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(0L);

        service.prepare(50L);

        verify(displayDao).markReady(eq(50L), eq(1L), any(), anyLong(), anyInt(), anyBoolean(),
                anyBoolean(), anyString(), any());
    }

    @Test
    void nullSliceMetadataFallsBackToSafeDefaults() {
        var row = display();
        row.setAttemptCount(null);
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        var meta = meta(0, 1, 0L);
        meta.setPayloadBytes(null);
        meta.setPayloadChars(null);
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta));
        var payloadRow = chunk(0, null);
        payloadRow.setChunkIndex(null);
        when(eventDao.listChunkPayloads(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32), anyInt()))
                .thenReturn(List.of(payloadRow));
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(0L);

        service.prepare(50L);

        verify(displayDao).markReady(eq(50L), eq(1L), any(), anyLong(), anyInt(), anyBoolean(),
                anyBoolean(), anyString(), any());
    }

    @Test
    void missingSliceWithNullAttemptCountStillSchedulesARetry() {
        var row = display();
        row.setAttemptCount(null);
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta(0, 2, 2L)))
                .thenReturn(List.of());

        service.prepare(50L);

        verify(displayDao).scheduleRetry(eq(50L), any(), anyString(), any());
    }

    /** N-1：扫描进度持久化在 checkpoint 行，重启/多实例不会退回从 0 全表重扫。 */
    @Test
    void historyScanResumesFromThePersistedCheckpointAfterRestart() {
        var scan = new ConversationEventDisplayScanDO();
        scan.setLastRawId(700L); scan.setHighWaterRawId(900L); scan.setGeneration(3L);
        when(displayDao.findScan(ConversationEventDisplayScanDO.SCAN_KEY_RAW)).thenReturn(scan);
        when(eventDao.listRawKeysAfter(700L, 200))
                .thenReturn(List.of(rawKey(701L, 7L, 1, 1L, "text", new java.util.Date())));

        service.scanHistoryBatch(200, 500L);

        verify(eventDao).listRawKeysAfter(700L, 200);
        verify(eventDao, never()).listRawKeysAfter(0L, 200);
        verify(displayDao).advanceScan(eq(ConversationEventDisplayScanDO.SCAN_KEY_RAW), eq(0L),
                eq(900L), eq(4L), any(), any());
    }

    /** QA-B2：切片数超过处理上限 → 明确失败（不可用），不尝试读入。 */
    @Test
    void chunkCountOverTheLimitIsRejectedWithoutReadingPayloads() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        List<AgentConversationTurnEventDO> hugePage = new java.util.ArrayList<>();
        for (int i = 0; i <= ConversationEventDisplayBudget.MAX_CHUNKS; i++) {
            hugePage.add(meta(i, ConversationEventDisplayBudget.MAX_CHUNKS + 1, 1L));
        }
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(hugePage);
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(0L);

        service.prepare(50L);

        verify(eventDao, never()).listChunkPayloads(anyLong(), anyLong(), anyInt(), anyLong(),
                anyInt(), anyInt(), anyInt());
        verify(displayDao).markFailedIfCurrent(eq(50L), eq(1L), anyString(), anyInt(), anyString(), any());
    }

    /** QA-B2：各片元数据都小于 32MiB，但合计超限 → 明确失败。 */
    @Test
    void aggregateMetadataOverThirtyTwoMebibytesIsRejected() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        long seventeenMib = 17L * 1024 * 1024;
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta(0, 2, seventeenMib), meta(1, 2, seventeenMib)));
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(0L);

        service.prepare(50L);

        verify(eventDao, never()).listChunkPayloads(anyLong(), anyLong(), anyInt(), anyLong(),
                anyInt(), anyInt(), anyInt());
        verify(displayDao).markFailedIfCurrent(eq(50L), eq(1L), anyString(), anyInt(), anyString(), any());
    }

    /** QA-B2：元数据未超限但重组后实际内容超 32MiB → 二次守卫失败。 */
    @Test
    void reassembledPayloadOverThirtyTwoMebibytesIsRejected() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta(0, 1, 10L)))
                .thenReturn(List.of());
        String oversized = "x".repeat((int) ConversationEventDisplayBudget.MAX_EVENT_BYTES + 1);
        when(eventDao.listChunkPayloads(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32), anyInt()))
                .thenReturn(List.of(chunk(0, oversized)));
        when(displayDao.selectMaxPublicationSeq(1L, 2L, 7L)).thenReturn(0L);

        service.prepare(50L);

        verify(displayDao).markFailedIfCurrent(eq(50L), eq(1L), anyString(), anyInt(), anyString(), any());
    }

    /** QA-B5：投影抛运行时异常 → 进入重试而不是崩溃或永久失败。 */
    @Test
    void projectionRuntimeFailureSchedulesARetry() {
        var row = display();
        when(displayDao.findById(50L)).thenReturn(row);
        stubTurnAndConversation("WORKITEM_CLARIFICATION");
        when(eventDao.listChunkMeta(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32)))
                .thenReturn(List.of(meta(0, 1, 2L)));
        when(eventDao.listChunkPayloads(eq(1L), eq(7L), eq(1), eq(3L), anyInt(), eq(32), anyInt()))
                .thenReturn(List.of(chunk(0, "body")));
        var spied = org.mockito.Mockito.spy(service);
        org.mockito.Mockito.doThrow(new IllegalStateException("projection boom"))
                .when(spied).project(any(), any(), any());

        spied.prepare(50L);

        verify(displayDao).scheduleRetry(eq(50L), any(), anyString(), any());
        verify(displayDao, never()).markFailedIfCurrent(anyLong(), anyLong(), anyString(), anyInt(), anyString(), any());
    }
}
