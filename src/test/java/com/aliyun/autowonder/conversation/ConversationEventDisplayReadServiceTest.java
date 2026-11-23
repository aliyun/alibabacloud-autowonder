package com.aliyun.autowonder.conversation;

import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.conversation.dto.ConversationEventDisplayDtos.ContentSegment;
import com.aliyun.autowonder.conversation.dto.ConversationEventDisplayDtos.SummaryPage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ConversationEventDisplayReadServiceTest {

    @Test
    void readDoesNotPerformBackfillWritesOnTheRequestThread() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 11)).thenReturn(List.of());
        when(displayDao.findMissingLogicalKey(1L, 2L, 7L)).thenReturn(500L);
        service.readSummaries(1L, 2L, 7L, null, 10);
        verify(preparationService, never()).backfillTurn(1L, 2L, 7L);
        verify(displayDao, never()).promoteTurn(anyLong(), anyLong(), anyLong(), anyString(), anyString(), any());
    }

    @Test
    void emptyCursorContinuationReschedulesALegacyUpgradeAfterAnEarlierRejection() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 8L, 11)).thenReturn(List.of());
        when(displayDao.findMissingLogicalKey(1L, 2L, 7L)).thenReturn(null);
        when(displayDao.findLegacyReadyId(1L, 2L, 7L)).thenReturn(9L);
        service.readSummaries(1L, 2L, 7L, "8", 10);
        verify(recovery).request(1L, 2L, 7L);
    }

    private final ConversationEventDisplayDao displayDao = mock(ConversationEventDisplayDao.class);
    private final ConversationEventContentSegmentDao segmentDao = mock(ConversationEventContentSegmentDao.class);
    private final AgentConversationTurnDao turnDao = mock(AgentConversationTurnDao.class);
    private final ConversationEventDisplayPreparationService preparationService =
            mock(ConversationEventDisplayPreparationService.class);
    private ConversationEventDisplayReadService service;
    private final ConversationEventDisplayRecovery recovery = mock(ConversationEventDisplayRecovery.class);

    @BeforeEach
    void setUp() {
        service = new ConversationEventDisplayReadService(displayDao, segmentDao, turnDao,
                recovery);
        var turn = new AgentConversationTurnDO();
        turn.setId(7L);
        when(turnDao.findByConversationTurn(1L, 2L, 7L)).thenReturn(turn);
    }

    private ConversationEventDisplayDO ready(long id, long seq, String summary, boolean detail) {
        var row = new ConversationEventDisplayDO();
        row.setId(id); row.setTenantId(1L); row.setConversationId(2L); row.setTurnId(7L);
        row.setDispatchAttempt(1); row.setEventSeq(seq); row.setEventType("tool_result");
        row.setStatus(ConversationEventDisplayDO.STATUS_READY);
        row.setPublicationSeq(seq); row.setSummary(summary);
        row.setDetailAvailable(detail ? 1 : 0); row.setTruncated(detail ? 1 : 0);
        row.setTotalSegments(detail ? 3 : 1); row.setContentLength(10L);
        row.setGmtCreate(new Date(1700000000000L));
        return row;
    }

    @Test
    void summaryPageReadsOnlyPublishedRowsAndReturnsCursor() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 101))
                .thenReturn(List.of(ready(11L, 1L, "small", false), ready(12L, 2L, "large", true)));
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_READY)).thenReturn(2);
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_FAILED)).thenReturn(0);
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_PREPARING)).thenReturn(1);

        SummaryPage page = service.readSummaries(1L, 2L, 7L, null, 100);

        assertEquals(2, page.items().size());
        assertEquals(2L, page.nextCursor());
        assertFalse(page.hasMore());
        assertEquals("PARTIAL", page.preparationStatus());
        assertEquals(1, page.pendingCount());
        assertEquals(3000L, page.retryAfterMs());
        assertEquals("small", page.items().get(0).payload());
        assertNull(page.items().get(0).summary());
        assertNull(page.items().get(1).payload());
        assertEquals("large", page.items().get(1).summary());
        assertTrue(page.items().get(1).detailAvailable());
    }

    @Test
    void pageStopsAtOneHundredItemsEvenWhenMoreRowsExist() {
        List<ConversationEventDisplayDO> rows = new ArrayList<>();
        for (int i = 1; i <= 101; i++) rows.add(ready(1000L + i, i, "s", false));
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 101)).thenReturn(rows);
        when(displayDao.countByStatus(anyLong(), anyLong(), anyLong(), anyString())).thenReturn(0);

        SummaryPage page = service.readSummaries(1L, 2L, 7L, null, 500);

        assertEquals(100, page.items().size());
        assertTrue(page.hasMore());
        assertEquals(100L, page.nextCursor());
    }

    @Test
    void unknownCursorIsRejectedWithoutReadingRows() {
        assertThrows(BizException.class, () -> service.readSummaries(1L, 2L, 7L, "abc", 10));
        verify(displayDao, never()).listPublishedAfter(anyLong(), anyLong(), anyLong(), anyLong(), anyInt());
    }

    @Test
    void turnOwnershipIsValidatedBeforeAnyRead() {
        when(turnDao.findByConversationTurn(1L, 2L, 99L)).thenReturn(null);
        assertThrows(BizException.class, () -> service.readSummaries(1L, 2L, 99L, null, 10));
        verify(displayDao, never()).listPublishedAfter(anyLong(), anyLong(), anyLong(), anyLong(), anyInt());
    }

    @Test
    void preparingAndUnavailableDetailsAreExplicit() {
        var preparing = ready(11L, 1L, null, true);
        preparing.setStatus(ConversationEventDisplayDO.STATUS_PREPARING);
        when(displayDao.findById(11L)).thenReturn(preparing);
        ContentSegment segment = service.readContentSegment(1L, 2L, 7L, 11L, null, null);
        assertEquals("PREPARING", segment.state());
        assertEquals(3000L, segment.retryAfterMs());

        var failed = ready(12L, 2L, null, true);
        failed.setStatus(ConversationEventDisplayDO.STATUS_FAILED);
        when(displayDao.findById(12L)).thenReturn(failed);
        assertEquals("UNAVAILABLE", service.readContentSegment(1L, 2L, 7L, 12L, null, null).state());
    }

    @Test
    void contentReadsTheRequestedSegmentAndReportsCursors() {
        when(displayDao.findById(11L)).thenReturn(ready(11L, 1L, "large", true));
        var segment = new ConversationEventContentSegmentDO();
        segment.setDisplayId(11L); segment.setProjectionVersion("v1"); segment.setSegmentIndex(1);
        segment.setContent("第二段");
        when(segmentDao.findSegment(11L, "v1", 1)).thenReturn(segment);

        ContentSegment result = service.readContentSegment(1L, 2L, 7L, 11L, "1", "v1");

        assertEquals("第二段", result.content());
        assertEquals(0L, result.previousCursor());
        assertEquals(2L, result.nextCursor());
        assertTrue(result.hasMore());
    }

    @Test
    void staleProjectionVersionIsRejectedBeforeReadingSegments() {
        when(displayDao.findById(11L)).thenReturn(ready(11L, 1L, "large", true));
        assertThrows(BizException.class,
                () -> service.readContentSegment(1L, 2L, 7L, 11L, "0", "v0"));
        verify(segmentDao, never()).findSegment(anyLong(), anyString(), anyInt());
    }

    @Test
    void eventFromAnotherTurnIsRejected() {
        var row = ready(11L, 1L, "x", false);
        row.setTurnId(99L);
        when(displayDao.findById(11L)).thenReturn(row);
        assertThrows(BizException.class,
                () -> service.readContentSegment(1L, 2L, 7L, 11L, null, null));
        verify(segmentDao, never()).findSegment(anyLong(), anyString(), anyInt());
    }

    @Test
    void preparationStatusPartitionsExplicitly() {
        assertEquals("EMPTY", ConversationEventDisplayReadService.preparationStatus(0, 0, 0));
        assertEquals("PREPARING", ConversationEventDisplayReadService.preparationStatus(0, 0, 2));
        assertEquals("PARTIAL", ConversationEventDisplayReadService.preparationStatus(1, 0, 2));
        assertEquals("READY", ConversationEventDisplayReadService.preparationStatus(1, 1, 0));
        assertEquals("UNAVAILABLE", ConversationEventDisplayReadService.preparationStatus(0, 2, 0));
    }

    @Test
    void emptyTurnReportsEmptyPreparationAndNoCursor() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 101)).thenReturn(List.of());
        when(displayDao.countByStatus(anyLong(), anyLong(), anyLong(), anyString())).thenReturn(0);
        when(displayDao.findMissingLogicalKey(1L, 2L, 7L)).thenReturn(null);

        SummaryPage page = service.readSummaries(1L, 2L, 7L, null, 10);

        assertEquals("EMPTY", page.preparationStatus());
        assertNull(page.nextCursor());
        assertFalse(page.hasMore());
        assertNull(page.retryAfterMs());
    }

    /** 该轮仍有原始事件没有 display 行时，不能把「还没发现」误报成「确实没有事件」。 */
    @Test
    void undiscoveredEmptyTurnStaysPreparingInsteadOfReportingEmpty() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 11)).thenReturn(List.of());
        when(displayDao.countByStatus(anyLong(), anyLong(), anyLong(), anyString())).thenReturn(0);
        when(displayDao.findMissingLogicalKey(1L, 2L, 7L)).thenReturn(500L);
        when(preparationService.backfillTurn(1L, 2L, 7L)).thenReturn(5);

        SummaryPage page = service.readSummaries(1L, 2L, 7L, null, 10);

        assertEquals("PREPARING", page.preparationStatus());
        assertEquals(3000L, page.retryAfterMs());
    }

    @Test
    void emptyTurnIsEmptyOnceEveryRawEventHasADisplayRow() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 11)).thenReturn(List.of());
        when(displayDao.countByStatus(anyLong(), anyLong(), anyLong(), anyString())).thenReturn(0);
        when(displayDao.findMissingLogicalKey(1L, 2L, 7L)).thenReturn(null);

        SummaryPage page = service.readSummaries(1L, 2L, 7L, null, 10);

        assertEquals("EMPTY", page.preparationStatus());
        assertNull(page.retryAfterMs());
    }

    /**
     * CR-11 核心：已发布 20 行但该轮还有未发现事件时必须报 PARTIAL，不能提前 READY，
     * 否则前端会停止补偿并永久截断尾部。
     */
    @Test
    void partiallyDiscoveredTurnReportsPartialInsteadOfReady() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 11)).thenReturn(List.of());
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_READY))
                .thenReturn(20);
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_FAILED))
                .thenReturn(0);
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_PREPARING))
                .thenReturn(0);
        when(displayDao.findMissingLogicalKey(1L, 2L, 7L)).thenReturn(900L);
        when(preparationService.backfillTurn(1L, 2L, 7L)).thenReturn(20);

        SummaryPage page = service.readSummaries(1L, 2L, 7L, null, 10);

        assertEquals("PARTIAL", page.preparationStatus());
        assertEquals(3000L, page.retryAfterMs());
        verify(recovery).request(1L, 2L, 7L);
    }

    /** 逻辑键永久失败时补建 0 行：仍保持诚实 PARTIAL，但退避到 30s，避免 3s 节奏持续打库。 */
    @Test
    void backfillWithoutProgressBacksOffInsteadOfPollingEveryThreeSeconds() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 11)).thenReturn(List.of());
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_READY))
                .thenReturn(20);
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_FAILED))
                .thenReturn(0);
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_PREPARING))
                .thenReturn(0);
        when(displayDao.findMissingLogicalKey(1L, 2L, 7L)).thenReturn(900L);
        when(preparationService.backfillTurn(1L, 2L, 7L)).thenReturn(0);

        SummaryPage page = service.readSummaries(1L, 2L, 7L, null, 10);

        assertEquals("PARTIAL", page.preparationStatus());
        assertEquals(3000L, page.retryAfterMs());
    }

    /** 全部已发布且发现完备时才允许 READY。 */
    @Test
    void fullyDiscoveredReadyTurnStaysReadyWithoutBackfill() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 11)).thenReturn(List.of());
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_READY))
                .thenReturn(20);
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_FAILED))
                .thenReturn(0);
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_PREPARING))
                .thenReturn(0);
        when(displayDao.findMissingLogicalKey(1L, 2L, 7L)).thenReturn(null);

        assertEquals("READY", service.readSummaries(1L, 2L, 7L, null, 10).preparationStatus());
        verify(preparationService, never()).backfillTurn(anyLong(), anyLong(), anyLong());
    }

    /** 用户打开一个尚未被后台发现的轮次：按需补建一批，避免干等扫描游标推进。 */
    @Test
    void undiscoveredTurnTriggersOneBoundedBackfill() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 11)).thenReturn(List.of());
        when(displayDao.countByStatus(anyLong(), anyLong(), anyLong(), anyString())).thenReturn(0);
        when(displayDao.findMissingLogicalKey(1L, 2L, 7L)).thenReturn(500L);

        SummaryPage page = service.readSummaries(1L, 2L, 7L, null, 10);

        assertEquals("PREPARING", page.preparationStatus());
        verify(recovery).request(1L, 2L, 7L);
    }

    @Test
    void backfillFailureDoesNotBreakAnAuthorisedRead() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 11)).thenReturn(List.of());
        when(displayDao.countByStatus(anyLong(), anyLong(), anyLong(), anyString())).thenReturn(0);
        when(displayDao.findMissingLogicalKey(1L, 2L, 7L)).thenReturn(500L);
        when(preparationService.backfillTurn(1L, 2L, 7L))
                .thenThrow(new IllegalStateException("db busy"));

        assertEquals("PREPARING",
                service.readSummaries(1L, 2L, 7L, null, 10).preparationStatus());
    }

    /** 该轮的原始事件全部已有 display 行且没有可发布内容时，才可以是 EMPTY。 */
    @Test
    void turnWithoutMissingRawEventsIsEmptyImmediately() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 11)).thenReturn(List.of());
        when(displayDao.countByStatus(anyLong(), anyLong(), anyLong(), anyString())).thenReturn(0);
        when(displayDao.findMissingLogicalKey(1L, 2L, 7L)).thenReturn(null);

        assertEquals("EMPTY", service.readSummaries(1L, 2L, 7L, null, 10).preparationStatus());
        verify(preparationService, never()).backfillTurn(anyLong(), anyLong(), anyLong());
    }

    @Test
    void readingAPendingTurnPromotesItToTheInteractiveQueue() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 11)).thenReturn(List.of());
        when(displayDao.countByStatus(anyLong(), anyLong(), anyLong(), anyString())).thenReturn(0);
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_PREPARING))
                .thenReturn(2);

        service.readSummaries(1L, 2L, 7L, null, 10);

        verify(recovery).request(1L, 2L, 7L);
        verify(displayDao, never()).promoteTurn(anyLong(), anyLong(), anyLong(), anyString(), anyString(), any());
    }

    @Test
    void promotionFailureDoesNotBreakAnAuthorisedRead() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 11)).thenReturn(List.of());
        when(displayDao.countByStatus(anyLong(), anyLong(), anyLong(), anyString())).thenReturn(0);
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_PREPARING))
                .thenReturn(2);
        when(displayDao.promoteTurn(anyLong(), anyLong(), anyLong(), anyString(), anyString(),
                any())).thenThrow(new IllegalStateException("db busy"));

        SummaryPage page = service.readSummaries(1L, 2L, 7L, null, 10);

        assertEquals("PREPARING", page.preparationStatus());
    }

    @Test
    void summaryPageExposesThePublicationWatermarkSoTheClientCanResume() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 101))
                .thenReturn(List.of(ready(11L, 1L, "small", false)));
        when(displayDao.countByStatus(anyLong(), anyLong(), anyLong(), anyString())).thenReturn(0);
        when(displayDao.maxPublishedSeq(1L, 2L, 7L)).thenReturn(9L);

        SummaryPage page = service.readSummaries(1L, 2L, 7L, null, 100);

        assertEquals(9L, page.publicationWatermark());
        assertEquals(1L, page.nextCursor());
    }

    @Test
    void negativeCursorIsRejected() {
        assertThrows(BizException.class, () -> service.readSummaries(1L, 2L, 7L, "-2", 10));
    }

    @Test
    void unknownEventIsRejectedAsATurnMismatch() {
        when(displayDao.findById(404L)).thenReturn(null);
        assertThrows(BizException.class,
                () -> service.readContentSegment(1L, 2L, 7L, 404L, null, null));
        verify(segmentDao, never()).findSegment(anyLong(), anyString(), anyInt());
    }

    @Test
    void zeroSegmentEventReturnsAnEmptyReadyBody() {
        var row = ready(11L, 1L, "", false);
        row.setTotalSegments(0);
        when(displayDao.findById(11L)).thenReturn(row);

        ContentSegment segment = service.readContentSegment(1L, 2L, 7L, 11L, null, null);

        assertEquals("", segment.content());
        assertEquals("READY", segment.state());
        assertFalse(segment.hasMore());
    }

    @Test
    void outOfRangeCursorIsRejected() {
        when(displayDao.findById(11L)).thenReturn(ready(11L, 1L, "large", true));
        assertThrows(BizException.class,
                () -> service.readContentSegment(1L, 2L, 7L, 11L, "9", null));
    }

    @Test
    void missingSegmentRowIsReportedAsNotReady() {
        when(displayDao.findById(11L)).thenReturn(ready(11L, 1L, "large", true));
        when(segmentDao.findSegment(11L, "v1", 0)).thenReturn(null);

        assertThrows(BizException.class,
                () -> service.readContentSegment(1L, 2L, 7L, 11L, "0", null));
    }

    @Test
    void blankCursorStartsFromZero() {
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 11)).thenReturn(List.of());
        when(displayDao.countByStatus(anyLong(), anyLong(), anyLong(), anyString())).thenReturn(0);

        assertFalse(service.readSummaries(1L, 2L, 7L, "  ", 10).hasMore());
        verify(displayDao).listPublishedAfter(1L, 2L, 7L, 0L, 11);
    }

    @Test
    void nullDisplayFieldsFallBackToSafeDefaults() {
        var row = ready(11L, 1L, "small", false);
        row.setDetailAvailable(null);
        row.setTruncated(null);
        row.setTotalSegments(null);
        row.setProjectionVersion(null);
        row.setContentLength(null);
        when(displayDao.findById(11L)).thenReturn(row);
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 11)).thenReturn(List.of(row));
        when(displayDao.countByStatus(anyLong(), anyLong(), anyLong(), anyString())).thenReturn(0);
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_READY)).thenReturn(1);

        var page = service.readSummaries(1L, 2L, 7L, null, 10);
        assertNull(page.items().get(0).totalSegments());
        assertFalse(page.items().get(0).detailAvailable());
        assertFalse(page.items().get(0).truncated());
        assertEquals("small", page.items().get(0).payload());

        // 版本为空时使用首版默认值；空参同样不触发版本失效。
        ContentSegment segment = service.readContentSegment(1L, 2L, 7L, 11L, null, " ");
        assertEquals("READY", segment.state());
        assertEquals("v1", segment.projectionVersion());
    }

    @Test
    void failedRowNeverExposesAPayloadOrSummary() {
        var row = ready(11L, 1L, "summary", false);
        row.setStatus(ConversationEventDisplayDO.STATUS_FAILED);
        when(displayDao.listPublishedAfter(1L, 2L, 7L, 0L, 101)).thenReturn(List.of(row));
        when(displayDao.countByStatus(1L, 2L, 7L, ConversationEventDisplayDO.STATUS_FAILED)).thenReturn(1);
        when(displayDao.findMissingLogicalKey(1L, 2L, 7L)).thenReturn(null);

        var page = service.readSummaries(1L, 2L, 7L, null, 100);

        assertEquals("UNAVAILABLE", page.items().get(0).state());
        assertNull(page.items().get(0).payload());
        assertNull(page.items().get(0).summary());
        assertEquals("UNAVAILABLE", page.preparationStatus());
        assertNull(page.retryAfterMs());
    }
}
