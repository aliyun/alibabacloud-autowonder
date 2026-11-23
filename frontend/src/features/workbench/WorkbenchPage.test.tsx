import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { message } from 'antd';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/shared/auth/store';
import type { Workitem, WorkitemDetail } from '@/shared/types/workitem';
import type { StatusNode, TemplateDetail } from '@/features/statemachine/types';
import { WorkbenchPage } from './WorkbenchPage';

const {
  listWorkitemsMock, listNotificationsMock, listAgentsMock, useMembersMock,
  getWorkitemMock, transitionWorkitemMock, getTemplateDetailMock,
} = vi.hoisted(() => ({
  listWorkitemsMock: vi.fn(),
  listNotificationsMock: vi.fn(),
  listAgentsMock: vi.fn(),
  useMembersMock: vi.fn(),
  getWorkitemMock: vi.fn(),
  transitionWorkitemMock: vi.fn(),
  getTemplateDetailMock: vi.fn(),
}));

vi.mock('@/features/workitem/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/workitem/api')>()),
  listWorkitems: listWorkitemsMock,
  getWorkitem: getWorkitemMock,
  transitionWorkitem: transitionWorkitemMock,
}));

vi.mock('@/features/statemachine/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/statemachine/api')>()),
  getTemplateDetail: getTemplateDetailMock,
}));

vi.mock('@/features/notification/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/notification/api')>()),
  listNotifications: listNotificationsMock,
}));

vi.mock('@/features/agent/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/agent/api')>()),
  listAgents: listAgentsMock,
}));

vi.mock('@/features/settings/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/settings/hooks')>()),
  useMembers: useMembersMock,
}));

function workitem(overrides: Partial<Workitem>): Workitem {
  return {
    id: 1,
    workType: 'REQ',
    title: '工单',
    contentMd: '',
    templateId: null,
    statusNodeId: 1,
    statusName: '开发中',
    sdlcId: null,
    sdlcName: null,
    assigneeType: 'HUMAN',
    assigneeRef: 7,
    assigneeName: '我',
    priority: 2,
    version: 0,
    gmtCreate: '2026-11-12T00:00:00.000Z',
    gmtModified: '2026-11-12T01:00:00.000Z',
    statusCategory: 'IN_PROGRESS',
    ...overrides,
  };
}

function page(list: Workitem[]) {
  return { list, total: list.length, pageNum: 1, pageSize: 5 };
}

function totalPage(list: Workitem[], total: number, query: { page?: number; size?: number } = {}) {
  return { list, total, pageNum: query.page ?? 1, pageSize: query.size ?? 5 };
}

type ExternalCollaboration = NonNullable<Workitem['externalCollaboration']>;

function externalWorkitem(externalWorkitemId: string, externalUrl: string | null): ExternalCollaboration {
  return {
    provider: 'Aone',
    externalProjectId: 'P1',
    externalWorkitemId,
    externalUrl,
    sourceStatusId: null,
    sourceStatusName: null,
    sourceLifecycle: 'ACTIVE',
    reporter: null,
    businessOwner: null,
    principalRelations: [],
    lastSyncAt: null,
    syncStatus: 'HEALTHY',
    lastErrorCode: null,
    lastError: null,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/workbench']}>
        <WorkbenchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="route-path">{location.pathname}</div>;
}

function renderPageWithRoutes() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/workbench']}>
        <Routes>
          <Route path="/workbench" element={<WorkbenchPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function paginationOf(container: HTMLElement): HTMLElement {
  return container.querySelector('.ant-pagination') as HTMLElement;
}

function openDropdown(): HTMLElement {
  return document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)') as HTMLElement;
}

/** 跟进筛选区最后一个下拉是「当前负责人」，避免按文案取到无障碍 live region。 */
function assigneeSelectSelector(): HTMLElement {
  const selects = document.querySelectorAll('.aw-workbench-filters .ant-select');
  const root = selects[selects.length - 1] as HTMLElement;
  return root.querySelector('.ant-select-selector') as HTMLElement;
}

/** 展开分页的页大小选择器并按位置选中选项（0=5、1=10、2=20），避免依赖语言文案。 */
async function changePageSize(container: HTMLElement, optionIndex: number) {
  await userEvent.click(within(paginationOf(container)).getByRole('combobox'));
  const options = Array.from(
    document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option'),
  );
  await userEvent.click(options[optionIndex] as HTMLElement);
}

beforeEach(() => {
  window.sessionStorage.clear();
  useAuthStore.getState().clear();
  useAuthStore.getState().setUser({ id: 7, username: 'me', nickname: '我', email: 'me@example.com' });
  useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'W', description: '' }, 'READ_WRITE');
  listWorkitemsMock.mockReset();
  listNotificationsMock.mockReset();
  listAgentsMock.mockReset();
  getWorkitemMock.mockReset();
  transitionWorkitemMock.mockReset();
  getTemplateDetailMock.mockReset();
  listAgentsMock.mockResolvedValue([{ id: 88, name: 'Agent-88' }]);
  useMembersMock.mockReset();
  useMembersMock.mockReturnValue({ data: [{ userId: 7, nickname: '我', username: 'me' }] });
  listNotificationsMock.mockResolvedValue({
    items: [{
      id: 11, type: 'COMMENT', title: '有新的评论', content: '请看下工单', link: null,
      refType: 'WORKITEM', refId: 2, status: 'UNREAD', gmtCreate: '2026-11-12T02:00:00.000Z',
      relatedLinks: null,
    }],
    total: 1,
  });
  listWorkitemsMock.mockImplementation((query: { assigneeType?: string; assigneeRef?: number }) => {
    if (query.assigneeType === 'HUMAN' && query.assigneeRef === 7) {
      return Promise.resolve(page([workitem({ id: 1, title: '待我处理事项', statusCategory: 'PENDING_DECISION' })]));
    }
    return Promise.resolve(page([workitem({
      id: 2,
      title: '跟进事项',
      assigneeType: 'AGENT',
      assigneeRef: 88,
      assigneeName: 'Agent-88',
      assigneeSquadName: '交付小队',
      roundStartedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      roundEndedAt: null,
      externalCollaboration: externalWorkitem('AONE-1', 'https://example.com/aone/1'),
    })]));
  });
});

afterEach(() => {
  cleanup();
  // antd message 挂在 body 上、不随组件卸载消失，残留文案会让后续用例重复命中。
  message.destroy();
  useAuthStore.getState().clear();
});

describe('WorkbenchPage', () => {
  it('loads the todo list with the server-side unfinished filter and updated-first order', async () => {
    renderPage();

    expect(await screen.findByText('待我处理事项')).toBeInTheDocument();
    await waitFor(() => {
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({
        assigneeType: 'HUMAN',
        assigneeRef: 7,
        statusCategories: 'NEW,IN_PROGRESS,PENDING_DECISION',
        sortBy: 'UPDATED',
        size: 5,
      }));
    });
    expect(screen.getByText('去处理')).toBeInTheDocument();
    expect(screen.getByText('等待你的决定')).toBeInTheDocument();
  });

  it('loads the following list as a de-duplicated personal union with agent details and duration', async () => {
    renderPage();

    expect(await screen.findByText('跟进事项')).toBeInTheDocument();
    await waitFor(() => {
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({
        mineScopes: 'CREATED,WATCHED,COMMENTED',
        statusCategories: 'NEW,IN_PROGRESS,PENDING_DECISION',
        sortBy: 'UPDATED',
        size: 5,
      }));
    });
    expect(screen.getByText('交付小队')).toBeInTheDocument();
    expect(screen.getByText('Aone AONE-1')).toBeInTheDocument();
    expect(screen.getByText(/分钟/)).toBeInTheDocument();
  });

  it('switches the relation tab to a single server-side scope', async () => {
    renderPage();
    await screen.findByText('跟进事项');

    await userEvent.click(screen.getByText('我发起的'));

    await waitFor(() => {
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({ mineScope: 'CREATED' }));
    });
  });

  it('renders recent collaboration activity from notifications', async () => {
    renderPage();

    expect(await screen.findByText('有新的评论')).toBeInTheDocument();
    expect(screen.getByText('查看全部通知')).toBeInTheDocument();
    expect(listNotificationsMock).toHaveBeenCalledWith({ page: 1, size: 6 });
  });

  it('applies stored relation, status, assignee and keyword filters to the server query', async () => {
    window.sessionStorage.setItem('aw.workbench.following.1.scope', JSON.stringify('CREATED'));
    window.sessionStorage.setItem('aw.workbench.following.1.status', JSON.stringify('DONE'));
    window.sessionStorage.setItem('aw.workbench.following.1.assignee', JSON.stringify('AGENT:88'));
    window.sessionStorage.setItem('aw.workbench.following.1.keyword', JSON.stringify('关键字'));
    window.sessionStorage.setItem('aw.workbench.following.1.page', JSON.stringify(3));
    window.sessionStorage.setItem('aw.workbench.following.1.size', JSON.stringify(10));

    renderPage();

    await waitFor(() => {
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({
        mineScope: 'CREATED',
        statusCategories: 'DONE',
        assigneeType: 'AGENT',
        assigneeRef: 88,
        keyword: '关键字',
        page: 3,
        size: 10,
      }));
    });
  });

  it('queries every status for a stored human assignee without status categories', async () => {
    window.sessionStorage.setItem('aw.workbench.following.1.status', JSON.stringify('ALL'));
    window.sessionStorage.setItem('aw.workbench.following.1.assignee', JSON.stringify('HUMAN:7'));

    renderPage();

    await waitFor(() => {
      const following = listWorkitemsMock.mock.calls
        .map((call) => call[0] as Record<string, unknown>)
        .find((call) => 'mineScopes' in call);
      expect(following).toMatchObject({ assigneeType: 'HUMAN', assigneeRef: 7 });
      expect(following?.statusCategories).toBeUndefined();
    });
  });

  it('retries a failed following list without failing the todo list', async () => {
    listWorkitemsMock.mockImplementation((query: { mineScopes?: string }) => (
      query.mineScopes
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(page([workitem({ id: 1, title: '待我处理事项' })]))
    ));

    renderPage();

    expect(await screen.findByText('加载失败，请重试')).toBeInTheDocument();
    const before = listWorkitemsMock.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(listWorkitemsMock.mock.calls.length).toBeGreaterThan(before));
  });

  it('renders unassigned rows and external rows without a link honestly', async () => {
    listWorkitemsMock.mockImplementation((query: { mineScopes?: string }) => (
      query.mineScopes
        ? Promise.resolve(page([
            workitem({ id: 2, title: '未指派事项', assigneeType: 'HUMAN', assigneeRef: null }),
            workitem({
              id: 3,
              title: '无链接外部事项',
              assigneeType: 'AGENT',
              assigneeRef: 99,
              assigneeName: 'Agent-99',
              assigneeSquadName: null,
              externalCollaboration: externalWorkitem('AONE-9', null),
            }),
          ]))
        : Promise.resolve(page([workitem({ id: 1, title: '待我处理事项' })]))
    ));

    renderPage();

    expect(await screen.findByText('未指派事项')).toBeInTheDocument();
    expect(screen.getByText('未指派')).toBeInTheDocument();
    expect(screen.getByText(/Aone AONE-9/)).toBeInTheDocument();
  });

  it('opens an activity item with a relative link', async () => {
    listNotificationsMock.mockResolvedValue({
      items: [{
        id: 12, type: 'SYSTEM', title: '系统通知', content: null, link: '/settings',
        refType: 'OTHER', refId: null, status: 'READ', gmtCreate: '2026-11-12T02:00:00.000Z',
        relatedLinks: null,
      }],
      total: 1,
    });

    renderPage();

    await userEvent.click(await screen.findByText('系统通知'));
    expect(screen.queryByText('有新的评论')).not.toBeInTheDocument();
  });

  it('paginates the todo list and returns to the first page when the page size changes', async () => {
    listWorkitemsMock.mockImplementation((query: { assigneeType?: string; page?: number; size?: number }) => (
      query.assigneeType === 'HUMAN'
        ? Promise.resolve(totalPage([workitem({ id: 1, title: '待我处理事项' })], 12, query))
        : Promise.resolve(page([workitem({ id: 2, title: '跟进事项' })]))
    ));

    renderPage();
    const todoCard = (await screen.findByText('待我处理事项')).closest('.ant-card') as HTMLElement;
    const pagination = paginationOf(todoCard);

    await userEvent.click(within(pagination).getByTitle('2'));
    await waitFor(() => {
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({
        assigneeType: 'HUMAN',
        page: 2,
      }));
    });

    await changePageSize(todoCard, 1);
    await waitFor(() => {
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({
        assigneeType: 'HUMAN',
        page: 1,
        size: 10,
      }));
    });
  });

  it('retries a failed todo list after the error state', async () => {
    let failTodo = true;
    listWorkitemsMock.mockImplementation((query: { assigneeType?: string }) => {
      if (query.assigneeType === 'HUMAN') {
        return failTodo
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(page([workitem({ id: 1, title: '待我处理事项' })]));
      }
      return Promise.resolve(page([workitem({ id: 2, title: '跟进事项' })]));
    });

    renderPage();

    expect(await screen.findByText('加载失败，请重试')).toBeInTheDocument();
    failTodo = false;
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByText('待我处理事项')).toBeInTheDocument();
  });

  it('shows the todo empty state when nothing is assigned', async () => {
    listWorkitemsMock.mockImplementation((query: { assigneeType?: string }) => (
      query.assigneeType === 'HUMAN'
        ? Promise.resolve(totalPage([], 0))
        : Promise.resolve(page([workitem({ id: 2, title: '跟进事项' })]))
    ));

    renderPage();

    expect(await screen.findByText('当前没有需要你处理的工单')).toBeInTheDocument();
  });

  it('searches the following list from the input and clears the keyword', async () => {
    listWorkitemsMock.mockImplementation((query: { mineScopes?: string }) => (
      query.mineScopes
        ? Promise.resolve(page([workitem({ id: 2, title: '跟进事项', assigneeType: 'AGENT', assigneeRef: 88, assigneeName: 'Agent-88' })]))
        : Promise.resolve(page([workitem({ id: 1, title: '待我处理事项' })]))
    ));

    renderPage();
    await screen.findByText('跟进事项');

    const search = screen.getByPlaceholderText('搜索标题、外部或平台工单号');
    await userEvent.type(search, '支付');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({
        keyword: '支付',
        page: 1,
      }));
    });

    await userEvent.clear(search);
    await waitFor(() => {
      const last = listWorkitemsMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(last.keyword).toBeUndefined();
    });
  });

  it('paginates the following list independently', async () => {
    listWorkitemsMock.mockImplementation((query: { mineScopes?: string; page?: number; size?: number }) => (
      query.mineScopes
        ? Promise.resolve(totalPage([workitem({ id: 2, title: '跟进事项' })], 12, query))
        : Promise.resolve(page([workitem({ id: 1, title: '待我处理事项' })]))
    ));

    renderPage();
    const followingCard = (await screen.findByText('跟进事项')).closest('.ant-card') as HTMLElement;
    const pagination = paginationOf(followingCard);

    await userEvent.click(within(pagination).getByTitle('2'));
    await waitFor(() => {
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({
        mineScopes: 'CREATED,WATCHED,COMMENTED',
        page: 2,
      }));
    });

    await changePageSize(followingCard, 1);
    await waitFor(() => {
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({
        mineScopes: 'CREATED,WATCHED,COMMENTED',
        page: 1,
        size: 10,
      }));
    });
  });

  it('builds assignee options from the member and agent directories', async () => {
    useMembersMock.mockReturnValue({ data: [{ userId: 21, nickname: '小安', username: 'an' }] });
    listAgentsMock.mockResolvedValue([{ id: 88, name: 'Agent-88' }]);

    renderPage();
    await screen.findByText('跟进事项');

    await userEvent.click(assigneeSelectSelector());
    await userEvent.click(within(openDropdown()).getByText('小安'));

    await waitFor(() => {
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({
        mineScopes: 'CREATED,WATCHED,COMMENTED',
        assigneeType: 'HUMAN',
        assigneeRef: 21,
      }));
    });

    await userEvent.click(assigneeSelectSelector());
    await userEvent.click(within(openDropdown()).getByText('Agent-88'));

    await waitFor(() => {
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({
        mineScopes: 'CREATED,WATCHED,COMMENTED',
        assigneeType: 'AGENT',
        assigneeRef: 88,
      }));
    });
  });

  it('shows the external id on todo rows', async () => {
    listWorkitemsMock.mockImplementation((query: { assigneeType?: string }) => (
      query.assigneeType === 'HUMAN'
        ? Promise.resolve(page([workitem({
            id: 1,
            title: '待我处理事项',
            externalCollaboration: externalWorkitem('AONE-T1', null),
          })]))
        : Promise.resolve(page([workitem({ id: 2, title: '跟进事项' })]))
    ));

    renderPage();

    expect(await screen.findByText(/Aone AONE-T1/)).toBeInTheDocument();
  });

  it('falls back to the assignee id when a human name is missing', async () => {
    listWorkitemsMock.mockImplementation((query: { mineScopes?: string }) => (
      query.mineScopes
        ? Promise.resolve(page([workitem({
            id: 2,
            title: '无姓名事项',
            assigneeType: 'HUMAN',
            assigneeRef: 55,
            assigneeName: null,
            assigneeDisplayName: null,
          })]))
        : Promise.resolve(page([workitem({ id: 1, title: '待我处理事项' })]))
    ));

    renderPage();

    expect(await screen.findByText('#55')).toBeInTheDocument();
  });

  it('navigates to the referenced workitem from collaboration activity', async () => {
    listNotificationsMock.mockResolvedValue({
      items: [{
        id: 13, type: 'COMMENT', title: '工单动态', content: null, link: null,
        refType: 'WORKITEM', refId: 42, status: 'UNREAD', gmtCreate: '2026-11-12T02:00:00.000Z',
        relatedLinks: null,
      }],
      total: 1,
    });

    renderPageWithRoutes();

    await userEvent.click(await screen.findByText('工单动态'));
    expect(await screen.findByTestId('route-path')).toHaveTextContent('/workitems/42');
  });

  it('shows the activity empty state when there are no notifications', async () => {
    listNotificationsMock.mockResolvedValue({ items: [], total: 0 });

    renderPage();

    expect(await screen.findByText('暂无协作动态')).toBeInTheDocument();
  });
});

const TEMPLATE_ID = 10;

const statusNodes: StatusNode[] = [
  { id: 20, templateId: TEMPLATE_ID, code: 'todo', name: '待处理', systemLabelKey: null, category: 'INIT', sort: 1, gmtCreate: '' },
  { id: 21, templateId: TEMPLATE_ID, code: 'done', name: '已完成', systemLabelKey: null, category: 'DONE', sort: 3, gmtCreate: '' },
  { id: 22, templateId: TEMPLATE_ID, code: 'doing', name: '执行中', systemLabelKey: null, category: 'IN_PROGRESS', sort: 2, gmtCreate: '' },
];

function followingRow(overrides: Partial<Workitem> = {}): Workitem {
  return workitem({
    id: 2, title: '跟进事项', templateId: TEMPLATE_ID, statusNodeId: 20, statusName: '待处理', version: 3, ...overrides,
  });
}

function workitemDetail(overrides: Partial<WorkitemDetail> = {}): WorkitemDetail {
  return {
    ...workitem({ id: 2, title: '跟进事项', templateId: TEMPLATE_ID, statusNodeId: 20, statusName: '待处理', version: 3 }),
    ...overrides,
  };
}

function statusTemplate(overrides: Partial<TemplateDetail> = {}): TemplateDetail {
  return {
    id: TEMPLATE_ID,
    workType: 'REQ',
    name: '默认模板',
    systemLabelKey: null,
    isDefault: true,
    gmtCreate: '',
    gmtModified: '',
    nodes: statusNodes,
    transitions: [{ id: 1, templateId: TEMPLATE_ID, fromNodeId: 20, toNodeId: 22, name: '开始执行', systemLabelKey: null, gmtCreate: '' }],
    ...overrides,
  };
}

function mockFollowingRows(rows: Workitem[]) {
  listWorkitemsMock.mockImplementation((query: { mineScopes?: string }) => (
    query.mineScopes
      ? Promise.resolve(page(rows))
      : Promise.resolve(page([workitem({ id: 1, title: '待我处理事项' })]))
  ));
}

async function openStatusChange(title = '跟进事项'): Promise<void> {
  const row = (await screen.findByText(title)).closest('tr') as HTMLElement;
  await userEvent.click(within(row).getByRole('button', { name: '改状态' }));
}

function followingCalls(): number {
  return listWorkitemsMock.mock.calls.filter(([query]) => (query as { mineScopes?: string }).mineScopes).length;
}

/** antd Modal 关闭后保留隐藏 DOM，按可见性判断弹层是否仍打开。 */
function statusDialogOpen(): boolean {
  const wrap = document.querySelector('.ant-modal-wrap') as HTMLElement | null;
  return wrap != null && wrap.style.display !== 'none';
}

describe('WorkbenchPage inline status change', () => {
  it('changes a following work item status with template candidates and the optimistic guard', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail());
    getTemplateDetailMock.mockResolvedValue(statusTemplate());
    transitionWorkitemMock.mockResolvedValue(workitemDetail({ statusNodeId: 22, statusName: '执行中', version: 4 }));

    renderPage();
    await openStatusChange();

    expect(await screen.findByText('选择目标状态')).toBeInTheDocument();
    expect(screen.getByText('当前状态「待处理」可流转到以下状态：')).toBeInTheDocument();
    const candidates = screen.getAllByRole('button', { name: /^流转到/ });
    expect(candidates.map((button) => button.getAttribute('aria-label'))).toEqual(['流转到执行中', '流转到已完成']);
    expect(candidates[0].className).toContain('ant-btn-primary');
    expect(candidates[1].className).not.toContain('ant-btn-primary');
    expect(getWorkitemMock).toHaveBeenCalledWith(2);
    expect(getTemplateDetailMock).toHaveBeenCalledWith(TEMPLATE_ID);

    await userEvent.click(screen.getByRole('button', { name: '流转到执行中' }));

    await waitFor(() => expect(transitionWorkitemMock).toHaveBeenCalledWith(2, 22, { fromNodeId: 20, expectedVersion: 3 }));
    expect(await screen.findByText('状态已更新为「执行中」')).toBeInTheDocument();
    await waitFor(() => expect(statusDialogOpen()).toBe(false));
    // 成功后退效工作台查询，「我在跟进」重新拉取。
    await waitFor(() => expect(followingCalls()).toBeGreaterThan(1));
  });

  it('shows the server warning when the transition is outside the template recommendations', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail());
    getTemplateDetailMock.mockResolvedValue(statusTemplate());
    transitionWorkitemMock.mockResolvedValue(workitemDetail({
      statusNodeId: 21, statusName: '已完成', transitionWarning: '该流转不在模板推荐范围内',
    }));

    renderPage();
    await openStatusChange();
    await userEvent.click(await screen.findByRole('button', { name: '流转到已完成' }));

    expect(await screen.findByText('该流转不在模板推荐范围内')).toBeInTheDocument();
  });

  it('blocks the change when the list row is stale', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail({ version: 4 }));

    renderPage();
    await openStatusChange();

    expect(await screen.findByText('工单已被更新，请重试')).toBeInTheDocument();
    expect(getTemplateDetailMock).not.toHaveBeenCalled();
    expect(transitionWorkitemMock).not.toHaveBeenCalled();
    expect(statusDialogOpen()).toBe(false);
  });

  it('reports work items without a status template', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail({ templateId: null }));

    renderPage();
    await openStatusChange();

    expect(await screen.findByText('该工单未配置状态流程，无法直接改状态')).toBeInTheDocument();
    expect(getTemplateDetailMock).not.toHaveBeenCalled();
  });

  it('reports work items without a current status node', async () => {
    mockFollowingRows([followingRow({ statusNodeId: null })]);
    getWorkitemMock.mockResolvedValue(workitemDetail({ statusNodeId: null }));

    renderPage();
    await openStatusChange();

    expect(await screen.findByText('该工单未配置状态流程，无法直接改状态')).toBeInTheDocument();
    expect(getTemplateDetailMock).not.toHaveBeenCalled();
  });

  it('reports a template without other status nodes', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail());
    getTemplateDetailMock.mockResolvedValue(statusTemplate({ nodes: [statusNodes[0]], transitions: [] }));

    renderPage();
    await openStatusChange();

    expect(await screen.findByText('当前模板没有其他可流转的状态节点')).toBeInTheDocument();
    expect(transitionWorkitemMock).not.toHaveBeenCalled();
  });

  it('falls back to the placeholder when the work item has no status name', async () => {
    mockFollowingRows([followingRow({ statusName: null, statusLabelKey: null })]);
    getWorkitemMock.mockResolvedValue(workitemDetail({ statusName: null, statusLabelKey: null }));
    getTemplateDetailMock.mockResolvedValue(statusTemplate());

    renderPage();
    const row = (await screen.findByText('跟进事项')).closest('tr') as HTMLElement;
    expect(within(row).getByText('-')).toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: '改状态' }));

    expect(await screen.findByText('当前状态「」可流转到以下状态：')).toBeInTheDocument();
  });

  it('surfaces the error message when the latest state cannot be loaded', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockRejectedValue(new Error('网络不可用'));

    renderPage();
    await openStatusChange();

    expect(await screen.findByText('网络不可用')).toBeInTheDocument();
    expect(transitionWorkitemMock).not.toHaveBeenCalled();
  });

  it('falls back to a readable error when loading rejects without a message', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail());
    getTemplateDetailMock.mockRejectedValue('boom');

    renderPage();
    await openStatusChange();

    expect(await screen.findByText('读取可变更状态失败，请重试')).toBeInTheDocument();
  });

  it('closes the dialog with an error message when the transition fails', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail());
    getTemplateDetailMock.mockResolvedValue(statusTemplate());
    transitionWorkitemMock.mockRejectedValue(new Error('状态已变化'));

    renderPage();
    await openStatusChange();
    await userEvent.click(await screen.findByRole('button', { name: '流转到执行中' }));

    expect(await screen.findByText('状态已变化')).toBeInTheDocument();
    await waitFor(() => expect(statusDialogOpen()).toBe(false));
    await waitFor(() => expect(followingCalls()).toBeGreaterThan(1));
  });

  it('falls back to a readable error when the transition rejects without a message', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail());
    getTemplateDetailMock.mockResolvedValue(statusTemplate());
    transitionWorkitemMock.mockRejectedValue('boom');

    renderPage();
    await openStatusChange();
    await userEvent.click(await screen.findByRole('button', { name: '流转到执行中' }));

    expect(await screen.findByText('状态更新失败，请重试')).toBeInTheDocument();
  });

  it('closes the dialog without submitting', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail());
    getTemplateDetailMock.mockResolvedValue(statusTemplate());

    renderPage();
    await openStatusChange();
    expect(await screen.findByText('选择目标状态')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '关闭' }));

    await waitFor(() => expect(statusDialogOpen()).toBe(false));
    expect(transitionWorkitemMock).not.toHaveBeenCalled();
  });

  it('ignores repeated clicks while the latest state is loading', async () => {
    mockFollowingRows([followingRow()]);
    let resolveDetail: (value: WorkitemDetail) => void = () => {};
    getWorkitemMock.mockReturnValue(new Promise<WorkitemDetail>((resolve) => { resolveDetail = resolve; }));
    getTemplateDetailMock.mockResolvedValue(statusTemplate());

    renderPage();
    const row = (await screen.findByText('跟进事项')).closest('tr') as HTMLElement;
    const trigger = within(row).getByRole('button', { name: '改状态' });
    await userEvent.click(trigger);
    await waitFor(() => expect(getWorkitemMock).toHaveBeenCalledTimes(1));

    await userEvent.click(trigger);
    expect(getWorkitemMock).toHaveBeenCalledTimes(1);

    resolveDetail(workitemDetail());
    expect(await screen.findByText('选择目标状态')).toBeInTheDocument();
  });

  it('denies the change for read-only access without fetching', async () => {
    mockFollowingRows([followingRow()]);
    useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'W', description: '' }, 'READ_ONLY');

    renderPage();
    await openStatusChange();

    expect(await screen.findByText('当前为只读权限，流转工单状态需要读写权限')).toBeInTheDocument();
    expect(getWorkitemMock).not.toHaveBeenCalled();
  });
});
