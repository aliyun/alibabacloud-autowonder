import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import dayjs from 'dayjs';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import { SpaceDashboardPage } from './SpaceDashboardPage';
import type { SpaceDashboardOverview } from './types';

const envelope = (data: unknown) => ({ success: true, code: '0', message: '', traceId: null, data });

function payload(overrides: Partial<SpaceDashboardOverview> = {}): SpaceDashboardOverview {
  return {
    platformAdmin: false,
    workspaceCount: 5,
    workspaces: [
      { id: 1, name: '交付一队' },
      { id: 2, name: '自动化平台' },
      { id: 3, name: '运维小组' },
    ],
    agents: { workspaceCount: 5, agentCount: 37, humanCount: 14, squadCount: 9 },
    delivery: {
      window: { start: '2026-09-27', end: '2026-10-26', workTypes: ['REQ', 'BUG', 'TASK'] },
      workitemCount: 320,
      completedCount: 180,
      inProgressCount: 95,
      topCompleted: [{ workspaceId: 2, workspaceName: '自动化平台', value: 62 }],
      topCompletedTotal: 1,
      bottomCompleted: [{ workspaceId: 3, workspaceName: '运维小组', value: 0 }],
      bottomCompletedTotal: 1,
    },
    cost: {
      window: { start: '2026-09-27', end: '2026-10-26' },
      totalCredits: 48213.55,
      dailyAverage: 1607.12,
      completedWorkitemCount: 180,
      perCompletedWorkitem: 267.85,
      topCredits: [{ workspaceId: 2, workspaceName: '自动化平台', value: 18234.11 }],
      topCreditsTotal: 1,
      bottomCredits: [{ workspaceId: 3, workspaceName: '运维小组', value: 0 }],
      bottomCreditsTotal: 1,
    },
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}{location.search}</span>;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/workspaces/dashboard']}>
        <Routes>
          <Route path="/workspaces/dashboard" element={<SpaceDashboardPage />} />
          <Route path="/workspaces" element={<div data-testid="workspace-list" />} />
          <Route path="/insights" element={<div data-testid="insights-page" />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SpaceDashboardPage', () => {
  const requests: string[] = [];

  function mockOverview(data: SpaceDashboardOverview) {
    server.use(http.get('/api/space-dashboard/overview', ({ request }) => {
      requests.push(new URL(request.url).search);
      return HttpResponse.json(envelope(data));
    }));
  }

  function lastParams(): URLSearchParams {
    return new URLSearchParams(requests.at(-1));
  }

  beforeEach(() => {
    requests.length = 0;
    localStorage.clear();
    useAuthStore.getState().clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the three sections with the default 30-day windows ending yesterday', async () => {
    mockOverview(payload());

    renderPage();

    expect(await screen.findByTestId('space-dashboard-page')).toBeInTheDocument();
    expect(screen.getByTestId('space-dashboard-scope')).toHaveTextContent('统计范围：你管理的 5 个空间');
    expect(screen.getByTestId('stat-agent-count')).toHaveTextContent('37');
    expect(screen.getByTestId('stat-human-count')).toHaveTextContent('14');
    expect(screen.getByTestId('stat-squad-count')).toHaveTextContent('9');
    expect(screen.getByTestId('stat-workitem-count')).toHaveTextContent('320');
    expect(screen.getByTestId('stat-completed-count')).toHaveTextContent('180');
    expect(screen.getByTestId('stat-in-progress-count')).toHaveTextContent('95');
    expect(screen.getByTestId('stat-total-credits')).toHaveTextContent('48,213.55');
    expect(screen.getByTestId('stat-daily-average')).toHaveTextContent('1,607.12');
    expect(screen.getByTestId('stat-per-workitem')).toHaveTextContent('267.85');
    expect(screen.getByTestId('rank-top-completed-item-2')).toHaveTextContent('自动化平台');
    expect(screen.getByTestId('rank-bottom-completed-item-3')).toHaveTextContent('运维小组');

    const params = lastParams();
    expect(params.get('deliveryStart')).toBe(dayjs().subtract(30, 'day').format('YYYY-MM-DD'));
    expect(params.get('deliveryEnd')).toBe(dayjs().subtract(1, 'day').format('YYYY-MM-DD'));
    expect(params.get('costStart')).toBe(dayjs().subtract(30, 'day').format('YYYY-MM-DD'));
    expect(params.get('costEnd')).toBe(dayjs().subtract(1, 'day').format('YYYY-MM-DD'));
    expect(params.get('workTypes')).toBe('REQ,BUG,TASK');
  });

  it('uses four snapshot cards and separate three-metric / two-extrema rows', async () => {
    mockOverview(payload());
    renderPage();
    const page = await screen.findByTestId('space-dashboard-page');
    const sections = page.querySelectorAll('.space-dashboard-section');
    expect(sections).toHaveLength(3);
    expect(sections[0].querySelector('.space-dashboard-grid-four')?.children).toHaveLength(4);
    for (const body of page.querySelectorAll('.space-dashboard-stat .ant-card-body')) {
      expect(body).toHaveStyle({ padding: '14px 16px' });
    }
    for (const section of [sections[1], sections[2]]) {
      const metrics = section.querySelector('.space-dashboard-grid');
      const ranks = section.querySelector('.space-dashboard-ranks');
      expect(metrics?.children).toHaveLength(3);
      expect(metrics?.querySelector('.space-dashboard-rank')).toBeNull();
      expect(ranks?.children).toHaveLength(2);
      expect(metrics?.nextElementSibling).toBe(ranks);
    }
    expect(requests).toHaveLength(1);
  });

  it('places filters in the title head without a blue rule or redundant visible labels', async () => {
    mockOverview(payload());
    renderPage();
    const page = await screen.findByTestId('space-dashboard-page');
    for (const title of ['工单交付', '成本分析']) {
      const section = within(page).getByRole('heading', { name: title }).closest('section')!;
      const head = section.querySelector('.space-dashboard-section-head')!;
      expect(head.querySelector('.space-dashboard-toolbar')).not.toBeNull();
      expect(within(head as HTMLElement).getByRole('combobox')).toBeInTheDocument();
    }
    expect(page.querySelector('.space-dashboard-section-rule')).toBeNull();
    for (const label of ['交付日期', '工单类型', '成本日期']) {
      expect(within(page).queryByText(label, { exact: true })).toBeNull();
    }
    expect(screen.getByRole('group', { name: '工单类型' })).toBeInTheDocument();
  });

  it('keeps external delivery and cost presets independent and persists only their existing keys', async () => {
    mockOverview(payload());
    renderPage();
    await screen.findByTestId('space-dashboard-page');
    const delivery = screen.getByRole('combobox', { name: '工单交付统计日期范围' });
    const cost = screen.getByRole('combobox', { name: '成本分析统计日期范围' });
    await userEvent.click(delivery);
    await userEvent.click(await screen.findByText('近7天'));
    await waitFor(() => expect(lastParams().get('deliveryStart')).toBe(dayjs().subtract(7, 'day').format('YYYY-MM-DD')));
    expect(lastParams().get('costStart')).toBe(dayjs().subtract(30, 'day').format('YYYY-MM-DD'));
    await userEvent.click(cost);
    // rc-select deliberately shares TEST_OR_SSR ids in jsdom; target the open popup, not the hidden delivery popup.
    const costPopup = document.querySelector<HTMLElement>('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')!;
    await userEvent.click(within(costPopup).getByText('近90天'));
    await waitFor(() => expect(lastParams().get('costStart')).toBe(dayjs().subtract(90, 'day').format('YYYY-MM-DD')));
    expect(lastParams().get('deliveryStart')).toBe(dayjs().subtract(7, 'day').format('YYYY-MM-DD'));
    expect(lastParams().get('deliveryEnd')).toBe(dayjs().subtract(1, 'day').format('YYYY-MM-DD'));
    expect(lastParams().get('costEnd')).toBe(dayjs().subtract(1, 'day').format('YYYY-MM-DD'));
    expect(lastParams().get('workTypes')).toBe('REQ,BUG,TASK');
    expect(JSON.parse(localStorage.getItem('aw:insights:v1:anonymous:none:spaceDashboard.delivery.dates')!))
      .toEqual([lastParams().get('deliveryStart'), lastParams().get('deliveryEnd')]);
    expect(JSON.parse(localStorage.getItem('aw:insights:v1:anonymous:none:spaceDashboard.cost.dates')!))
      .toEqual([lastParams().get('costStart'), lastParams().get('costEnd')]);
  });

  it('restores a valid 181-day custom window including the earliest selectable day', async () => {
    const end = dayjs().subtract(1, 'day');
    const start = end.subtract(180, 'day').format('YYYY-MM-DD');
    localStorage.setItem('aw:insights:v1:anonymous:none:spaceDashboard.delivery.dates',
      JSON.stringify([start, end.format('YYYY-MM-DD')]));
    mockOverview(payload());
    renderPage();
    await screen.findByTestId('space-dashboard-page');
    expect(lastParams().get('deliveryStart')).toBe(start);
    expect(lastParams().get('costStart')).toBe(dayjs().subtract(30, 'day').format('YYYY-MM-DD'));
    const delivery = screen.getByRole('combobox', { name: '工单交付统计日期范围' }).closest('.ant-select')!;
    expect(delivery).toHaveTextContent('自定义');
    expect(screen.getByTestId('stat-workitem-count')).toHaveTextContent('181 天窗口内创建');
  });

  it('rejects invalid persisted ranges before the first aggregated query', async () => {
    const end = dayjs().subtract(1, 'day');
    localStorage.setItem('aw:insights:v1:anonymous:none:spaceDashboard.delivery.dates',
      JSON.stringify([end.subtract(181, 'day').format('YYYY-MM-DD'), end.format('YYYY-MM-DD')]));
    localStorage.setItem('aw:insights:v1:anonymous:none:spaceDashboard.cost.dates',
      JSON.stringify([end.format('YYYY-MM-DD'), dayjs().add(1, 'day').format('YYYY-MM-DD')]));
    mockOverview(payload());
    renderPage();
    await screen.findByTestId('space-dashboard-page');
    expect(requests).toHaveLength(1);
    for (const section of ['delivery', 'cost']) {
      expect(lastParams().get(`${section}Start`)).toBe(dayjs().subtract(30, 'day').format('YYYY-MM-DD'));
      expect(lastParams().get(`${section}End`)).toBe(end.format('YYYY-MM-DD'));
    }
  });

  it('keeps successful statistics and scope visible while fetching a changed window', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.get('/api/space-dashboard/overview', async ({ request }) => {
      requests.push(new URL(request.url).search);
      if (requests.length > 1) await pending;
      const base = payload();
      return HttpResponse.json(envelope(requests.length === 1 ? base : {
        ...base, delivery: { ...base.delivery, completedCount: 7 },
      }));
    }));
    renderPage();
    await screen.findByTestId('space-dashboard-page');
    try {
      await userEvent.click(screen.getByRole('combobox', { name: '工单交付统计日期范围' }));
      await userEvent.click(await screen.findByText('近7天'));
      await waitFor(() => expect(requests).toHaveLength(2));
      expect(screen.getByTestId('space-dashboard-page')).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByTestId('stat-completed-count')).toHaveTextContent('180');
      expect(screen.getByTestId('stat-agent-count')).toHaveTextContent('37');
      expect(screen.getByTestId('stat-total-credits')).toHaveTextContent('48,213.55');
      expect(screen.getByTestId('space-dashboard-scope')).toHaveTextContent('你管理的 5 个空间');
      expect(screen.queryByTestId('space-dashboard-loading')).toBeNull();
    } finally {
      release();
    }
    await waitFor(() => expect(screen.getByTestId('space-dashboard-page')).toHaveAttribute('aria-busy', 'false'));
    expect(screen.getByTestId('stat-completed-count').querySelector('.space-dashboard-stat-value')).toHaveTextContent('7');
  });

  it('renders real zero values without replacing the unavailable denominator with zero', async () => {
    const base = payload();
    mockOverview({
      ...base,
      agents: { workspaceCount: 5, agentCount: 0, humanCount: 0, squadCount: 0 },
      delivery: { ...base.delivery, workitemCount: 0, completedCount: 0, inProgressCount: 0 },
      cost: { ...base.cost, totalCredits: 0, dailyAverage: 0, completedWorkitemCount: 0, perCompletedWorkitem: null },
    });
    renderPage();
    await screen.findByTestId('space-dashboard-page');
    for (const id of ['agent-count', 'human-count', 'squad-count', 'workitem-count', 'completed-count', 'in-progress-count']) {
      expect(screen.getByTestId(`stat-${id}`).querySelector('.space-dashboard-stat-value')).toHaveTextContent(/^0$/);
    }
    for (const id of ['total-credits', 'daily-average']) {
      expect(screen.getByTestId(`stat-${id}`).querySelector('.space-dashboard-stat-value')).toHaveTextContent(/^0\.00$/);
    }
    expect(screen.getByTestId('stat-per-workitem').querySelector('.space-dashboard-stat-value')).toHaveTextContent(/^--$/);
    expect(screen.getByTestId('rank-bottom-completed-item-3')).toHaveTextContent('0');
  });

  it('provides the full formatted long numeric value without shrinking or losing digits', async () => {
    const base = payload();
    mockOverview({ ...base, cost: { ...base.cost, totalCredits: 123456789012345.67 } });
    renderPage();
    const card = await screen.findByTestId('stat-total-credits');
    const value = card.querySelector('.space-dashboard-stat-value')!;
    expect(value).toHaveTextContent('123,456,789,012,345.67');
    expect(value).toHaveAttribute('title', '123,456,789,012,345.67');
  });

  it('does not show fabricated numbers during initial loading', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.get('/api/space-dashboard/overview', async () => {
      await pending;
      return HttpResponse.json(envelope(payload()));
    }));
    renderPage();
    try {
      expect(await screen.findByTestId('space-dashboard-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('stat-agent-count')).toBeNull();
      expect(screen.queryByTestId('space-dashboard-scope')).toBeNull();
    } finally {
      release();
    }
    await screen.findByTestId('space-dashboard-page');
  });

  it('renders the platform-wide scope copy for a platform admin', async () => {
    mockOverview(payload({ platformAdmin: true, workspaceCount: 32 }));

    renderPage();

    const scope = await screen.findByTestId('space-dashboard-scope');
    expect(scope).toHaveTextContent('统计范围：全平台 32 个空间');
    expect(scope).toHaveTextContent('已排除停用空间与回收站空间');
    expect(scope).not.toHaveTextContent('你管理的');
  });

  it('narrows the delivery section by work type while the cost section stays unchanged', async () => {
    mockOverview(payload());
    renderPage();
    await screen.findByTestId('space-dashboard-page');

    // 取消 BUG 后再勾回：覆盖 checked=true 的累加分支（QA-F2）。
    await userEvent.click(screen.getByTestId('space-dashboard-work-type-BUG'));
    await waitFor(() => expect(lastParams().get('workTypes')).toBe('REQ,TASK'));
    await userEvent.click(screen.getByTestId('space-dashboard-work-type-BUG'));
    await waitFor(() => expect(lastParams().get('workTypes')).toBe('REQ,TASK,BUG'));
    expect(screen.getByTestId('space-dashboard-work-type-BUG')).toBeChecked();

    await userEvent.click(screen.getByTestId('space-dashboard-work-type-REQ'));
    await waitFor(() => expect(lastParams().get('workTypes')).toBe('TASK,BUG'));

    await userEvent.click(screen.getByTestId('space-dashboard-work-type-TASK'));
    await waitFor(() => expect(lastParams().get('workTypes')).toBe('BUG'));
    expect(screen.getByTestId('stat-total-credits')).toHaveTextContent('48,213.55');
    // 成本窗口参数不随工单类型筛选变化。
    expect(lastParams().get('costStart')).toBe(dayjs().subtract(30, 'day').format('YYYY-MM-DD'));

    const settled = requests.length;
    await userEvent.click(screen.getByTestId('space-dashboard-work-type-BUG'));
    expect(requests).toHaveLength(settled);
    expect(screen.getByTestId('space-dashboard-work-type-BUG')).toBeChecked();
  });

  it('shows a placeholder when no workitem completed in the delivery window', async () => {
    mockOverview(payload({
      cost: {
        ...payload().cost,
        completedWorkitemCount: 0,
        perCompletedWorkitem: null,
      },
    }));

    renderPage();

    expect(await screen.findByTestId('stat-per-workitem')).toHaveTextContent('--');
    expect(screen.getByTestId('stat-per-workitem')).toHaveTextContent('分母：交付窗口内无已完成工单');
  });

  it('renders the forbidden state when the caller has no manageable workspace', async () => {
    server.use(http.get('/api/space-dashboard/overview', () => HttpResponse.json(
      { success: false, code: '10403', message: '无权限', traceId: null, data: null },
      { status: 403 },
    )));

    renderPage();

    expect(await screen.findByTestId('space-dashboard-forbidden')).toBeInTheDocument();
    expect(screen.getByText('无权限访问空间级看板')).toBeInTheDocument();
    expect(screen.queryByTestId('stat-agent-count')).toBeNull();
    expect(screen.queryByTestId('space-dashboard-scope')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '返回工作空间列表' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/workspaces');
  });

  it('shows an error state and recovers after retry', async () => {
    let calls = 0;
    server.use(http.get('/api/space-dashboard/overview', () => {
      calls += 1;
      if (calls === 1) {
        return HttpResponse.json(
          { success: false, code: '10000', message: '服务器异常', traceId: null, data: null },
          { status: 500 },
        );
      }
      return HttpResponse.json(envelope(payload()));
    }));

    renderPage();

    expect(await screen.findByTestId('space-dashboard-error')).toBeInTheDocument();
    expect(screen.queryByTestId('stat-agent-count')).toBeNull();
    expect(screen.queryByTestId('space-dashboard-scope')).toBeNull();
    await userEvent.click(screen.getByTestId('space-dashboard-retry'));
    expect(await screen.findByTestId('space-dashboard-page')).toBeInTheDocument();
  });

  it('switches to the clicked workspace and opens its insights page', async () => {
    mockOverview(payload());
    server.use(http.post('/api/workspaces/2/switch', () => HttpResponse.json(
      envelope({ accessToken: 'switched-token', accessLevel: 'ADMIN' }),
    )));

    renderPage();

    await userEvent.click(await screen.findByTestId('rank-top-completed-item-2'));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/insights'));
    expect(useAuthStore.getState().currentWorkspace?.id).toBe(2);
    expect(useAuthStore.getState().accessToken).toBe('switched-token');
  });

  it('keeps the dashboard open when the workspace switch fails', async () => {
    mockOverview(payload());
    server.use(http.post('/api/workspaces/2/switch', () => HttpResponse.json(
      { success: false, code: '10000', message: '切换失败，请稍后重试', traceId: null, data: null },
      { status: 400 },
    )));

    renderPage();

    await userEvent.click(await screen.findByTestId('rank-top-completed-item-2'));

    expect(await screen.findByText('切换失败，请稍后重试')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/workspaces/dashboard');
  });

  it('ignores ranks whose workspace left the scope before the click', async () => {
    const base = payload();
    mockOverview({
      ...base,
      delivery: {
        ...base.delivery,
        topCompleted: [{ workspaceId: 99, workspaceName: '已移除空间', value: 5 }],
      },
    });
    const switchCalls = vi.fn();
    server.use(http.post('/api/workspaces/:id/switch', ({ params }) => {
      switchCalls(params.id);
      return HttpResponse.json(envelope({ accessToken: 't', accessLevel: 'ADMIN' }));
    }));

    renderPage();

    await userEvent.click(await screen.findByTestId('rank-top-completed-item-99'));

    expect(switchCalls).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/workspaces/dashboard');
  });
});
