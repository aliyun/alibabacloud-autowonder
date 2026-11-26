import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { setupStatus } from '@/features/chiefOfStaff/api';
import { useAuthStore } from '@/shared/auth/store';
import { ChiefEntryButton } from './ChiefEntryButton';
import {
  resetWorkspaceGuideBridge,
  subscribeChiefOpenPanel,
  type ChiefOpenRequest,
} from '@/features/workspaceGuide/bridge';

let opens: ChiefOpenRequest[] = [];

vi.mock('@/features/chiefOfStaff/api', () => ({ setupStatus: vi.fn() }));

function renderEntry(props: { standalone?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChiefEntryButton {...props} />
    </QueryClientProvider>,
  );
}

let statusCalls = 0;

function mockStatus(state: string) {
  statusCalls = 0;
  server.use(
    http.get('/api/platform-agent/status', () => {
      statusCalls += 1;
      return HttpResponse.json({
        success: true, code: '0', message: '',
        data: { state, agentId: 11, executorCount: state === 'NOT_CONFIGURED' ? 0 : 2, onlineExecutorCount: state === 'OK' ? 2 : 0 },
        traceId: null,
      });
    }),
  );
}

function enterWorkspaceAs(accessLevel: 'ADMIN' | 'READ_WRITE') {
  useAuthStore.getState().setCurrentWorkspace(
    { id: 7, name: '星云工坊', description: '' },
    accessLevel,
  );
}

beforeEach(() => {
  resetWorkspaceGuideBridge();
  opens = [];
  vi.mocked(setupStatus).mockReset();
  subscribeChiefOpenPanel(request => opens.push(request));
});

afterEach(() => {
  resetWorkspaceGuideBridge();
  useAuthStore.getState().clear();
});

describe('ChiefEntryButton', () => {
  it.each([true, false])('opens standalone Chief only when the current workspace is ready (%s)', async (ready) => {
    useAuthStore.getState().setUser({ id: 7, username: 'user', nickname: '', email: '' });
    useAuthStore.getState().setCurrentWorkspace({ id: 4, name: 'Space', description: '' }, 'READ_WRITE');
    vi.mocked(setupStatus).mockResolvedValue({
      ready, agentId: 2, executorId: 3, agentConfigured: true, skillsConfigured: true,
      executorConfigured: true, launchConfigured: ready, missingSkills: [],
    });
    renderEntry({ standalone: true });

    fireEvent.click(screen.getByRole('button', { name: '打开 Chief' }));

    await waitFor(() => expect(setupStatus).toHaveBeenCalledOnce());
    if (ready) await waitFor(() => expect(opens).toHaveLength(1));
    else {
      expect(await screen.findByText('请进入工作空间，完成 Chief 配置并启动执行器。')).toBeVisible();
      expect(opens).toHaveLength(0);
    }
  });

  it('prompts users to enter a workspace before checking standalone Chief', async () => {
    renderEntry({ standalone: true });
    fireEvent.click(screen.getByRole('button', { name: '打开 Chief' }));
    expect(await screen.findByText('请先进入一个工作空间，再使用 Chief。')).toBeVisible();
    expect(setupStatus).not.toHaveBeenCalled();
    expect(opens).toHaveLength(0);
  });

  it('opens Chief in docked mode and leaves guide targeting to the overlay', () => {
    renderEntry();

    const button = screen.getByRole('button', { name: '打开 Chief' });
    fireEvent.click(button);

    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ expanded: false });
  });

  it('marks the entry with the concrete reason when the platform agent is not ready', async () => {
    mockStatus('OFFLINE');
    enterWorkspaceAs('ADMIN');
    const { container } = renderEntry();

    await waitFor(() => expect(statusCalls).toBe(1));
    expect(container.querySelector('.aw-chief-entry-dot')).not.toBeNull();

    await userEvent.hover(screen.getByRole('button', { name: '打开 Chief' }));
    expect(await screen.findByText('Chief of Staff · 执行器全部离线')).toBeInTheDocument();
  });

  it('leaves the entry unmarked when the platform agent is ready', async () => {
    mockStatus('OK');
    enterWorkspaceAs('ADMIN');
    const { container } = renderEntry();

    await waitFor(() => expect(statusCalls).toBe(1));
    expect(container.querySelector('.aw-chief-entry-dot')).toBeNull();
  });
});
