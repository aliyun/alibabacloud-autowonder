import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { HTMLAttributes, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import dayjs from 'dayjs';
import { server } from '@/test/mocks/server';
import { i18n } from '@/shared/i18n';
import { DeliveryOverviewPage } from './DeliveryOverviewPage';
import type { CreatedWorkitemPage, DeliveryOverview, PendingWorkitemPage } from './types';

// jsdom 的 cssstyle 会丢弃 var() 颜色值，真实 StatusTag 的 colorKey 无法从 DOM 读出；
// 这里 mock 成 data-status-color 暴露色板键选择，palette→var() 映射由 sharedIdentity.test 锁定。
vi.mock('@/shared/ui/StatusTag', async () => {
  const { forwardRef } = await import('react');
  return {
    StatusTag: forwardRef<HTMLSpanElement, { label: ReactNode; colorKey: string; dot?: boolean } & HTMLAttributes<HTMLSpanElement>>(
      function StatusTag({ label, colorKey, dot, ...rest }, ref) {
        return (
          <span ref={ref} data-status-color={colorKey} data-dot={dot ? '' : undefined} {...rest}>{label}</span>
        );
      },
    ),
  };
});

const overviewStyles = readFileSync(resolve(process.cwd(), 'src/features/overview/DeliveryOverviewPage.css'), 'utf8');

function expectTimeCell(row: HTMLElement, value: string, locale = 'zh-CN') {
  const date = new Date(value);
  const dateText = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric' }).format(date);
  const timeText = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  const dateLine = within(row).getByText(dateText);
  expect(dateLine.parentElement?.children).toHaveLength(2);
  expect(within(dateLine.parentElement!).getByText(timeText)).toBeInTheDocument();
}

function curvePoints(card: HTMLElement) {
  return card.querySelector('polyline')?.getAttribute('points')?.split(' ').map((point) => point.split(',').map(Number)) ?? [];
}

function shanghaiToday() {
  return dayjs(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()));
}

const TODAY = shanghaiToday().format('YYYY-MM-DD');
const WEEK_START = shanghaiToday().subtract(6, 'day').format('YYYY-MM-DD');
const MONTH_START = shanghaiToday().subtract(29, 'day').format('YYYY-MM-DD');

function overviewPayload(start: string, end: string): DeliveryOverview {
  const days = dayjs(end).diff(dayjs(start), 'day') + 1;
  return {
    startDate: start,
    endDate: end,
    timezone: 'Asia/Shanghai',
    dataThrough: TODAY,
    daysInRange: days,
    created: {
      count: 2,
      daily: Array.from({ length: days }, (_, index) => ({
        date: dayjs(start).add(index, 'day').format('YYYY-MM-DD'),
        count: index === 0 ? 2 : 0,
      })),
    },
    delivered: {
      count: 10,
      daily: Array.from({ length: days }, (_, index) => ({
        date: dayjs(start).add(index, 'day').format('YYYY-MM-DD'),
        count: index === 0 ? 3 : index === Math.floor(days / 2) ? 5 : index === days - 1 ? 2 : 0,
      })),
      dailyAverage: Number((10 / days).toFixed(1)),
      previous: {
        startDate: dayjs(start).subtract(days, 'day').format('YYYY-MM-DD'),
        endDate: dayjs(start).subtract(1, 'day').format('YYYY-MM-DD'),
        count: 8,
      },
      changePercent: 25,
    },
  };
}

const envelope = (data: unknown) => ({ success: true, code: '0', message: '', traceId: null, data });

const EMPTY_PENDING: PendingWorkitemPage = { list: [], total: 0, pageNum: 1, pageSize: 10 };
const EMPTY_CREATED: CreatedWorkitemPage = { list: [], total: 0, pageNum: 1, pageSize: 10 };

function overviewHandler(captured: string[], payload: (start: string, end: string) => DeliveryOverview) {
  return http.get('/api/insights/delivery-overview', ({ request }) => {
    const url = new URL(request.url);
    captured.push(url.search);
    return HttpResponse.json(envelope(payload(url.searchParams.get('start_date')!, url.searchParams.get('end_date')!)));
  });
}

function pendingHandler(captured: string[], payload: (page: number) => PendingWorkitemPage) {
  return http.get('/api/insights/delivery-overview/pending', ({ request }) => {
    const url = new URL(request.url);
    captured.push(url.search);
    return HttpResponse.json(envelope(payload(Number(url.searchParams.get('page') ?? '1'))));
  });
}

function createdHandler(captured: string[], payload: (page: number) => CreatedWorkitemPage) {
  return http.get('/api/insights/delivery-overview/created', ({ request }) => {
    const url = new URL(request.url);
    captured.push(url.search);
    return HttpResponse.json(envelope(payload(Number(url.searchParams.get('page') ?? '1'))));
  });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/overview']}>
        <Routes>
          <Route path="/overview" element={<DeliveryOverviewPage />} />
          <Route path="/workitems/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage('zh-CN');
});

describe('DeliveryOverviewPage', () => {
  it('loads the last week by default and renders stats, range labels and the pending empty state', async () => {
    const requests: string[] = [];
    const pendingRequests: string[] = [];
    const createdRequests: string[] = [];
    server.use(
      overviewHandler(requests, overviewPayload),
      pendingHandler(pendingRequests, () => EMPTY_PENDING),
      createdHandler(createdRequests, () => EMPTY_CREATED),
    );

    renderPage();

    expect(await screen.findByText('交付总览')).toBeInTheDocument();
    expect(screen.getByText('当前需要你处理的工单，以及近期任务新增与交付吞吐。')).toBeInTheDocument();
    // 数据渲染完成后再断言请求参数，确保两侧请求都已被捕获
    expect(await screen.findByText(`数据截至 ${TODAY}`)).toBeInTheDocument();
    expect(requests[0]).toContain(`start_date=${WEEK_START}`);
    expect(requests[0]).toContain(`end_date=${TODAY}`);
    expect(pendingRequests[0]).toContain('page=1');
    expect(pendingRequests[0]).toContain('size=10');

    expect(screen.getByText(`统计范围 ${WEEK_START} 至 ${TODAY}`)).toBeInTheDocument();
    expect(screen.getByText('时区 Asia/Shanghai')).toBeInTheDocument();

    const createdCard = screen.getByTestId('overview-created');
    expect(within(createdCard).getByText('新增工单')).toBeInTheDocument();
    expect(within(createdCard).getByText('2')).toBeInTheDocument();
    expect(within(createdCard).getByText('近 7 天，按日展示新增工单数。')).toBeInTheDocument();
    expect(within(createdCard).getByRole('img', { name: '近 7 天每日新增工单趋势' })).toBeInTheDocument();

    const deliveredCard = screen.getByTestId('overview-delivered');
    expect(within(deliveredCard).getByText('已完成工单')).toBeInTheDocument();
    expect(within(deliveredCard).getByText('10')).toBeInTheDocument();
    expect(within(deliveredCard).getByRole('img', { name: '近 7 天每日已完成工单趋势' })).toBeInTheDocument();
    const points = curvePoints(deliveredCard);
    expect(points).toHaveLength(7);
    [14.8, 34, 34, 2, 34, 34, 21.2].forEach((y, index) => expect(points[index][1]).toBeCloseTo(y));
    expect(points).not.toEqual(curvePoints(createdCard));
    for (const card of [createdCard, deliveredCard]) {
      expect(card.querySelector('.overview-sparkline svg')).toHaveAttribute('viewBox', '0 0 320 36');
      expect(card.querySelector('.overview-sparkline svg')).toHaveAttribute('preserveAspectRatio', 'none');
    }
    expect(deliveredCard.querySelector('polyline')).toHaveAttribute('stroke', 'var(--aw-success)');
    expect(within(deliveredCard).getByText('日均 1.4 单/天')).toBeInTheDocument();
    expect(within(deliveredCard).getByText('环比上期 +25.0%')).toBeInTheDocument();
    expect(within(deliveredCard).getByText(
      `上期 ${dayjs(WEEK_START).subtract(7, 'day').format('YYYY-MM-DD')} 至 `
      + `${dayjs(WEEK_START).subtract(1, 'day').format('YYYY-MM-DD')}：已完成 8 个`)).toBeInTheDocument();
    expect(within(deliveredCard).getByText('日均 = 区间内完成工单数 ÷ 区间天数（含首尾）。')).toBeInTheDocument();

    const pendingCard = screen.getByTestId('overview-pending');
    expect(within(pendingCard).getByText('当前用户待处理工单')).toBeInTheDocument();
    expect(pendingCard.querySelector('.overview-caption')).toBeNull();
    expect(within(pendingCard).queryByText('全部待处理')).toBeNull();
    expect(await within(pendingCard).findByText('暂无待处理工单')).toBeInTheDocument();
    // antd Table 在 total=0 时不渲染分页节点（含 showTotal），空态只断言空文案

    // 分区重排：待处理整行在前，分隔线与统计范围工具行夹在中间，统计卡与新增列表随后
    const divider = document.querySelector('.overview-section-divider')!;
    const stats = screen.getByTestId('overview-created');
    const createdListCard = screen.getByTestId('overview-created-list');
    expect(pendingCard.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stats.compareDocumentPosition(createdListCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('.overview-lists')).toBeNull();
    expect(within(createdListCard).getByText('近一周新增工单')).toBeInTheDocument();
    expect(within(createdListCard).queryByText('所选统计范围')).toBeNull();
    expect(await within(createdListCard).findByText('所选范围内暂无新增工单')).toBeInTheDocument();
    expect(createdRequests[0]).toContain(`start_date=${WEEK_START}`);
    expect(createdRequests[0]).toContain(`end_date=${TODAY}`);
    expect(createdRequests[0]).toContain('page=1');
    expect(createdRequests[0]).toContain('size=10');
  });

  it('switches to the last month range and refetches a 30-day window', async () => {
    const requests: string[] = [];
    const createdRequests: string[] = [];
    server.use(
      overviewHandler(requests, overviewPayload),
      pendingHandler([], () => EMPTY_PENDING),
      createdHandler(createdRequests, () => EMPTY_CREATED),
    );

    renderPage();
    await screen.findByText('交付总览');

    await userEvent.click(screen.getByText('近一个月'));

    await waitFor(() => expect(requests.some((search) => search.includes(`start_date=${MONTH_START}`))).toBe(true));
    expect(screen.getByText(`统计范围 ${MONTH_START} 至 ${TODAY}`)).toBeInTheDocument();
    expect(await screen.findByText('近 30 天，按日展示新增工单数。')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '近 30 天每日新增工单趋势' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '近 30 天每日已完成工单趋势' })).toBeInTheDocument();
    await waitFor(() => expect(curvePoints(screen.getByTestId('overview-delivered'))).toHaveLength(30));
    const points = curvePoints(screen.getByTestId('overview-delivered'));
    expect(points[15][1]).toBe(2);
    expect(points[29][1]).toBeCloseTo(21.2);
    // 新增工单列表跟随统计范围切换标题与取数窗口
    expect(await screen.findByText('近一个月新增工单')).toBeInTheDocument();
    await waitFor(() => expect(
      createdRequests.some((search) => search.includes(`start_date=${MONTH_START}`))).toBe(true));
  });

  it('shows the no-comparable-base label instead of a fabricated change percent', async () => {
    const base = overviewPayload(WEEK_START, TODAY);
    server.use(
      overviewHandler([], () => ({
        ...base,
        delivered: {
          ...base.delivered, count: 0, daily: base.delivered.daily.map((day) => ({ ...day, count: 0 })),
          dailyAverage: 0, previous: { ...base.delivered.previous, count: 0 }, changePercent: null,
        },
      })),
      pendingHandler([], () => EMPTY_PENDING),
      createdHandler([], () => EMPTY_CREATED),
    );

    renderPage();

    const deliveredCard = await screen.findByTestId('overview-delivered');
    expect(await within(deliveredCard).findByText('无可比基数')).toBeInTheDocument();
    expect(within(deliveredCard).queryByText(/环比上期/)).toBeNull();
    expect(within(deliveredCard).getByText(/：已完成 0 个$/)).toBeInTheDocument();
    const points = curvePoints(deliveredCard);
    expect(points).toHaveLength(7);
    expect(points.every(([, y]) => y === 34)).toBe(true);
  });

  it('does not fabricate a completion curve when the API daily sequence is empty', async () => {
    const base = overviewPayload(WEEK_START, TODAY);
    server.use(
      overviewHandler([], () => ({ ...base, delivered: { ...base.delivered, count: 0, daily: [], dailyAverage: 0 } })),
      pendingHandler([], () => EMPTY_PENDING),
      createdHandler([], () => EMPTY_CREATED),
    );

    renderPage();
    await screen.findByText(`数据截至 ${TODAY}`);
    expect(screen.getByTestId('overview-created').querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('overview-delivered').querySelector('.overview-sparkline svg')).toBeNull();
  });

  it('renders a negative change percent without a plus sign', async () => {
    const base = overviewPayload(WEEK_START, TODAY);
    server.use(
      overviewHandler([], () => ({
        ...base,
        delivered: { ...base.delivered, changePercent: -33.3 },
      })),
      pendingHandler([], () => EMPTY_PENDING),
      createdHandler([], () => EMPTY_CREATED),
    );

    renderPage();

    const deliveredCard = await screen.findByTestId('overview-delivered');
    expect(await within(deliveredCard).findByText('环比上期 -33.3%')).toBeInTheDocument();
  });

  it('lists my pending work items with decision highlight, reasons, unknown fallbacks and paging', async () => {
    const pendingRequests: string[] = [];
    const pageOne: PendingWorkitemPage = {
      list: [
        { id: 501, title: '待你决策的工单', statusName: '待评审', statusCategory: 'PENDING_DECISION', priority: 0, reason: 'AWAITING_DECISION', gmtModified: '2026-01-06T01:00:00Z' },
        { id: 502, title: '进行中的工单', statusName: null, statusCategory: 'IN_PROGRESS', priority: 2, reason: 'IN_PROGRESS', gmtModified: '2026-01-05T01:00:00Z' },
        { id: 503, title: '未知原因的工单', statusName: '处理中', statusCategory: 'NEW', priority: 9, reason: 'SOMETHING_ELSE', gmtModified: '2026-01-04T01:00:00Z' },
      ],
      total: 12, pageNum: 1, pageSize: 10,
    };
    const pageTwo: PendingWorkitemPage = {
      list: [
        { id: 601, title: '第二页工单', statusName: '待处理', statusCategory: 'NEW', priority: 1, reason: 'AWAITING_HANDLING', gmtModified: '2026-01-03T01:00:00Z' },
      ],
      total: 12, pageNum: 2, pageSize: 10,
    };
    server.use(
      overviewHandler([], overviewPayload),
      pendingHandler(pendingRequests, (page) => (page === 2 ? pageTwo : pageOne)),
      createdHandler([], () => EMPTY_CREATED),
    );

    const { container } = renderPage();

    expect(await screen.findByText('待你决策的工单')).toBeInTheDocument();
    const decisionRow = screen.getByText('待你决策的工单').closest('tr')!;
    expect(decisionRow).toHaveClass('overview-row-decision');
    expect(screen.getByText('进行中的工单').closest('tr')).not.toHaveClass('overview-row-decision');

    expect(within(decisionRow).getByText('待你决策')).toBeInTheDocument();
    expect(within(decisionRow).getByText('紧急')).toBeInTheDocument();
    expect(within(decisionRow).getByText('待评审')).toBeInTheDocument();
    expect(within(decisionRow).getByText('501')).toBeInTheDocument();
    expectTimeCell(decisionRow, '2026-01-06T01:00:00Z');

    const inProgressRow = screen.getByText('进行中的工单').closest('tr')!;
    expect(within(inProgressRow).getByText('进行中')).toBeInTheDocument();
    expect(within(inProgressRow).getByText('中')).toBeInTheDocument();
    expect(within(inProgressRow).getByText('—')).toBeInTheDocument();

    const unknownRow = screen.getByText('未知原因的工单').closest('tr')!;
    expect(within(unknownRow).getByText('待处理')).toBeInTheDocument();
    expect(within(unknownRow).getByText('未知优先级')).toBeInTheDocument();
    expect(within(unknownRow).getByText('处理中')).toBeInTheDocument();

    expect(screen.getByText('共 12 条')).toBeInTheDocument();

    const nextButton = container.querySelector('.ant-pagination-next button')!;
    await userEvent.click(nextButton);

    expect(await screen.findByText('第二页工单')).toBeInTheDocument();
    await waitFor(() => expect(pendingRequests[1]).toContain('page=2'));
    expect(pendingRequests[1]).toContain('size=10');
    expect(within(screen.getByText('第二页工单').closest('tr')!).getByText('待你处理')).toBeInTheDocument();
  });

  it('navigates to the work item detail from a row click', async () => {
    server.use(
      overviewHandler([], overviewPayload),
      pendingHandler([], () => ({
        list: [{ id: 502, title: '进行中的工单', statusName: '处理中', statusCategory: 'IN_PROGRESS', priority: 2, reason: 'IN_PROGRESS', gmtModified: '2026-01-05T01:00:00Z' }],
        total: 1, pageNum: 1, pageSize: 10,
      })),
      createdHandler([], () => EMPTY_CREATED),
    );

    renderPage();
    await userEvent.click(await screen.findByText('进行中的工单'));

    expect(await screen.findByTestId('location-probe')).toHaveTextContent('/workitems/502');
  });

  it('renders the work item id in the prototype mono style', async () => {
    server.use(
      overviewHandler([], overviewPayload),
      pendingHandler([], () => ({
        list: [{ id: 501, title: '待你决策的工单', statusName: '待评审', statusCategory: 'PENDING_DECISION', priority: 0, reason: 'AWAITING_DECISION', gmtModified: '2026-01-06T01:00:00Z' }],
        total: 1, pageNum: 1, pageSize: 10,
      })),
      createdHandler([], () => EMPTY_CREATED),
    );

    renderPage();
    const id = await screen.findByText('501');

    // JSDOM 的 cssstyle 会丢弃 var() 颜色值，可断言的字体族/字号/数字宽度用属性字面量核对；
    // 颜色与真实渲染几何由浏览器回验与 CSS 令牌约定保证。
    expect(id.style.fontFamily).toBe('var(--aw-font-mono)');
    expect(id.style.fontSize).toBe('11px');
    expect(id.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('retries the recent stats request after a load failure', async () => {
    let attempts = 0;
    server.use(
      http.get('/api/insights/delivery-overview', ({ request }) => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json({ success: false, code: '10000', message: 'boom', traceId: null, data: null }, { status: 500 });
        }
        const url = new URL(request.url);
        return HttpResponse.json(envelope(overviewPayload(url.searchParams.get('start_date')!, url.searchParams.get('end_date')!)));
      }),
      pendingHandler([], () => EMPTY_PENDING),
      createdHandler([], () => EMPTY_CREATED),
    );

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('近期统计加载失败')).toBeInTheDocument();
    expect(within(screen.getByTestId('overview-delivered')).getByText('—')).toBeInTheDocument();
    expect(screen.getByTestId('overview-delivered').querySelector('.overview-sparkline svg')).toBeNull();
    // antd 会在恰好两个中文字符的按钮中插入空格（「重试」渲染为「重 试」），用角色+正则匹配
    await userEvent.click(within(alert).getByRole('button', { name: /重\s*试/ }));

    expect(await screen.findByText('近 7 天，按日展示新增工单数。')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('近期统计加载失败')).toBeNull());
    expect(attempts).toBe(2);
  });

  it('shows the pending failure in the table and recovers after retry', async () => {
    let attempts = 0;
    server.use(
      overviewHandler([], overviewPayload),
      http.get('/api/insights/delivery-overview/pending', () => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json({ success: false, code: '10000', message: 'boom', traceId: null, data: null }, { status: 500 });
        }
        return HttpResponse.json(envelope(EMPTY_PENDING));
      }),
      createdHandler([], () => EMPTY_CREATED),
    );

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('待处理工单加载失败')).toBeInTheDocument();
    expect(await screen.findAllByText('待处理工单加载失败')).toHaveLength(2);
    // antd 会在恰好两个中文字符的按钮中插入空格（「重试」渲染为「重 试」），用角色+正则匹配
    await userEvent.click(within(alert).getByRole('button', { name: /重\s*试/ }));

    expect(await screen.findByText('暂无待处理工单')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('待处理工单加载失败')).toBeNull());
  });

  it('refreshes both sections together from the toolbar button', async () => {
    const overviewRequests: string[] = [];
    const pendingRequests: string[] = [];
    const createdRequests: string[] = [];
    server.use(
      overviewHandler(overviewRequests, overviewPayload),
      pendingHandler(pendingRequests, () => EMPTY_PENDING),
      createdHandler(createdRequests, () => EMPTY_CREATED),
    );

    renderPage();
    await screen.findByText('暂无待处理工单');

    await userEvent.click(screen.getByRole('button', { name: '刷新交付总览' }));

    await waitFor(() => expect(overviewRequests).toHaveLength(2));
    await waitFor(() => expect(pendingRequests).toHaveLength(2));
    await waitFor(() => expect(createdRequests).toHaveLength(2));
  });

  it('lists new work items with status colors, priority and independent paging', async () => {
    const createdRequests: string[] = [];
    const pageOne: CreatedWorkitemPage = {
      list: [
        { id: 701, title: '已完成的新建工单', statusName: '已完成', statusCategory: 'DONE', priority: 1, createdAt: '2026-01-06T03:00:00Z' },
        { id: 702, title: '已取消的新建工单', statusName: '已取消', statusCategory: 'CANCELED', priority: 2, createdAt: '2026-01-06T02:00:00Z' },
        { id: 703, title: '进行中的新建工单', statusName: '进行中', statusCategory: 'IN_PROGRESS', priority: 0, createdAt: '2026-01-06T01:00:00Z' },
      ],
      total: 13, pageNum: 1, pageSize: 10,
    };
    const pageTwo: CreatedWorkitemPage = {
      list: [
        { id: 801, title: '第二页新增工单', statusName: null, statusCategory: null, priority: 3, createdAt: '2026-01-05T01:00:00Z' },
      ],
      total: 13, pageNum: 2, pageSize: 10,
    };
    server.use(
      overviewHandler([], overviewPayload),
      pendingHandler([], () => EMPTY_PENDING),
      createdHandler(createdRequests, (page) => (page === 2 ? pageTwo : pageOne)),
    );

    renderPage();

    const card = await screen.findByTestId('overview-created-list');
    expect(await within(card).findByText('已完成的新建工单')).toBeInTheDocument();
    expect(createdRequests[0]).toContain(`start_date=${WEEK_START}`);
    expect(createdRequests[0]).toContain(`end_date=${TODAY}`);
    expect(createdRequests[0]).toContain('page=1');
    expect(createdRequests[0]).toContain('size=10');
    expect(within(card).getByText('共 13 条')).toBeInTheDocument();

    const doneRow = within(card).getByText('已完成的新建工单').closest('tr')!;
    // JSDOM 的 cssstyle 会丢弃 var() 颜色值，mock StatusTag 暴露的色板键即页面选色结果；
    // palette→var() 映射由 sharedIdentity.test 锁定。
    expect(within(doneRow).getByText('已完成')).toHaveAttribute('data-status-color', 'green');
    expect(within(doneRow).getByText('701')).toBeInTheDocument();
    expect(within(doneRow).getByText('高')).toBeInTheDocument();
    expectTimeCell(doneRow, '2026-01-06T03:00:00Z');

    const canceledRow = within(card).getByText('已取消的新建工单').closest('tr')!;
    expect(within(canceledRow).getByText('已取消')).toHaveAttribute('data-status-color', 'gray');
    expect(within(canceledRow).getByText('中')).toBeInTheDocument();

    const inProgressRow = within(card).getByText('进行中的新建工单').closest('tr')!;
    expect(within(inProgressRow).getByText('进行中')).toHaveAttribute('data-status-color', 'blue');
    expect(within(inProgressRow).getByText('紧急')).toBeInTheDocument();

    await userEvent.click(card.querySelector('.ant-pagination-next button')!);
    expect(await within(card).findByText('第二页新增工单')).toBeInTheDocument();
    await waitFor(() => expect(createdRequests[1]).toContain('page=2'));
    expect(createdRequests[1]).toContain('size=10');
    // 状态节点缺失时状态列兜底为短横线
    expect(within(card).getByText('—')).toBeInTheDocument();
  });

  it('navigates to the work item detail from a created list row', async () => {
    server.use(
      overviewHandler([], overviewPayload),
      pendingHandler([], () => EMPTY_PENDING),
      createdHandler([], () => ({
        list: [{ id: 704, title: '新增工单跳转', statusName: '待处理', statusCategory: 'INIT', priority: 2, createdAt: '2026-01-06T01:00:00Z' }],
        total: 1, pageNum: 1, pageSize: 10,
      })),
    );

    renderPage();
    await userEvent.click(await screen.findByText('新增工单跳转'));

    expect(await screen.findByTestId('location-probe')).toHaveTextContent('/workitems/704');
  });

  it('shows the created list failure in the card and recovers after retry', async () => {
    let attempts = 0;
    server.use(
      overviewHandler([], overviewPayload),
      pendingHandler([], () => EMPTY_PENDING),
      http.get('/api/insights/delivery-overview/created', () => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json({ success: false, code: '10000', message: 'boom', traceId: null, data: null }, { status: 500 });
        }
        return HttpResponse.json(envelope(EMPTY_CREATED));
      }),
    );

    renderPage();

    const card = await screen.findByTestId('overview-created-list');
    const alert = await within(card).findByRole('alert');
    expect(within(alert).getByText('新增工单列表加载失败')).toBeInTheDocument();
    // antd 会在恰好两个中文字符的按钮中插入空格（「重试」渲染为「重 试」），用角色+正则匹配
    await userEvent.click(within(alert).getByRole('button', { name: /重\s*试/ }));

    expect(await within(card).findByText('所选范围内暂无新增工单')).toBeInTheDocument();
    await waitFor(() => expect(within(card).queryByText('新增工单列表加载失败')).toBeNull());
    expect(attempts).toBe(2);
  });

  it('renders the timezone reported by the API instead of a hardcoded label', async () => {
    const base = overviewPayload(WEEK_START, TODAY);
    server.use(
      overviewHandler([], () => ({ ...base, timezone: 'Asia/Tokyo' })),
      pendingHandler([], () => EMPTY_PENDING),
      createdHandler([], () => EMPTY_CREATED),
    );

    renderPage();

    expect(await screen.findByText('时区 Asia/Tokyo')).toBeInTheDocument();
    expect(screen.queryByText('时区 Asia/Shanghai')).toBeNull();
  });

  it.each(['zh-CN', 'en-US'] as const)('keeps every column, fluid titles and full-label tooltips in compact cards (%s)', async (locale) => {
    await i18n.changeLanguage(locale);
    // JSDOM does not lay out text: simulate overflow to exercise the existing EllipsisText outlet.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(80);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(18);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(500);
    const pendingTitle = '完整的待处理标题 / A very long pending work item title that must remain available';
    const createdTitle = '完整的新增标题 / A very long newly created work item title that must remain available';
    const statusName = '自定义完整状态名称 / Awaiting final stakeholder approval';
    const time = '2026-01-06T03:00:00Z';
    server.use(
      overviewHandler([], overviewPayload),
      pendingHandler([], () => ({
        list: [{ id: 141916, title: pendingTitle, statusName, statusCategory: 'PENDING_DECISION', priority: 9, reason: 'AWAITING_DECISION', gmtModified: time }],
        total: 12, pageNum: 1, pageSize: 10,
      })),
      createdHandler([], () => ({
        list: [{ id: 141917, title: createdTitle, statusName, statusCategory: 'DONE', priority: 1, createdAt: time }],
        total: 13, pageNum: 1, pageSize: 10,
      })),
    );

    renderPage();
    await screen.findByText(pendingTitle);
    await screen.findByText(createdTitle);
    const pendingCard = screen.getByTestId('overview-pending');
    const createdCard = screen.getByTestId('overview-created-list');
    const expectedHeaders = locale === 'zh-CN'
      ? [['工单', '标题', '状态', '优先级', '需处理原因', '最近更新'], ['工单', '标题', '状态', '优先级', '创建时间']]
      : [['Work item', 'Title', 'Status', 'Priority', 'Reason', 'Last updated'], ['Work item', 'Title', 'Status', 'Priority', 'Created at']];
    const expectedWidths = [['60px', '', '116px', '88px', '112px', '124px'], ['60px', '', '116px', '88px', '124px']];

    for (const [index, card] of [pendingCard, createdCard].entries()) {
      expect(within(card).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(expectedHeaders[index]);
      expect(card.querySelector('table')).toHaveStyle({ tableLayout: 'fixed' });
      expect((card.querySelector('table') as HTMLElement).style.width).toBe('');
      expect((card.querySelector('.ant-table-content') as HTMLElement).style.overflowX).toBe('');
      const widths = Array.from(card.querySelectorAll('colgroup col')).map((column) => (column as HTMLElement).style.width);
      expect(widths).toEqual(expectedWidths[index]);
      const fixedBudget = widths.reduce((sum, width) => sum + (parseInt(width, 10) || 0), 0);
      // Budget assertions, not browser geometry: full-row cards leave the single fluid title column a wide remainder.
      expect(widths.filter((width) => width === '')).toEqual(['']);
      expect(900 - fixedBudget).toBeGreaterThanOrEqual(400);
      expect(card.querySelector('.ant-pagination-next button')).not.toBeNull();
      expectTimeCell(card.querySelector('tbody tr')!, time, locale);
      const title = index === 0 ? pendingTitle : createdTitle;
      await act(async () => { within(card).getByText(title).parentElement!.focus(); });
      expect(await screen.findByRole('tooltip', { name: title })).toHaveTextContent(title);
      await userEvent.hover(within(card).getByText(statusName));
      expect(await screen.findByRole('tooltip', { name: statusName })).toHaveTextContent(statusName);
      await userEvent.unhover(within(card).getByText(statusName));
    }

    const reason = locale === 'zh-CN' ? '待你决策' : 'Awaiting your decision';
    await userEvent.hover(within(pendingCard).getByText(reason));
    expect(await screen.findByRole('tooltip', { name: reason })).toHaveTextContent(reason);
    const priority = locale === 'zh-CN' ? '未知优先级' : 'Unknown priority';
    await userEvent.hover(within(pendingCard).getByText(priority));
    expect(await screen.findByRole('tooltip', { name: priority })).toHaveTextContent(priority);
    const deliveredLabel = locale === 'zh-CN' ? '近 7 天每日已完成工单趋势' : 'Daily trend of completed work items over the last 7 days';
    expect(within(screen.getByTestId('overview-delivered')).getByRole('img', { name: deliveredLabel })).toBeInTheDocument();
  });

  it('keeps header wrapping and narrow single-column layouts scoped to overview cards', () => {
    expect(overviewStyles).toMatch(/\.overview-table-card[^{}]*\.ant-table-thead[^{}]*\{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
    expect(overviewStyles).toMatch(/\.overview-section-divider\s*\{[^}]*border-top: 1px solid var\(--aw-border\);/);
    expect(overviewStyles).toMatch(/@media \(max-width: 1024px\)\s*\{\s*\.overview-stats \{ grid-template-columns: 1fr; \}\s*\}/);
    expect(overviewStyles).toMatch(/@media \(max-width: 600px\)\s*\{\s*\.overview-table-card \.ant-table-content \{ overflow-x: auto; \}\s*\.overview-table-card \.ant-table-content > table \{ min-width: 480px; \}/);
    expect(overviewStyles).not.toMatch(/876px|726px|\.overview-lists/);
  });

  it('constrains complete curves and wraps card titles and pagination without hiding overflow', () => {
    expect(overviewStyles).toMatch(/\.overview-stat-card \.overview-sparkline svg\s*\{[^}]*width: 100%;/);
    expect(overviewStyles).toMatch(/\.overview-table-card \.aw-card-head\s*\{[^}]*flex-wrap: wrap;/);
    expect(overviewStyles).toMatch(/\.overview-table-card \.aw-card-title\s*\{[^}]*overflow-wrap: anywhere;/);
    expect(overviewStyles).not.toMatch(/\.aw-card-extra|\.overview-table-title/);
    expect(overviewStyles).toMatch(/\.overview-table-card \.ant-pagination\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;/);
    expect(overviewStyles).toMatch(/\.overview-table-card \.ant-pagination > li\s*\{[^}]*margin-inline-end: 0;/);
  });

  it('locks the prototype column styling and ghost refresh button in the stylesheet', () => {
    expect(overviewStyles).toMatch(/td\.overview-title-cell\s*\{[^}]*font-size: 13px;/);
    expect(overviewStyles).toMatch(/td\.overview-time-cell\s*\{[^}]*color: var\(--aw-text-3\);/);
    expect(overviewStyles).toMatch(/\.overview-table-card \.overview-reason\s*\{[^}]*color: var\(--aw-text-3\);/);
    expect(overviewStyles).toMatch(/\.overview-meta-strip \.overview-refresh-btn\.ant-btn\s*\{[^}]*height: 26px;[^}]*border-color: transparent;[^}]*background: transparent;/);
    expect(overviewStyles).toMatch(/\.overview-meta-strip \.overview-refresh-btn\.ant-btn:not\(:disabled\):hover\s*\{[^}]*background: var\(--aw-gray-bg\);/);
  });
});
