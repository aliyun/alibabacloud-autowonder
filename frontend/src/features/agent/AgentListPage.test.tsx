import { i18n } from '@/shared/i18n';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { message } from 'antd';
import { createMemoryRouter, RouterProvider, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import { AgentListPage } from './AgentListPage';
import { AgentsHubPage } from './AgentsHubPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/agents']}>
        <Routes>
          <Route path="/agents" element={<AgentListPage />} />
          <Route path="/agents/:id" element={<div>数字员工详情路由</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AgentListPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'O', description: '' }, 'READ_WRITE');
    window.localStorage.removeItem('autowonder.agents.view');
    vi.restoreAllMocks();
  });

  it('renders compact agent cards with usage and executor status', async () => {
    server.use(
      http.get('/api/agents', () => {
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null,
          data: [{
            id: 1,
            name: 'Alpha',
            avatarUrl: null,
            status: 'ONLINE',
            onlineVersionId: null,
            editingVersionId: null,
            latestVersionNo: 2,
            version: 1,
            gmtCreate: '2026-07-01',
            roleName: '前端开发工程师',
            roleCode: 'FRONTEND_DEV',
            executorOnlineCount: 1,
            executorTotalCount: 2,
            skillCount: 3,
            memoryCount: 4,
            repoPermCount: 5,
          }],
        });
      }),
    );
    renderPage();
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getAllByText('使用中').length).toBeGreaterThan(0);
    expect(screen.getByText('前端开发工程师')).toBeInTheDocument();
    expect(screen.getByText('1/2 在线')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('技能')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('记忆')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('仓库')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('keeps create visible but does not navigate for a read-only member', async () => {
    const error = vi.spyOn(message, 'error').mockImplementation(
      () => undefined as unknown as ReturnType<typeof message.error>,
    );
    useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'O', description: '' }, 'READ_ONLY');
    server.use(
      http.get('/api/agents', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null, data: [],
      })),
    );
    // 新建按钮在数字员工 Tab 工具栏右侧（原型 06），只读态点击只报权限错误不跳转。
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents']}>
          <Routes>
            <Route path="/agents" element={<AgentsHubPage />} />
            <Route path="/agents/new" element={<div>新建数字员工路由</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('暂无数字员工');
    expect(screen.getAllByRole('button', { name: /新建/ })).toHaveLength(1);
    const create = screen.getByRole('button', { name: /新建数字员工/ });
    expect(create.closest('.aw-toolbar')).not.toBeNull();
    await userEvent.click(create);

    expect(error).toHaveBeenCalledWith('当前为只读权限，新建数字员工需要读写权限');
    expect(screen.queryByText('新建数字员工路由')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '配置说明' })).not.toBeInTheDocument();
  });

  it('shows the bound SDLC and one accessible detail link per card', async () => {
    server.use(
      http.get('/api/agents', () => {
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null,
          data: [{
            id: 1,
            name: 'Alpha',
            avatarUrl: null,
            status: 'ONLINE',
            onlineVersionId: null,
            editingVersionId: null,
            latestVersionNo: 2,
            version: 1,
            gmtCreate: '2026-07-01',
            roleName: '前端开发工程师',
            roleCode: 'FRONTEND_DEV',
            executorOnlineCount: 1,
            executorTotalCount: 2,
            skillCount: 3,
            memoryCount: 4,
            repoPermCount: 5,
          }],
        });
      }),
    );
    renderPage();
    await screen.findByText('Alpha');

    expect(document.querySelector('.agent-card-sdlc')).toHaveTextContent('未绑定');

    const detailLink = screen.getByRole('link', { name: '查看 Alpha 的详情与配置' });
    expect(detailLink).toHaveAttribute('href', '/agents/1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('navigates to agent detail page when clicking the card', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/agents', () => {
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null,
          data: [{
            id: 1,
            name: 'Alpha',
            avatarUrl: null,
            status: 'ONLINE',
            onlineVersionId: null,
            editingVersionId: null,
            latestVersionNo: 2,
            version: 1,
            gmtCreate: '2026-07-01',
            roleName: '前端开发工程师',
            roleCode: 'FRONTEND_DEV',
            executorOnlineCount: 1,
            executorTotalCount: 2,
            skillCount: 3,
            memoryCount: 4,
            repoPermCount: 5,
          }],
        });
      }),
    );
    renderPage();

    await user.click(await screen.findByRole('link', { name: '查看 Alpha 的详情与配置' }));

    expect(await screen.findByText('数字员工详情路由')).toBeInTheDocument();
  });

  it('defaults to the standard tab and requests kind=STANDARD', async () => {
    const kinds: (string | null)[] = [];
    server.use(
      http.get('/api/squads', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null,
        data: { list: [], total: 0, pageNum: 1, pageSize: 100 },
      })),
      http.get('/api/agents', ({ request }) => {
        kinds.push(new URL(request.url).searchParams.get('kind'));
        return HttpResponse.json({ success: true, code: '0', message: '', traceId: null, data: [] });
      }),
    );
    renderPage();
    expect(await screen.findByRole('radio', { name: '标准数字员工' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '系统平台智能体' })).toBeInTheDocument();
    await screen.findByText('暂无数字员工');
    expect(kinds).toContain('STANDARD');
  });

  it('switches to the platform tab, requests kind=PLATFORM and shows the platform badge', async () => {
    const user = userEvent.setup();
    const kinds: (string | null)[] = [];
    server.use(
      http.get('/api/squads', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null,
        data: { list: [], total: 0, pageNum: 1, pageSize: 100 },
      })),
      http.get('/api/agents', ({ request }) => {
        const kind = new URL(request.url).searchParams.get('kind');
        kinds.push(kind);
        const data = kind === 'PLATFORM'
          ? [{
              id: 9,
              name: 'Chief of Staff',
              avatarUrl: null,
              status: 'ONLINE',
              kind: 'PLATFORM',
              onlineVersionId: 5,
              editingVersionId: null,
              latestVersionNo: 1,
              version: 1,
              gmtCreate: '2026-09-04',
              roleName: '平台管家',
              roleCode: 'chief_of_staff',
              executorOnlineCount: 0,
              executorTotalCount: 0,
              skillCount: 0,
              memoryCount: 0,
              repoPermCount: 0,
            }]
          : [];
        return HttpResponse.json({ success: true, code: '0', message: '', traceId: null, data });
      }),
    );
    renderPage();
    await user.click(await screen.findByText('系统平台智能体'));
    expect(await screen.findByText('Chief of Staff')).toBeInTheDocument();
    expect(screen.getByText('平台')).toBeInTheDocument();
    expect(kinds).toContain('PLATFORM');
    expect(screen.queryByRole('button', { name: /新 建|新建/ })).not.toBeInTheDocument();
  });

  function useSquadsAndAgents(agents: unknown[]) {
    server.use(
      http.get('/api/squads', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null,
        data: { list: [{ id: 7, name: 'Squad A' }, { id: 8, name: 'Squad B' }], total: 2, pageNum: 1, pageSize: 100 },
      })),
      http.get('/api/agents', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null, data: agents,
      })),
    );
  }

  function agentRow(id: number, name: string, squadIds?: number[] | null, squadNames?: string[] | null) {
    return {
      id, name, status: 'ONLINE', roleName: '前端开发工程师', version: 1, latestVersionNo: 1,
      gmtCreate: '2026-07-01', squadIds, squadNames,
    };
  }

  it('tags each agent card with its squads and marks unaffiliated ones', async () => {
    window.localStorage.setItem('autowonder.agents.view', 'list');
    useSquadsAndAgents([
      agentRow(1, 'Alpha', [7, 8], ['Squad A', 'Squad B']),
      agentRow(2, 'Beta', [], []),
    ]);

    renderPage();

    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Squad A' })).toHaveAttribute('href', '/squads?squadId=7');
    expect(screen.getByRole('link', { name: 'Squad B' })).toHaveAttribute('href', '/squads?squadId=8');
    expect(screen.getByText('未分组')).toBeInTheDocument();
  });

  it('re-requests the list with the selected squad ids comma joined', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    server.use(
      http.get('/api/squads', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null,
        data: { list: [{ id: 7, name: 'Squad A' }, { id: 8, name: 'Squad B' }], total: 2, pageNum: 1, pageSize: 100 },
      })),
      http.get('/api/agents', ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null,
          data: [agentRow(1, 'Alpha', [7], ['Squad A'])],
        });
      }),
    );

    renderPage();
    expect(await screen.findByText('Alpha')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: '按小队筛选' }));
    await user.click(await screen.findByText('Squad A', { selector: '.ant-select-item-option-content' }));

    await waitFor(() => expect(seen.some((query) => query.includes('squadIds=7'))).toBe(true));
    // axios' default array form (`squadIds[]=7`) is not bindable by Spring's @RequestParam List<Long>.
    expect(seen.some((query) => query.includes('squadIds%5B%5D'))).toBe(false);
  });

  it('opens grouped by default, buckets agents by squad and keeps unaffiliated ones visible', async () => {
    useSquadsAndAgents([
      agentRow(1, 'Alpha', [7], ['Squad A']),
      agentRow(2, 'Beta', [8], ['Squad B']),
      agentRow(3, 'Gamma', null, null),
    ]);

    const { container } = renderPage();
    expect(await screen.findByText('Alpha')).toBeInTheDocument();

    await waitFor(() => expect(container.querySelectorAll('.agent-squad-group-header')).toHaveLength(3));
    const headers = [...container.querySelectorAll('.agent-squad-group-header')]
      .map((header) => header.textContent ?? '');
    expect(headers[0]).toContain('Squad A');
    expect(headers[1]).toContain('Squad B');
    expect(headers[2]).toContain('未分组');
    expect(headers[2]).toContain('1 个');
    // An agent in two squads shows up under both, so no group looks empty and none is dropped.
    expect(screen.getByText('Gamma')).toBeInTheDocument();
  });

  it('collapses and expands a squad group from its keyboard-operable header', async () => {
    const user = userEvent.setup();
    useSquadsAndAgents([agentRow(1, 'Alpha', [7], ['Squad A'])]);

    renderPage();
    await screen.findByText('Alpha');

    const toggle = screen.getByRole('button', { name: '收起分组' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'agent-group-body-squad-7');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByText('Alpha')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '展开分组' }));
    expect(await screen.findByText('Alpha')).toBeInTheDocument();

    // The header row itself is clickable too, not only the toggle button.
    await user.click(screen.getByText('1 个'));
    await waitFor(() => expect(screen.queryByText('Alpha')).not.toBeInTheDocument());
  });

  it('restores the stored flat list view and persists every toggle', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('autowonder.agents.view', 'list');
    useSquadsAndAgents([
      agentRow(1, 'Alpha', [7], ['Squad A']),
      agentRow(2, 'Beta', [8], ['Squad B']),
      agentRow(3, 'Gamma', null, null),
    ]);

    const { container } = renderPage();
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(container.querySelectorAll('.agent-squad-group-header')).toHaveLength(0);
    // 列表视图现在是表格，且不再渲染分页。
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByText('共 3 条')).not.toBeInTheDocument();

    await user.click(screen.getByText('分组'));

    await waitFor(() => expect(container.querySelectorAll('.agent-squad-group-header')).toHaveLength(3));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('autowonder.agents.view')).toBe('grouped');

    await user.click(screen.getByText('列表'));

    await waitFor(() => expect(container.querySelectorAll('.agent-squad-group-header')).toHaveLength(0));
    expect(window.localStorage.getItem('autowonder.agents.view')).toBe('list');
  });

  it('renders ID first, combined name/role, short executor text and an accessible detail icon', async () => {
    window.localStorage.setItem('autowonder.agents.view', 'list');
    useSquadsAndAgents([agentRow(1, 'Alpha', [7], ['Squad A'])]);

    renderPage();
    expect(await screen.findByText('Alpha')).toBeInTheDocument();

    const headerCells = [...screen.getAllByRole('columnheader')].map((cell) => cell.textContent ?? '');
    expect(headerCells[0]).toBe('ID');
    expect(headerCells[1]).toBe('名称 / 角色');
    expect(headerCells).not.toContain('角色');
    expect(headerCells).not.toContain('创建时间');
    expect(headerCells[headerCells.length - 1]).toBe('操作');
    expect(screen.getByText('Alpha').closest('td')).toContainElement(screen.getByText('前端开发工程师'));

    // 表格执行器列省略「执行器」前缀；卡片视图的完整文案不受影响。
    expect(screen.getByText('离线')).toBeInTheDocument();
    expect(screen.queryByText('执行器离线')).not.toBeInTheDocument();
    const detail = screen.getByRole('button', { name: '查看 Alpha 的详情与配置' });
    expect(detail.querySelector('[data-glyph="eye"]')).not.toBeNull();
    expect(detail).toHaveTextContent('');
    await userEvent.click(detail);
    expect(await screen.findByText('数字员工详情路由')).toBeInTheDocument();
  });

  it('filters the table server-side by the selected status', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('autowonder.agents.view', 'list');
    const seen: string[] = [];
    server.use(
      http.get('/api/squads', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null,
        data: { list: [], total: 0, pageNum: 1, pageSize: 100 },
      })),
      http.get('/api/agents', ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen.push(`status=${params.get('status')}`);
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null,
          data: [agentRow(1, 'Alpha', [7], ['Squad A'])],
        });
      }),
    );

    renderPage();
    expect(await screen.findByRole('table')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: '按状态筛选' }));
    await user.click(await screen.findByText('使用中', { selector: '.ant-select-item-option-content' }));

    await waitFor(() => expect(seen.some((entry) => entry === 'status=ONLINE')).toBe(true));
    // 分组视图共用同一套筛选：切到分组后状态筛选仍在，且保留已选值。
    await user.click(screen.getByText('分组'));
    expect(screen.getByRole('combobox', { name: '按状态筛选' })).toBeInTheDocument();
    expect(seen[seen.length - 1]).toBe('status=ONLINE');
  });

  it('searches name and ID across all loaded pages without adding API query parameters', async () => {
    window.localStorage.setItem('autowonder.agents.view', 'list');
    const requests: URLSearchParams[] = [];
    const agents = Array.from({ length: 101 }, (_, index) => agentRow(index + 1, `Worker ${index + 1}`));
    agents[100] = agentRow(101, 'Beyond First Page');
    server.use(http.get('/api/agents', ({ request }) => {
      const params = new URL(request.url).searchParams;
      requests.push(params);
      const page = Number(params.get('page'));
      return HttpResponse.json({ success: true, data: agents.slice((page - 1) * 100, page * 100) });
    }));
    renderPage();
    await screen.findByText('Beyond First Page');
    expect(requests.map(params => params.get('page'))).toEqual(['1', '2']);
    expect(requests.every(params => params.get('size') === '100')).toBe(true);
    const input = screen.getByRole('textbox', { name: '搜索名称或 ID' });
    fireEvent.change(input, { target: { value: '  bEyOnD  ' } });
    expect(screen.getByText('Beyond First Page')).toBeInTheDocument();
    expect(screen.queryByText('Worker 1')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '101' } });
    expect(screen.getByText('Beyond First Page')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'missing' } });
    expect(screen.getByText('没有匹配的数字员工')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText('Worker 1')).toBeInTheDocument();
    expect(requests).toHaveLength(2);
    expect(requests.every(params => !params.has('search') && !params.has('roleCode'))).toBe(true);
  });

  it('combines name search with canonical role filtering and applies the same filters to grouped cards', async () => {
    window.localStorage.setItem('autowonder.agents.view', 'list');
    useSquadsAndAgents([
      { ...agentRow(1, 'Alpha Frontend'), roleCode: 'FRONTEND_DEV' },
      { ...agentRow(2, 'Alpha Backend'), roleCode: 'BACKEND_DEV' },
      { ...agentRow(3, 'Beta Frontend'), roleCode: 'FRONTEND_DEV' },
    ]);
    renderPage();
    await screen.findByText('Alpha Frontend');
    await userEvent.type(screen.getByRole('textbox', { name: '搜索名称或 ID' }), 'Alpha');
    await userEvent.click(screen.getByRole('combobox', { name: '按角色筛选' }));
    expect(document.querySelectorAll('.ant-select-item-option-content')).toHaveLength(14);
    await userEvent.click(screen.getByText('前端开发工程师', { selector: '.ant-select-item-option-content' }));
    expect(screen.getByText('Alpha Frontend')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Backend')).not.toBeInTheDocument();
    expect(screen.queryByText('Beta Frontend')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('分组'));
    expect(screen.getByText('Alpha Frontend')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Backend')).not.toBeInTheDocument();
    expect(screen.queryByText('Beta Frontend')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '搜索名称或 ID' })).toHaveValue('Alpha');
    expect(screen.getByRole('combobox', { name: '按角色筛选' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument();
    expect(localStorage.getItem('autowonder.agents.view')).toBe('grouped');
    await userEvent.click(screen.getByText('列表'));
    expect(screen.getByRole('textbox', { name: '搜索名称或 ID' })).toHaveValue('Alpha');
    expect(screen.queryByText('Alpha Backend')).not.toBeInTheDocument();
  });

  it('offers view, edit and delete row operations, hiding delete for in-use agents', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('autowonder.agents.view', 'list');
    const deleted: string[] = [];
    useSquadsAndAgents([
      agentRow(1, 'Alpha'),
      { ...agentRow(2, 'Draft'), status: 'OFFLINE' },
      { ...agentRow(3, 'Pending'), status: 'PENDING_REVIEW' },
    ]);
    server.use(http.delete('/api/agents/:id', ({ params }) => {
      deleted.push(String(params.id));
      return HttpResponse.json({ success: true, code: '0', message: '', traceId: null, data: null });
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agents']}>
          <Routes>
            <Route path="/agents" element={<AgentListPage />} />
            <Route path="/agents/:id/edit" element={<div>编辑数字员工路由</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('共 3 个数字员工 · 1 个使用中 · 1 个待审核')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑 Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除 Alpha' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除 Pending' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除 Draft' }));
    await user.click(await screen.findByRole('button', { name: '确定删除' }));
    await waitFor(() => expect(deleted).toEqual(['2']));

    await user.click(screen.getByRole('button', { name: '编辑 Alpha' }));
    expect(await screen.findByText('编辑数字员工路由')).toBeInTheDocument();
  });

  it('filters authored custom roles by code or missing-code name without conflating them', async () => {
    window.localStorage.setItem('autowonder.agents.view', 'list');
    useSquadsAndAgents([
      { ...agentRow(1, 'Coded'), roleCode: 'CUSTOM', roleName: '<b>自定义角色</b>' },
      { ...agentRow(2, 'Uncoded'), roleCode: null, roleName: 'CUSTOM' },
      { ...agentRow(3, 'No role'), roleCode: null, roleName: null },
    ]);
    renderPage();
    await screen.findByText('Coded');
    await userEvent.click(screen.getByRole('combobox', { name: '按角色筛选' }));
    await userEvent.click(screen.getByText('<b>自定义角色</b>', { selector: '.ant-select-item-option-content' }));
    expect(screen.getByText('Coded')).toBeInTheDocument();
    expect(screen.queryByText('Uncoded')).not.toBeInTheDocument();
    expect(screen.queryByText('No role')).not.toBeInTheDocument();
    expect(screen.queryByText('自定义角色')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '按角色筛选' }).closest('.ant-select')).toHaveStyle({ width: '140px' });
    await userEvent.click(screen.getByRole('combobox', { name: '按角色筛选' }));
    await userEvent.click(screen.getByText('CUSTOM', { selector: '.ant-select-item-option-content' }));
    expect(screen.getByText('Uncoded')).toBeInTheDocument();
    expect(screen.queryByText('Coded')).not.toBeInTheDocument();
    const clear = screen.getByRole('combobox', { name: '按角色筛选' })
      .closest('.ant-select')?.querySelector('.ant-select-clear') as HTMLElement;
    await userEvent.click(clear);
    expect(screen.getByText('Coded')).toBeInTheDocument();
    expect(screen.getByText('Uncoded')).toBeInTheDocument();
    expect(screen.getByText('No role')).toBeInTheDocument();
  });

  it('refetches the current query on refresh, shows loading and retains local filters', async () => {
    window.localStorage.setItem('autowonder.agents.view', 'list');
    useSquadsAndAgents([]);
    let calls = 0;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    server.use(http.get('/api/agents', async () => {
      calls += 1;
      if (calls > 1) await pending;
      return HttpResponse.json({ success: true, data: [
        { ...agentRow(1, calls === 1 ? 'Alpha Before' : 'Alpha After'), roleCode: 'QA' },
        { ...agentRow(2, 'Beta'), roleCode: 'BACKEND_DEV' },
      ] });
    }));
    renderPage();
    await screen.findByText('Alpha Before');
    const input = screen.getByRole('textbox', { name: '搜索名称或 ID' });
    await userEvent.type(input, 'Alpha');
    await userEvent.click(screen.getByRole('combobox', { name: '按角色筛选' }));
    await userEvent.click(screen.getByText('测试工程师', { selector: '.ant-select-item-option-content' }));
    const refresh = screen.getByRole('button', { name: '刷新' });
    await userEvent.click(refresh);
    await waitFor(() => expect(calls).toBe(2));
    expect(refresh).toHaveClass('ant-btn-loading');
    expect(screen.getByText('Alpha Before')).toBeInTheDocument();
    await act(async () => { release(); });
    expect(await screen.findByText('Alpha After')).toBeInTheDocument();
    await waitFor(() => expect(refresh).not.toHaveClass('ant-btn-loading'));
    expect(input).toHaveValue('Alpha');
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('falls back to the grouped view when the stored view value is invalid', async () => {
    window.localStorage.setItem('autowonder.agents.view', 'bogus');
    useSquadsAndAgents([agentRow(1, 'Alpha', [7], ['Squad A'])]);

    const { container } = renderPage();
    expect(await screen.findByText('Alpha')).toBeInTheDocument();

    await waitFor(() => expect(container.querySelectorAll('.agent-squad-group-header')).toHaveLength(1));
    expect(container.querySelector('.agent-squad-group-header')).toHaveTextContent('Squad A');
  });
});


describe('routed squad grouping localization', () => {
  it('refreshes group fallbacks and preserves authored labels without rebuilding group identity', async () => {
    await i18n.changeLanguage('zh-CN');
    useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'O', description: '' }, 'READ_WRITE');
    localStorage.removeItem('autowonder.agents.view');
    server.use(
      http.get('/api/squads', () => HttpResponse.json({ success: true, data: [{ id: 7, name: '<b>自定义小队</b>', memberAgentIds: [] }] })),
      http.get('/api/squads/7', () => HttpResponse.json({ success: true, data: { id: 7, name: '<b>自定义小队</b>', memberAgentIds: [] } })),
      http.get('/api/agents', () => HttpResponse.json({ success: true, data: [{ id: 1, name: '<b>自定义资源</b>', status: 'ONLINE', roleCode: 'CUSTOM', roleName: '自定义角色', squadIds: [], squadNames: [] }, { id: 2, name: 'Known', status: 'ONLINE', squadIds: [7], squadNames: ['<b>自定义小队</b>'] }, { id: 3, name: 'Missing', status: 'ONLINE', squadIds: [42] }] })),
    );
    const router = createMemoryRouter([{ path: '/', element: <AgentListPage /> }]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
    await screen.findByRole('combobox', { name: '按小队筛选' });

    await screen.findAllByText('未分组');
    const groupHeader = screen.getAllByText('未分组')[0];
    await act(async () => { await i18n.changeLanguage('en-US'); });
    await screen.findAllByText('Ungrouped');
    expect(screen.getAllByText('Ungrouped')[0]).toBe(groupHeader);
    expect(screen.getAllByText('Squad #42').length).toBeGreaterThan(0);
    expect(screen.getAllByText('<b>自定义小队</b>').length).toBeGreaterThan(0);
    expect(screen.getByText('<b>自定义资源</b>')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by squad' })).toBeInTheDocument();
    await act(async () => { await i18n.changeLanguage('zh-CN'); });
  });
});

function tagOk(data: unknown) {
  return HttpResponse.json({ success: true, code: '0', message: '', traceId: null, data });
}

function tagAgent(id: number, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id, name, avatarUrl: null, status: 'ONLINE', onlineVersionId: null, editingVersionId: null,
    latestVersionNo: 1, version: 1, gmtCreate: '2026-07-01',
    roleName: '前端开发工程师', roleCode: 'FRONTEND_DEV',
    executorOnlineCount: 0, executorTotalCount: 0, skillCount: 0, memoryCount: 0, repoPermCount: 0,
    systemTags: [], customTags: [],
    ...overrides,
  };
}

describe('AgentListPage tags', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'O', description: '' }, 'READ_WRITE');
    window.localStorage.setItem('autowonder.agents.view', 'list');
    vi.restoreAllMocks();
    server.use(http.get('/api/squads', () => tagOk({ list: [], total: 0, pageNum: 1, pageSize: 100 })));
  });

  it('renders the tags column between name and status with an inline edit entry', async () => {
    server.use(http.get('/api/agents', () => tagOk([
      tagAgent(1, 'Alpha', { systemTags: ['REQ_CLARIFY'], customTags: ['报表', 'React'] }),
      tagAgent(2, 'Beta'),
    ])));

    renderPage();
    expect(await screen.findByText('Alpha')).toBeInTheDocument();

    const headers = [...screen.getAllByRole('columnheader')].map((cell) => cell.textContent ?? '');
    expect(headers[1]).toBe('名称 / 角色');
    expect(headers[2]).toBe('标签');
    expect(headers[3]).toBe('状态');

    const alphaCell = screen.getByTestId('agent-tags-cell-1');
    expect(within(alphaCell).getByText('需求澄清')).toBeInTheDocument();
    expect(within(alphaCell).getByText('报表')).toBeInTheDocument();
    expect(within(alphaCell).getByText('+1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑 Alpha 的标签' })).toBeInTheDocument();
    expect(screen.getByTestId('agent-tags-cell-2')).toHaveTextContent('—');
  });

  it('keeps read-only members without any tag edit entry', async () => {
    useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'O', description: '' }, 'READ_ONLY');
    server.use(http.get('/api/agents', () => tagOk([tagAgent(1, 'Alpha', { customTags: ['报表'] })])));

    renderPage();
    await screen.findByText('Alpha');

    expect(screen.getByText('报表')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑 Alpha 的标签' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('agent-tags-cell-1'));
    expect(screen.queryByTestId('agent-tags-editor')).not.toBeInTheDocument();
  });

  it('keeps platform agent tags read-only with a lock hint even for writers', async () => {
    server.use(http.get('/api/agents', () => tagOk([
      tagAgent(9, 'Chief', { kind: 'PLATFORM', systemTags: ['REQ_CLARIFY'] }),
    ])));

    renderPage();
    await screen.findByText('Chief');

    expect(screen.queryByRole('button', { name: '编辑 Chief 的标签' })).not.toBeInTheDocument();
    await userEvent.hover(screen.getByTestId('agent-tags-cell-9'));
    expect(await screen.findByText('平台数字人标签只读')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('agent-tags-cell-9'));
    expect(screen.queryByTestId('agent-tags-editor')).not.toBeInTheDocument();
  });

  it('saves tags from the row popover and refreshes the row', async () => {
    let tags: { systemTags: string[]; customTags: string[] } = { systemTags: [], customTags: [] };
    const puts: unknown[] = [];
    server.use(
      http.get('/api/agents', () => tagOk([tagAgent(1, 'Alpha', tags)])),
      http.get('/api/agents/tag-options', () => tagOk(['报表'])),
      http.put('/api/agents/1/tags', async ({ request }) => {
        const body = await request.json() as { systemTags: string[]; customTags: string[] };
        puts.push(body);
        tags = body;
        return tagOk(tagAgent(1, 'Alpha', tags));
      }),
    );

    renderPage();
    await screen.findByText('Alpha');
    expect(screen.getByTestId('agent-tags-cell-1')).toHaveTextContent('—');

    await userEvent.click(screen.getByRole('button', { name: '编辑 Alpha 的标签' }));
    expect(await screen.findByTestId('agent-tags-editor')).toBeInTheDocument();

    await userEvent.click(await screen.findByText('需求澄清', { selector: '.ant-select-item-option-content' }));
    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => expect(puts).toEqual([{ systemTags: ['REQ_CLARIFY'], customTags: [] }]));
    await waitFor(() => expect(screen.queryByTestId('agent-tags-editor')).not.toBeInTheDocument());
    expect(await within(screen.getByTestId('agent-tags-cell-1')).findByText('需求澄清')).toBeInTheDocument();
  });

  it('shows read-only tags on grouped cards and folds the overflow', async () => {
    window.localStorage.removeItem('autowonder.agents.view');
    server.use(http.get('/api/agents', () => tagOk([
      tagAgent(1, 'Alpha', {
        systemTags: ['REQ_CLARIFY', 'PROTOTYPE_DESIGN'], customTags: ['报表', 'React'],
      }),
      tagAgent(2, 'Beta'),
    ])));

    renderPage();
    expect(await screen.findByText('Alpha')).toBeInTheDocument();

    const cardTags = await screen.findByTestId('agent-card-tags');
    expect(within(cardTags).getByText('需求澄清')).toBeInTheDocument();
    expect(within(cardTags).getByText('原型设计')).toBeInTheDocument();
    expect(within(cardTags).getByText('报表')).toBeInTheDocument();
    expect(within(cardTags).getByText('+1')).toBeInTheDocument();
    await userEvent.hover(within(cardTags).getByText('+1'));
    expect(await screen.findByText('React')).toBeInTheDocument();
    // A worker without tags renders no tag row at all.
    expect(screen.getAllByTestId('agent-card-tags')).toHaveLength(1);
  });
});
