import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { apiClient } from '@/shared/api/client';
import { listRepos } from '@/features/repo/api';
import { getSquadMembers } from '@/features/squad/api';
import { WorkitemLaunchModal } from './WorkitemLaunchModal';

vi.mock('@/shared/api/client', () => ({ apiClient: { post: vi.fn() } }));
vi.mock('@/features/repo/api', () => ({
  listRepos: vi.fn().mockResolvedValue([
    { id: 12, name: 'Archive', url: 'git@example.test:team/archive.git' },
    { id: 42, name: 'Design Repo', url: 'git@example.test:team/design.git', designBaseBranch: 'design-base' },
    { id: 43, name: 'Other Repo', url: 'git@example.test:team/other.git', designBaseBranch: 'main' },
  ]),
}));
vi.mock('@/features/squad/api', () => ({
  listSquads: vi.fn(),
  listAllSquads: vi.fn().mockResolvedValue([
    { id: 1, name: 'Support', memberCount: 1 },
    { id: 2, name: 'Design Squad', memberCount: 2 },
  ]),
  getSquadMembers: vi.fn(async (id: number) => id === 1
    ? [{ agentId: 11, agentName: 'Support Employee', executorOnline: true }]
    : [{ agentId: 22, agentName: 'Non-design Employee', executorOnline: true },
        { agentId: 23, agentName: 'Design Employee', executorOnline: true, sdlcName: 'PRD设计' }]),
}));

describe('WorkitemLaunchModal', () => {
  it('starts a design from the template without choosing a repository', async () => {
    vi.mocked(apiClient.post).mockClear().mockResolvedValue({ data: { phase: 'QUEUED' } } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onEnter = vi.fn();
    const view = render(<QueryClientProvider client={client}><WorkitemLaunchModal item="59815" activity="design"
      initialRepo={null} onEnter={onEnter} onClose={vi.fn()} /></QueryClientProvider>);
    try {
      fireEvent.mouseDown(screen.getByRole('combobox', { name: '设计来源' }));
      fireEvent.click(await screen.findByText('新项目'));
      const start = screen.getByRole('button', { name: '开始设计' });
      await waitFor(() => expect(start).toBeEnabled());
      fireEvent.click(start);
      await waitFor(() => expect(onEnter).toHaveBeenCalledWith({ phase: 'QUEUED' }));
      expect(vi.mocked(apiClient.post).mock.lastCall?.[1]).toMatchObject({ source: 'NEW', repoId: undefined });
    } finally { view.unmount(); client.clear(); }
  });

  it('chooses the first matching repository and employee and displays the Git address and tag', async () => {
    vi.mocked(apiClient.post).mockClear().mockResolvedValue({ data: { phase: 'QUEUED' } } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><WorkitemLaunchModal item="59815" activity="design"
      initialRepo={43} onEnter={vi.fn()} onClose={vi.fn()} /></QueryClientProvider>);
    try {
      await waitFor(() => expect(screen.getByRole('button', { name: '开始设计' })).toBeEnabled());
      expect(screen.getByText('git@example.test:team/design.git')).toBeInTheDocument();
      expect(screen.getByTitle('Design Repo · git@example.test:team/design.git')).toBeInTheDocument();
      expect(screen.queryByText('前端目录')).not.toBeInTheDocument();
      expect(screen.getByText('PRD设计')).toHaveClass('ant-tag');
      expect(screen.getByText('Design Squad')).toBeInTheDocument();
      expect(screen.getByText('Design Employee · 执行器在线')).toBeInTheDocument();
      expect(apiClient.post).toHaveBeenCalledWith('/api/workitems/59815/prd/launch/check',
        expect.objectContaining({ source: 'REPO', repoId: 42, squadId: 2, agentId: 23 }), expect.anything());
      fireEvent.mouseDown(screen.getByRole('combobox', { name: '空间仓库' }));
      fireEvent.click(await screen.findByText('git@example.test:team/other.git'));
      await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/workitems/59815/prd/launch/check',
        expect.objectContaining({ source: 'REPO', repoId: 43, squadId: 2, agentId: 23 }), expect.anything()));
    } finally { view.unmount(); client.clear(); }
  });

  it('leaves the team and employee unset when nobody has the PRD Design workflow', async () => {
    vi.mocked(getSquadMembers).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    vi.mocked(apiClient.post).mockClear();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><WorkitemLaunchModal item="59815" activity="design"
      initialRepo={null} onEnter={vi.fn()} onClose={vi.fn()} /></QueryClientProvider>);
    try {
      expect(await screen.findByText(/未找到带「PRD 设计」标签的员工/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '开始设计' })).toBeDisabled();
      expect(apiClient.post).not.toHaveBeenCalled();
    } finally { view.unmount(); client.clear(); }
  });

  it('leaves the repository blank when none has a design base branch', async () => {
    vi.mocked(listRepos).mockResolvedValueOnce([]);
    vi.mocked(apiClient.post).mockClear();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><WorkitemLaunchModal item="59815" activity="design"
      initialRepo={null} onEnter={vi.fn()} onClose={vi.fn()} /></QueryClientProvider>);
    try {
      expect(await screen.findByText(/未找到已配置设计基线分支的仓库/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '开始设计' })).toBeDisabled();
      expect(apiClient.post).not.toHaveBeenCalled();
    } finally { view.unmount(); client.clear(); }
  });

  it('rechecks a rejected executor and enables start when its preview capability comes online', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('executor unavailable')).mockResolvedValue({ data: true } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><WorkitemLaunchModal item="59815" activity="design"
      initialRepo={42} onEnter={vi.fn()} onClose={vi.fn()} /></QueryClientProvider>);
    try {
      expect(await screen.findByText(/design-base/)).toBeInTheDocument();
      expect(await screen.findByText('executor unavailable')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '开始设计' })).toBeDisabled();
      await waitFor(() => expect(screen.queryByText('executor unavailable')).not.toBeInTheDocument(), { timeout: 5000 });
      expect(screen.getByRole('button', { name: '开始设计' })).toBeEnabled();
    } finally { view.unmount(); client.clear(); }
  });
});
