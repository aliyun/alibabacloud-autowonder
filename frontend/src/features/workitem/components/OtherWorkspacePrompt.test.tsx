import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse, delay } from 'msw';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import { OtherWorkspacePrompt } from './OtherWorkspacePrompt';
import type { WorkitemOwningWorkspace } from '../otherWorkspace';

const OWNING: WorkitemOwningWorkspace = { workspaceId: 2, workspaceName: 'AutoWonder自迭代' };
const SWITCH_URL = '/api/workspaces/2/switch';

function ok<T>(data: T) {
  return HttpResponse.json({ success: true, code: '0', message: '', traceId: null, data });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function renderPrompt(owning: WorkitemOwningWorkspace = OWNING) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/workitems/9']}>
        <LocationProbe />
        <Routes>
          <Route path="/workitems/9" element={<OtherWorkspacePrompt owning={owning} />} />
          <Route path="/workitems" element={<div>工单列表页</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({
    accessToken: 'old-token',
    accessLevel: 'READ_WRITE',
    currentWorkspace: { id: 1, name: 'AI 研发效能', description: '' },
  });
});

afterEach(() => {
  useAuthStore.getState().clear();
});

describe('OtherWorkspacePrompt', () => {
  it('shows the current project → target project handoff', () => {
    renderPrompt();

    expect(screen.getByRole('heading', { name: '打开其他项目的工单' })).toBeInTheDocument();
    expect(screen.getByText('这张工单不在你当前的项目里，需要切换后打开。')).toBeInTheDocument();
    expect(screen.getByText('当前项目')).toBeInTheDocument();
    expect(screen.getByText('AI 研发效能')).toBeInTheDocument();
    expect(screen.getByText('目标项目')).toBeInTheDocument();
    expect(screen.getByText('AutoWonder自迭代')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换到「AutoWonder自迭代」并打开' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回工单列表' })).toBeInTheDocument();
  });

  it('switches in place without navigating away', async () => {
    server.use(http.post(SWITCH_URL, () => ok({ accessToken: 'new-token', accessLevel: 'READ_WRITE' })));
    renderPrompt();

    await userEvent.click(screen.getByRole('button', { name: '切换到「AutoWonder自迭代」并打开' }));

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('new-token'));
    expect(useAuthStore.getState().currentWorkspace).toMatchObject({ id: 2, name: 'AutoWonder自迭代' });
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/workitems/9');
    expect(screen.getByRole('heading', { name: '打开其他项目的工单' })).toBeInTheDocument();
  });

  it('keeps the failure inline and retries without leaving the card', async () => {
    let calls = 0;
    server.use(http.post(SWITCH_URL, () => {
      calls += 1;
      return calls === 1
        ? HttpResponse.json(
          { success: false, code: '50000', message: '目标项目暂时不可用', traceId: null, data: null },
          { status: 500 },
        )
        : ok({ accessToken: 'retried-token', accessLevel: 'READ_WRITE' });
    }));
    renderPrompt();

    await userEvent.click(screen.getByRole('button', { name: '切换到「AutoWonder自迭代」并打开' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('切换项目失败：目标项目暂时不可用');

    await userEvent.click(screen.getByRole('button', { name: '重试切换' }));

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('retried-token'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('returns to the work item list instead of an error page', async () => {
    renderPrompt();

    await userEvent.click(screen.getByRole('button', { name: '返回工单列表' }));

    expect(screen.getByText('工单列表页')).toBeInTheDocument();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/workitems');
  });

  it('locks both actions while the switch request is in flight', async () => {
    let calls = 0;
    server.use(http.post(SWITCH_URL, async () => {
      calls += 1;
      await delay('infinite');
      return ok({ accessToken: 'never', accessLevel: 'READ_WRITE' });
    }));
    renderPrompt();

    await userEvent.click(screen.getByRole('button', { name: '切换到「AutoWonder自迭代」并打开' }));

    const switching = await screen.findByRole('button', { name: /正在切换/ });
    // antd loading 按钮靠类名拦截重复点击，不是原生 disabled
    expect(switching).toHaveClass('ant-btn-loading');
    expect(screen.getByRole('button', { name: '返回工单列表' })).toBeDisabled();

    await userEvent.click(switching);
    expect(calls).toBe(1);
  });

  it('truncates a long project name but keeps it reachable via title', () => {
    const longName = '阿里巴巴集团-云智能-研发效能平台-2026';
    renderPrompt({ workspaceId: 3, workspaceName: longName });

    expect(screen.getByText(longName)).toHaveAttribute('title', longName);
  });

  it('falls back to a plain 当前项目 label when the session has no project name', () => {
    useAuthStore.setState({ currentWorkspace: null });
    renderPrompt();

    // 标签与占位值共用同一文案，因此会有两处
    expect(screen.getAllByText('当前项目')).toHaveLength(2);
  });
});
