import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@/features/agent/api';
import { listAllAgents } from '@/features/agent/api';
import {
  isAutoClarificationCandidate,
  loadAutoClarificationAgent,
} from './defaultClarificationAgent';

vi.mock('@/features/agent/api', () => ({ listAllAgents: vi.fn() }));

const listAllAgentsMock = vi.mocked(listAllAgents);

function agent(overrides: Partial<Agent> & { id: number }): Agent {
  const { id, ...rest } = overrides;
  return {
    id,
    name: `Agent-${id}`,
    avatarUrl: null,
    status: 'ONLINE',
    onlineVersionId: 1,
    editingVersionId: null,
    latestVersionNo: 1,
    version: 1,
    gmtCreate: '2026-01-01T00:00:00',
    ...rest,
  };
}

function candidate(overrides: Partial<Agent> & { id: number } = { id: 1 }): Agent {
  return agent({ systemTags: ['REQ_CLARIFY'], executorOnlineCount: 1, ...overrides });
}

describe('defaultClarificationAgent', () => {
  beforeEach(() => {
    listAllAgentsMock.mockReset();
  });

  it('returns the agent when exactly one candidate is online', async () => {
    const only = candidate({ id: 42, name: '需求澄清小助手' });
    listAllAgentsMock.mockResolvedValue([only]);
    await expect(loadAutoClarificationAgent()).resolves.toBe(only);
    expect(listAllAgentsMock).toHaveBeenCalledWith({ status: 'ONLINE' });
  });

  it('returns null when no agent carries the requirement-clarification tag', async () => {
    listAllAgentsMock.mockResolvedValue([
      agent({ id: 1, executorOnlineCount: 1 }),
      agent({ id: 2, systemTags: [], executorOnlineCount: 1 }),
    ]);
    await expect(loadAutoClarificationAgent()).resolves.toBeNull();
  });

  it('returns null when multiple tagged candidates are online', async () => {
    listAllAgentsMock.mockResolvedValue([
      candidate({ id: 1 }),
      candidate({ id: 2 }),
    ]);
    await expect(loadAutoClarificationAgent()).resolves.toBeNull();
  });

  it('picks the only tagged agent whose executor is online', async () => {
    const online = candidate({ id: 7, name: '在线澄清' });
    listAllAgentsMock.mockResolvedValue([
      candidate({ id: 6, executorOnlineCount: 0 }),
      online,
    ]);
    await expect(loadAutoClarificationAgent()).resolves.toBe(online);
  });

  it('ignores platform agents even when tagged and online', async () => {
    listAllAgentsMock.mockResolvedValue([
      candidate({ id: 9, kind: 'PLATFORM' }),
    ]);
    await expect(loadAutoClarificationAgent()).resolves.toBeNull();
  });

  it('ignores agents whose systemTags are absent', async () => {
    listAllAgentsMock.mockResolvedValue([
      agent({ id: 9, systemTags: null, executorOnlineCount: 1 }),
    ]);
    await expect(loadAutoClarificationAgent()).resolves.toBeNull();
  });

  it('requires ONLINE status and a live executor', () => {
    expect(isAutoClarificationCandidate(candidate({ id: 1 }))).toBe(true);
    expect(isAutoClarificationCandidate(agent({
      id: 2, status: 'DRAFT', systemTags: ['REQ_CLARIFY'], executorOnlineCount: 1,
    }))).toBe(false);
    expect(isAutoClarificationCandidate(agent({
      id: 3, status: 'OFFLINE', systemTags: ['REQ_CLARIFY'], executorOnlineCount: 1,
    }))).toBe(false);
    expect(isAutoClarificationCandidate(candidate({ id: 4, executorOnlineCount: 0 }))).toBe(false);
    expect(isAutoClarificationCandidate(agent({
      id: 5, executorOnlineCount: 1, systemTags: undefined,
    }))).toBe(false);
  });
});
