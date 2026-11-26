package com.aliyun.autowonder.agent;

import com.aliyun.autowonder.access.RequireWorkspaceAccess;
import com.aliyun.autowonder.access.WorkspaceAccessLevel;
import com.aliyun.autowonder.agent.dto.AgentVO;
import com.aliyun.autowonder.agent.dto.UpdateAgentTagsRequest;
import com.aliyun.autowonder.context.AutoWonderContext;
import com.aliyun.autowonder.squad.SquadService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AgentControllerTagTest {

    @AfterEach
    void tearDown() {
        AutoWonderContext.destroy();
    }

    @Test
    void updateTagsPassesCurrentWorkspaceAndUser() {
        AgentService agentService = mock(AgentService.class);
        AgentController controller = new AgentController(agentService, mock(SquadService.class));
        AutoWonderContext.get().setCurrentWorkspaceId(100L);
        AutoWonderContext.get().setUserId(7L);
        UpdateAgentTagsRequest req = new UpdateAgentTagsRequest();
        AgentVO vo = new AgentVO();
        when(agentService.updateTags(10L, req, 100L, 7L)).thenReturn(vo);

        assertEquals(vo, controller.updateTags(10L, req).getData());
        verify(agentService).updateTags(10L, req, 100L, 7L);
    }

    @Test
    void updateTagsRequiresReadWriteAccessWithExplicitActionKey() throws Exception {
        RequireWorkspaceAccess access = AgentController.class
                .getMethod("updateTags", Long.class, UpdateAgentTagsRequest.class)
                .getAnnotation(RequireWorkspaceAccess.class);

        assertNotNull(access);
        assertEquals(WorkspaceAccessLevel.READ_WRITE, access.value());
        assertEquals("更新数字人标签", access.action());
        assertEquals("access.action.update_agent_tags", access.actionKey());
    }

    @Test
    void tagOptionsInheritsClassLevelReadOnlyAccess() throws Exception {
        AgentService agentService = mock(AgentService.class);
        AgentController controller = new AgentController(agentService, mock(SquadService.class));
        AutoWonderContext.get().setCurrentWorkspaceId(100L);
        when(agentService.listAgentTagOptions(100L)).thenReturn(List.of("报表"));

        assertEquals(List.of("报表"), controller.tagOptions().getData());
        assertNull(AgentController.class.getMethod("tagOptions").getAnnotation(RequireWorkspaceAccess.class));
        RequireWorkspaceAccess classLevel = AgentController.class.getAnnotation(RequireWorkspaceAccess.class);
        assertNotNull(classLevel);
        assertEquals(WorkspaceAccessLevel.READ_ONLY, classLevel.value());
    }
}
