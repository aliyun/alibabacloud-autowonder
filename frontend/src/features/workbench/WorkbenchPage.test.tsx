import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { message } from 'antd';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/shared/auth/store';
import { ApiError } from '@/shared/types/common';
import type { Workitem, WorkitemDetail } from '@/shared/types/workitem';
import type { Agent } from '@/features/agent/api';
import type { ScheduledTask, ScheduledTaskRun } from '@/features/scheduledTask/types';
import type { StatusNode, TemplateDetail } from '@/features/statemachine/types';
import { WorkbenchPage } from './WorkbenchPage';

const {
  listWorkitemsMock, listNotificationsMock, getUnreadNotificationCountMock,
  listAgentsMock, listPendingReviewsMock, getPendingReviewCountMock, useMembersMock,
  getScheduledTaskSummaryMock, listScheduledTasksMock, listScheduledTaskRunsMock,
  getRunningWorkitemsMock, getWorkitemMock, transitionWorkitemMock, getTemplateDetailMock,
} = vi.hoisted(() => ({
  listWorkitemsMock: vi.fn(),
  listNotificationsMock: vi.fn(),
  getUnreadNotificationCountMock: vi.fn(),
  listAgentsMock: vi.fn(),
  listPendingReviewsMock: vi.fn(),
  getPendingReviewCountMock: vi.fn(),
  useMembersMock: vi.fn(),
  getScheduledTaskSummaryMock: vi.fn(),
  listScheduledTasksMock: vi.fn(),
  listScheduledTaskRunsMock: vi.fn(),
  getRunningWorkitemsMock: vi.fn(),
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
  getUnreadNotificationCount: getUnreadNotificationCountMock,
}));

vi.mock('@/features/agent/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/agent/api')>()),
  listAgents: listAgentsMock,
  listPendingReviews: listPendingReviewsMock,
  getPendingReviewCount: getPendingReviewCountMock,
}));

vi.mock('@/features/settings/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/settings/hooks')>()),
  useMembers: useMembersMock,
}));

vi.mock('@/features/scheduledTask/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/scheduledTask/api')>()),
  getScheduledTaskSummary: getScheduledTaskSummaryMock,
  listScheduledTasks: listScheduledTasksMock,
  listScheduledTaskRuns: listScheduledTaskRunsMock,
}));

vi.mock('@/features/insights/realtime/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/insights/realtime/api')>()),
  getRunningWorkitems: getRunningWorkitemsMock,
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

function pendingAgent(overrides: Partial<Agent>): Agent {
  return {
    id: 9,
    name: '代码小云',
    avatarUrl: null,
    status: 'PENDING_REVIEW',
    onlineVersionId: null,
    editingVersionId: null,
    latestVersionNo: 3,
    version: 0,
    gmtCreate: '2026-11-12T00:30:00.000Z',
    ...overrides,
  } as Agent;
}

function scheduledTask(overrides: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 5,
    name: '每日对账巡检',
    instructionMd: '',
    squadId: 1,
    initialAgentId: 88,
    scheduleType: 'CRON',
    runAt: null,
    cronExpression: '0 0 * * *',
    timezone: 'Asia/Shanghai',
    sessionMode: 'NEW',
    overlapPolicy: 'SKIP',
    misfirePolicy: 'FIRE_ONCE',
    startDeadlineSeconds: null,
    affinityTimeoutSeconds: null,
    status: 'ACTIVE',
    nextFireAt: null,
    lastFireAt: '2026-11-12T01:00:00.000Z',
    gmtCreate: '2026-11-01T00:00:00.000Z',
    gmtModified: '2026-11-12T01:00:00.000Z',
    creatorId: 7,
    modifierId: 7,
    version: 0,
    ...overrides,
  } as ScheduledTask;
}

function scheduledRun(overrides: Partial<ScheduledTaskRun>): ScheduledTaskRun {
  return {
    id: 51,
    scheduledTaskId: 5,
    status: 'FAILED',
    triggerType: 'SCHEDULED',
    triggerKey: 'k',
    scheduledAt: '2026-11-12T01:00:00.000Z',
    startedAt: '2026-11-12T01:00:00.000Z',
    finishedAt: '2026-11-12T01:30:00.000Z',
    currentAgentId: null,
    currentStepId: null,
    failureReason: null,
    version: 0,
    ...overrides,
  } as ScheduledTaskRun;
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
  return <div data-testid="route-path">{location.pathname}{location.search}</div>;
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

function queueCard(container: HTMLElement): HTMLElement {
  return container.querySelector('#aw-workbench-queue') as HTMLElement;
}

function followingCard(container: HTMLElement): HTMLElement {
  return container.querySelector('#aw-workbench-following') as HTMLElement;
}

function paginationOf(container: HTMLElement): HTMLElement {
  return container.querySelector('.ant-pagination') as HTMLElement;
}

function openDropdown(): HTMLElement {
  return document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)') as HTMLElement;
}

/** 跟进筛选区最后一个下拉是「当前负责人」，避免按文案取到无障碍 live region。 */
function assigneeSelectSelector(): HTMLElement {
  const selects = document.querySelectorAll('.aw-wb-bar .ant-select');
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

/** 默认列表路由：跟进（mineScopes/mineScope）→ 决策桶 → 指派桶。 */
function defaultListWorkitems(query: {
  mineScopes?: string; mineScope?: string; assigneeType?: string; assigneeRef?: number; statusCategories?: string;
}) {
  if (query.mineScopes || query.mineScope) {
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
  }
  if (query.assigneeType === 'HUMAN' && query.assigneeRef === 7 && query.statusCategories === 'PENDING_DECISION') {
    return Promise.resolve(page([workitem({ id: 1, title: '待我处理事项', statusCategory: 'PENDING_DECISION' })]));
  }
  return Promise.resolve(page([]));
}

beforeEach(() => {
  window.sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  useAuthStore.getState().clear();
  useAuthStore.getState().setUser({ id: 7, username: 'me', nickname: '我', email: 'me@example.com' });
  useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'W', description: '' }, 'READ_WRITE');
  listWorkitemsMock.mockReset();
  listNotificationsMock.mockReset();
  getUnreadNotificationCountMock.mockReset();
  listAgentsMock.mockReset();
  listPendingReviewsMock.mockReset();
  getPendingReviewCountMock.mockReset();
  getScheduledTaskSummaryMock.mockReset();
  listScheduledTasksMock.mockReset();
  listScheduledTaskRunsMock.mockReset();
  getRunningWorkitemsMock.mockReset();
  getWorkitemMock.mockReset();
  transitionWorkitemMock.mockReset();
  getTemplateDetailMock.mockReset();
  useMembersMock.mockReset();
  listAgentsMock.mockResolvedValue([{ id: 88, name: 'Agent-88' }]);
  listPendingReviewsMock.mockResolvedValue([]);
  getPendingReviewCountMock.mockResolvedValue(0);
  getScheduledTaskSummaryMock.mockResolvedValue({ running: 0, today: 0, success30d: 0, completed30d: 0, attention: 0 });
  listScheduledTasksMock.mockResolvedValue({ list: [], total: 0, offset: 0, size: 50 });
  listScheduledTaskRunsMock.mockResolvedValue([]);
  getRunningWorkitemsMock.mockResolvedValue([]);
  getUnreadNotificationCountMock.mockResolvedValue(0);
  useMembersMock.mockReturnValue({ data: [{ userId: 7, nickname: '我', username: 'me' }] });
  listNotificationsMock.mockResolvedValue({
    items: [{
      id: 11, type: 'COMMENT', title: '有新的评论', content: '请看下工单', link: null,
      refType: 'WORKITEM', refId: 2, status: 'UNREAD', gmtCreate: '2026-11-12T02:00:00.000Z',
      relatedLinks: null,
    }],
    total: 1,
  });
  listWorkitemsMock.mockImplementation(defaultListWorkitems);
});

afterEach(() => {
  cleanup();
  // antd message 挂在 body 上、不随组件卸载消失，残留文案会让后续用例重复命中。
  message.destroy();
  useAuthStore.getState().clear();
});

describe('WorkbenchPage', () => {
  it('loads the decision queue with the server-side pending-decision filter and updated-first order', async () => {
    renderPage();

    expect(await screen.findByText('待我处理事项')).toBeInTheDocument();
    await waitFor(() => {
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({
        assigneeType: 'HUMAN',
        assigneeRef: 7,
        statusCategories: 'PENDING_DECISION',
        sortBy: 'UPDATED',
        size: 50,
      }));
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({
        assigneeType: 'HUMAN',
        assigneeRef: 7,
        statusCategories: 'NEW,IN_PROGRESS',
        sortBy: 'UPDATED',
        size: 50,
      }));
    });
    expect(screen.getByText('去决策')).toBeInTheDocument();
    expect(screen.getByText('数字员工等待你的决定')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('merges assigned workitems into the queue with their own kind and action', async () => {
    listWorkitemsMock.mockImplementation((query: { mineScopes?: string; mineScope?: string; statusCategories?: string }) => {
      if (query.mineScopes || query.mineScope) return Promise.resolve(page([workitem({ id: 2, title: '跟进事项' })]));
      if (query.statusCategories === 'NEW,IN_PROGRESS') {
        return Promise.resolve(page([workitem({ id: 3, title: '指派事项', statusCategory: 'IN_PROGRESS' })]));
      }
      return Promise.resolve(page([]));
    });

    renderPage();

    expect(await screen.findByText('指派事项')).toBeInTheDocument();
    expect(screen.getByText('去处理')).toBeInTheDocument();
    expect(screen.getByText('当前负责人是本人')).toBeInTheDocument();
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
    expect(screen.getByText('Agent-88')).toBeInTheDocument();
    expect(screen.getByText('Aone AONE-1')).toBeInTheDocument();
    expect(screen.getByText(/分钟/)).toBeInTheDocument();
  });

  it('switches the relation tab to a single server-side scope', async () => {
    renderPage();
    await screen.findByText('跟进事项');

    await userEvent.click(screen.getByText('我创建的'));

    await waitFor(() => {
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({ mineScope: 'CREATED' }));
    });
  });

  it('renders recent activity from notifications with an all-notifications entry', async () => {
    renderPage();

    expect(await screen.findByText('有新的评论')).toBeInTheDocument();
    expect(screen.getByText('全部通知')).toBeInTheDocument();
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
        .find((call) => 'mineScopes' in call || 'mineScope' in call);
      expect(following).toMatchObject({ assigneeType: 'HUMAN', assigneeRef: 7 });
      expect(following?.statusCategories).toBeUndefined();
    });
  });

  it('retries a failed following list without failing the action queue', async () => {
    listWorkitemsMock.mockImplementation((query: { mineScopes?: string; mineScope?: string }) => (
      query.mineScopes || query.mineScope
        ? Promise.reject(new Error('boom'))
        : defaultListWorkitems(query)
    ));

    renderPage();

    expect(await screen.findByText('加载失败，请重试')).toBeInTheDocument();
    expect(screen.getByText('待我处理事项')).toBeInTheDocument();
    const before = listWorkitemsMock.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(listWorkitemsMock.mock.calls.length).toBeGreaterThan(before));
  });

  it('renders unassigned rows and external rows without a link honestly', async () => {
    listWorkitemsMock.mockImplementation((query: { mineScopes?: string; mineScope?: string }) => (
      query.mineScopes || query.mineScope
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
        : defaultListWorkitems(query)
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

  it('paginates the merged queue client-side at eight rows per page', async () => {
    const decisionRows = Array.from({ length: 10 }, (_, index) => workitem({
      id: 101 + index,
      title: `决策事项${index + 1}`,
      statusCategory: 'PENDING_DECISION',
      gmtModified: new Date(Date.now() - index * 60_000).toISOString(),
    }));
    listWorkitemsMock.mockImplementation((query: { mineScopes?: string; mineScope?: string; statusCategories?: string }) => {
      if (query.mineScopes || query.mineScope) return Promise.resolve(page([workitem({ id: 2, title: '跟进事项' })]));
      if (query.statusCategories === 'PENDING_DECISION') return Promise.resolve(totalPage(decisionRows, 10));
      return Promise.resolve(page([]));
    });

    const { container } = renderPage();
    const card = queueCard(container);
    await within(card).findByText('决策事项1');
    expect(within(card).getAllByText(/决策事项/)).toHaveLength(8);
    expect(within(card).getByText('共 10 条')).toBeInTheDocument();

    const callsBefore = listWorkitemsMock.mock.calls.length;
    await userEvent.click(within(paginationOf(card)).getByTitle('2'));
    expect(within(card).getAllByText(/决策事项/)).toHaveLength(2);
    expect(within(card).getByText('决策事项9')).toBeInTheDocument();
    // 客户端分页不触发新的服务端请求。
    expect(listWorkitemsMock.mock.calls.length).toBe(callsBefore);
  });

  it('retries a failed queue after the error state', async () => {
    let failQueue = true;
    listWorkitemsMock.mockImplementation((query: { mineScopes?: string; mineScope?: string; statusCategories?: string }) => {
      if (query.mineScopes || query.mineScope) return Promise.resolve(page([workitem({ id: 2, title: '跟进事项' })]));
      if (query.statusCategories === 'PENDING_DECISION') {
        return failQueue
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(page([workitem({ id: 1, title: '待我处理事项', statusCategory: 'PENDING_DECISION' })]));
      }
      return Promise.resolve(page([]));
    });

    renderPage();

    expect(await screen.findByText('加载失败，请重试')).toBeInTheDocument();
    failQueue = false;
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByText('待我处理事项')).toBeInTheDocument();
  });

  it('shows the queue empty state with a shortcut to the following card', async () => {
    listWorkitemsMock.mockImplementation((query: { mineScopes?: string; mineScope?: string }) => {
      if (query.mineScopes || query.mineScope) return Promise.resolve(page([workitem({ id: 2, title: '跟进事项' })]));
      return Promise.resolve(page([]));
    });
    const { container } = renderPage();

    expect(await within(queueCard(container)).findByText('今天没有需要你处理的事')).toBeInTheDocument();
    expect(within(queueCard(container)).getByText('全部')).toBeInTheDocument();
    await userEvent.click(within(queueCard(container)).getByRole('button', { name: '查看我在跟进' }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('searches the following list from the input and clears the keyword', async () => {
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
    listWorkitemsMock.mockImplementation((query: { mineScopes?: string; mineScope?: string; page?: number; size?: number }) => (
      query.mineScopes || query.mineScope
        ? Promise.resolve(totalPage([workitem({ id: 2, title: '跟进事项' })], 12, query))
        : defaultListWorkitems(query)
    ));

    const { container } = renderPage();
    const card = followingCard(container);
    await within(card).findByText('跟进事项');
    const pagination = paginationOf(card);

    await userEvent.click(within(pagination).getByTitle('2'));
    await waitFor(() => {
      expect(listWorkitemsMock).toHaveBeenCalledWith(expect.objectContaining({
        mineScopes: 'CREATED,WATCHED,COMMENTED',
        page: 2,
      }));
    });

    await changePageSize(card, 1);
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

  it('falls back to the assignee id when a human name is missing', async () => {
    listWorkitemsMock.mockImplementation((query: { mineScopes?: string; mineScope?: string }) => (
      query.mineScopes || query.mineScope
        ? Promise.resolve(page([workitem({
            id: 2,
            title: '无姓名事项',
            assigneeType: 'HUMAN',
            assigneeRef: 55,
            assigneeName: null,
            assigneeDisplayName: null,
          })]))
        : defaultListWorkitems(query)
    ));

    renderPage();

    expect(await screen.findByText('#55')).toBeInTheDocument();
  });

  it('navigates to the referenced workitem from recent activity', async () => {
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

    expect(await screen.findByText('暂无最近动态')).toBeInTheDocument();
  });

  it('renders the review bucket and jumps to the agent review tab when permitted', async () => {
    getPendingReviewCountMock.mockResolvedValue(1);
    listPendingReviewsMock.mockResolvedValue([pendingAgent({})]);

    renderPageWithRoutes();

    expect(await screen.findByText('数字员工「代码小云」v3 版本待审核')).toBeInTheDocument();
    expect(screen.getByText('版本变更等待评审')).toBeInTheDocument();
    await userEvent.click(screen.getByText('去审核'));
    expect(await screen.findByTestId('route-path')).toHaveTextContent('/agents?tab=reviews');
  });

  it('hides the review bucket without read-write access and never queries it', async () => {
    useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'W', description: '' }, 'READ_ONLY');

    renderPage();
    await screen.findByText('待我处理事项');

    expect(getPendingReviewCountMock).not.toHaveBeenCalled();
    expect(listPendingReviewsMock).not.toHaveBeenCalled();
    expect(screen.queryByText('待审核')).not.toBeInTheDocument();
  });

  it('hides the review bucket silently when the count query fails', async () => {
    getPendingReviewCountMock.mockRejectedValue(new Error('403'));
    listPendingReviewsMock.mockResolvedValue([pendingAgent({})]);

    renderPage();
    await screen.findByText('待我处理事项');

    expect(screen.queryByText('待审核')).not.toBeInTheDocument();
    expect(screen.queryByText('数字员工「代码小云」v3 版本待审核')).not.toBeInTheDocument();
    expect(screen.queryByText('加载失败，请重试')).not.toBeInTheDocument();
  });

  it('aggregates scheduled-task attention rows by the backend run-status condition', async () => {
    getScheduledTaskSummaryMock.mockResolvedValue({ running: 0, today: 0, success30d: 0, completed30d: 0, attention: 1 });
    listScheduledTasksMock.mockResolvedValue({
      list: [scheduledTask({ id: 5 }), scheduledTask({ id: 6, name: '正常任务' })],
      total: 2, offset: 0, size: 50,
    });
    listScheduledTaskRunsMock.mockImplementation((id: number) => Promise.resolve([
      id === 5 ? scheduledRun({ status: 'FAILED' }) : scheduledRun({ id: 61, scheduledTaskId: 6, status: 'SUCCEEDED' }),
    ]));

    renderPageWithRoutes();

    expect(await screen.findByText('定时任务「每日对账巡检」需要关注')).toBeInTheDocument();
    expect(screen.queryByText('定时任务「正常任务」需要关注')).not.toBeInTheDocument();
    expect(screen.getByText('需要关注最近一次运行')).toBeInTheDocument();
    expect(listScheduledTasksMock).toHaveBeenCalledWith({ size: 50, offset: 0 });
    expect(listScheduledTaskRunsMock).toHaveBeenCalledWith(5, 1, 0);
    await userEvent.click(screen.getByText('去查看'));
    expect(await screen.findByTestId('route-path')).toHaveTextContent('/scheduled-tasks/5');
  });

  it('takes filter counts from server totals and filters only the visible list', async () => {
    listWorkitemsMock.mockImplementation((query: { mineScopes?: string; mineScope?: string; statusCategories?: string }) => {
      if (query.mineScopes || query.mineScope) return Promise.resolve(page([workitem({ id: 2, title: '跟进事项' })]));
      if (query.statusCategories === 'PENDING_DECISION') {
        return Promise.resolve(totalPage([workitem({ id: 1, title: '待我处理事项', statusCategory: 'PENDING_DECISION' })], 3));
      }
      if (query.statusCategories === 'NEW,IN_PROGRESS') {
        return Promise.resolve(totalPage([workitem({ id: 3, title: '指派事项' })], 2));
      }
      return Promise.resolve(page([]));
    });

    const { container } = renderPage();
    const card = queueCard(container);
    await within(card).findByText('指派事项');

    // 概览与卡头计数来自服务端 total（3+2），不是当前分页行数。
    expect(card.querySelector('.aw-wb-cnt')?.textContent).toBe('5');
    const qbar = card.querySelector('.aw-wb-qbar') as HTMLElement;
    expect(within(qbar).getByText('3')).toBeInTheDocument();
    expect(within(qbar).getByText('2')).toBeInTheDocument();

    await userEvent.click(within(qbar).getByText('待决策'));
    expect(within(card).getByText('待我处理事项')).toBeInTheDocument();
    expect(within(card).queryByText('指派事项')).not.toBeInTheDocument();
    expect(within(card).getByText('共 3 条')).toBeInTheDocument();
    // 过滤不改概览：指派徽标仍为 2。
    expect(within(qbar).getByText('2')).toBeInTheDocument();
  });

  it('renders running deliveries with agent, step and elapsed time', async () => {
    getRunningWorkitemsMock.mockResolvedValue([
      { workitemId: 2, title: '跟进事项', agentName: '代码小云', stepName: '编码', runningMinutes: 24, runningDispatchCount: 1 },
      { workitemId: 3, title: '长时任务', agentName: '测试小满', stepName: '回归测试', runningMinutes: 72, runningDispatchCount: 1 },
    ]);

    renderPageWithRoutes();

    expect(await screen.findByText('运行中的交付')).toBeInTheDocument();
    expect(screen.getByText('已运行 24 分钟')).toBeInTheDocument();
    expect(screen.getByText('已运行 1 小时 12 分')).toBeInTheDocument();
    expect(screen.getByText('编码')).toBeInTheDocument();
    expect(screen.getByText('执行记录')).toBeInTheDocument();

    await userEvent.click(screen.getByText('长时任务'));
    expect(await screen.findByTestId('route-path')).toHaveTextContent('/workitems/3');
  });

  it('shows the unread notification count in the overview badges', async () => {
    getUnreadNotificationCountMock.mockResolvedValue(6);

    renderPage();

    expect(await screen.findByText('未读通知')).toBeInTheDocument();
    const badge = screen.getByText('未读通知').closest('.aw-wb-kpi') as HTMLElement;
    expect(within(badge).getByText('6')).toBeInTheDocument();
  });

  it('refreshes all workbench queries from the overview refresh button', async () => {
    renderPage();
    await screen.findByText('待我处理事项');
    await waitFor(() => expect(getRunningWorkitemsMock).toHaveBeenCalled());

    const before = listWorkitemsMock.mock.calls.length;
    const runningBefore = getRunningWorkitemsMock.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /刷\s*新/ }));
    await waitFor(() => {
      expect(listWorkitemsMock.mock.calls.length).toBeGreaterThan(before);
      expect(getRunningWorkitemsMock.mock.calls.length).toBeGreaterThan(runningBefore);
    });
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
  it('opens the grouped dialog and commits the selected status with the optimistic guard', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail());
    getTemplateDetailMock.mockResolvedValue(statusTemplate());
    transitionWorkitemMock.mockResolvedValue(workitemDetail({ statusNodeId: 22, statusName: '执行中', version: 4 }));

    renderPage();
    await openStatusChange();

    expect(await screen.findByText('选择目标状态')).toBeInTheDocument();
    expect(screen.getByText('推荐流转')).toBeInTheDocument();
    expect(screen.getByText('其他状态')).toBeInTheDocument();
    expect(screen.getByText('流转「开始执行」')).toBeInTheDocument();
    expect(screen.getByText('不在模板推荐范围')).toBeInTheDocument();
    const dialog = document.querySelector('.aw-wb-transition') as HTMLElement;
    const radios = within(dialog).getAllByRole('radio');
    expect(radios.map(radio => radio.getAttribute('aria-label'))).toEqual(['执行中', '已完成']);
    expect(radios.every(radio => radio.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(getWorkitemMock).toHaveBeenCalledWith(2);
    expect(getTemplateDetailMock).toHaveBeenCalledWith(TEMPLATE_ID);

    await userEvent.click(screen.getByRole('radio', { name: '执行中' }));
    expect(screen.getByRole('radio', { name: '执行中' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('button', { name: '确认流转' }));

    await waitFor(() => expect(transitionWorkitemMock).toHaveBeenCalledWith(
      2, 22, expect.objectContaining({ fromNodeId: 20, expectedVersion: 3 }),
    ));
    expect(await screen.findByText('状态已更新为「执行中」')).toBeInTheDocument();
    await waitFor(() => expect(statusDialogOpen()).toBe(false));
    /* 成功后退效工作台查询，「我在跟进」重新拉取。 */
    await waitFor(() => expect(followingCalls()).toBeGreaterThan(1));
  });

  it('keeps the confirm action disabled until a target status is selected', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail());
    getTemplateDetailMock.mockResolvedValue(statusTemplate());

    renderPage();
    await openStatusChange();

    expect(await screen.findByRole('button', { name: '确认流转' })).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: '已完成' }));
    expect(screen.getByRole('button', { name: '确认流转' })).toBeEnabled();
    expect(transitionWorkitemMock).not.toHaveBeenCalled();
  });

  it('passes the optional reason to the transition', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail());
    getTemplateDetailMock.mockResolvedValue(statusTemplate());
    transitionWorkitemMock.mockResolvedValue(workitemDetail({ statusNodeId: 22, statusName: '执行中', version: 4 }));

    renderPage();
    await openStatusChange();
    await userEvent.click(await screen.findByRole('radio', { name: '执行中' }));
    await userEvent.type(screen.getByRole('textbox', { name: '流转备注（选填）' }), '客户确认方案');
    await userEvent.click(screen.getByRole('button', { name: '确认流转' }));

    await waitFor(() => expect(transitionWorkitemMock).toHaveBeenCalledWith(
      2, 22, expect.objectContaining({ fromNodeId: 20, expectedVersion: 3, reason: '客户确认方案' }),
    ));
  });

  it('confirms a target outside the template recommendations and shows the server warning', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail());
    getTemplateDetailMock.mockResolvedValue(statusTemplate());
    transitionWorkitemMock.mockResolvedValue(workitemDetail({
      statusNodeId: 21, statusName: '已完成', transitionWarning: '该流转不在模板推荐范围内',
    }));

    renderPage();
    await openStatusChange();
    await userEvent.click(await screen.findByRole('radio', { name: '已完成' }));
    await userEvent.click(screen.getByRole('button', { name: '确认流转' }));

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

    expect(await screen.findByText('选择目标状态')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '执行中' })).toBeInTheDocument();
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

  it('keeps the dialog open with an error when the transition fails', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail());
    getTemplateDetailMock.mockResolvedValue(statusTemplate());
    transitionWorkitemMock.mockRejectedValue(new Error('状态已变化'));

    renderPage();
    await openStatusChange();
    await userEvent.click(await screen.findByRole('radio', { name: '执行中' }));
    await userEvent.click(screen.getByRole('button', { name: '确认流转' }));

    expect(await screen.findByText('状态已变化')).toBeInTheDocument();
    expect(statusDialogOpen()).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: /^取\s*消$/ }));
    await waitFor(() => expect(statusDialogOpen()).toBe(false));
  });

  it('falls back to a readable error when the transition rejects without a message', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail());
    getTemplateDetailMock.mockResolvedValue(statusTemplate());
    transitionWorkitemMock.mockRejectedValue('boom');

    renderPage();
    await openStatusChange();
    await userEvent.click(await screen.findByRole('radio', { name: '执行中' }));
    await userEvent.click(screen.getByRole('button', { name: '确认流转' }));

    expect(await screen.findByText('状态更新失败，请重试')).toBeInTheDocument();
    expect(statusDialogOpen()).toBe(true);
  });

  it('offers a reload action when the transition hits a version conflict', async () => {
    mockFollowingRows([followingRow()]);
    getWorkitemMock.mockResolvedValue(workitemDetail());
    getTemplateDetailMock.mockResolvedValue(statusTemplate());
    transitionWorkitemMock.mockRejectedValue(new ApiError('13005', '工单已被修改,请重试', null));

    renderPage();
    await openStatusChange();
    await userEvent.click(await screen.findByRole('radio', { name: '执行中' }));
    await userEvent.click(screen.getByRole('button', { name: '确认流转' }));

    expect(await screen.findByText('工单已被更新，请重试')).toBeInTheDocument();
    expect(screen.getByText('加载后按最新状态重新给出可流转目标。')).toBeInTheDocument();
    expect(statusDialogOpen()).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(getWorkitemMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('选择目标状态')).toBeInTheDocument();
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
