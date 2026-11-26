import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/test/mocks/server';
import { i18n } from '@/shared/i18n';
import { useAuthStore } from '@/shared/auth/store';
import { StageDurationTab } from './StageDurationTab';
import { StageDurationDetails } from './StageDurationDetails';
import { StageDurationComparison } from './StageDurationComparison';
import type { StageDurationReport, StageDurationVersionSample } from '../types';

const ok = (data: unknown) => ({ success: true, code: '0', message: '', data });
function sample(id: number, version: number | null, durationMs: number | null, snapshotId: number | null = 40, complete = true): StageDurationVersionSample {
  return { dispatchId: id, workitemId: 100, title: '用户编写的需求', agentName: '用户的员工', agentId: 7,
    agentVersionId: version == null ? null : version + 100, agentVersionNo: version, currentAgentVersion: version === 2,
    status: complete ? 'SUCCEEDED' : 'FAILED', createdAt: snapshotId === 41 ? '2026-01-03T00:00:00Z' : '2026-01-01T00:00:00Z',
    durationMs, complete, sdlcId: 5, sdlcName: '用户的工作流', snapshotId, snapshotSource: snapshotId == null ? null : 'CAPTURED',
    stages: [{ key: '5:id:10', stepId: 10, stepOrder: 1, name: '开发与自查', status: complete ? 'done' : 'failed', durationMs }] };
}
const report: StageDurationReport = {
  startDate: '2026-01-01', endDate: '2026-01-07', timezone: 'Asia/Shanghai', calculatedAt: '2026-01-07T08:00:00Z',
  executionCount: 6, workitemCount: 1, measuredExecutionCount: 5, missingDurationCount: 1, totalDurationMs: 580_000, stages: [],
  versionSamples: [sample(21, 1, 200_000), sample(22, 2, 60_000, 41), sample(23, 12, 180_000), sample(24, 2, 120_000),
    sample(25, null, 20_000, null, false), { ...sample(26, null, null, null, false), agentId: 8, agentName: null, agentVersionId: 80 }],
  flowSnapshots: [
    { id: 40, sdlcId: 5, capturedAt: '2026-01-01T00:00:00Z', contentHash: 'abcdef123', configuration: { steps: [{ id: '10', name: '开发与自查', required: true, instruction: '原始指令' }] } },
    { id: 41, sdlcId: 5, capturedAt: '2026-01-03T00:00:00Z', contentHash: 'fedcba321', configuration: { steps: [{ id: '10', name: '开发与自查', required: true, instruction: '新的用户指令' }] } },
  ],
};
const requests: URL[] = [];
function renderTab(rememberConfigurationView = true) {
  const state = useAuthStore.getState();
  const key = `aw:insights:v1:${state.user?.id ?? 'anonymous'}:${state.currentWorkspace?.id ?? 'none'}:stages.cohorts.view`;
  const dateKey = key.replace('stages.cohorts.view', 'stages.cohorts.dates');
  if (!localStorage.getItem(dateKey)) localStorage.setItem(dateKey, JSON.stringify(['2026-01-01', '2026-01-07']));
  if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(rememberConfigurationView ? 'daily' : 'versions'));
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><StageDurationTab /></QueryClientProvider>);
}
const commonPanel = () => screen.getByText(/已核验配置 abcdef1/).closest('section')!;
const selectOption = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
  await user.click(screen.getByRole('combobox', { name: label }));
  const choices = await screen.findAllByText(option, { selector: '.ant-select-item-option-content' });
  await user.click(choices.find(row => !row.closest('.ant-select-dropdown-hidden') && !row.closest('.ant-select-item-option-disabled'))!);
};
beforeEach(() => {
  localStorage.clear(); requests.length = 0;
  server.use(
    http.get('/api/insights/stage-duration/workers', () => HttpResponse.json(ok([{ id: 7, name: '用户的员工' }, { id: 8, name: '另一员工' }]))),
    http.get('/api/insights/stage-duration/versions', ({ request }) => {
      const url = new URL(request.url); requests.push(url);
      return HttpResponse.json(ok((url.searchParams.get('agent_id') === '8' ? [80] : [112, 102, 101]).map(id => ({
        agentVersionId: String(id), agentVersionNo: id > 100 ? id - 100 : null, currentAgentVersion: id === 102, executionCount: id === 102 ? 2 : 1,
      }))));
    }),
    http.get('/api/insights/stage-duration/version-samples', ({ request }) => {
      const url = new URL(request.url); requests.push(url);
      const ids = url.searchParams.get('version_ids')!.split(',');
      return HttpResponse.json(ok({ ...report, sampleLimit: 30, versionSamples: report.versionSamples!.filter(row => String(row.agentId) === url.searchParams.get('agent_id') && ids.includes(String(row.agentVersionId))) }));
    }),
    http.get('/api/insights/stage-duration', ({ request }) => {
      const url = new URL(request.url); requests.push(url);
      return HttpResponse.json(ok({ ...report, versionSamples: report.versionSamples!.filter(row => String(row.agentId) === url.searchParams.get('agent_id')) }));
    }),
  );
});
afterEach(async () => { await act(async () => { await i18n.changeLanguage('zh-CN'); }); });

describe('StageDurationTab cohorts', () => {
  it.each(['workers', 'versions'])('shows an empty comparison when the %s list is empty', async endpoint => {
    server.use(http.get('/api/insights/stage-duration/' + endpoint, () => HttpResponse.json(ok([]))));
    renderTab(false);
    expect(await screen.findByText('所选日期内暂无执行样本。')).toBeInTheDocument();
    expect(requests.some(url => url.pathname.endsWith('/version-samples'))).toBe(false);
  });

  it('groups daily samples in Shanghai time without formatting every sample once per day', async () => {
    const samples = Array.from({ length: 120 }, (_, index) => ({ ...sample(1000 + index, 2, 1000),
      createdAt: new Date(Date.UTC(2026, 0, 1 + index % 30)).toISOString() }));
    samples[0].createdAt = '2026-01-01T15:59:59Z';
    samples[30].createdAt = '2026-01-01T16:00:00Z';
    const format = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    try {
      render(<StageDurationComparison data={{ ...report, versionSamples: samples }} loading={false} view="daily" />);
      expect(format.mock.calls.length).toBeLessThan(samples.length * 4);
      await userEvent.setup().click(screen.getByRole('button', { name: /样本口径与完整性/ }));
      expect(screen.getByText(/2026-01-01：共 3 次，完整执行 3 次/)).toBeInTheDocument();
      expect(screen.getByText(/2026-01-02：共 5 次，完整执行 5 次/)).toBeInTheDocument();
    } finally { format.mockRestore(); }
  });

  it('disables details only for the version without that stage', async () => {
    const original = sample(12, 12, 1000), changed: StageDurationVersionSample = { ...sample(2, 2, 2000, 41), stages: [
      { key: '5:id:11', stepId: 11, stepOrder: 2, name: '验收', status: 'done', durationMs: 2000 },
    ] };
    for (const row of [original, changed]) row.stages.push({ key: '5:key:build', stepId: null,
      stepOrder: 3, name: '旧阶段代码', status: 'done', durationMs: row.durationMs });
    for (const id of [15, 16]) original.stages.push({ ...original.stages[0], key: '5:id:' + id, stepId: id, name: null });
    server.use(http.get('/api/insights/stage-duration/version-samples', () => HttpResponse.json(ok({
      ...report, sampleLimit: 30, versionSamples: [original, changed],
    }))));
    const user = userEvent.setup(); renderTab(false);
    const overview = await screen.findByRole('region', { name: '阶段变化总览' });
    expect(within(overview).getByRole('button', { name: /开发与自查.*v12/ })).toBeEnabled();
    expect(within(overview).getByRole('button', { name: /开发与自查.*v2/ })).toBeDisabled();
    expect(within(overview).getByRole('button', { name: /验收.*v2/ })).toBeEnabled();
    expect(within(overview).getByRole('button', { name: /验收.*v12/ })).toBeDisabled();
    expect(within(overview).queryAllByRole('img', { name: /旧阶段代码/ })).toHaveLength(0);
    expect(within(overview).getByText('阶段 #15', { exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /配置分布与耗时/ }));
    expect(within(commonPanel()).getByRole('table')).toHaveTextContent('旧阶段代码');
    const changedPanel = screen.getByText(/已核验配置 fedcba3/).closest('section')!;
    expect(within(changedPanel).getByRole('button', { name: /开发与自查.*v2/ })).toBeDisabled();
    expect(within(changedPanel).getByRole('button', { name: /验收.*v2/ })).toBeEnabled();
  });

  it('shows only present versions per configuration and retains an unmeasured side of a genuinely shared configuration', async () => {
    const before = sample(91, 2, 100_000, 40);
    const unmeasured = sample(92, 12, 40_000, 40, false);
    const candidateOnly = sample(93, 12, 60_000, 41);
    server.use(http.get('/api/insights/stage-duration/version-samples', () => HttpResponse.json(ok({ ...report,
      versionSamples: [before, unmeasured, candidateOnly], sampleLimit: 30,
    }))));
    const user = userEvent.setup(); renderTab(false);
    await screen.findByRole('region', { name: '阶段变化总览' });
    await user.click(screen.getByRole('button', { name: /配置分布与耗时/ }));
    const shared = commonPanel();
    expect(within(shared).getByText('共同配置')).toBeInTheDocument();
    expect(within(shared).getByRole('table')).toHaveTextContent('有效 0 / 1');
    expect(within(shared).getAllByRole('row')).toHaveLength(3);
    const single = screen.getByText(/已核验配置 fedcba3/).closest('section')!;
    expect(within(single).getByText('仅 v12 使用')).toBeInTheDocument();
    expect(within(single).getAllByRole('row')).toHaveLength(2);
    expect(within(single).queryByRole('columnheader', { name: '员工版本' })).not.toBeInTheDocument();
    expect(single).not.toHaveTextContent('有效 0 / 0');
    await user.click(within(shared).getByRole('button', { name: '查看开发与自查 · v12的执行样本' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('#92')).toBeInTheDocument();
    expect(within(dialog).queryByText('#91')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('#93')).not.toBeInTheDocument();
  });

  it('keeps zero baselines finite, missing timings unknown, and same-name stage identities separate', async () => {
    const before = sample(71, 2, 0);
    const after = sample(72, 12, 10_000, 41);
    after.stages.push({ ...after.stages[0], key: '5:id:11', stepId: 11, durationMs: 20_000 });
    before.stages.push({ ...before.stages[0], key: '5:id:12', stepId: 12, durationMs: null });
    const other = { ...sample(73, 12, 900_000), sdlcId: 6, stages: [{ ...after.stages[0], key: '6:id:10', durationMs: 900_000 }] };
    server.use(http.get('/api/insights/stage-duration/version-samples', () => HttpResponse.json(ok({ ...report, versionSamples: [before, after, other], sampleLimit: 30 }))));
    const user = userEvent.setup(); renderTab();
    await user.click(screen.getByRole('radio', { name: '员工版本' }).closest('label')!);
    const overview = await screen.findByRole('region', { name: '阶段变化总览' });
    expect(within(within(overview).getByRole('figure')).getAllByRole('img')).toHaveLength(6);
    expect(within(overview).getByText('增加 10 秒')).toBeInTheDocument();
    expect(overview).not.toHaveTextContent(/Infinity|NaN|15 分钟|100%/);
    expect(overview.querySelector('.is-zero')).toHaveStyle({ width: '0%' });
    expect(overview.querySelectorAll('.is-missing')).toHaveLength(3);
    expect(within(overview).getAllByText('暂无可对比计时')).toHaveLength(2);
    expect(within(overview).queryByText(i18n.t('insights:evolution.noComparableStages'))).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '扣除已知等待后的耗时' }).closest('label')!);
    expect(within(overview).getByText(i18n.t('insights:evolution.noComparableStages'))).toBeInTheDocument();
    await selectOption(user, '执行时使用的流程', '用户的工作流 · 流程 #6（1 次执行）');
    expect(screen.getByRole('region', { name: '阶段变化总览' })).toHaveTextContent('15 分钟');
    expect(screen.getByRole('region', { name: '阶段变化总览' })).not.toHaveTextContent('增加 10 秒');
  });

  it('retains order-only historical timings in details without matching them across configurations', async () => {
    const legacy = [sample(71, 2, 100_000, 40), sample(72, 12, 40_000, 41)].map(row => ({ ...row,
      stages: row.stages.map(stage => ({ ...stage, key: '5:order:1', stepId: null })),
    }));
    server.use(http.get('/api/insights/stage-duration/version-samples', () => HttpResponse.json(ok({ ...report, versionSamples: legacy, sampleLimit: 30 }))));
    const user = userEvent.setup(); renderTab(false);
    const overview = await screen.findByRole('region', { name: '阶段变化总览' });
    expect(within(overview).getByText(/2 条阶段记录缺少可核验的阶段标识/)).toBeInTheDocument();
    expect(within(overview).queryByRole('figure')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /配置分布与耗时/ }));
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getAllByRole('table')[0]).toHaveTextContent('40 秒');
    expect(screen.getAllByRole('table')[1]).toHaveTextContent('1.7 分钟');
  });

  it('keeps unknown configurations measurable, counts unobserved stages, and drills down to real executions', async () => {
    const old = { ...sample(55, 3, 30_000, null, false), stages: [{ ...sample(55, 3, 30_000).stages[0], status: 'done' }] };
    server.use(http.get('/api/insights/stage-duration', () => HttpResponse.json(ok({ ...report, versionSamples: [old, { ...old, dispatchId: 56, stages: [], durationMs: null }], flowSnapshots: [] }))));
    const user = userEvent.setup(); renderTab();
    const figure = await screen.findByRole('figure', { name: '开发与自查 · P50' });
    expect(within(figure).getByRole('img')).toHaveAccessibleName(/SDLC 配置未知：P50 30 秒；有效 1 \/ 2/);
    expect(screen.getByText(/未核验配置/)).toBeInTheDocument();
    expect(screen.getAllByText(/这些未核验执行可能使用不同配置/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /样本口径与完整性/ }));
    expect(screen.getByText(/完整执行 0 次/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '展开开发与自查的执行记录' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('link', { name: '#100 用户编写的需求' })[0]).toHaveAttribute('href', '/workitems/100');
  });

  it('keeps same-name workflows and stage identities separate and distinguishes zero from missing timing', async () => {
    const zero = sample(80, 2, 0);
    const missing = { ...sample(81, 2, null, 41), stages: [{ ...zero.stages[0], status: 'active', durationMs: 99_000 }] };
    const noEvents = { ...sample(83, 2, null, 42), stages: [] };
    const otherFlow = { ...sample(82, 2, 90_000, null), sdlcId: 6, stages: [{ ...zero.stages[0], key: '6:id:10', durationMs: 90_000 }] };
    zero.stages.push({ ...zero.stages[0], key: '5:id:11', stepId: 11, stepOrder: 2, durationMs: 30_000 });
    server.use(http.get('/api/insights/stage-duration', () => HttpResponse.json(ok({ ...report,
      versionSamples: [zero, missing, noEvents, otherFlow],
      flowSnapshots: [...report.flowSnapshots!, { ...report.flowSnapshots![0], id: 42, contentHash: 'no-events' }],
    }))));
    const user = userEvent.setup(); renderTab();
    const chart = await screen.findByRole('region', { name: '流程配置耗时对比' });
    expect(within(chart).getAllByRole('figure')).toHaveLength(1);
    expect(within(chart).getAllByRole('img')).toHaveLength(3);
    await selectOption(user, '查看阶段', '开发与自查 · 阶段 #11');
    expect(within(chart).getByRole('img', { name: /流程 #5.*P50 30 秒/ })).toBeInTheDocument();
    await selectOption(user, '查看阶段', '开发与自查 · 阶段 #10');
    const zeroPoint = within(chart).getByRole('img', { name: /流程 #5.*S40.*P50 0 毫秒；有效 1 \/ 1/ });
    expect(zeroPoint.querySelector('.is-zero')).toHaveStyle({ width: '0%' });
    expect(within(chart).getByRole('img', { name: /S41.*P50 —；有效 0 \/ 1/ })).toBeInTheDocument();
    expect(within(chart).getByRole('img', { name: /S42.*P50 —；有效 0 \/ 1/ })).toBeInTheDocument();
    expect(within(chart).queryByRole('img', { name: /流程 #6/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(3);
    const noEventsTable = within(screen.getByText(/已核验配置 no-even/).closest('section')!).getByRole('table');
    expect(noEventsTable).toHaveTextContent('开发与自查');
    expect(noEventsTable).toHaveTextContent('有效 0 / 1');
    expect(within(noEventsTable).getAllByRole('row')).toHaveLength(2);
    await selectOption(user, '执行时使用的流程', '用户的工作流 · 流程 #6（1 次执行）');
    const otherChart = screen.getByRole('region', { name: '流程配置耗时对比' });
    expect(within(otherChart).getByRole('img', { name: /流程 #6.*P50 1.5 分钟；有效 1 \/ 1/ })).toBeInTheDocument();
    expect(within(otherChart).queryByRole('img', { name: /流程 #5/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('compares configuration changes only within the selected workflow', async () => {
    const earlier = sample(91, 2, 2000, 40), later = sample(90, 12, 1000, 41);
    const largeId = '9007199254740993';
    later.snapshotId = largeId;
    const initial = sample(94, 12, 1500, 40);
    const returned = { ...sample(93, 12, 800, 40), createdAt: '2026-01-07T00:00:00Z' };
    const foreign = { ...sample(92, 12, 1000, 60), sdlcId: 6, createdAt: '2026-01-06T00:00:00Z' };
    server.use(http.get('/api/insights/stage-duration/version-samples', () => HttpResponse.json(ok({ ...report,
      versionSamples: [foreign, returned, later, initial, earlier], flowSnapshots: [report.flowSnapshots![0], { ...report.flowSnapshots![1], id: largeId },
        { ...report.flowSnapshots![0], id: 60, sdlcId: 6 }],
    }))));
    const user = userEvent.setup(); renderTab(false);
    await user.click(await screen.findByRole('button', { name: '配置变化' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('所选 SDLC 配置相同。')).toBeInTheDocument();
    await selectOption(user, '所选版本 SDLC 配置', '流程 #5 · 配置 S9007199254740993 · fedcba3');
    expect(within(dialog).getByText('原始指令')).toBeInTheDocument();
    expect(within(dialog).getByText('新的用户指令')).toBeInTheDocument();
    expect(within(dialog).queryByText(/流程 #6/)).not.toBeInTheDocument();
  });

  it('blocks configuration evolution between different workflows even if their content matches', async () => {
    const left = sample(90, 12, 1000, 40), right = { ...sample(91, 2, 2000, 41), sdlcId: 6 };
    server.use(http.get('/api/insights/stage-duration/version-samples', () => HttpResponse.json(ok({ ...report,
      versionSamples: [left, right], flowSnapshots: [report.flowSnapshots![0], { ...report.flowSnapshots![0], id: 41, sdlcId: 6 }],
    }))));
    const user = userEvent.setup(); renderTab(false);
    await user.click(await screen.findByRole('button', { name: '配置变化' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('一侧缺少可核验的配置，无法确定变更。')).toBeInTheDocument();
    expect(within(dialog).queryByText('配置相同')).not.toBeInTheDocument();
  });

  it('queries historical employee executions even when the current employee list is empty', async () => {
    server.use(http.get('/api/insights/workers', () => HttpResponse.json(ok([]))),
      http.get('/api/insights/stage-duration/workers', () => HttpResponse.json(ok([{ id: 7, name: '已删除的员工' }]))));
    renderTab();
    await screen.findByRole('region', { name: '流程配置耗时对比' });
    expect(screen.getByText('已删除的员工', { selector: '.ant-select-selection-item' })).toBeInTheDocument();
    expect(requests.some(url => url.searchParams.get('agent_id') === '7')).toBe(true);
  });

  it('renders all pause transition statuses in execution details in both languages', async () => {
    const rows = ['PAUSING', 'WAITING_FOR_PAUSE', 'PAUSE_FAILED'].map((status, i) => ({ ...sample(i, 2, i === 0 ? 90_000 : 1000), status }));
    const rendered = render(<StageDurationDetails samples={rows} total basis="total" />);
    for (const text of ['暂停中', '等待暂停', '暂停失败']) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText('1.5 分钟')).toBeInTheDocument();
    await act(async () => { await i18n.changeLanguage('en-US'); });
    for (const text of ['Pausing', 'Waiting for pause', 'Pause failed']) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText('1.5 min')).toBeInTheDocument();
    rendered.unmount();
  });

  it('hides stale timings after refresh failure and returns an honest empty state after retry', async () => {
    const user = userEvent.setup(); renderTab(); await screen.findByText(/已核验配置 abcdef1/);
    server.use(http.get('/api/insights/stage-duration', () => HttpResponse.json({ success: false, code: '10001', message: '请缩小日期范围' })));
    await user.click(screen.getByRole('button', { name: '刷新' }));
    expect(await screen.findByText('阶段耗时加载失败')).toBeInTheDocument();
    expect(screen.getByText('请缩小日期范围')).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    server.use(http.get('/api/insights/stage-duration', () => HttpResponse.json(ok({ ...report, versionSamples: [] }))));
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('所选日期内暂无执行样本。')).toBeInTheDocument();
  });
});
