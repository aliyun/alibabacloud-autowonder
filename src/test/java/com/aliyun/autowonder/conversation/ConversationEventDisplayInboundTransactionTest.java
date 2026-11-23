package com.aliyun.autowonder.conversation;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class ConversationEventDisplayInboundTransactionTest {
    @Test
    void unsupportedSavepointsSignalBoundedRecoveryOnlyAfterSuccessfulCompletion() {
        var source = new DriverManagerDataSource(
                "jdbc:h2:mem:display_inbound_no_savepoint;MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
        var jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE TABLE IF NOT EXISTS inbound_probe (id INT PRIMARY KEY)");
        jdbc.update("DELETE FROM inbound_probe");
        var transactionManager = new DataSourceTransactionManager(source);
        transactionManager.setNestedTransactionAllowed(false);
        var displayDao = mock(ConversationEventDisplayDao.class);
        var recovery = mock(ConversationEventDisplayRecovery.class);
        @SuppressWarnings("unchecked")
        org.springframework.beans.factory.ObjectProvider<ConversationEventDisplayRecovery> provider =
                mock(org.springframework.beans.factory.ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(recovery);
        var service = new ConversationEventDisplayPreparationService(displayDao,
                mock(ConversationEventContentSegmentDao.class), mock(AgentConversationTurnEventDao.class),
                mock(AgentConversationTurnDao.class), mock(AgentConversationDao.class), transactionManager);
        service.setRecoveryProvider(provider);

        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            jdbc.update("INSERT INTO inbound_probe VALUES (1)");
            service.markDirty(1, 2, 3, 1, 1, "text");
            verifyNoInteractions(recovery, displayDao);
            assertFalse(status.isRollbackOnly());
        });
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM inbound_probe", Integer.class));
        verify(recovery).request(1, 2, 3);
        reset(recovery);

        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            service.markDirty(1, 2, 3, 1, 2, "text");
            status.setRollbackOnly();
        });
        verifyNoInteractions(recovery);
    }

    @Test
    void failedDerivedMarkRollsBackOnlyItsSavepointAndNeverAcquiresASecondConnection() {
        AtomicInteger acquired = new AtomicInteger();
        var source = new DelegatingDataSource(new DriverManagerDataSource(
                "jdbc:h2:mem:display_inbound_savepoint;MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "")) {
            @Override public Connection getConnection() throws SQLException {
                acquired.incrementAndGet();
                return super.getConnection();
            }
        };
        var jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE TABLE IF NOT EXISTS inbound_probe (id INT PRIMARY KEY, kind VARCHAR(20))");
        jdbc.update("DELETE FROM inbound_probe");
        var transactionManager = new DataSourceTransactionManager(source);
        var displayDao = mock(ConversationEventDisplayDao.class);
        doAnswer(call -> {
            jdbc.update("INSERT INTO inbound_probe VALUES (2, 'derived')");
            throw new IllegalStateException("derived write failed after its first statement");
        }).when(displayDao).insertTask(any());
        var service = new ConversationEventDisplayPreparationService(displayDao,
                mock(ConversationEventContentSegmentDao.class), mock(AgentConversationTurnEventDao.class),
                mock(AgentConversationTurnDao.class), mock(AgentConversationDao.class), transactionManager);
        acquired.set(0);

        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            jdbc.update("INSERT INTO inbound_probe VALUES (1, 'raw')");
            assertThrows(IllegalStateException.class, () -> service.markDirty(1, 2, 3, 1, 1, "text"));
            assertFalse(status.isRollbackOnly(), "derived errors must not poison the inbound ACK transaction");
        });

        assertEquals(1, acquired.get(), "nested display work must use the already held connection");
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM inbound_probe WHERE id=1", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM inbound_probe WHERE id=2", Integer.class));
    }
}
