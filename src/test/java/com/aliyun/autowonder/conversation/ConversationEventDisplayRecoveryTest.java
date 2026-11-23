package com.aliyun.autowonder.conversation;

import org.junit.jupiter.api.Test;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ConversationEventDisplayRecoveryTest {
    @Test
    void slowRecoveryDoesNotHoldTheReaderAndRepeatedReadsShareOneJob() throws Exception {
        var preparation = mock(ConversationEventDisplayPreparationService.class);
        when(preparation.upgradeLegacyReadyPage(anyLong(), anyLong(), anyLong(), anyLong()))
                .thenReturn(new ConversationEventDisplayPreparationService.LegacyUpgradePage(0, 0, false));
        var dao = mock(ConversationEventDisplayDao.class);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(preparation.backfillTurn(1, 2, 3)).thenAnswer(invocation -> {
            started.countDown();
            try { release.await(3, TimeUnit.SECONDS); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            return 0;
        });
        try (var recovery = new ConversationEventDisplayRecovery(preparation, dao)) {
            recovery.request(1, 2, 3);
            assertTrue(started.await(1, TimeUnit.SECONDS));
            assertTimeout(java.time.Duration.ofSeconds(1), () -> {
                for (int i = 0; i < 500; i++) recovery.request(1, 2, 3);
            });
            verify(preparation, times(1)).backfillTurn(1, 2, 3);
            release.countDown();
        } finally {
            release.countDown();
        }
    }

    @Test
    void saturatedQueueNeverRunsDiscoveryOnTheCallingThread() throws Exception {
        var preparation = mock(ConversationEventDisplayPreparationService.class);
        when(preparation.upgradeLegacyReadyPage(anyLong(), anyLong(), anyLong(), anyLong()))
                .thenReturn(new ConversationEventDisplayPreparationService.LegacyUpgradePage(0, 0, false));
        var dao = mock(ConversationEventDisplayDao.class);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(preparation.backfillTurn(anyLong(), anyLong(), anyLong())).thenAnswer(invocation -> {
            started.countDown();
            try { release.await(3, TimeUnit.SECONDS); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            return 0;
        });
        try (var recovery = new ConversationEventDisplayRecovery(preparation, dao)) {
            recovery.request(1, 2, 0);
            assertTrue(started.await(1, TimeUnit.SECONDS));
            assertTimeout(java.time.Duration.ofSeconds(1), () -> {
                for (int i = 1; i <= 500; i++) recovery.request(1, 2, i);
            });
            verify(preparation, times(1)).backfillTurn(anyLong(), anyLong(), anyLong());
        } finally {
            release.countDown();
        }
    }
}
