package com.aliyun.autowonder.prd;

import com.aliyun.autowonder.agent.AgentDao;
import com.aliyun.autowonder.agent.AgentDO;
import com.aliyun.autowonder.agent.AgentRepoPermDao;
import com.aliyun.autowonder.common.error.BizException;
import com.aliyun.autowonder.common.error.ErrorCode;
import com.aliyun.autowonder.conversation.AgentConversationDO;
import com.aliyun.autowonder.conversation.AgentConversationDao;
import com.aliyun.autowonder.conversation.AgentConversationTurnDao;
import com.aliyun.autowonder.conversation.ConversationExecutorRouter;
import com.aliyun.autowonder.conversation.WorkitemClarificationConversationService;
import com.aliyun.autowonder.repo.RepoDao;
import com.aliyun.autowonder.squad.SquadMemberDO;
import com.aliyun.autowonder.squad.SquadMemberDao;
import com.aliyun.autowonder.websocket.PresenceManager;
import com.aliyun.autowonder.workitem.WorkitemDao;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class WorkitemLaunchServiceTest {
    private final WorkitemLaunchDao launches = mock(WorkitemLaunchDao.class);
    private final WorkitemLaunchAccess access = mock(WorkitemLaunchAccess.class);
    private final PrdDesignRuntimeDao runtimes = mock(PrdDesignRuntimeDao.class);
    private final AgentConversationDao conversations = mock(AgentConversationDao.class);
    private final WorkitemLaunchService service = new WorkitemLaunchService(
            launches, access, mock(PrdDesignDao.class), mock(PrdDesignService.class), runtimes, conversations,
            mock(AgentConversationTurnDao.class), mock(AgentDao.class), mock(SquadMemberDao.class),
            mock(WorkitemClarificationConversationService.class));

    @Test
    void launchExplainsThatAnEmployeeNeedsAPublishedVersion() {
        var member = new SquadMemberDO();
        member.setTenantId(1L);
        var members = mock(SquadMemberDao.class);
        when(members.findBySquadAndAgent(4L, 5L)).thenReturn(member);
        var agent = new AgentDO();
        agent.setTenantId(1L);
        var agents = mock(AgentDao.class);
        when(agents.findById(5L)).thenReturn(agent);
        var launchAccess = new WorkitemLaunchAccess(mock(WorkitemDao.class), members, agents,
                mock(RepoDao.class), mock(AgentRepoPermDao.class), mock(ConversationExecutorRouter.class),
                mock(PresenceManager.class), launches, mock(PrdReviewPreviewProperties.class));

        var failure = assertThrows(BizException.class,
                () -> launchAccess.check(1L, true, new WorkitemLaunchAccess.Choice(4L, 5L, "NEW", null, null), null));

        assertEquals(ErrorCode.AGENT_NOT_ONLINE.getCode(), failure.getCode());
        assertEquals("workitem.launch.agent_unpublished", failure.getMessageKey());
    }

    @Test
    void retriesFailedCheckoutOnAnotherExecutorAndKeepsTheConversation() {
        var launch = prepareRetry("FAILED_PREPARING", 0L);
        when(access.check(eq(1L), eq(true), any(), any(), eq(true))).thenReturn(10L);
        when(launches.retry(launch)).thenReturn(1);

        service.retry(1L, 2L);

        verify(conversations).updateExecutor(1L, 3L, 10L);
        verify(runtimes).resetPreparation(1L, 3L, 10L);
    }

    @Test
    void refusesToMoveANativeDraftWhenPreviewStartupFailed() {
        prepareRetry("FAILED_STARTING", 17L);
        when(access.check(eq(1L), eq(true), any(), any(), eq(false))).thenReturn(10L);

        assertThrows(BizException.class, () -> service.retry(1L, 2L));

        verify(launches, never()).retry(any());
        verify(conversations, never()).updateExecutor(anyLong(), anyLong(), anyLong());
        verify(runtimes, never()).resetPreparation(anyLong(), anyLong(), anyLong());
    }

    private WorkitemLaunchDao.Launch prepareRetry(String phase, long turnId) {
        var launch = new WorkitemLaunchDao.Launch(1, 2, 3, "DESIGN", 4, 5, 6L, 7, phase, 1);
        var conversation = new AgentConversationDO();
        conversation.setId(3L);
        conversation.setExecutorId(9L);
        var runtime = new PrdDesignRuntimeDO();
        runtime.setTurnId(turnId);
        when(launches.latest(1L, 2L, "DESIGN")).thenReturn(launch);
        when(conversations.findById(1L, 3L)).thenReturn(conversation);
        when(runtimes.find(1L, 3L)).thenReturn(runtime);
        return launch;
    }
}
