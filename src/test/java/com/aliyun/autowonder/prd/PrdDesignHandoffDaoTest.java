package com.aliyun.autowonder.prd;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

import java.sql.Timestamp;
import java.time.Instant;

import static com.aliyun.autowonder.prd.PrdDesignHandoffStatus.*;
import static org.junit.jupiter.api.Assertions.*;

class PrdDesignHandoffDaoTest {
    @Test
    void firstDecisionWinsAndDeliveryRetryKeepsTheFrozenSnapshot() throws Exception {
        var db = new UnpooledDataSource("org.h2.Driver", "jdbc:h2:mem:prdHandoff;MODE=MySQL", "sa", "");
        var settings = new Configuration(new Environment("test", new JdbcTransactionFactory(), db));
        settings.setMapUnderscoreToCamelCase(true);
        settings.addMapper(PrdDesignHandoffDao.class);
        try (var session = new SqlSessionFactoryBuilder().build(settings).openSession(true)) {
            ScriptUtils.executeSqlScript(session.getConnection(), new ClassPathResource("schema/prd-design-handoff.sql"));
            var dao = session.getMapper(PrdDesignHandoffDao.class);
            var row = new PrdDesignHandoffDao.Review();
            row.setWorkspaceId(1);
            row.setWorkitemId(10);
            row.setConversationId(20);
            row.setExecutorId(30);
            row.setSourceKey("source");
            row.setVersionId(100);
            row.setDesignDigest("d".repeat(64));
            row.setRepoId(200);
            row.setRepoUrl("https://example.invalid/team/design.git");
            row.setBranch("autowonder-design/10-source");
            row.setReviewersJson("[7,8]");
            row.setMarkdown("# Frozen requirements\n");
            row.setCreatorId(9);
            dao.insert(row);
            assertNotNull(row.getId());
            assertNull(dao.latest(2, 10));
            assertEquals(row.getId(), dao.lockActive(1, 10));

            var snapshot = dao.lock(1, row.getId());
            assertEquals(SNAPSHOTTING, snapshot.getStatus());
            String branch = PrdDesignRepository.reviewBranch(snapshot);
            assertEquals("autowonder-review/1/10/" + row.getId() + "-dddddddddddddddd", branch);
            assertEquals(1, dao.recordSnapshot(snapshot, "f".repeat(40), branch));
            assertEquals(0, dao.recordSnapshot(snapshot, "e".repeat(40), branch));
            var waiting = dao.lock(1, row.getId());
            assertEquals(IN_REVIEW, waiting.getStatus());
            assertEquals(branch, waiting.getBranch());
            assertEquals(1, dao.decide(waiting, ATTACHING, 7, null, branch));
            assertEquals(0, dao.decide(waiting, RETURNED, 8, "Late decision", branch));

            var attaching = dao.lock(1, row.getId());
            assertEquals(1, dao.advance(attaching, ATTACHMENT_FAILED, null, null));
            assertEquals(1, dao.retryAttachment(dao.lock(1, row.getId()), branch));
            assertEquals(0, dao.advance(attaching, COMPLETED, null, 111L));
            var retry = dao.lock(1, row.getId());
            assertEquals(ATTACHING, retry.getStatus());
            assertEquals("f".repeat(40), retry.getCommitSha());
            assertEquals(branch, retry.getBranch());
            assertEquals(7L, retry.getDecidedBy());
            assertNull(dao.completed(1, 10));

            assertEquals(1, dao.advance(dao.lock(1, row.getId()), COMPLETED, null, 123L));
            assertNull(dao.lockActive(1, 10));
            assertEquals(123L, dao.completed(1, 10).getAttachmentId());
            assertEquals(row.getMarkdown(), dao.frozenDocument(1, 10, 100));

            var completedAt = Timestamp.from(Instant.parse("2026-11-26T09:00:00Z"));
            try (var update = session.getConnection()
                    .prepareStatement("UPDATE prd_design_handoff SET next_check=? WHERE id=?")) {
                update.setTimestamp(1, completedAt);
                update.setLong(2, row.getId());
                assertEquals(1, update.executeUpdate());
            }
            session.clearCache();
            assertNull(dao.completedForDelivery(1, 10, new Timestamp(completedAt.getTime() - 1)));
            assertNull(dao.completedForDelivery(2, 10, completedAt));
            assertEquals(123L, dao.completedForDelivery(1, 10, completedAt).getAttachmentId());
        }
    }
}
