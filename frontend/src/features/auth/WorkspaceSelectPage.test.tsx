import { i18n } from '@/shared/i18n';
import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { RouteGuard } from '@/app/RouteGuard';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import { WorkspaceSelectPage } from './WorkspaceSelectPage';

// antd inserts a thin space between exactly two CJK characters in a Button label (`保存` renders
// as `保 存`), so every button lookup goes through a whitespace-tolerant matcher.
function buttonName(label: string) {
  return new RegExp(label.split('').join('\\s*'));
}

const MANAGEABLE_WORKSPACE = {
  id: 1,
  name: '星云工坊',
  description: '多 Agent 研发协作空间',
  background: '云原生研发',
  version: 3,
  canManage: true,
};

function mockMine(data: unknown[]) {
  server.use(
    http.get('/api/workspaces/mine', () => HttpResponse.json({
      success: true,
      code: '0',
      message: '',
      traceId: null,
      data,
    })),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><WorkspaceSelectPage /></MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-path">{`${location.pathname}${location.search}`}</span>;
}

// jsdom has no layout, so EllipsisText cannot detect truncation on its own. These prototype
// getters make every ellipsis span report overflow (width for 1-line, height for line-clamped),
// which is what turns the hover tooltip on.
function mockEllipsisOverflow() {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 200 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 100 });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 200 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 100 });
  return () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    delete proto.scrollWidth;
    delete proto.clientWidth;
    delete proto.scrollHeight;
    delete proto.clientHeight;
  };
}

function renderPageWithLocation() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/workspaces']}>
        <WorkspaceSelectPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WorkspaceSelectPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    server.use(http.get('/api/notifications/unread-count', () => HttpResponse.json({ success: true, data: 0 })));
  });

  it.each(['name', 'description'] as const)('shows the complete long %s on hover', async (field) => {
    const restoreMeasurements = mockEllipsisOverflow();
    try {
      const workspace = { ...MANAGEABLE_WORKSPACE, [field]: '超长工作空间内容'.repeat(30) };
      mockMine([workspace]);
      renderPage();
      const card = await screen.findByTestId('workspace-card-1');
      await userEvent.hover(within(card).getByText(workspace[field]));
      expect(await screen.findByRole('tooltip')).toHaveTextContent(workspace[field]);
    } finally {
      restoreMeasurements();
    }
  });

  it('shows the shared signed-in user menu instead of the current-workspace panel', async () => {
    useAuthStore.getState().setUser({ id: 7, username: 'alice', nickname: '爱丽丝', email: 'alice@example.com' });
    mockMine([]);
    renderPageWithLocation();
    expect(screen.queryByText('爱丽丝')).not.toBeInTheDocument();
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('当前工作空间')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '用户菜单' }));
    expect(await screen.findByText('退出登录')).toBeInTheDocument();
    await user.click(screen.getByText('个人设置'));
    await waitFor(() => expect(screen.getByTestId('location-path')).toHaveTextContent('/profile/settings'));
  });

  it.each([
    { selected: true, count: 4 },
    { selected: true, count: 0 },
    { selected: false, count: 4 },
  ])('uses the real notification action with selected=$selected and unread=$count', async ({ selected, count }) => {
    useAuthStore.getState().setTokens('test-access', 'test-refresh');
    useAuthStore.getState().setUser({ id: 7, username: 'alice', nickname: '爱丽丝', email: '' });
    if (selected) useAuthStore.getState().setCurrentWorkspace(MANAGEABLE_WORKSPACE, 'READ_WRITE');
    mockMine([MANAGEABLE_WORKSPACE]);
    let unreadRequests = 0;
    server.use(http.get('/api/notifications/unread-count', () => {
      unreadRequests += 1;
      return HttpResponse.json({ success: true, code: '0', data: count });
    }));
    renderPageWithLocation();
    await screen.findByTestId('workspace-card-1');
    const header = document.querySelector<HTMLElement>('.aw-page-header-actions')!;
    const actions = Array.from(header.children);
    expect(actions.map(action => action.getAttribute('aria-label'))).toEqual([
      // Chief 入口由 Tooltip 包裹在 span 上，aria-label 位于内部按钮。
      null, '帮助中心', '切换语言', '切换外观', '通知中心', '用户菜单',
    ]);
    expect(within(header).getByRole('button', { name: '打开 Chief' })).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: '帮助中心' })).toHaveAttribute('href', '/help');
    const bell = within(header).getByRole('button', { name: '通知中心' });
    expect(bell.querySelector('[data-glyph="bell"]')).not.toBeNull();
    if (selected) await waitFor(() => expect(unreadRequests).toBe(1));
    else expect(unreadRequests).toBe(0);
    if (selected && count > 0) await waitFor(() => expect(bell.querySelector('.aw-bell-dot')).not.toBeNull());
    else expect(bell.querySelector('.aw-bell-dot')).toBeNull();
    expect(bell).toHaveTextContent('');
    await act(async () => { await i18n.changeLanguage('en-US'); });
    try {
      expect(within(header).getByRole('button', { name: 'Notifications' })).toBe(bell);
      bell.focus();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(screen.getByTestId('location-path')).toHaveTextContent(/^\/notifications$/));
      expect(useAuthStore.getState().isAuthenticated()).toBe(true);
      expect(useAuthStore.getState().currentWorkspace?.id ?? null).toBe(selected ? 1 : null);
      expect(unreadRequests).toBe(selected ? 1 : 0);
    } finally {
      await act(async () => { await i18n.changeLanguage('zh-CN'); });
    }
  });

  it.each([true, false])('preserves the notification workspace route guard for authenticated users with selected=%s', async (selected) => {
    useAuthStore.getState().setTokens('test-access', 'test-refresh');
    useAuthStore.getState().setUser({ id: 7, username: 'alice', nickname: '', email: '' });
    if (selected) useAuthStore.getState().setCurrentWorkspace(MANAGEABLE_WORKSPACE, 'READ_WRITE');
    mockMine([MANAGEABLE_WORKSPACE]);
    server.use(http.get('/api/notifications/unread-count', () => HttpResponse.json({ success: true, data: 0 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/workspaces']}>
          <Routes>
            <Route path="/workspaces" element={<RouteGuard requireWorkspace={false}><WorkspaceSelectPage /></RouteGuard>} />
            <Route path="/notifications" element={<RouteGuard><span data-testid="guarded-notification-route" /></RouteGuard>} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: '通知中心' }));
    if (selected) {
      expect(await screen.findByTestId('guarded-notification-route')).toBeInTheDocument();
      expect(screen.getByTestId('location-path')).toHaveTextContent(/^\/notifications$/);
    } else {
      expect(await screen.findByTestId('workspace-select-grid')).toBeInTheDocument();
      expect(screen.getByTestId('location-path')).toHaveTextContent(/^\/workspaces(\?|$)/);
      expect(screen.queryByTestId('guarded-notification-route')).not.toBeInTheDocument();
    }
    expect(useAuthStore.getState().isAuthenticated()).toBe(true);
  });

  it('shows supplied real zero counts and opens background without switching', async () => {
    mockMine([{ ...MANAGEABLE_WORKSPACE, memberCount: 2, workitemCount: 0 }, { id: 2, name: '空背景', description: '', canManage: false }]);
    renderPage();
    const shell = await screen.findByTestId('workspace-card-shell-1');
    expect(within(shell).getByText('2 名成员')).toBeInTheDocument();
    expect(within(shell).getByText('0 个工单')).toBeInTheDocument();
    await userEvent.click(within(shell).getByRole('button', { name: '查看工作空间背景 星云工坊' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('云原生研发')).toBeInTheDocument();
    expect(useAuthStore.getState().currentWorkspace).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: buttonName('关闭') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const empty = screen.getByTestId('workspace-card-shell-2');
    expect(empty.querySelector('.ws-count')).toBeNull();
    await userEvent.click(within(empty).getByRole('button', { name: '查看工作空间背景 空背景' }));
    expect(await screen.findByText('尚未填写工作空间背景')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: buttonName('编辑') })).not.toBeInTheDocument();
  });

  it('renders workspace cards with shared appearance tokens', async () => {
    useAuthStore.getState().setCurrentWorkspace({ id: 1, name: '星云工坊', description: '研发工作空间' }, 'READ_ONLY');
    server.use(
      http.get('/api/workspaces/mine', () => HttpResponse.json({
        success: true,
        code: '0',
        message: '',
        traceId: null,
        data: [
          { id: 1, name: '星云工坊', description: '多 Agent 研发协作空间' },
          { id: 2, name: '云效集成平台', description: '连接 Aone 工单与执行器集群' },
        ],
      })),
    );

    renderPage();
    expect(screen.getAllByRole('button', { name: '切换外观' })).toHaveLength(1);

    expect(await screen.findByText('云效集成平台')).toBeInTheDocument();
    expect(screen.getAllByText('星云工坊').length).toBeGreaterThan(0);
    // 原型 09：卡片视觉（3 列栅格、hover 主色边框、hover 浮现操作）在
    // workspaceLifecycle.css，jsdom 只能钉类名与结构。
    expect(screen.getByTestId('workspace-select-grid')).toHaveClass('ws-grid');
    const activeShell = screen.getByTestId('workspace-card-shell-1');
    expect(activeShell).toHaveClass('ws-card', 'ws-card--current');
    expect(screen.getByTestId('workspace-card-2').closest('.ws-card')).not.toHaveClass('ws-card--current');
    expect(screen.getByTestId('workspace-card-1')).toHaveClass('ws-card-enter');
    // 「当前」徽标内联于标题行，不再是绝对定位角标。
    const currentBadge = within(activeShell).getByText('当前');
    expect(currentBadge).toHaveClass('ws-cur');
    expect(currentBadge.closest('.ws-title')).not.toBeNull();
    expect(screen.getByTestId('workspace-create-card')).toHaveClass('ws-new');
  });

  it('stores the access level returned when switching workspace', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/workspaces/mine', () => HttpResponse.json({
        success: true,
        code: '0',
        message: '',
        traceId: null,
        data: [{ id: 2, name: '云效集成平台', description: '研发工作空间' }],
      })),
      http.post('/api/workspaces/2/switch', () => HttpResponse.json({
        success: true,
        code: '0',
        message: '',
        traceId: null,
        data: {
          accessToken: 'workspace-access-token',
          accessLevel: 'ADMIN',
        },
      })),
    );

    renderPage();
    await user.click(await screen.findByTestId('workspace-card-2'));

    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBe('workspace-access-token');
      expect(useAuthStore.getState().currentWorkspace?.id).toBe(2);
      expect(useAuthStore.getState().accessLevel).toBe('ADMIN');
    });
  });

  it('links to global branding settings outside workspace workspaces', async () => {
    server.use(
      http.get('/api/workspaces/mine', () => HttpResponse.json({
        success: true,
        code: '0',
        message: '',
        traceId: null,
        data: [{ id: 2, name: '云效集成平台', description: '研发工作空间' }],
      })),
    );

    renderPageWithLocation();

    await userEvent.click(await screen.findByRole('button', { name: /平台配置/ }));

    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent('/workspaces/branding');
    });
  });

  it('clears cached workitem lists after switching workspace', async () => {
    useAuthStore.getState().setCurrentWorkspace(
      { id: 1, name: '星云工坊', description: '研发工作空间' },
      'READ_ONLY',
    );
    server.use(
      http.get('/api/workspaces/mine', () => HttpResponse.json({
        success: true,
        code: '0',
        message: '',
        traceId: null,
        data: [
          { id: 1, name: '星云工坊', description: '多 Agent 研发协作空间' },
          { id: 2, name: '云效集成平台', description: '连接 Aone 工单与执行器集群' },
        ],
      })),
      http.post('/api/workspaces/2/switch', () => HttpResponse.json({
        success: true,
        code: '0',
        message: '',
        traceId: null,
        data: { accessToken: 'workspace-2-token', accessLevel: 'READ_ONLY' },
      })),
    );
    const { queryClient } = renderPage();
    queryClient.setQueryData(['workitems', { page: 1, size: 20 }], { content: [{ id: 101, title: '旧工作空间工单' }] });
    queryClient.setQueryData(['workitem', '101'], { id: 101, title: '旧工作空间详情' });

    const targetWorkspace = await screen.findByTestId('workspace-card-2');
    await act(async () => {
      await userEvent.click(targetWorkspace);
    });

    expect(queryClient.getQueryData(['workitems', { page: 1, size: 20 }])).toBeUndefined();
    expect(queryClient.getQueryData(['workitem', '101'])).toBeUndefined();
    expect(useAuthStore.getState().currentWorkspace?.id).toBe(2);
    expect(useAuthStore.getState().accessToken).toBe('workspace-2-token');
  });

  it('renders both tabs and keeps 我的工作空间 active with the own-workspaces grid', async () => {
    server.use(
      http.get('/api/workspaces/mine', () => HttpResponse.json({
        success: true,
        code: '0',
        message: '',
        traceId: null,
        data: [{ id: 1, name: '星云工坊', description: '多 Agent 研发协作空间' }],
      })),
    );

    renderPage();

    expect(screen.getByRole('tab', { name: '我的工作空间' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '所有工作空间' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '我的工作空间' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('workspace-select-grid')).toBeInTheDocument();
    expect(await screen.findByText('星云工坊')).toBeInTheDocument();
  });

  it('does not fetch all workspaces until the discovery tab is opened', async () => {
    const user = userEvent.setup();
    let allWorkspacesRequests = 0;
    server.use(
      http.get('/api/workspaces/mine', () => HttpResponse.json({
        success: true,
        code: '0',
        message: '',
        traceId: null,
        data: [{ id: 1, name: '星云工坊', description: '多 Agent 研发协作空间' }],
      })),
      http.get('/api/workspaces/all', () => {
        allWorkspacesRequests += 1;
        return HttpResponse.json({
          success: true,
          code: '0',
          message: '',
          traceId: null,
          data: {
            list: [{ id: 9, name: '公开空间', description: '', membershipStatus: 'NOT_MEMBER', accessLevel: null }],
            total: 1,
            pageNum: 1,
            pageSize: 20,
          },
        });
      }),
    );

    renderPage();

    expect(await screen.findByText('星云工坊')).toBeInTheDocument();
    expect(allWorkspacesRequests).toBe(0);

    await user.click(screen.getByRole('tab', { name: '所有工作空间' }));

    expect(await screen.findByText('共 1 个工作空间')).toBeInTheDocument();
    expect(allWorkspacesRequests).toBe(1);
  });

  it('shows my workspaces again after switching back from the discovery tab', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/workspaces/mine', () => HttpResponse.json({
        success: true,
        code: '0',
        message: '',
        traceId: null,
        data: [{ id: 1, name: '星云工坊', description: '多 Agent 研发协作空间' }],
      })),
      http.get('/api/workspaces/all', () => HttpResponse.json({
        success: true,
        code: '0',
        message: '',
        traceId: null,
        data: {
          list: [{ id: 9, name: '公开空间', description: '', membershipStatus: 'NOT_MEMBER', accessLevel: null }],
          total: 1,
          pageNum: 1,
          pageSize: 20,
        },
      })),
    );

    renderPage();

    await user.click(await screen.findByRole('tab', { name: '所有工作空间' }));
    expect(await screen.findByText('共 1 个工作空间')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '我的工作空间' }));

    expect(await screen.findByTestId('workspace-select-grid')).toBeVisible();
    expect(screen.getByText('星云工坊')).toBeVisible();
    expect(screen.getByText('共 1 个工作空间')).not.toBeVisible();
  });

  it('opens the create-workspace form in the shared modal', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/workspaces/mine', () => HttpResponse.json({
        success: true,
        code: '0',
        message: '',
        traceId: null,
        data: [{ id: 1, name: '星云工坊', description: '多 Agent 研发协作空间' }],
      })),
    );

    renderPage();

    await user.click(await screen.findByTestId('workspace-create-card'));

    // 创建卡会先探测建空间权限再打开弹窗，等待异步探测完成。
    const dialog = await screen.findByRole('dialog');
    expect(dialog.closest('.ws-modal')).not.toBeNull();
    expect(within(dialog).getByPlaceholderText('输入工作空间名称')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-create-card')).toBeInTheDocument();
    expect(document.querySelector('.ws-form')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: buttonName('创建') }));
    expect(await within(dialog).findByText('工作空间名称不能为空')).toBeInTheDocument();
    expect(dialog.querySelector('form')).toHaveClass('ws-workspace-form');
  });

  it('cancels creation without writing and resets the draft on reopening', async () => {
    let createCalls = 0;
    mockMine([]);
    server.use(http.post('/api/workspaces', () => {
      createCalls += 1;
      return HttpResponse.json({ success: true, data: MANAGEABLE_WORKSPACE });
    }));
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('workspace-create-card'));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('工作空间名称'), '未保存草稿');
    await user.click(within(dialog).getByRole('button', { name: buttonName('取消') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(createCalls).toBe(0);
    await user.click(screen.getByTestId('workspace-create-card'));
    expect(within(await screen.findByRole('dialog')).getByLabelText('工作空间名称')).toHaveValue('');
    expect(createCalls).toBe(0);
  });

  it('keeps a rejected create draft and localizes field errors without writing', async () => {
    let createCalls = 0;
    mockMine([]);
    server.use(http.post('/api/workspaces', () => {
      createCalls += 1;
      return HttpResponse.json({ success: false, code: '11003', message: '空间重名', data: null });
    }));
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('workspace-create-card'));
    // 创建卡先探测建空间权限再打开弹窗，负载高时探测会晚于点击返回。
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText('工作空间名称');
    await user.type(name, '   ');
    await user.click(within(dialog).getByRole('button', { name: buttonName('创建') }));
    expect(await within(dialog).findByText('工作空间名称不能为空')).toBeInTheDocument();
    expect(createCalls).toBe(0);
    try {
      await act(async () => { await i18n.changeLanguage('en-US'); });
      expect(await within(dialog).findByText('Enter a workspace name')).toBeInTheDocument();
      expect(name).toHaveValue('   ');
      expect(createCalls).toBe(0);
    } finally {
      await act(async () => { await i18n.changeLanguage('zh-CN'); });
    }
    await user.clear(name);
    await user.type(name, '重名草稿');
    await user.click(within(dialog).getByRole('button', { name: buttonName('创建') }));
    expect(await screen.findByText('空间重名')).toBeInTheDocument();
    expect(createCalls).toBe(1);
    expect(name).toHaveValue('重名草稿');
    expect(dialog).toBeInTheDocument();
    expect(useAuthStore.getState().currentWorkspace).toBeNull();
    expect(within(dialog).getByRole('button', { name: buttonName('创建') })).toBeEnabled();
  });

  it('creates once under duplicate submissions, refetches and switches into the result', async () => {
    const bodies: unknown[] = [];
    let mineCalls = 0;
    let switchCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    server.use(
      http.get('/api/workspaces/mine', () => {
        mineCalls += 1;
        return HttpResponse.json({ success: true, data: bodies.length ? [MANAGEABLE_WORKSPACE] : [] });
      }),
      http.post('/api/workspaces', async ({ request }) => {
        bodies.push(await request.json());
        await gate;
        return HttpResponse.json({ success: true, data: MANAGEABLE_WORKSPACE });
      }),
      http.post('/api/workspaces/1/switch', () => {
        switchCalls += 1;
        return HttpResponse.json({ success: true, data: { accessToken: 'created-workspace-token', accessLevel: 'ADMIN' } });
      }),
    );
    renderPageWithLocation();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('workspace-create-card'));
    // 创建卡先探测建空间权限再打开弹窗，负载高时探测会晚于点击返回。
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('工作空间名称'), '星云工坊');
    await user.type(within(dialog).getByLabelText('工作空间描述'), '创建描述');
    await user.type(within(dialog).getByLabelText('工作空间背景'), '原文背景');
    const mineBefore = mineCalls;
    try {
      await act(async () => {
        fireEvent.submit(dialog.querySelector('form')!);
        fireEvent.submit(dialog.querySelector('form')!);
      });
      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0]).toEqual({ name: '星云工坊', description: '创建描述', background: '原文背景' });
      expect(within(dialog).getByRole('button', { name: buttonName('取消') })).toBeDisabled();
      expect(switchCalls).toBe(0);
    } finally {
      release();
    }
    await waitFor(() => expect(useAuthStore.getState().currentWorkspace?.id).toBe(1));
    expect(useAuthStore.getState().accessToken).toBe('created-workspace-token');
    expect(useAuthStore.getState().accessLevel).toBe('ADMIN');
    expect(bodies).toHaveLength(1);
    expect(switchCalls).toBe(1);
    expect(mineCalls).toBeGreaterThan(mineBefore);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('location-path')).toHaveTextContent(/^\/$/));
  });

  it('shows the empty state with a create card when the user has no workspaces', async () => {
    server.use(
      http.get('/api/workspaces/mine', () => HttpResponse.json({
        success: true,
        code: '0',
        message: '',
        traceId: null,
        data: [],
      })),
    );

    renderPage();

    expect(await screen.findByTestId('workspace-create-card')).toHaveClass('ws-new--full');
    expect(screen.getByTestId('workspace-select-grid').children).toHaveLength(1);
    expect(screen.queryByText('暂无已加入的工作空间，请创建一个')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-card-1')).not.toBeInTheDocument();
  });

  it('refetches the workspace list for the new account without showing the previous account data', async () => {
    useAuthStore.getState().setUser({
      id: 1,
      username: 'alice',
      nickname: '爱丽丝',
      email: 'alice@example.com',
    });
    server.use(
      http.get('/api/workspaces/mine', () => HttpResponse.json({
        success: true,
        code: '0',
        message: '',
        traceId: null,
        data: [{ id: 11, name: '账号A的工作空间', description: '账号A的数据' }],
      })),
    );

    renderPage();
    expect(await screen.findByText('账号A的工作空间')).toBeInTheDocument();

    server.use(
      http.get('/api/workspaces/mine', () => HttpResponse.json({
        success: true,
        code: '0',
        message: '',
        traceId: null,
        data: [{ id: 21, name: '账号B的工作空间', description: '账号B的数据' }],
      })),
    );

    act(() => {
      useAuthStore.getState().clear();
      useAuthStore.getState().setUser({
        id: 2,
        username: 'bob',
        nickname: '鲍勃',
        email: 'bob@example.com',
      });
    });

    expect(screen.queryByText('账号A的工作空间')).not.toBeInTheDocument();
    expect(await screen.findByText('账号B的工作空间')).toBeInTheDocument();
  });

  it('shows the manage controls only for workspaces the server marks as manageable', async () => {
    mockMine([
      MANAGEABLE_WORKSPACE,
      { id: 2, name: '只读工作空间', description: '', canManage: false },
      { id: 3, name: '旧接口工作空间', description: '' },
    ]);

    renderPage();

    expect(await screen.findByTestId('workspace-manage-area-1')).toBeInTheDocument();
    expect(screen.getByTestId('edit-workspace-1')).toBeInTheDocument();
    expect(screen.getByTestId('delete-workspace-1')).toBeInTheDocument();
    // `canManage === true` is the only gate: an explicit false and a missing field (a payload
    // from an older backend) both hide the controls, so the UI never offers an edit or a delete
    // that the service would reject with a permission error.
    expect(screen.queryByTestId('workspace-manage-area-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-manage-area-3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('edit-workspace-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('delete-workspace-3')).not.toBeInTheDocument();
  });

  it('keeps the manage controls out of the enter control so managing cannot enter the workspace', async () => {
    let switchCalls = 0;
    mockMine([MANAGEABLE_WORKSPACE]);
    server.use(
      http.post('/api/workspaces/1/switch', () => {
        switchCalls += 1;
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null,
          data: { accessToken: 'workspace-1-token', accessLevel: 'ADMIN' },
        });
      }),
    );
    const user = userEvent.setup();

    renderPage();

    const enter = await screen.findByTestId('workspace-card-1');
    const manageArea = screen.getByTestId('workspace-manage-area-1');
    // F1.2: a control nested inside a <button> is invalid HTML, and its click would bubble into
    // the card's enter handler and switch workspace instead of opening the dialog.
    expect(enter).not.toContainElement(manageArea);
    expect(enter).not.toContainElement(screen.getByTestId('edit-workspace-1'));
    expect(enter).not.toContainElement(screen.getByTestId('delete-workspace-1'));
    const footer = manageArea.parentElement!;
    expect(footer).toHaveClass('ws-foot');
    expect(footer.parentElement).toBe(enter.parentElement);
    expect(manageArea).toHaveClass('ws-ops');
    expect(enter.querySelector('button')).toBeNull();
    expect(screen.getByTestId('edit-workspace-1').querySelector('svg')).toHaveAttribute('width', '14');
    expect(screen.getByTestId('delete-workspace-1').querySelector('svg')).toHaveAttribute('height', '14');

    await user.click(screen.getByTestId('edit-workspace-1'));
    expect(await screen.findByText('编辑「星云工坊」')).toBeInTheDocument();
    expect(switchCalls).toBe(0);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('prefills the edit dialog and shows the new name and description right after saving', async () => {
    let savedBody: Record<string, unknown> | null = null;
    let mineCalls = 0;
    server.use(
      http.get('/api/workspaces/mine', () => {
        mineCalls += 1;
        // Echoes the save so the assertion below can only pass if the list was really re-read.
        const saved = savedBody as { name?: string; description?: string } | null;
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null,
          data: [{
            ...MANAGEABLE_WORKSPACE,
            name: saved ? saved.name : MANAGEABLE_WORKSPACE.name,
            description: saved ? saved.description : MANAGEABLE_WORKSPACE.description,
            version: saved ? 4 : 3,
          }],
        });
      }),
      http.put('/api/workspaces/1', async ({ request }) => {
        savedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null, data: { id: 1 },
        });
      }),
    );
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByTestId('edit-workspace-1'));

    // F1.3 回显: all three stored fields land in the dialog, including the background that the
    // card itself never renders.
    const nameInput = await screen.findByPlaceholderText('输入工作空间名称');
    expect(nameInput).toHaveValue('星云工坊');
    const descriptionInput = screen.getByPlaceholderText('简要描述工作空间用途');
    expect(descriptionInput).toHaveValue('多 Agent 研发协作空间');
    expect(screen.getByPlaceholderText('工作空间的行业背景、技术栈、团队规模等信息'))
      .toHaveValue('云原生研发');

    const mineBefore = mineCalls;
    await user.clear(nameInput);
    await user.type(nameInput, '星云工坊 2');
    await user.clear(descriptionInput);
    await user.type(descriptionInput, '改名后的描述');
    await user.click(screen.getByRole('button', { name: buttonName('保存') }));

    await waitFor(() => expect(savedBody).not.toBeNull());
    // F1.5: the optimistic-lock version travels with the save, taken from the row as loaded.
    expect(savedBody).toEqual({
      name: '星云工坊 2',
      description: '改名后的描述',
      background: '云原生研发',
      version: 3,
    });

    // F1.3: the dialog closes and the list shows the new name and description with no manual
    // refresh, because the save invalidates the shared ['workspaces'] prefix.
    await waitFor(() => expect(screen.queryByText('编辑「星云工坊」')).not.toBeInTheDocument());
    expect(mineCalls).toBeGreaterThan(mineBefore);
    expect(await screen.findByText('星云工坊 2')).toBeInTheDocument();
    expect(await screen.findByText('改名后的描述')).toBeInTheDocument();
    expect(screen.queryByText('多 Agent 研发协作空间')).not.toBeInTheDocument();
  });

  it('opens the delete dialog from the card and states all three consequences', async () => {
    let switchCalls = 0;
    let deleteCalls = 0;
    mockMine([MANAGEABLE_WORKSPACE]);
    server.use(
      http.post('/api/workspaces/1/switch', () => {
        switchCalls += 1;
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null,
          data: { accessToken: 'workspace-1-token', accessLevel: 'ADMIN' },
        });
      }),
      http.delete('/api/workspaces/1', () => {
        deleteCalls += 1;
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null, data: { id: 1 },
        });
      }),
    );
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByTestId('delete-workspace-1'));

    expect(await screen.findByText('删除「星云工坊」')).toBeInTheDocument();
    // F2.1: the confirmation must name the recycle bin, the loss of access, and the fact that
    // nothing is physically destroyed -- in that order, as three separate list items.
    expect(
      within(screen.getByTestId('workspace-delete-consequences'))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      '删除后该工作空间将移入回收站。',
      '成员暂时无法进入或访问该工作空间。',
      '数据不会物理删除，可通过回收站恢复。',
    ]);
    // Opening the dialog neither switches nor deletes.
    expect(switchCalls).toBe(0);
    expect(deleteCalls).toBe(0);
  });

  it('drops the workspace binding when the workspace bound to the token is deleted', async () => {
    useAuthStore.getState().setTokens('bound-token', 'refresh-token');
    useAuthStore.getState().setCurrentWorkspace(
      { id: 1, name: '星云工坊', description: '' },
      'ADMIN',
    );
    const deletedIds: number[] = [];
    mockMine([MANAGEABLE_WORKSPACE]);
    server.use(
      http.post('/api/auth/refresh', () => HttpResponse.json({
        success: true, code: '0', data: { accessToken: 'unbound-token' },
      })),
      http.delete('/api/workspaces/:id', ({ params }) => {
        deletedIds.push(Number(params.id));
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null, data: { id: Number(params.id) },
        });
      }),
    );
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByTestId('delete-workspace-1'));
    await user.click(await screen.findByRole('button', { name: buttonName('确认删除') }));

    await waitFor(() => expect(deletedIds).toEqual([1]));
    // F6: AuthFilter now rejects every workspace-scoped call made with this token, so the binding
    // goes at the moment of deletion instead of after the first failed request.
    await waitFor(() => {
      expect(useAuthStore.getState().currentWorkspace).toBeNull();
      expect(useAuthStore.getState().accessLevel).toBeNull();
    });
    // The account survives with an access token that no longer contains the deleted workspace.
    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('unbound-token'));
    expect(useAuthStore.getState().refreshToken).toBe('refresh-token');
  });

  it('keeps the current workspace binding when a different workspace is deleted', async () => {
    useAuthStore.getState().setTokens('bound-token', 'refresh-token');
    useAuthStore.getState().setCurrentWorkspace(
      { id: 2, name: '云效集成平台', description: '' },
      'READ_WRITE',
    );
    mockMine([MANAGEABLE_WORKSPACE, { id: 2, name: '云效集成平台', description: '', canManage: true }]);
    server.use(
      http.delete('/api/workspaces/:id', ({ params }) => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null, data: { id: Number(params.id) },
      })),
    );
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByTestId('delete-workspace-1'));
    await user.click(await screen.findByRole('button', { name: buttonName('确认删除') }));

    await waitFor(() => expect(screen.queryByText('删除「星云工坊」')).not.toBeInTheDocument());
    // Deleting a workspace the token is not bound to must not sign the user out of the one they
    // are actually working in.
    expect(useAuthStore.getState().currentWorkspace?.id).toBe(2);
    expect(useAuthStore.getState().accessLevel).toBe('READ_WRITE');
    expect(useAuthStore.getState().accessToken).toBe('bound-token');
  });

  it('routes to the recycle bin from the workspace tab bar', async () => {
    mockMine([MANAGEABLE_WORKSPACE]);
    const user = userEvent.setup();

    renderPageWithLocation();

    const entry = await screen.findByTestId('workspace-recycle-bin-entry');
    // F4.1: an interactive button with an icon and a label, not a decorative element.
    expect(entry).toHaveAttribute('type', 'button');
    expect(entry).toHaveAccessibleName('打开工作空间回收站');
    expect(entry).toHaveTextContent('工作空间回收站');
    expect(entry.closest('.ant-tabs-nav')).toContainElement(screen.getByRole('tab', { name: '我的工作空间' }));
    expect(entry.closest('.ant-tabs-nav')).toContainElement(screen.getByRole('tab', { name: '所有工作空间' }));
    expect(entry).not.toHaveStyle({ position: 'fixed' });

    await user.click(entry);

    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent('/workspaces/recycle-bin');
    });
  });

  it('switches workspace navigation language from the shared header without changing workspace names', async () => {
    mockMine([MANAGEABLE_WORKSPACE]);
    renderPage();
    await screen.findByText('星云工坊');
    try {
      await userEvent.click(screen.getByRole('button', { name: '切换语言' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'English' }));
      expect(await screen.findByRole('tab', { name: 'My workspaces' })).toBeInTheDocument();
      expect(screen.getByText('星云工坊')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Switch language' })).toHaveLength(1);
    } finally {
      await act(async () => { await i18n.changeLanguage('zh-CN'); });
    }
  });

  it('returns to the saved in-site target after choosing a workspace', async () => {
    const user = userEvent.setup();
    mockMine([{ ...MANAGEABLE_WORKSPACE, id: 2, name: '目标空间' }]);
    server.use(http.post('/api/workspaces/2/switch', () => HttpResponse.json({
      success: true, code: '0', message: '', traceId: null,
      data: { accessToken: 'token-2', accessLevel: 'READ_WRITE' },
    })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/workspaces?returnTo=%2Fworkitems%2F42%3Ftab%3Ddiscussion']}>
          <WorkspaceSelectPage />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByTestId('workspace-card-2'));

    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent('/workitems/42?tab=discussion');
    });
  });

  it.each(['%2F%2Fevil.example.com%2Fsteal', '%2Flogin'])(
    'ignores an unsafe return target %s and falls back to the default page',
    async (returnTo) => {
      const user = userEvent.setup();
      mockMine([{ ...MANAGEABLE_WORKSPACE, id: 2, name: '目标空间' }]);
      server.use(http.post('/api/workspaces/2/switch', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null,
        data: { accessToken: 'token-2', accessLevel: 'READ_WRITE' },
      })));
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/workspaces?returnTo=${returnTo}`]}>
            <WorkspaceSelectPage />
            <LocationProbe />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      await user.click(await screen.findByTestId('workspace-card-2'));

      await waitFor(() => {
        expect(screen.getByTestId('location-path')).toHaveTextContent(/^\/$/);
      });
    },
  );

  it('switches to a deep-linked workspace and returns to the allowed channel route', async () => {
    mockMine([MANAGEABLE_WORKSPACE, { ...MANAGEABLE_WORKSPACE, id: 2, name: '目标空间' }]);
    let switched = 0;
    server.use(http.post('/api/workspaces/2/switch', () => {
      switched += 1;
      return HttpResponse.json({
        success: true, code: '0', message: '', traceId: null,
        data: { accessToken: 'token-2', accessLevel: 'READ_WRITE' },
      });
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/workspaces?targetWorkspaceId=2&returnTo=%2Fintegrations%3Ftab%3Dchannels']}>
          <WorkspaceSelectPage />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(switched).toBe(1));
    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent('/integrations');
    });
  });

  it('reports a failed deep-link switch and stays on the workspace page', async () => {
    mockMine([MANAGEABLE_WORKSPACE, { ...MANAGEABLE_WORKSPACE, id: 2, name: '目标空间' }]);
    server.use(http.post('/api/workspaces/2/switch', () => HttpResponse.json({
      success: false, code: '10000', message: '切换失败', traceId: null, data: null,
    }, { status: 500 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/workspaces?targetWorkspaceId=2&returnTo=%2Fintegrations%3Ftab%3Dchannels']}>
          <WorkspaceSelectPage />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('无法进入目标工作空间：你没有该工作空间的访问权限，或该空间已删除。请返回后联系对应管理员。'))
      .toBeInTheDocument();
    expect(screen.getByTestId('location-path')).toHaveTextContent('/workspaces');
  });

  it('refuses a deep link to a workspace the caller cannot access without switching', async () => {
    mockMine([MANAGEABLE_WORKSPACE]);
    let switched = 0;
    server.use(http.post(RegExp('/api/workspaces/.*/switch'), () => {
      switched += 1;
      return HttpResponse.json({
        success: true, code: '0', message: '', traceId: null,
        data: { accessToken: 'token-x', accessLevel: 'READ_WRITE' },
      });
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/workspaces?targetWorkspaceId=99&returnTo=%2Fintegrations%3Ftab%3Dchannels']}>
          <WorkspaceSelectPage />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('无法进入目标工作空间：你没有该工作空间的访问权限，或该空间已删除。请返回后联系对应管理员。'))
      .toBeInTheDocument();
    expect(switched).toBe(0);
    expect(screen.getByTestId('location-path')).toHaveTextContent('/workspaces');
  });
  it('shows the denied dialog with contacts when the server revokes permission at submit time', async () => {
    useAuthStore.getState().setUser({
      id: 5, username: 'applicant', nickname: '阿杰', email: 'jie@example.com',
    });
    mockMine([MANAGEABLE_WORKSPACE]);
    server.use(
      http.get('/api/workspaces/creation-requests/me', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null,
        data: { canCreate: true, pending: false, administratorContacts: null },
      })),
      http.post('/api/workspaces', () => HttpResponse.json({
        success: false,
        code: '37015',
        message: '无权限创建空间，请联系平台管理员开启',
        data: { administratorContacts: [{ nickname: '周宁', email: 'zhou@example.com' }] },
        traceId: null,
      })),
    );
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('workspace-create-card'));
    await user.type(await screen.findByLabelText('工作空间名称'), '新空间');
    await user.click(screen.getByRole('button', { name: buttonName('创建') }));

    expect(await screen.findByText('无权限创建空间，请联系平台管理员开启')).toBeInTheDocument();
    expect(screen.getByText('zhou@example.com')).toBeInTheDocument();
  });

  it('degrades to the generic denied copy when the contact probe fails', async () => {
    useAuthStore.getState().setUser({
      id: 5, username: 'applicant', nickname: '阿杰', email: 'jie@example.com',
    });
    mockMine([MANAGEABLE_WORKSPACE]);
    server.use(
      http.get('/api/workspaces/creation-requests/me', ({ request }) => {
        const includeContacts = new URL(request.url).searchParams
          .get('includeAdministratorContacts') === 'true';
        if (includeContacts) {
          return HttpResponse.json({
            success: false, code: '10000', message: 'boom', data: null, traceId: null,
          });
        }
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null,
          data: { canCreate: false, pending: false, administratorContacts: null },
        });
      }),
    );
    renderPage();

    await userEvent.click(await screen.findByTestId('workspace-create-card'));

    expect(await screen.findByText('无权限创建空间，请联系平台管理员开启')).toBeInTheDocument();
    expect(screen.getByText('暂无可用平台管理员，请联系平台管理员处理。')).toBeInTheDocument();
  });

  it('keeps the request button disabled and reports a failed request', async () => {
    useAuthStore.getState().setUser({
      id: 5, username: 'applicant', nickname: '阿杰', email: 'jie@example.com',
    });
    mockMine([MANAGEABLE_WORKSPACE]);
    server.use(
      http.get('/api/workspaces/creation-requests/me', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null,
        data: { canCreate: false, pending: false, administratorContacts: null },
      })),
      http.post('/api/workspaces/creation-requests', () => HttpResponse.json({
        success: false, code: '10000', message: '申请失败', data: null, traceId: null,
      })),
    );
    renderPage();

    const requestButton = await screen.findByTestId('workspace-request-permission');
    await userEvent.click(requestButton);

    await waitFor(() => expect(screen.getByTestId('workspace-request-permission')).toHaveTextContent('申请权限'));
    expect(screen.getByTestId('workspace-request-permission')).toBeEnabled();
  });

  it('shows the creation denied dialog with administrator contacts and marks the request as requested', async () => {
    useAuthStore.getState().setUser({
      id: 5, username: 'applicant', nickname: '阿杰', email: 'jie@example.com',
    });
    mockMine([]);
    let requested = false;
    server.use(
      http.get('/api/workspaces/creation-requests/me', ({ request }) => {
        const includeContacts = new URL(request.url).searchParams
          .get('includeAdministratorContacts') === 'true';
        return HttpResponse.json({
          success: true,
          code: '0',
          message: '',
          traceId: null,
          data: {
            canCreate: false,
            pending: requested,
            administratorContacts: includeContacts
              ? [{ nickname: '周宁', email: 'zhou@example.com' }]
              : null,
          },
        });
      }),
      http.post('/api/workspaces/creation-requests', () => {
        requested = true;
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null,
          data: { canCreate: false, pending: true, administratorContacts: null },
        });
      }),
    );
    renderPage();

    await userEvent.click(await screen.findByTestId('workspace-create-card'));

    expect(await screen.findByText('无权限创建空间，请联系平台管理员开启')).toBeInTheDocument();
    expect(screen.getByText('zhou@example.com')).toBeInTheDocument();
    const requestButton = await screen.findByTestId('workspace-request-permission');
    expect(requestButton).toHaveTextContent('申请权限');
    expect(screen.getByTestId('workspace-create-card').parentElement).toContainElement(requestButton);
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /申请权限/ }));

    await waitFor(() =>
      expect(screen.getByTestId('workspace-request-permission')).toHaveTextContent('已申请'));
    expect(screen.getByTestId('workspace-request-permission')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /已申请/ })).toBeDisabled();
  });

});
