package com.aliyun.autowonder.agent;

import com.aliyun.autowonder.agent.dto.AgentVO;
import com.aliyun.autowonder.agent.dto.UpdateAgentTagsRequest;
import com.aliyun.autowonder.executor.ExecutorDao;
import com.aliyun.autowonder.executor.ExecutorRegistry;
import com.aliyun.autowonder.skill.SkillDao;
import com.aliyun.autowonder.workspace.WorkspaceDao;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AgentServiceTagFillTest {

    private static final long TENANT = 1L;

    AgentDao agentDao;
    AgentVersionDao versionDao;
    AgentTagService tagService;
    AgentService service;

    @BeforeEach
    void setUp() {
        agentDao = mock(AgentDao.class);
        versionDao = mock(AgentVersionDao.class);
        tagService = mock(AgentTagService.class);
        service = new AgentService(agentDao, versionDao, mock(AgentRepoPermDao.class), mock(AgentSkillDao.class),
                mock(AgentMemoryRefDao.class), mock(WorkspaceDao.class), mock(ExecutorDao.class),
                mock(ExecutorRegistry.class), mock(SkillDao.class));
        service.setAgentTagService(tagService);
    }

    private AgentDO agent(long id) {
        AgentDO agent = new AgentDO();
        agent.setId(id);
        agent.setTenantId(TENANT);
        agent.setName("worker-" + id);
        agent.setStatus("ONLINE");
        agent.setKind("STANDARD");
        agent.setLatestVersionNo(1);
        agent.setVersion(1);
        return agent;
    }

    @Test
    void listFillsTagsOnceForTheWholePage() {
        when(agentDao.list(eq(TENANT), any(), any(), any(), eq(0), eq(20)))
                .thenReturn(List.of(agent(1L), agent(2L)));

        List<AgentVO> vos = service.list(TENANT, null, null, null, 1, 20);

        assertEquals(2, vos.size());
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<AgentVO>> captor = ArgumentCaptor.forClass(List.class);
        verify(tagService, times(1)).fillTags(captor.capture(), eq(TENANT));
        assertEquals(2, captor.getValue().size());
    }

    @Test
    void listSkipsTagFillWhenThePageIsEmpty() {
        when(agentDao.list(eq(TENANT), any(), any(), any(), eq(0), eq(20))).thenReturn(List.of());

        assertTrue(service.list(TENANT, null, null, null, 1, 20).isEmpty());
        verify(tagService, never()).fillTags(anyList(), anyLong());
    }

    @Test
    void listSkipsTagFillWhenTheAgentHasNoTenant() {
        AgentDO orphan = agent(1L);
        orphan.setTenantId(null);
        when(agentDao.list(any(), any(), any(), any(), eq(0), eq(20))).thenReturn(List.of(orphan));

        service.list(null, null, null, null, 1, 20);

        verify(tagService, never()).fillTags(anyList(), anyLong());
    }

    @Test
    void getFillsTagsForTheSingleAgent() {
        when(agentDao.findById(5L)).thenReturn(agent(5L));

        service.get(5L, TENANT);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<AgentVO>> captor = ArgumentCaptor.forClass(List.class);
        verify(tagService).fillTags(captor.capture(), eq(TENANT));
        assertEquals(1, captor.getValue().size());
        assertEquals(5L, captor.getValue().get(0).getId());
    }

    @Test
    void updateTagsReplacesAndReturnsFreshlyFilledVo() {
        AgentDO agent = agent(7L);
        UpdateAgentTagsRequest req = new UpdateAgentTagsRequest();
        req.setSystemTags(List.of("REQ_CLARIFY"));
        when(agentDao.findById(7L)).thenReturn(agent);

        AgentVO vo = service.updateTags(7L, req, TENANT, 9L);

        var mutation = org.mockito.Mockito.inOrder(agentDao, tagService);
        mutation.verify(agentDao).lockByIdForUpdate(TENANT, 7L);
        mutation.verify(tagService).replaceTags(agent, req, TENANT, 9L);
        verify(tagService).fillTags(anyList(), eq(TENANT));
        assertEquals(7L, vo.getId());
    }

    @Test
    void deletingAnAgentRemovesItsTagsAfterTakingTheSameLock() {
        AgentDO agent = agent(7L);
        agent.setStatus("DRAFT");
        when(agentDao.findById(7L)).thenReturn(agent);
        when(agentDao.softDelete(7L, TENANT, agent.getVersion(), 9L)).thenReturn(1);

        service.delete(7L, TENANT, 9L);

        var mutation = org.mockito.Mockito.inOrder(agentDao, tagService);
        mutation.verify(agentDao).lockByIdForUpdate(TENANT, 7L);
        mutation.verify(agentDao).softDelete(7L, TENANT, agent.getVersion(), 9L);
        mutation.verify(tagService).deleteForAgent(TENANT, 7L);
    }

    @Test
    void updateTagsWithoutTagServiceFailsLoudly() {
        AgentService unwired = new AgentService(agentDao, versionDao, mock(AgentRepoPermDao.class),
                mock(AgentSkillDao.class), mock(AgentMemoryRefDao.class), mock(WorkspaceDao.class),
                mock(ExecutorDao.class), mock(ExecutorRegistry.class), mock(SkillDao.class));
        when(agentDao.findById(7L)).thenReturn(agent(7L));

        assertThrows(IllegalStateException.class,
                () -> unwired.updateTags(7L, new UpdateAgentTagsRequest(), TENANT, 9L));
    }

    @Test
    void tagOptionsDelegateToTagService() {
        when(tagService.listTagOptions(TENANT)).thenReturn(List.of("报表"));

        assertEquals(List.of("报表"), service.listAgentTagOptions(TENANT));
        verify(tagService).listTagOptions(TENANT);
    }

    @Test
    void tagOptionsAreEmptyWithoutTagService() {
        AgentService unwired = new AgentService(agentDao, versionDao, mock(AgentRepoPermDao.class),
                mock(AgentSkillDao.class), mock(AgentMemoryRefDao.class), mock(WorkspaceDao.class),
                mock(ExecutorDao.class), mock(ExecutorRegistry.class), mock(SkillDao.class));

        assertTrue(unwired.listAgentTagOptions(TENANT).isEmpty());
    }

    @Test
    void untaggedVoDefaultsToEmptyTagArrays() {
        AgentVO vo = new AgentVO();

        assertTrue(vo.getSystemTags().isEmpty());
        assertTrue(vo.getCustomTags().isEmpty());
    }
}
