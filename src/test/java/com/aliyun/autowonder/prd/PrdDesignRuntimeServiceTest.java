package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.access.WorkspaceAccessLevel;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.conversation.AgentConversationDO;
import com.aliyun.autowonder.conversation.AgentConversationDao;
import com.aliyun.autowonder.mcp.ConversationMcpTokenService;
import com.aliyun.autowonder.mcp.McpAccessTokenService;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.*;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Real SQL coverage for ownership, ordered reports and refresh idempotence. */
class PrdDesignRuntimeServiceTest {
    SqlSession session;
    PrdDesignRuntimeDao dao;
    final AgentConversationDao conversations = mock(AgentConversationDao.class);
    final PrdDesignDao designs = mock(PrdDesignDao.class);
    final ConversationMcpTokenService tokens = mock(ConversationMcpTokenService.class);
    final PrdDesignTemplateService templates = mock(PrdDesignTemplateService.class);
    final com.aliyun.autowonder.repo.RepoDao repos = mock(com.aliyun.autowonder.repo.RepoDao.class);
    PrdDesignRuntimeService service;
    AgentConversationDO conversation;
    McpAccessTokenService.Principal principal;

    @BeforeEach void setup() throws Exception {
        var datasource = new UnpooledDataSource("org.h2.Driver", "jdbc:h2:mem:runtime" + System.nanoTime() + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
        var config = new Configuration(new Environment("test", new JdbcTransactionFactory(), datasource));
        config.setMapUnderscoreToCamelCase(true); config.addMapper(PrdDesignRuntimeDao.class);
        session = new SqlSessionFactoryBuilder().build(config).openSession(true);
        session.getConnection().createStatement().execute(PrdDesignSchemaBootstrap.CREATE_RUNTIME_TABLE);
        dao = session.getMapper(PrdDesignRuntimeDao.class);
        service = new PrdDesignRuntimeService(dao, conversations, designs, tokens, templates);
        service.setRepoDao(repos);
        conversation = new AgentConversationDO(); conversation.setId(20L); conversation.setTenantId(1L);
        conversation.setBizRefId(10L); conversation.setExecutorId(30L); conversation.setChannel("WORKITEM_PRD");
        when(conversations.findById(1L, 20L)).thenReturn(conversation);
        when(conversations.findLatestByBizRef(1L, "WORKITEM_PRD", "WORKITEM", 10L, 40L)).thenReturn(conversation);
        when(templates.download()).thenReturn(new PrdDesignTemplateService.Download("https://storage.example/template.zip", "abc123"));
        principal = principal(50L, 1, 30L);
        service.runtimePrompt(conversation, 50L, 1, "PREPARE");
    }
    @AfterEach void close() { session.close(); }

    McpAccessTokenService.Principal principal(long turn, int attempt, long executor) {
        return new McpAccessTokenService.Principal(1L, 7L, 20L, WorkspaceAccessLevel.READ_WRITE,
                McpAccessTokenService.CredentialType.CONVERSATION,
                new McpAccessTokenService.ExecutionScope(20L, turn, attempt, executor, 40L, 41L));
    }
    PrdDesignRuntimeDO report(String status, Integer port, int sequence) {
        return service.report(principal, status, port, "/settings?q=1#save", "design-demo/10/template", null, sequence);
    }
    @Test void actualPortIsRestoredAndRetriesDoNotRefreshTwice() {
        assertEquals(5174, report("READY", 5174, 1).getPort());
        assertEquals(1, report("READY", 5174, 1).getRevision());
        assertEquals(2, report("UPDATED", 5174, 2).getRevision());
        assertEquals(2, report("STARTING", null, 1).getRevision());
        assertEquals("READY", service.get(1L, 10L, 40L).getStatus());
        assertEquals("/settings?q=1#save", service.get(1L, 10L, 40L).getRoute());
        verify(tokens, times(4)).validateExecution(7L, 1L, principal.executionScope());
    }
    @Test void ordinaryTurnRebindsRuntimeOwnershipWithoutPreparationPrompt() {
        report("READY", 5174, 1);

        service.bindTurn(conversation, 51L, 1);

        var rebound = dao.find(1L, 20L);
        assertEquals(51L, rebound.getTurnId());
        assertEquals(0, rebound.getReportSequence());
        assertEquals("READY", rebound.getStatus());
        assertEquals(5174, rebound.getPort());
        assertThrows(BizException.class, () -> report("UPDATED", 5174, 2));

        principal = principal(51L, 1, 30L);
        assertEquals(2, report("UPDATED", 5174, 1).getRevision());
    }
    @Test void managedPreviewPublishesItsPortAndRetainsItAcrossDesignReports() {
        var row = dao.find(1L, 20L);
        var properties = new PrdReviewPreviewProperties();
        var binding = properties.forRuntime(row);

        assertFalse(service.activatePreview(binding, 5174));
        var recovery = mock(PrdPreviewRecovery.class);
        when(recovery.supports(30L)).thenReturn(true);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "previewProperties", properties);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "previewRecovery", recovery);
        org.springframework.transaction.support.TransactionSynchronizationManager.initSynchronization();
        try {
            String application = row.getDirectory() + "/frontend";
            var prepared = service.report(principal, "PREPARED", null, "/workitems", application, null, 1);
            assertEquals("PREPARED", prepared.getStatus());
            verify(recovery, never()).ensure(any(), any());
            org.springframework.transaction.support.TransactionSynchronizationManager.getSynchronizations()
                    .forEach(org.springframework.transaction.support.TransactionSynchronization::afterCommit);
            verify(recovery).ensure(eq(binding), argThat(runtime ->
                    application.equals(runtime.getDirectory()) && runtime.getPort() == null));
            assertEquals(application, PrdPreviewRecovery.frame(binding, prepared).get("directory"));
        } finally {
            org.springframework.transaction.support.TransactionSynchronizationManager.clearSynchronization();
        }

        assertTrue(service.activatePreview(binding, 5174));
        assertTrue(service.activatePreview(binding, 5175));
        long revision = dao.find(1L, 20L).getRevision();
        assertTrue(service.activatePreview(binding, 5175));
        assertEquals(revision, dao.find(1L, 20L).getRevision());
        assertEquals("READY", report("PREPARED", null, 2).getStatus());
        assertEquals(5175, dao.find(1L, 20L).getPort());
        assertThrows(BizException.class, () -> report("READY", 5174, 3));
        conversation.setExecutorId(31L);
        assertFalse(service.activatePreview(binding, 5174));
    }
    @Test void clusterRegistrationToTheSamePortFencesDelayedOldPortUpdates() {
        var row = report("READY", 5174, 1);
        var properties = new PrdReviewPreviewProperties();
        var binding = properties.forRuntime(row);

        assertFalse(service.activateClusterPreview(binding, 5175, () -> false));
        assertFalse(service.activateClusterPreview(binding, 5175, () ->
                service.activateClusterPreview(binding, 5174, () -> true)));
        var current = dao.find(1L, 20L);
        assertEquals(5174, current.getPort());
        assertEquals(row.getRevision() + 1, current.getRevision());
    }

    @Test void legacyPreviewHealthUsesOnlyAnExistingReadyRuntime() {
        var properties = new PrdReviewPreviewProperties();
        var binding = properties.forRuntime(dao.find(1L, 20L));
        var recovery = mock(PrdPreviewRecovery.class);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "previewRecovery", recovery);
        assertFalse(service.acceptsLegacyPreview(binding));
        report("READY", 5174, 1);
        assertTrue(service.acceptsLegacyPreview(binding));
        when(recovery.supports(30L)).thenReturn(true);
        assertFalse(service.acceptsLegacyPreview(binding));
    }

    @Test void nextAttemptPreservesServiceButRejectsOldReports() {
        report("READY", 5174, 1);
        service.runtimePrompt(conversation, 50L, 2, "PREPARE");
        assertEquals(5174, dao.find(1L, 20L).getPort());
        assertThrows(BizException.class, () -> report("UPDATED", 5173, 2));
        principal = principal(50L, 2, 30L);
        assertEquals(2, report("UPDATED", 5174, 1).getRevision());
        String incremental = service.runtimePrompt(conversation, 51L, 1, "RECOVER");
        assertTrue(incremental.contains("AutoWonder runtime: RECOVER"));
        assertTrue(incremental.contains("复用独立工程目录"));
        assertFalse(incremental.contains("clone"));
        assertThrows(BizException.class, () -> service.runtimePrompt(conversation, 50L, 1, "PREPARE"));
        assertThrows(BizException.class, () -> report("FAILED", null, 2));
    }
    @Test void executorMoveAndTargetChangeDoNotExposeOldLocalhost() {
        report("READY", 5174, 1);
        conversation.setExecutorId(31L);
        assertFalse(service.current(dao.find(1L,20L)));
        assertNull(service.get(1L, 10L, 40L));
        service.runtimePrompt(conversation, 51L, 1, "RECOVER");
        assertNull(dao.find(1L, 20L).getPort());
        var design = new PrdDesignDO(); design.setWorkspaceId(1L); design.setTargetRepoId(99L); design.setTargetAppRoot("web");
        var repo = new com.aliyun.autowonder.repo.RepoDO(); repo.setId(99L); repo.setTenantId(1L);
        repo.setUrl("git@example.com:team/design-app.git");
        when(repos.findById(99L)).thenReturn(repo);
        when(designs.findByWorkitem(1L, 10L)).thenReturn(design);
        assertNull(service.get(1L, 10L, 40L));
        String oldDirectory = dao.find(1L, 20L).getDirectory();
        String prompt = service.runtimePrompt(conversation, 52L, 1, "PREPARE");
        assertNotEquals(oldDirectory, dao.find(1L, 20L).getDirectory());
        assertTrue(prompt.contains("AutoWonder runtime: PREPARE"));
        assertTrue(prompt.contains("创建或复用工作分支：autowonder-design/10-"));
        assertTrue(prompt.contains("从本轮仓库能力读取目标仓库和应用目录"));
        assertTrue(prompt.contains("dev:autowonder"));
        assertFalse(prompt.contains("git@example.com"));
        assertFalse(prompt.contains("repos.json"));
        assertFalse(prompt.contains("universal-inspector"));
        assertFalse(prompt.contains("frpc"));
        assertFalse(prompt.contains("localhost"));
        assertFalse(prompt.contains("abc123"));
        assertFalse(prompt.contains("交付"));
        assertFalse(prompt.contains(".autowonder/turns"));
    }
    @Test void specifiedRepositoryMustBeInActiveCapabilitySnapshot() {
        var design = new PrdDesignDO();
        design.setTargetRepoId(99L);
        when(designs.findByWorkitem(1L, 10L)).thenReturn(design);

        assertThrows(BizException.class, () -> service.requireAuthorizedRepository(conversation, java.util.List.of()));
        assertThrows(BizException.class, () -> service.requireAuthorizedRepository(conversation,
                java.util.List.of(java.util.Map.of("repoId", 98L))));
        service.requireAuthorizedRepository(conversation, java.util.List.of(java.util.Map.of("repoId", 99L)));
    }

    @Test void invalidPortsRoutesAndNonDesignCredentialsAreRejected() {
        assertThrows(BizException.class, () -> report("READY", null, 1));
        assertThrows(BizException.class, () -> report("READY", 65536, 1));
        for (String route : new String[]{"https://evil.example", "//evil.example", "/\\evil.example", "/x\n"}) {
            assertThrows(BizException.class, () -> service.report(principal, "READY", 5173, route, "demo", null, 1));
        }
        assertThrows(BizException.class, () -> service.report(null, "READY", 5173, "/", "demo", null, 1));
        conversation.setChannel("WORKITEM_CLARIFICATION");
        assertThrows(BizException.class, () -> report("READY", 5173, 1));
        assertNull(service.get(2L, 10L, 40L));
        assertEquals(0, dao.find(1L, 20L).getRevision());
    }
}
