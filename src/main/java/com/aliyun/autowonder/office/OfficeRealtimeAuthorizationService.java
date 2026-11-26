package com.aliyun.autowonder.office;

import com.aliyun.autowonder.access.WorkspaceAccessLevel;
import com.aliyun.autowonder.websocket.RealtimeChannelAuthorizationService;
import com.aliyun.autowonder.workspace.WorkspaceMemberDO;
import com.aliyun.autowonder.workspace.WorkspaceMemberDao;
import org.springframework.stereotype.Service;

@Service
public class OfficeRealtimeAuthorizationService implements RealtimeChannelAuthorizationService {
    private final WorkspaceMemberDao members;

    public OfficeRealtimeAuthorizationService(WorkspaceMemberDao members) {
        this.members = members;
    }

    @Override
    public boolean supports(String channel) {
        return channel != null && channel.startsWith(OfficeRealtimePublisher.CHANNEL_PREFIX);
    }

    @Override
    public boolean authorize(long workspaceId, long userId, String channel) {
        if (!supports(channel) || workspaceId <= 0 || userId <= 0) return false;
        final long channelWorkspaceId;
        try {
            channelWorkspaceId = Long.parseLong(channel.substring(OfficeRealtimePublisher.CHANNEL_PREFIX.length()));
        } catch (RuntimeException ignored) {
            return false;
        }
        if (channelWorkspaceId != workspaceId) return false;
        WorkspaceMemberDO member = members.findByWorkspaceAndUser(workspaceId, userId);
        if (member == null || !Integer.valueOf(0).equals(member.getStatus())) return false;
        try {
            return WorkspaceAccessLevel.valueOf(member.getAccessLevel()).allows(WorkspaceAccessLevel.READ_ONLY);
        } catch (RuntimeException ignored) {
            return false;
        }
    }
}
