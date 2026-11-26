package com.aliyun.autowonder.office;

import com.aliyun.autowonder.workspace.WorkspaceMemberDO;
import com.aliyun.autowonder.workspace.WorkspaceMemberDao;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class OfficeRealtimeAuthorizationServiceTest {
    private WorkspaceMemberDao members;
    private OfficeRealtimeAuthorizationService service;

    @BeforeEach
    void setUp() {
        members = mock(WorkspaceMemberDao.class);
        service = new OfficeRealtimeAuthorizationService(members);
    }

    @Test
    void permitsOnlyThePrincipalCurrentReadableWorkspace() {
        WorkspaceMemberDO member = new WorkspaceMemberDO();
        member.setStatus(0);
        member.setAccessLevel("READ_ONLY");
        when(members.findByWorkspaceAndUser(2048L, 19L)).thenReturn(member);
        assertTrue(service.authorize(2048L, 19L, "office:2048"));
        assertFalse(service.authorize(2048L, 19L, "office:2049"));
    }

    @Test
    void rejectsMalformedChannelsAndInactiveMembers() {
        WorkspaceMemberDO member = new WorkspaceMemberDO();
        member.setStatus(1);
        member.setAccessLevel("ADMIN");
        when(members.findByWorkspaceAndUser(2048L, 19L)).thenReturn(member);
        assertFalse(service.authorize(2048L, 19L, "office:not-a-number"));
        assertFalse(service.authorize(2048L, 19L, "dispatch:2048"));
        assertFalse(service.authorize(2048L, 19L, "office:2048"));
    }
}
