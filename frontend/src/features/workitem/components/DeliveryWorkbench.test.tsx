import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { DeliveryProgress } from './DeliveryProgress';
import { i18n } from '@/shared/i18n';
import type { AgentDeliveryProgress, DeliveryProgress as Progress } from '@/shared/types/workitem';

vi.mock('./RuntimeLogDrawer', () => ({ RuntimeLogPanel: ({ dispatchId }: { dispatchId: number }) => <div data-testid="selected-terminal">{dispatchId}</div> }));
vi.mock('./LiveActivityPanel', () => ({ LiveActivityPanel: ({ dispatchId }: { dispatchId: number }) => <div data-testid="selected-activity">{dispatchId}</div> }));
vi.mock('./DispatchActivityFeed', () => ({ DispatchActivityFeed: ({ dispatchId }: { dispatchId: number }) => <span data-testid={`dispatch-activities-${dispatchId}`} /> }));
const agent = (id: number, name: string, dispatches: number[], status: AgentDeliveryProgress['status']): AgentDeliveryProgress => ({
  agentId: id, agentName: name, status, durationMs: 1000,
  steps: [{ stepId: id, name: `${name} stage`, status: status === 'active' ? 'active' : 'done', agentName: name, executorName: null, subSteps: null, durationMs: 1000,
    attempts: dispatches.map(dispatchId => ({ dispatchId, agentName: name, executorName: null, startedAt: null, durationMs: 1000, status: status === 'active' ? 'RUNNING' : 'SUCCEEDED', canPause: status === 'active' })) }],
});
const initial = (): Progress => ({ steps: [], agents: [agent(1, 'PM', [10], 'finished'), agent(2, 'RD', [20, 40], 'active'), agent(3, 'QA', [30], 'finished')] });
const handedOff = (): Progress => ({ steps: [], agents: [agent(1, 'PM', [10], 'finished'), agent(2, 'RD', [20, 40], 'finished'), agent(3, 'QA', [30, 50], 'active')] });
const open = async (agentName?: string): Promise<HTMLElement> => {
  const rail = screen.getByTestId('delivery-rail');
  const row = agentName
    ? within(rail).getByRole('button', { name: new RegExp(`^${agentName}`) })
    : within(rail).queryByTestId('current-agent-name')?.closest('button')
      ?? within(rail).getAllByTestId('delivery-agent-row')[0];
  fireEvent.click(row as HTMLElement);
  const workbench = await screen.findByTestId('delivery-workbench');
  fireEvent.click(within(workbench).getByRole('tab', { name: 'Terminal' }));
  return workbench;
};
const openExecutionLog = async (): Promise<HTMLElement> => {
  fireEvent.click(screen.getAllByRole('button', { name: '查看执行' })[0]);
  return await screen.findByTestId('delivery-workbench');
};
beforeEach(() => {
  server.use(http.get('/api/dispatches/:dispatchId/runtime-trace', ({ params }) => HttpResponse.json({
    success: true, code: '0', data: {
      dispatchId: Number(params.dispatchId), changed: true, events: [], sessions: [],
      tokenUsage: { available: false, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 },
    },
  })));
});
afterEach(async () => { await act(async () => { await i18n.changeLanguage('zh-CN'); }); });

describe('Delivery workbench', () => {
  it('binds recovery to the selected terminal', async () => {
    render(<DeliveryProgress progress={initial()} renderRecovery={id => <div data-testid="selected-recovery">{id}</div>} />);
    expect(screen.queryByTestId('selected-recovery')).not.toBeInTheDocument();
    await open();
    const workbench = await screen.findByTestId('delivery-workbench');
    expect(within(workbench).getByTestId('selected-recovery')).toHaveTextContent('40');
    expect(within(workbench).queryByText('Dispatch 20 · 1秒')).not.toBeInTheDocument();
    fireEvent.click(within(workbench).getByRole('button', { name: '更早 1 次' }));
    fireEvent.click(within(workbench).getByText('Dispatch 20 · 1秒'));
    expect(within(workbench).getByTestId('selected-terminal')).toHaveTextContent('20');
    expect(within(workbench).getByTestId('selected-recovery')).toHaveTextContent('20');
    expect(within(workbench).queryByRole('button', { name: /全部执行记录/ })).not.toBeInTheDocument();
  });
  it('shows step timings only inside the workbench and keeps historical execution timings separate', async () => {
    const progress = initial();
    progress.executions = [
      { dispatchId: 20, agentId: 2, agentName: 'RD', executorName: null, status: 'FAILED', startedAt: null, durationMs: 600_000,
        stepTimings: [{ stepId: 2, name: 'Old attempt', status: 'failed', durationMs: 600_000 }] },
      { dispatchId: 40, agentId: 2, agentName: 'RD', executorName: null, status: 'RUNNING', startedAt: null, durationMs: 60_000,
        stepTimings: [{ stepId: 2, name: 'Current attempt', status: 'active', durationMs: 60_000 }] },
    ];
    render(<DeliveryProgress progress={progress} />);
    expect(screen.queryByTestId('step-duration-chart')).not.toBeInTheDocument();
    await open();
    fireEvent.click(screen.getByRole('tab', { name: 'SDLC 阶段耗时' }));
    const panel = await screen.findByRole('tabpanel', { name: 'SDLC 阶段耗时' });
    await waitFor(() => expect(within(panel).getByText('Current attempt')).toBeVisible());
    expect(within(panel).getByTestId('step-duration-chart')).toHaveTextContent('本次执行 #40');
    expect(within(panel).getByTestId('step-duration-chart')).toHaveTextContent('步骤累计 1分');
    // Pinning history preserves the active view and switches its dispatch-scoped timings.
    fireEvent.click(within(screen.getByTestId('delivery-workbench')).getByRole('button', { name: '更早 1 次' }));
    fireEvent.click(within(screen.getByTestId('delivery-workbench')).getByRole('button', { name: /Dispatch 20 · 10分/ }));
    expect(screen.getByRole('tab', { name: 'SDLC 阶段耗时' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'SDLC 阶段耗时' })).toBe(panel);
    await waitFor(() => expect(within(panel).getByText('Old attempt')).toBeVisible());
    expect(within(panel).getByTestId('step-duration-chart')).toHaveTextContent('本次执行 #20');
    expect(within(panel).getByText('步骤累计 10分')).toBeVisible();
    expect(within(panel).queryByText('Current attempt')).not.toBeInTheDocument();
  });
  it('shows one current owner and orders handoffs by execution rather than agent order', async () => {
    render(<DeliveryProgress progress={initial()} />);
    expect(screen.getByTestId('current-agent-name')).toHaveTextContent('RD');
    const workbench = await open();
    const sidebar = workbench.querySelector('.delivery-workbench-rail') as HTMLElement;
    const grouping = within(sidebar).getByRole('group', { name: '执行轨迹分组' });
    expect(within(grouping).getByRole('button', { name: '按数字人' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sidebar).getByRole('separator', { name: '侧栏宽度' })).toHaveAttribute('aria-valuenow', '228');
    expect(workbench.querySelector('.delivery-workbench-layout')).toHaveStyle('--delivery-rail-width: 228px');
    const dispatchLabels = (container: Element) => [...container.querySelectorAll('.delivery-workbench-entry .delivery-workbench-entry-meta')].map(element => element.textContent);
    expect([...sidebar.querySelectorAll('.delivery-workbench-agent-group')].map(group => ({
      name: group.querySelector('.delivery-workbench-group-heading')?.textContent,
      dispatches: dispatchLabels(group),
    }))).toEqual([
      { name: 'PM', dispatches: ['Dispatch 10 · 1秒'] },
      { name: 'RD', dispatches: ['Dispatch 40 · 1秒'] },
      { name: 'QA', dispatches: ['Dispatch 30 · 1秒'] },
    ]);
    expect(within(sidebar).getByRole('button', { name: '更早 1 次' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(within(grouping).getByRole('button', { name: '按时间' }));
    expect(within(grouping).getByRole('button', { name: '按时间' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(grouping).getByRole('button', { name: '按数字人' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(sidebar).queryByRole('button', { name: /全部执行记录/ })).not.toBeInTheDocument();
    expect(dispatchLabels(sidebar)).toEqual(['Dispatch 40 · 1秒', 'Dispatch 30 · 1秒', 'Dispatch 20 · 1秒', 'Dispatch 10 · 1秒']);
    expect(within(sidebar).getByRole('button', { name: /Dispatch 40 · 1秒/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent(/^40$/);
    expect(within(screen.getByTestId('delivery-current-execution')).getByTestId('agent-current-activity')).toHaveTextContent('Dispatch 40');
  });
  it('shows only the latest session per agent with earlier ones in place and bounds the time view', async () => {
    render(<DeliveryProgress progress={{ steps: [], agents: [agent(1, 'RD', Array.from({ length: 20 }, (_, index) => index + 1), 'active')] }} />);
    const workbench = await open();
    expect(workbench.querySelectorAll('[data-testid="agent-progress-name"]')).toHaveLength(1);
    expect(within(workbench).queryByRole('button', { name: /全部执行记录/ })).not.toBeInTheDocument();
    const earlier = within(workbench).getByRole('button', { name: '更早 19 次' });
    expect(earlier).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(earlier);
    expect(workbench.querySelectorAll('[data-testid="agent-progress-name"]')).toHaveLength(20);
    expect(within(workbench).getByRole('button', { name: '仅看最近' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(workbench.querySelector('.delivery-workbench-rail') as HTMLElement).getByText('Dispatch 2 · 1秒'));
    fireEvent.click(within(workbench).getByRole('button', { name: '仅看最近' }));
    expect(workbench.querySelectorAll('[data-testid="agent-progress-name"]')).toHaveLength(2);
    expect(within(workbench).getByRole('button', { name: '更早 18 次' })).toBeInTheDocument();
    fireEvent.click(within(workbench).getByRole('button', { name: '按时间' }));
    expect(workbench.querySelectorAll('[data-testid="agent-progress-name"]')).toHaveLength(11);
    expect(within(workbench).getByText('Dispatch 11 · 1秒')).toBeInTheDocument();
    expect(within(workbench).queryByText('Dispatch 10 · 1秒')).not.toBeInTheDocument();
    expect(within(workbench).getByText('Dispatch 20 · 1秒')).toBeInTheDocument();
    expect(within(workbench).queryByText('Dispatch 1 · 1秒')).not.toBeInTheDocument();
    fireEvent.click(within(workbench).getByRole('button', { name: '全部执行记录（20）' }));
    const history = workbench.querySelector('.delivery-workbench-rail') as HTMLElement;
    expect(within(history).getAllByTestId('agent-progress-name')).toHaveLength(20);
    fireEvent.click(within(history).getByText('Dispatch 1 · 1秒'));
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('1');
    await act(async () => { await i18n.changeLanguage('en-US'); });
    expect(within(screen.getByTestId('delivery-workbench')).getByRole('button', { name: 'Recent only' })).toBeInTheDocument();
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('1');
  });
  it('folds an agent group from its heading without changing the selected session', async () => {
    render(<DeliveryProgress progress={initial()} />);
    const workbench = await open();
    const rd = [...workbench.querySelectorAll('.delivery-workbench-agent-group')].find(group => group.querySelector('.delivery-workbench-group-heading')?.textContent === 'RD') as HTMLElement;
    const heading = rd.querySelector('.delivery-workbench-ghead') as HTMLElement;
    expect(heading).toHaveAttribute('aria-expanded', 'true');
    expect(heading).toHaveTextContent('2');
    fireEvent.click(heading);
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    expect(within(rd).queryByText('Dispatch 40 · 1秒')).not.toBeInTheDocument();
    expect(within(rd).queryByRole('button', { name: '更早 1 次' })).not.toBeInTheDocument();
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('40');
    expect(within(workbench).getByText('Dispatch 10 · 1秒')).toBeInTheDocument();
    fireEvent.click(heading);
    expect(heading).toHaveAttribute('aria-expanded', 'true');
    expect(within(rd).getByText('Dispatch 40 · 1秒')).toBeInTheDocument();
  });
  it('groups a comment session without an SDLC agent under its own agent', async () => {
    render(<DeliveryProgress progress={{ steps: [], agents: [agent(1, 'RD', [20], 'finished')], executions: [{ dispatchId: 21, agentId: 9, agentName: 'Comment agent', executorName: null, status: 'RUNNING', startedAt: null, durationMs: null }] }} />);
    const workbench = await open();
    expect([...workbench.querySelectorAll('.delivery-workbench-group-heading')].map(element => element.textContent)).toEqual(['RD', 'Comment agent']);
    expect(within(workbench).getByRole('button', { name: /Dispatch 21/ })).toHaveAttribute('aria-pressed', 'true');
  });
  it('includes a comment dispatch missing from step attempts, with status tags and lifetime timestamps', async () => {
    const progress = initial();
    progress.agents![1].status = 'failed';
    progress.agents![1].steps[0].attempts!.forEach(attempt => { attempt.status = 'SUCCEEDED'; attempt.canPause = false; });
    progress.executions = [{ dispatchId: 11280, agentId: 2, agentName: 'RD', executorName: null, status: 'FAILED', resumeMode: 'CANONICAL_INTERACTION',
      error: 'raw <error> 中文', startedAt: '2026-10-09T02:00:00Z', endedAt: '2026-10-09T02:01:00Z', durationMs: 60000 }];
    render(<DeliveryProgress progress={progress} />);
    const card = screen.getByTestId('delivery-progress-card');
    expect(within(card).getByText('RD stage · Dispatch 11280')).toBeInTheDocument();
    const latest = within(card).getByTestId('delivery-current-execution');
    expect(latest.querySelector('.ant-tag')).toHaveTextContent('失败');
    await open();
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('11280');
    fireEvent.click(screen.getByRole('tab', { name: '执行详情' }));
    expect(screen.getByText('raw <error> 中文', { selector: 'pre' })).toBeInTheDocument();
    expect(screen.queryByTestId('delivery-step-2')).not.toBeInTheDocument();
    expect(screen.getAllByText(/派发时间：/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/结束时间：/).length).toBeGreaterThan(0);
    await act(async () => { await i18n.changeLanguage('en-US'); });
    expect(screen.getAllByText(/Dispatched:/).length).toBeGreaterThan(0);
    expect(screen.getByText('raw <error> 中文', { selector: 'pre' })).toBeInTheDocument();
  });
  it('shows an interaction without an SDLC agent and does not invent an end time for running work', async () => {
    render(<DeliveryProgress progress={{ steps: [], agents: [], executions: [{ dispatchId: 11281, agentId: 9, agentName: 'Comment agent', executorName: null, status: 'RUNNING', startedAt: null, durationMs: null }] }} />);
    expect(screen.getByTestId('current-agent-name')).toHaveTextContent('Comment agent');
    await open();
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('11281');
    fireEvent.click(screen.getByRole('tab', { name: '执行详情' }));
    expect(screen.getAllByText('结束时间：尚未结束').length).toBeGreaterThan(0);
    expect(screen.getAllByText('派发时间：未记录').length).toBeGreaterThan(0);
  });
  it('uses the latest comment execution for an existing finished agent', async () => {
    const progress: Progress = { steps: [], agents: [agent(1, 'PD', [11592], 'finished')], executions: [
      { dispatchId: 11592, agentId: 1, agentName: 'PD', executorName: null, status: 'SUCCEEDED', startedAt: null, durationMs: 1000 },
      { dispatchId: 11593, agentId: 1, agentName: 'PD', executorName: null, status: 'RUNNING', startedAt: null, durationMs: null },
    ] };
    const { rerender } = render(<DeliveryProgress progress={progress} />);
    expect(screen.getByTestId('current-agent-name')).toHaveTextContent('PD');
    await open();
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('11593');
    await act(async () => { await i18n.changeLanguage('en-US'); });
    expect(screen.getByTestId('selected-agent-name')).toHaveTextContent('PD');
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
    rerender(<DeliveryProgress progress={progress} terminalStatus="SUCCEEDED" />);
    expect(screen.getByTestId('selected-agent-name')).toHaveTextContent('PD');
    await waitFor(() => expect(screen.getByText('Latest execution session')).toBeVisible());
  });
  it('opens the execution log directly and returns to the current handoff explicitly', async () => {
    const { rerender } = render(<DeliveryProgress progress={initial()} />);
    await openExecutionLog();
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('40');
    rerender(<DeliveryProgress progress={handedOff()} />);
    // 「查看执行」固定的是 Dispatch，交接后仍停留在所查看的会话。
    expect(screen.getByTestId('selected-agent-name')).toHaveTextContent('RD');
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('40');
    await waitFor(() => expect(screen.getByText('已交接给 QA，当前保留所查看的历史会话。')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: '回到当前执行' }));
    expect(screen.getByTestId('selected-agent-name')).toHaveTextContent('QA');
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('50');
  });
  it('keeps a pinned historical session during handoff and returns explicitly to current', async () => {
    const { rerender } = render(<DeliveryProgress progress={initial()} />);
    await open();
    const workbench = within(screen.getByTestId('delivery-workbench'));
    fireEvent.click(workbench.getByText('PM', { selector: '[data-testid="agent-progress-name"]' }));
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('10');
    rerender(<DeliveryProgress progress={handedOff()} />);
    expect(screen.getByTestId('selected-agent-name')).toHaveTextContent('PM');
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('10');
    await waitFor(() => expect(screen.getByText('已交接给 QA，当前保留所查看的历史会话。')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: '回到当前执行' }));
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('50');
  });
  it('retains the selected session and sidebar setting after exit and locale changes', async () => {
    render(<DeliveryProgress progress={initial()} />);
    await open();
    fireEvent.click(within(screen.getByTestId('delivery-workbench')).getByText('PM', { selector: '[data-testid="agent-progress-name"]' }));
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    fireEvent.click(document.querySelector('.delivery-workbench-modal .ant-modal-close') as HTMLElement);
    await open('PM');
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('10');
    await act(async () => { await i18n.changeLanguage('en-US'); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeVisible());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Return to current execution' })).toBeVisible());
    expect(screen.getByTestId('selected-agent-name')).toHaveTextContent('PM');
  });
  it('keeps stages at the top of Details and selects the stage within that dispatch', async () => {
    render(<DeliveryProgress progress={initial()} />);
    expect(screen.queryByTestId('delivery-step-2')).not.toBeInTheDocument();
    const workbench = await open();
    const sidebar = workbench.querySelector('.delivery-workbench-rail') as HTMLElement;
    expect(sidebar.querySelector('.delivery-workbench-stages')).toBeNull();
    fireEvent.click(within(workbench).getByRole('tab', { name: '执行详情' }));
    const details = within(workbench).getByRole('tabpanel', { name: '执行详情' });
    const stages = details.querySelector('.delivery-workbench-stages') as HTMLElement;
    expect(details.firstElementChild).toBe(stages);
    expect(within(stages).getAllByRole('button').map(button => button.textContent)).toEqual(['RD stage']);
    const stage = within(stages).getByRole('button', { name: 'RD stage' });
    expect(stage).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(stage);
    expect(stage).toHaveAttribute('aria-pressed', 'true');
    expect(within(workbench).getByRole('tab', { name: '执行详情' })).toHaveAttribute('aria-selected', 'true');
    expect(details.querySelector('.delivery-workbench-detail-heading')).toHaveTextContent('RD stage');
    const selected = within(details).getByTestId('delivery-step-2');
    await waitFor(() => expect(selected).toBeVisible());
    expect(within(selected).getByText(/^执行中\s+1秒$/)).toBeVisible();
    expect(within(details).queryByTestId('delivery-step-1')).not.toBeInTheDocument();
    expect(within(details).queryByTestId('delivery-step-3')).not.toBeInTheDocument();
  });
  it('shows ending instead of pausing once a cancel intent exists', () => {
    const progress = initial();
    const rd = progress.agents![1];
    rd.steps[0].attempts![1].status = 'PAUSING';
    rd.steps[0].attempts![1].cancelRequested = true;
    render(<DeliveryProgress progress={progress} />);
    expect(screen.getAllByText(/正在结束/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/暂停中/)).not.toBeInTheDocument();
  });

  it('shows the pausing state without offering a duplicate pause action', () => {
    const progress = initial();
    const rd = progress.agents![1];
    rd.steps[0].attempts![0] = { ...rd.steps[0].attempts![0], canPause: false, canContinue: true, status: 'FAILED' };
    rd.steps[0].attempts![1].status = 'PAUSING';
    render(<DeliveryProgress progress={progress} />);
    expect(screen.queryByRole('button', { name: '继续执行' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '暂停中' })).not.toBeInTheDocument();
    expect(screen.getAllByText(/暂停中/).length).toBeGreaterThan(0);
  });
  it('does not claim live work after terminal convergence and keeps old sessions reachable', async () => {
    render(<DeliveryProgress progress={initial()} terminalStatus="SUCCEEDED" />);
    expect(screen.getByTestId('current-agent-name')).toHaveTextContent('RD');
    expect(within(screen.getByTestId('delivery-current-execution')).queryByText('执行中')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('delivery-current-execution')).getByText('已完成')).toBeVisible();
    await open();
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('40');
  });
  it('handles an active agent before a dispatch session is created', async () => {
    render(<DeliveryProgress progress={{ steps: [], agents: [agent(1, 'RD', [], 'active')] }} />);
    expect(screen.getByTestId('current-agent-name')).toHaveTextContent('RD');
    await open();
    await waitFor(() => expect(screen.getAllByText('暂无执行会话').length).toBeGreaterThan(0));
  });

  it.each([
    ['zh-CN', 'PENDING', 'NO_EXECUTOR_CAPACITY', '等待执行器容量'],
    ['en-US', 'PENDING', 'NO_EXECUTOR_CAPACITY', 'Waiting for executor capacity'],
    ['zh-CN', 'PACKAGING', null, '准备执行上下文'],
    ['zh-CN', 'DISPATCHED', null, '等待接单'],
    ['zh-CN', 'ACKED', null, '已接单'],
    ['zh-CN', 'RUNNING', null, '执行中'],
  ])('shows the actual dispatch phase in %s: %s', async (locale, status, waitingReason, label) => {
    await i18n.changeLanguage(locale!);
    const worker = agent(2, 'RD', [11761], 'active');
    worker.steps[0].attempts![0].status = status;
    worker.steps[0].attempts![0].waitingReason = waitingReason;
    worker.steps[0].executionStatus = status;
    render(<DeliveryProgress progress={{ steps: [], agents: [worker], executions: [{ ...worker.steps[0].attempts![0], agentId: 2 }] }} />);
    expect(screen.getAllByText(label!).length).toBeGreaterThan(0);
    if (status !== 'RUNNING') expect(screen.queryByText(locale === 'en-US' ? 'Running' : '执行中')).not.toBeInTheDocument();
  });
  it('keeps prior gate failures in historical dispatch details while the new handoff is queued', async () => {
    const raw = 'step "10083" gate: checklist not fully checked: "cl_2" remains pending; Artifact publication requires repair: code=ARTIFACT_REFERENCE_INVALID path="evidence/step-10083-route-conflict-evidence-r3.md" class="" sizeBytes=0 limitBytes=0 action=reference an existing regular file';
    const worker = agent(2, 'RD', [11664,11761], 'active');
    worker.steps[0].attempts![0].status = 'FAILED'; worker.steps[0].attempts![0].error = raw;
    worker.steps[0].attempts![1].status = 'PENDING'; worker.steps[0].attempts![1].waitingReason = 'NO_EXECUTOR_CAPACITY';
    worker.steps[0].executionStatus = 'PENDING'; worker.steps[0].waitingReason = 'NO_EXECUTOR_CAPACITY';
    render(<DeliveryProgress progress={{ steps: [], agents: [worker] }} />);
    await open(); fireEvent.click(screen.getByRole('tab', { name: '执行详情' }));
    expect(screen.queryByText(raw, { selector: 'pre' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '更早 1 次' }));
    fireEvent.click(screen.getAllByRole('button').find(button => button.textContent?.includes('Dispatch 11664'))!);
    fireEvent.click(screen.getByRole('tab', { name: '执行详情' }));
    expect(screen.getByText('dispatch 11664 · 执行失败')).toBeInTheDocument();
    expect(screen.getByText('检查项 cl_2 尚未完成。')).toBeInTheDocument();
    expect(screen.getByText(raw, { selector: 'pre' })).toBeInTheDocument();
  });

  it('uses the selected dispatch stage snapshot for both the details and timing views', async () => {
    const failure = 'step "10131" gate: checklist not fully checked: "statistics" remains pending';
    const progress: Progress = {
      steps: [],
      agents: [{
        agentId: 10033, agentName: '任务蒸馏数字员工', status: 'failed', durationMs: 10_000,
        steps: [
          { stepId: 10088, name: '收集工单执行日志', status: 'done', agentName: '任务蒸馏数字员工', executorName: null, subSteps: null, durationMs: 3000,
            attempts: [{ dispatchId: 12238, agentName: '任务蒸馏数字员工', executorName: null, status: 'FAILED', error: failure, startedAt: null, durationMs: 10_000 }] },
          { stepId: 10131, name: '分析日志、总结报告并提交 CR', status: 'failed', agentName: '任务蒸馏数字员工', executorName: null, subSteps: null, durationMs: null, attempts: [] },
        ],
      }],
      executions: [{
        dispatchId: 12238, agentId: 10033, agentName: '任务蒸馏数字员工', executorName: null, status: 'FAILED',
        error: failure, startedAt: null, durationMs: 10_000,
        stepTimings: [
          { stepId: 10088, name: '收集工单执行日志', status: 'done', durationMs: 3000 },
          { stepId: 10131, name: '分析日志、总结报告并提交 CR', status: 'failed', durationMs: 4000 },
        ],
      }],
    };
    render(<DeliveryProgress progress={progress} />);
    await open();
    fireEvent.click(screen.getByRole('tab', { name: '执行详情' }));
    const details = screen.getByRole('tabpanel', { name: '执行详情' });
    await waitFor(() => expect(within(within(details).getByTestId('delivery-step-10088')).getByText(/^已完成\s+3秒$/)).toBeVisible());
    const analyze = within(details).getByTestId('delivery-step-10131');
    expect(within(analyze).getByText(/^失败\s+4秒$/)).toBeVisible();
    // 阶段卡可折叠：默认只展开最后一个已执行阶段，执行者/第N次/执行详情在阶段内，顶部只留起止时间
    const collect = within(details).getByTestId('delivery-step-10088');
    const collectHead = within(collect).getByRole('button', { name: /收集工单执行日志/ });
    const analyzeHead = within(analyze).getByRole('button', { name: /分析日志、总结报告并提交 CR/ });
    expect(collectHead).toHaveAttribute('aria-expanded', 'false');
    expect(analyzeHead).toHaveAttribute('aria-expanded', 'true');
    expect(within(details).getAllByText('执行者: 任务蒸馏数字员工')).toHaveLength(1);
    expect(within(analyze).getByText('执行者: 任务蒸馏数字员工')).toBeVisible();
    expect(within(analyze).getByTestId('delivery-stage-attempt')).toHaveTextContent(/^第1次: 任务蒸馏数字员工 · 失败 · 10秒$/);
    expect(details.querySelectorAll('[data-testid="dispatch-activities-12238"]')).toHaveLength(1);
    expect(analyze.querySelector('[data-testid="dispatch-activities-12238"]')).not.toBeNull();
    expect(details.querySelector('.delivery-workbench-entry-meta')).not.toHaveTextContent('执行者');
    fireEvent.click(collectHead);
    expect(collectHead).toHaveAttribute('aria-expanded', 'true');
    expect(within(collect).getByText('执行者: 任务蒸馏数字员工')).toBeVisible();
    expect(collect.querySelector('[data-testid^="dispatch-activities-"]')).toBeNull();
    fireEvent.click(analyzeHead);
    expect(analyzeHead).toHaveAttribute('aria-expanded', 'false');
    expect(analyze.querySelector('[data-testid^="dispatch-activities-"]')).toBeNull();
    expect(within(details).queryByText('执行记录')).not.toBeInTheDocument();
    expect(within(details).getByText(failure, { selector: 'pre' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'SDLC 阶段耗时' }));
    const timing = screen.getByRole('tabpanel', { name: 'SDLC 阶段耗时' });
    await waitFor(() => expect(within(timing).getByTestId('step-duration-chart')).toHaveTextContent('本次执行 #12238'));
    await waitFor(() => expect(within(timing).getByText('步骤累计 7秒')).toBeVisible());
    expect(within(timing).getByText('收集工单执行日志')).toBeVisible();
    expect(within(timing).getByText('分析日志、总结报告并提交 CR')).toBeVisible();
    expect(within(timing).getByText('4秒')).toBeVisible();
  });

  it.each([[12238, true], [12300, false]])('shows runtime events of stages without an entry dispatch only on the agent current dispatch (%s)', async (currentDispatchId, shown) => {
    const progress: Progress = {
      steps: [],
      agents: [{
        agentId: 10033, agentName: '任务蒸馏数字员工', status: 'finished', durationMs: 10_000, currentDispatchId,
        steps: [
          { stepId: 10088, name: '收集工单执行日志', status: 'done', agentName: '任务蒸馏数字员工', executorName: null, subSteps: null, durationMs: 3000,
            attempts: [{ dispatchId: 12238, agentName: '任务蒸馏数字员工', executorName: null, status: 'SUCCEEDED', startedAt: null, durationMs: 10_000 }] },
          { stepId: 10131, name: '分析日志、总结报告并提交 CR', status: 'done', agentName: '任务蒸馏数字员工', executorName: null, durationMs: 4000, attempts: [],
            subSteps: [{ name: '开始执行', status: 'done' }, { name: '校验完成', status: 'done' }] },
        ],
      }],
      executions: [{
        dispatchId: 12238, agentId: 10033, agentName: '任务蒸馏数字员工', executorName: null, status: 'SUCCEEDED', startedAt: null, durationMs: 10_000,
        stepTimings: [
          { stepId: 10088, name: '收集工单执行日志', status: 'done', durationMs: 3000 },
          { stepId: 10131, name: '分析日志、总结报告并提交 CR', status: 'done', durationMs: 4000 },
        ],
      }],
    };
    render(<DeliveryProgress progress={progress} terminalStatus="SUCCEEDED" />);
    await open();
    fireEvent.click(screen.getByRole('tab', { name: '执行详情' }));
    const analyze = await within(screen.getByRole('tabpanel', { name: '执行详情' })).findByTestId('delivery-step-10131');
    expect(within(analyze).getByRole('button', { name: /分析日志、总结报告并提交 CR/ })).toHaveAttribute('aria-expanded', 'true');
    expect(within(analyze).queryByText('校验完成') !== null).toBe(shown);
  });

  it.each(['timing-first', 'details-first'])('keeps each view on the selected dispatch stage snapshot when switching executions (%s)', async (firstView) => {
    const progress: Progress = {
      steps: [],
      agents: [{
        agentId: 10033, agentName: '任务蒸馏数字员工', status: 'active', durationMs: 30_000,
        steps: [
          { stepId: 10088, name: '收集工单执行日志', status: 'done', agentName: '任务蒸馏数字员工', executorName: null, subSteps: null, durationMs: 3000,
            attempts: [
              { dispatchId: 12238, agentName: '任务蒸馏数字员工', executorName: null, status: 'FAILED', startedAt: null, durationMs: 10_000 },
              { dispatchId: 12255, agentName: '任务蒸馏数字员工', executorName: null, status: 'RUNNING', startedAt: null, durationMs: 20_000, canPause: true },
            ] },
        ],
      }],
      executions: [
        { dispatchId: 12238, agentId: 10033, agentName: '任务蒸馏数字员工', executorName: null, status: 'FAILED', error: 'first run failed on gate', startedAt: null, durationMs: 10_000,
          stepTimings: [
            { stepId: 10088, name: '收集工单执行日志', status: 'done', durationMs: 3000 },
            { stepId: 10131, name: '分析日志、总结报告并提交 CR', status: 'failed', durationMs: 4000 },
          ] },
        { dispatchId: 12255, agentId: 10033, agentName: '任务蒸馏数字员工', executorName: null, status: 'RUNNING', startedAt: null, durationMs: 20_000,
          stepTimings: [
            { stepId: 10088, name: '收集工单执行日志', status: 'done', durationMs: 6000 },
            { stepId: 10131, name: '分析日志、总结报告并提交 CR', status: 'active', durationMs: 20_000 },
          ] },
      ],
    };
    render(<DeliveryProgress progress={progress} />);
    await open();
    const workbench = within(screen.getByTestId('delivery-workbench'));
    expect(screen.getByTestId('selected-terminal')).toHaveTextContent('12255');
    fireEvent.click(workbench.getByRole('button', { name: '更早 1 次' }));
    if (firstView === 'details-first') {
      fireEvent.click(workbench.getByRole('tab', { name: '执行详情' }));
      const details = workbench.getByRole('tabpanel', { name: '执行详情' });
      const currentStage = within(details).getByTestId('delivery-step-10131');
      await waitFor(() => expect(within(currentStage).getByText(/^执行中\s+20秒$/)).toBeVisible());
      expect(within(details).getAllByText('执行者: 任务蒸馏数字员工')).toHaveLength(1);
      fireEvent.click(workbench.getByRole('button', { name: /Dispatch 12238 · 10秒/ }));
      expect(workbench.getByRole('tab', { name: '执行详情' })).toHaveAttribute('aria-selected', 'true');
      await waitFor(() => expect(within(details).queryByText(/执行中/)).not.toBeInTheDocument());
      expect(within(within(details).getByTestId('delivery-step-10131')).getByText(/^失败\s+4秒$/)).toBeVisible();
      fireEvent.click(workbench.getByRole('button', { name: '回到当前执行' }));
      await waitFor(() => expect(within(details).getByText(/^执行中\s+20秒$/)).toBeVisible());
    }
    fireEvent.click(workbench.getByRole('tab', { name: 'SDLC 阶段耗时' }));
    const timing = workbench.getByRole('tabpanel', { name: 'SDLC 阶段耗时' });
    await waitFor(() => expect(within(timing).getByTestId('step-duration-chart')).toHaveTextContent('本次执行 #12255'));
    await waitFor(() => expect(within(timing).getByText('步骤累计 26秒')).toBeVisible());
    fireEvent.click(workbench.getByRole('button', { name: /Dispatch 12238 · 10秒/ }));
    expect(workbench.getByRole('tab', { name: 'SDLC 阶段耗时' })).toHaveAttribute('aria-selected', 'true');
    expect(workbench.getByRole('tabpanel', { name: 'SDLC 阶段耗时' })).toBe(timing);
    await waitFor(() => expect(within(timing).getByTestId('step-duration-chart')).toHaveTextContent('本次执行 #12238'));
    await waitFor(() => expect(within(timing).getByText('步骤累计 7秒')).toBeVisible());
    expect(within(timing).queryByText('步骤累计 26秒')).not.toBeInTheDocument();
    fireEvent.click(workbench.getByRole('tab', { name: '执行详情' }));
    const details = workbench.getByRole('tabpanel', { name: '执行详情' });
    expect(within(details).getByText('first run failed on gate', { selector: 'pre' })).toBeInTheDocument();
    await waitFor(() => expect(within(within(details).getByTestId('delivery-step-10088')).getByText(/^已完成\s+3秒$/)).toBeVisible());
    const analyze = within(details).getByTestId('delivery-step-10131');
    expect(within(analyze).getByText(/^失败\s+4秒$/)).toBeVisible();
    // 12255 的 active 阶段不得出现在 12238 的详情中
    await waitFor(() => expect(within(details).queryByText(/执行中/)).not.toBeInTheDocument());
  });

  it('keeps the attempt-derived stages when a dispatch has no stage snapshot', async () => {
    const progress: Progress = {
      steps: [],
      agents: [{
        agentId: 10033, agentName: '任务蒸馏数字员工', status: 'failed', durationMs: 10_000,
        steps: [
          { stepId: 10088, name: '收集工单执行日志', status: 'done', agentName: '任务蒸馏数字员工', executorName: null, subSteps: null, durationMs: 3000,
            attempts: [{ dispatchId: 12238, agentName: '任务蒸馏数字员工', executorName: null, status: 'FAILED', startedAt: null, durationMs: 10_000 }] },
          { stepId: 10131, name: '分析日志、总结报告并提交 CR', status: 'failed', agentName: '任务蒸馏数字员工', executorName: null, subSteps: null, durationMs: null, attempts: [] },
        ],
      }],
      executions: [{ dispatchId: 12238, agentId: 10033, agentName: '任务蒸馏数字员工', executorName: null, status: 'FAILED', startedAt: null, durationMs: 10_000 }],
    };
    render(<DeliveryProgress progress={progress} />);
    await open();
    fireEvent.click(screen.getByRole('tab', { name: '执行详情' }));
    const details = screen.getByRole('tabpanel', { name: '执行详情' });
    expect(within(details).getByTestId('delivery-step-10088')).toBeInTheDocument();
    expect(within(details).queryByTestId('delivery-step-10131')).not.toBeInTheDocument();
  });

  it('renders a stage that ended without a completion record explicitly', async () => {
    const progress: Progress = {
      steps: [],
      agents: [{
        agentId: 10033, agentName: '任务蒸馏数字员工', status: 'finished', durationMs: 10_000,
        steps: [
          { stepId: 10088, name: '收集工单执行日志', status: 'done', agentName: '任务蒸馏数字员工', executorName: null, subSteps: null, durationMs: 3000,
            attempts: [{ dispatchId: 12238, agentName: '任务蒸馏数字员工', executorName: null, status: 'SUCCEEDED', startedAt: null, durationMs: 10_000 }] },
        ],
      }],
      executions: [{
        dispatchId: 12238, agentId: 10033, agentName: '任务蒸馏数字员工', executorName: null, status: 'SUCCEEDED', startedAt: null, durationMs: 10_000,
        stepTimings: [
          { stepId: 10088, name: '收集工单执行日志', status: 'done', durationMs: 3000 },
          { stepId: 10131, name: '分析日志、总结报告并提交 CR', status: 'interrupted', durationMs: 2000 },
        ],
      }],
    };
    render(<DeliveryProgress progress={progress} />);
    await open();
    fireEvent.click(screen.getByRole('tab', { name: '执行详情' }));
    const details = screen.getByRole('tabpanel', { name: '执行详情' });
    const interrupted = within(details).getByTestId('delivery-step-10131');
    expect(within(interrupted).getByText(/已结束，完成记录缺失/)).toBeInTheDocument();
    expect(within(interrupted).getByText(/2秒/)).toBeInTheDocument();
    await act(async () => { await i18n.changeLanguage('en-US'); });
    expect(within(details).getByText(/Ended without a completion record/)).toBeInTheDocument();
  });
});
