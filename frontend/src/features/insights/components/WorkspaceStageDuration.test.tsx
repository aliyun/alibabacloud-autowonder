import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { delay, http, HttpResponse } from 'msw';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { server } from '@/test/mocks/server';
import { i18n } from '@/shared/i18n';
import { useAuthStore } from '@/shared/auth/store';
import { StageDurationTab } from './StageDurationTab';
import type { StageDurationPlan, StageDurationReport } from '../types';

const ok = (data: unknown) => ({ success: true, code: '0', message: '', data });
const report: StageDurationReport = {
  startDate: '2026-01-01', endDate: '2026-01-07', timezone: 'Asia/Shanghai', calculatedAt: '2026-01-07T08:00:00Z',
  executionCount: 4, workitemCount: 2, measuredExecutionCount: 3, stageExecutionCount: 3, noStageExecutionCount: 1, notApplicableExecutionCount: 0, missingDurationCount: 1, totalDurationMs: 60_000,
  stages: [{ key: '5:id:10', agentId: null, agentName: null, agentVersionId: null, agentVersionNo: null, currentAgentVersion: null, sdlcId: 5, sdlcName: '用户的工作流', stepId: 10, stepOrder: 1, name: '开发与自查',
    sampleCount: 4, completedCount: 2, activeCount: 1, incompleteCount: 1, reusedCount: 0, skippedCount: 0,
    missingDurationCount: 1, totalDurationMs: 60_000, averageDurationMs: 10_000, medianDurationMs: 10_000, p90DurationMs: 20_000,
    slowest: [{ dispatchId: 20, agentId: 7, agentVersionId: null, agentVersionNo: null, currentAgentVersion: false, workitemId: 100, title: '用户编写的需求', agentName: '用户的员工', createdAt: '2026-01-01T00:00:00Z', status: 'active', durationMs: 30_000 }] }],
};
const plan = (overrides: Partial<StageDurationPlan> = {}): StageDurationPlan => ({
  snapshot: { maxDispatchId: 501, calculatedAt: '2026-01-07T08:00:00Z' },
  mode: 'sharded', executionCount: 9, workitemCount: 4, notApplicableExecutionCount: 1,
  recoverableSnapshotCount: 0, firstExecutionDate: '2026-01-01', lastExecutionDate: '2026-01-07',
  shards: [
    { sdlcId: 5, sdlcName: '流程甲', executionCount: 5, oversized: false },
    { sdlcId: 6, sdlcName: '流程乙', executionCount: 4, oversized: false },
  ], ...overrides });

const shardReport = (flow: number, totalDurationMs: number): StageDurationReport => ({ ...report,
  executionCount: 5, stageExecutionCount: 5, measuredExecutionCount: 5, totalDurationMs,
  stages: [{ ...report.stages[0], key: `${flow}:id:10`, sdlcId: flow, sdlcName: `流程${flow}`,
    name: `流程${flow}阶段`, totalDurationMs }] });

function renderTab() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><StageDurationTab /></QueryClientProvider>);
}

beforeEach(() => {
  localStorage.clear();
  server.use(
    http.get('/api/squads', () => HttpResponse.json(ok({ list: [{ id: 7, name: '开发小队' }], total: 1 }))),
    http.get('/api/sdlcs/page', () => HttpResponse.json(ok({ list: [{ id: '9007199254740993', name: '用户的工作流' }], total: 1 }))),
    http.get('/api/insights/stage-duration', () => HttpResponse.json(ok(report))),
  );
});
afterEach(async () => { await act(async () => { await i18n.changeLanguage('zh-CN'); }); });

describe('Workspace stage duration', () => {
  it('shows measured coverage and completed statistics with an accessible execution drilldown', async () => {
    const user = userEvent.setup();
    renderTab();
    expect(await screen.findByText('开发与自查')).toBeInTheDocument();
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByText('完成 2 · 运行中 1 · 未完成 1')).toBeInTheDocument();
    expect(screen.queryByText(/OKR|目标达成|24小时/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '展开开发与自查的执行记录' }));
    expect(screen.getByRole('link', { name: '#100 用户编写的需求' })).toHaveAttribute('href', '/workitems/100');
    expect(screen.getByText('#20')).toBeInTheDocument();
    expect(screen.getByText('运行中', { selector: '.ant-tag' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起开发与自查的执行记录' })).toHaveAttribute('aria-expanded', 'true');
    await act(async () => { await i18n.changeLanguage('en-US'); });
    expect(screen.getAllByText('Completed average').length).toBeGreaterThan(0);
    expect(screen.getByText('Running', { selector: '.ant-tag' })).toBeInTheDocument();
    expect(screen.getByText('开发与自查')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#100 用户编写的需求' })).toBeInTheDocument();
  });

  it('sends squad and workflow filters and scopes saved preferences to each workspace', async () => {
    const requests: URLSearchParams[] = [];
    server.use(http.get('/api/insights/stage-duration', ({ request }) => {
      requests.push(new URL(request.url).searchParams);
      return HttpResponse.json(ok(report));
    }));
    const user = userEvent.setup(); renderTab();
    await screen.findByText('开发与自查');
    expect(screen.getByRole('radio', { name: '工作区概览' })).toBeChecked();
    expect(screen.queryByRole('combobox', { name: '数字员工' })).not.toBeInTheDocument();
    expect(requests.at(-1)?.has('agent_id')).toBe(false);
    expect(requests.at(-1)?.get('exclude_canceled_workitems')).toBe('false');
    await user.click(screen.getByRole('checkbox', { name: '排除当前已取消的工单' }));
    await waitFor(() => expect(requests.at(-1)?.get('exclude_canceled_workitems')).toBe('true'));
    await user.click(screen.getByRole('combobox', { name: '小队' }));
    await user.click(within(document.querySelector('.ant-select-dropdown') as HTMLElement).getByText('开发小队'));
    await user.click(screen.getByRole('combobox', { name: '流程' }));
    const options = await screen.findAllByText('用户的工作流');
    await user.click(options.find(el => el.classList.contains('ant-select-item-option-content'))!);
    await waitFor(() => {
      expect(requests.at(-1)?.get('squad_id')).toBe('7');
      expect(requests.at(-1)?.get('sdlc_id')).toBe('9007199254740993');
    });
    await act(async () => { useAuthStore.setState({ currentWorkspace: { id: 900, name: 'Another workspace' } as never }); });
    await waitFor(() => {
      expect(requests.at(-1)?.has('squad_id')).toBe(false);
      expect(requests.at(-1)?.has('sdlc_id')).toBe(false);
    });
  });

  it('shows an empty state and unavailable values instead of zeroes after a failed refresh', async () => {
    const user = userEvent.setup(); renderTab();
    await screen.findByText('开发与自查');
    server.use(http.get('/api/insights/stage-duration', () => HttpResponse.json({ success: false, code: '10001', message: '请缩小日期范围' })));
    await user.click(screen.getByRole('button', { name: '刷新' }));
    expect(await screen.findByText('阶段耗时加载失败')).toBeInTheDocument();
    expect(screen.getByText('请缩小日期范围')).toBeInTheDocument();
    expect(screen.queryByText('开发与自查')).not.toBeInTheDocument();
    server.use(http.get('/api/insights/stage-duration', () => HttpResponse.json(ok({ ...report, executionCount: 0, workitemCount: 0, measuredExecutionCount: 0, totalDurationMs: 0, missingDurationCount: 0, stages: [] }))));
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('所选范围暂无阶段记录，请调整日期或筛选。')).toBeInTheDocument();
  });

  it('takes overview counts from the plan and appends every workflow shard', async () => {
    server.use(
      http.get('/api/insights/stage-duration/plan', () => HttpResponse.json(ok(plan({ shards: [
        { sdlcId: 5, sdlcName: '流程甲', executionCount: 5, oversized: true },
        { sdlcId: 6, sdlcName: '流程乙', executionCount: 4, oversized: false },
      ] })))),
      http.get('/api/insights/stage-duration', ({ request }) => {
        const flow = new URL(request.url).searchParams.get('sdlc_id');
        expect(new URL(request.url).searchParams.get('max_dispatch_id')).toBe('501');
        return HttpResponse.json(ok(shardReport(Number(flow), flow === '5' ? 40_000 : 60_000)));
      }));
    renderTab();
    expect(await screen.findByText('流程5阶段')).toBeInTheDocument();
    expect(await screen.findByText('流程6阶段')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/已加载/)).not.toBeInTheDocument());
    expect(screen.getByText('该流程执行次数较多，加载可能偏慢')).toBeInTheDocument();
    expect(within(screen.getByText('执行次数').closest('.participation-stat') as HTMLElement).getByText('9')).toBeInTheDocument();
    expect(within(screen.getByText('涉及工单').closest('.participation-stat') as HTMLElement).getByText('4')).toBeInTheDocument();
    expect(screen.getByText('1.7 分钟')).toBeInTheDocument();
  });

  it('renders the empty state without requesting shards when the overview window has no executions', async () => {
    const requests: string[] = [];
    server.use(
      http.get('/api/insights/stage-duration/plan', () => HttpResponse.json(ok(plan({ mode: 'single', executionCount: 0, workitemCount: 0, shards: [] })))),
      http.get('/api/insights/stage-duration', ({ request }) => { requests.push(new URL(request.url).search); return HttpResponse.json(ok(report)); }));
    renderTab();
    expect(await screen.findByText('所选范围暂无阶段记录，请调整日期或筛选。')).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it('keeps a single request when the overview reports one workflow', async () => {
    const requests: string[] = [];
    server.use(
      http.get('/api/insights/stage-duration/plan', () => HttpResponse.json(ok(plan({ mode: 'single', shards: [plan().shards[0]] })))),
      http.get('/api/insights/stage-duration', ({ request }) => { requests.push(new URL(request.url).search); return HttpResponse.json(ok(report)); }));
    renderTab();
    expect(await screen.findByText('开发与自查')).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('max_dispatch_id=501');
    expect(requests[0]).not.toContain('sdlc_id');
  });

  it('keeps loaded workflows visible when another flow fails and retries only that flow', async () => {
    let attempts = 0;
    server.use(
      http.get('/api/insights/stage-duration/plan', () => HttpResponse.json(ok(plan()))),
      http.get('/api/insights/stage-duration', ({ request }) => {
        const flow = new URL(request.url).searchParams.get('sdlc_id');
        if (flow === '6') {
          attempts += 1;
          if (attempts === 1) return HttpResponse.json({ success: false, code: '500', message: '流程乙失败' }, { status: 500 });
          return HttpResponse.json(ok(shardReport(6, 60_000)));
        }
        return HttpResponse.json(ok(shardReport(5, 40_000)));
      }));
    const user = userEvent.setup(); renderTab();
    expect(await screen.findByText('流程5阶段')).toBeInTheDocument();
    expect(await screen.findByText('流程 流程乙 加载失败')).toBeInTheDocument();
    expect(screen.getByText('已加载 1/2 个流程')).toBeInTheDocument();
    expect(screen.getByText('部分流程加载失败')).toBeInTheDocument();
    expect(screen.queryByText('阶段耗时加载失败')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试该流程' }));
    expect(await screen.findByText('流程6阶段')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('已加载 1/2 个流程')).not.toBeInTheDocument());
    expect(screen.queryByText('流程 流程乙 加载失败')).not.toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('keeps only the failure alerts instead of an empty-range message when every flow fails', async () => {
    server.use(
      http.get('/api/insights/stage-duration/plan', () => HttpResponse.json(ok(plan()))),
      http.get('/api/insights/stage-duration', () => HttpResponse.json({ success: false, code: '500', message: '所有流程失败' }, { status: 500 })));
    renderTab();
    expect(await screen.findByText('流程 流程甲 加载失败')).toBeInTheDocument();
    expect(screen.getByText('流程 流程乙 加载失败')).toBeInTheDocument();
    expect(screen.getByText('部分流程加载失败')).toBeInTheDocument();
    expect(screen.getByText('已加载 0/2 个流程')).toBeInTheDocument();
    expect(screen.queryByText('所选范围暂无阶段记录，请调整日期或筛选。')).not.toBeInTheDocument();
    expect(screen.queryByText('阶段耗时加载失败')).not.toBeInTheDocument();
  });

  it('keeps at most three shard requests in flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const requested = new Set<string>();
    server.use(
      http.get('/api/insights/stage-duration/plan', () => HttpResponse.json(ok(plan({ executionCount: 8,
        shards: [5, 6, 7, 8].map(id => ({ sdlcId: id, sdlcName: `流程${id}`, executionCount: 2, oversized: false })) })))),
      http.get('/api/insights/stage-duration', async ({ request }) => {
        const flow = new URL(request.url).searchParams.get('sdlc_id')!;
        requested.add(flow);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(20);
        inFlight -= 1;
        return HttpResponse.json(ok(shardReport(Number(flow), 10_000)));
      }));
    renderTab();
    await waitFor(() => expect(requested.size).toBe(4), { timeout: 3000 });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });
});
