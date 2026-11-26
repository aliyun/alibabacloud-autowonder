import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/shared/auth/store';
import { getPlatformAgentStatus, platformAgentStatusQueryKey } from './platformAgentStatusApi';

// 常驻状态按此间隔复查，执行器上线后无需手动刷新即可消失。
export const PLATFORM_AGENT_STATUS_POLL_MS = 30_000;

export type PlatformAgentIssue = 'NOT_CONFIGURED' | 'OFFLINE';

/** Only admins inside a workspace can read the platform agent's executor status. */
export function usePlatformAgentStatus() {
  const isAdmin = useAuthStore((s) => s.hasAccess('ADMIN'));
  const workspaceId = useAuthStore((s) => s.currentWorkspace?.id ?? null);
  return useQuery({
    queryKey: platformAgentStatusQueryKey(workspaceId),
    queryFn: getPlatformAgentStatus,
    enabled: isAdmin && workspaceId != null,
    refetchInterval: PLATFORM_AGENT_STATUS_POLL_MS,
  });
}

/** Returns the concrete problem behind a non-OK state, or null when ready/unknown. */
export function platformAgentIssue(state?: string | null): PlatformAgentIssue | null {
  return state === 'NOT_CONFIGURED' || state === 'OFFLINE' ? state : null;
}
