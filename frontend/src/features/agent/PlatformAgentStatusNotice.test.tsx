import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import { PlatformAgentStatusNotice } from './PlatformAgentStatusNotice';

let requestCount = 0;

function mockStatus(data: Record<string, unknown>) {
  server.use(
    http.get('/api/platform-agent/status', () => {
      requestCount += 1;
      return HttpResponse.json({
        success: true, code: '0', message: '', data, traceId: null,
      });
    }),
  );
}

function renderNotice() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlatformAgentStatusNotice />
      <div>页面内容</div>
    </QueryClientProvider>,
  );
}

function enterWorkspaceAs(accessLevel: 'ADMIN' | 'READ_WRITE' | 'READ_ONLY') {
  useAuthStore.getState().setCurrentWorkspace(
    { id: 7, name: '星云工坊', description: '' },
    accessLevel,
  );
}

describe('PlatformAgentStatusNotice', () => {
  beforeEach(() => {
    requestCount = 0;
    useAuthStore.getState().clear();
  });

  it('does not query or render for non-admin members', async () => {
    mockStatus({ state: 'NOT_CONFIGURED', agentId: 11, executorCount: 0, onlineExecutorCount: 0 });
    enterWorkspaceAs('READ_WRITE');

    renderNotice();
    await screen.findByText('页面内容');

    expect(requestCount).toBe(0);
    expect(document.querySelector('.ant-alert')).toBeNull();
  });

  it('stays hidden when the platform agent has an online executor', async () => {
    mockStatus({ state: 'OK', agentId: 11, executorCount: 1, onlineExecutorCount: 1 });
    enterWorkspaceAs('ADMIN');

    renderNotice();
    await waitFor(() => expect(requestCount).toBe(1));

    expect(document.querySelector('.ant-alert')).toBeNull();
  });

  it('shows the missing-executor reason on the executor page', async () => {
    mockStatus({ state: 'NOT_CONFIGURED', agentId: 11, executorCount: 0, onlineExecutorCount: 0 });
    enterWorkspaceAs('ADMIN');

    renderNotice();

    expect(await screen.findByText('建议配置平台智能体 Chief of Staff')).toBeInTheDocument();
    // 走公共 NoticeTip：标题 + 一行用途说明，保持 message tip 的通用样式。
    expect(document.querySelector('.aw-notice-tip')).not.toBeNull();
    expect(screen.getByText('配置并启动执行器后，可自动接单、拆解需求，并调度数字员工协作交付。')).toBeInTheDocument();
  });

  it('shows the offline reason on the executor page', async () => {
    mockStatus({ state: 'OFFLINE', agentId: 11, executorCount: 2, onlineExecutorCount: 0 });
    enterWorkspaceAs('ADMIN');

    renderNotice();

    expect(await screen.findByText('平台智能体 Chief of Staff 执行器全部离线')).toBeInTheDocument();
    expect(screen.getByText('重新启动执行器后，自动接单与协作交付会自动恢复。')).toBeInTheDocument();
  });
});
