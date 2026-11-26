import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { message, Modal } from 'antd';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkitemActionBar } from './WorkitemActionBar';
import { DeliveryStartRecords, RecoveryControls } from './RecoveryControls';
import type { DeliveryControlAction, RestartRound } from './RecoveryControls';
import { apiClient } from '@/shared/api/client';
import { useAuthStore } from '@/shared/auth/store';

vi.mock('@/shared/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

type Pending<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void };
function pending<T>(): Pending<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function actionBar(deliveryControl: DeliveryControlAction | null, onStartDelivery?: () => void) {
  return <WorkitemActionBar deliveryControl={deliveryControl} workType="REQ" statusName="开发中" priority={1} hasSdlc onStartDelivery={onStartDelivery} />;
}
function show(closed: boolean, status: string, recovery = {}, restarts: Array<Record<string, unknown>> = [],
              control: Record<string, unknown> | null = null) {
  vi.mocked(apiClient.get).mockResolvedValue({ data: { closed, canReopen: true,
    executions: [{ dispatchId: 100, agentId: 20, attempt: 2, status, recovery, control }], restarts } });
  const client = newClient();
  return render(<QueryClientProvider client={client}>
    <RecoveryControls workitemId="10" renderActions={actionBar} />
    <RecoveryControls workitemId="10" variant="execution" dispatchId={100} />
  </QueryClientProvider>);
}
function renderLedger(rounds: RestartRound[], props: Partial<ComponentProps<typeof DeliveryStartRecords>> = {}) {
  return render(<DeliveryStartRecords rounds={rounds} {...props} />);
}
function renderDelivery(onStartDelivery?: () => void) {
  const client = newClient();
  const renderActions = vi.fn((control: DeliveryControlAction | null) => actionBar(control, onStartDelivery));
  const view = (workitemId: string) => <QueryClientProvider client={client}>
    <RecoveryControls workitemId={workitemId} renderActions={renderActions} />
  </QueryClientProvider>;
  return { ...render(view('10')), view, client, renderActions };
}
function menuItem(menu: HTMLElement, label: string) {
  const item = within(menu).getByText(label).closest('[role="menuitem"]');
  if (!(item instanceof HTMLElement)) throw new Error(`Missing menu item: ${label}`);
  return item;
}
async function openDeliveryMenu(label = '关闭交付') {
  await userEvent.click(await screen.findByRole('button', { name: '更多工单操作' }));
  const menu = await screen.findByRole('menu');
  await within(menu).findByText(label);
  return menu;
}
async function requestDeliveryAction(label = '关闭交付') {
  const menu = await openDeliveryMenu(label);
  await userEvent.click(menuItem(menu, label));
  return screen.findByRole('dialog', { name: label });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.post).mockResolvedValue({ data: {} });
  useAuthStore.getState().clear();
  useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'O', description: '' }, 'READ_WRITE');
});
afterEach(() => {
  Modal.destroyAll();
  message.destroy();
  useAuthStore.getState().clear();
  vi.restoreAllMocks();
});

describe('delivery recovery', () => {
  it.each([false, true])('closes or reopens delivery through an explicit confirmed menu action when closed=%s', async (closed) => {
    show(closed, 'SUCCEEDED');
    const label = closed ? '重新开启交付' : '关闭交付';
    expect(await screen.findByTestId('workitem-action-bar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    const menu = await openDeliveryMenu(label);
    expect(menuItem(menu, label)).toHaveAttribute('aria-disabled', 'false');
    await userEvent.click(menuItem(menu, label));
    const dialog = await screen.findByRole('dialog', { name: label });
    expect(apiClient.post).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: label }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/workitems/10/recovery', {
      action: closed ? 'reopen' : 'close', dispatchId: undefined, force: false,
    }));
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not claim the runtime stopped after forced platform cancellation', async () => {
    show(true, 'CANCELED', { cancel_requested: 1, stop_pending: 1, forced: 1 }, [],
      { action: 'CANCEL', phase: 'UNCONFIRMED', origin: 'USER', forced: true, stopPending: true });
    const menu = await openDeliveryMenu('重新开启交付');
    expect(screen.getByText(/平台已结束，执行器停止未确认/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重\s*试/ })).not.toBeInTheDocument();
    expect(menuItem(menu, '重新开启交付')).toBeInTheDocument();
  });

  it('does not show the user force warning for a system timeout stop', async () => {
    show(true, 'TIMEOUT', { cancel_requested: 1, stop_pending: 1, forced: 1 }, [],
      { action: 'STOP', phase: 'REQUESTED', origin: 'TIMEOUT', forced: false, stopPending: true });
    await openDeliveryMenu('重新开启交付');
    expect(screen.queryByText(/平台已结束，执行器停止未确认/)).not.toBeInTheDocument();
  });

  it('keeps execution actions out of the recovery detail panel', async () => {
    show(false, 'FAILED');
    await openDeliveryMenu();
    expect(screen.queryByText('Dispatch 100 · 第 2 次')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '执行操作' })).not.toBeInTheDocument();
    expect(screen.queryByText('取消本次执行')).not.toBeInTheDocument();
  });
});

describe('delivery start records', () => {
  it('renders a single failed start as a section row with a red-only status', () => {
    renderLedger([{ restart_round: 1, status: 'FAILED', stop_reason: '数字员工未上线', gmt_create: '2026-09-18T08:00:00Z' }]);
    const block = screen.getByTestId('delivery-restart-rounds');
    expect(within(block).getByText('交付启动记录')).toBeInTheDocument();
    expect(within(block).getByText('交付启动')).toBeInTheDocument();
    const status = within(block).getByText('启动失败');
    expect(status).toHaveClass('aw-restart-status', 'is-failed');
    expect(within(block).getByText('数字员工未上线')).toBeInTheDocument();
    expect(within(block).queryByRole('button', { name: /全部/ })).not.toBeInTheDocument();
    expect(within(block).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the stopping-old-executions phase with its reason', () => {
    renderLedger([{ restart_round: 2, status: 'STOPPING_OLD', stop_reason: '正在停止旧执行 1 个，停止确认后启动新轮次' }]);
    const block = screen.getByTestId('delivery-restart-rounds');
    expect(within(block).getByText('第 2 轮')).toBeInTheDocument();
    expect(within(block).getByText('正在停止旧执行')).toHaveClass('aw-restart-status');
    expect(within(block).getByText(/正在停止旧执行 1 个/)).toBeInTheDocument();
  });

  it('keeps a normal latest round collapsed behind the fold control', async () => {
    renderLedger([
      { restart_round: 3, status: 'STARTED', dispatch_id: 88, source_dispatch_id: 86, gmt_create: '2026-09-18T08:00:00Z' },
      { restart_round: 2, status: 'SUPERSEDED', dispatch_id: 80 },
    ]);
    const block = screen.getByTestId('delivery-restart-rounds');
    const fold = within(block).getByRole('button', { name: /全部 2 次/ });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(within(block).queryByText('第 3 轮')).not.toBeInTheDocument();
    await userEvent.click(fold);
    expect(within(block).getByRole('button', { name: /收起轮次/ })).toHaveAttribute('aria-expanded', 'true');
    expect(within(block).getByText('第 3 轮')).toBeInTheDocument();
    expect(within(block).getByText('已启动')).toHaveClass('aw-restart-status');
    expect(within(block).getByText('Dispatch #88 · 替换 #86')).toBeInTheDocument();
    expect(within(block).getByText('已被新轮次取代')).toBeInTheDocument();
  });

  it('keeps historical failures collapsed when the current dispatch has no failing round', async () => {
    renderLedger([
      { restart_round: 10, status: 'FAILED', stop_reason: '数字员工未上线' },
      { restart_round: 4, status: 'FAILED', stop_reason: '执行器容量不足' },
    ], { currentDispatchId: 10046 });
    const block = screen.getByTestId('delivery-restart-rounds');
    expect(within(block).queryByText('第 10 轮')).not.toBeInTheDocument();
    const fold = within(block).getByRole('button', { name: /全部 2 次/ });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(fold);
    expect(within(block).getByText('第 10 轮')).toBeInTheDocument();
  });

  it('keeps a lone failed restart available after a previous dispatch', async () => {
    renderLedger([{ restart_round: 1, status: 'FAILED', stop_reason: '数字员工未上线' }],
      { currentDispatchId: 10046 });
    const block = screen.getByTestId('delivery-restart-rounds');
    const fold = within(block).getByRole('button', { name: /全部 1 次/ });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(within(block).queryByText('数字员工未上线')).not.toBeInTheDocument();
    await userEvent.click(fold);
    expect(within(block).getByText('数字员工未上线')).toBeInTheDocument();
  });

  it('expands a failure attached to the current dispatch', () => {
    renderLedger([{ restart_round: 2, status: 'FAILED', dispatch_id: 10046, stop_reason: '执行器未连接' }],
      { currentDispatchId: 10046 });
    const block = screen.getByTestId('delivery-restart-rounds');
    expect(within(block).getByText('第 2 轮')).toBeInTheDocument();
    expect(within(block).getByText('执行器未连接')).toBeInTheDocument();
  });

  it('renders newest first regardless of input order', () => {
    renderLedger([
      { restart_round: 1, status: 'FAILED', stop_reason: '数字员工未上线' },
      { restart_round: 3, status: 'FAILED', stop_reason: '执行器未连接' },
      { restart_round: 2, status: 'SUPERSEDED', dispatch_id: 40 },
    ]);
    const block = screen.getByTestId('delivery-restart-rounds');
    const rows = [...block.querySelectorAll('.aw-restart-no')].map(element => element.textContent);
    expect(rows).toEqual(['第 3 轮', '第 2 轮', '交付启动']);
  });

  it.each(['STARTED', 'STARTING'])('renders nothing for a single normal round (%s)', status => {
    const { container } = renderLedger([{ restart_round: 1, status, dispatch_id: 70 }]);
    expect(container).toBeEmptyDOMElement();
  });

  it('summarises the latest failure for a non-focused block with a clamped reason', () => {
    const long = 'SELECTION_INTERNAL_ERROR: 调度器内部错误，任务未派发；重试 3 次仍失败，请检查执行器连接与网络策略';
    renderLedger([{ restart_round: 4, status: 'FAILED', stop_reason: long, gmt_create: '2026-09-18T08:00:00Z' }],
      { variant: 'summary' });
    const summary = screen.getByTestId('recovery-controls');
    expect(summary).toHaveAttribute('role', 'alert');
    expect(summary).toHaveClass('aw-agent-block-sub');
    expect(within(summary).getByText('第 4 轮启动')).toBeInTheDocument();
    expect(within(summary).getByText('启动失败')).toHaveClass('is-failed');
    expect(within(summary).getByText(long)).toHaveAttribute('title', long);
    expect(screen.queryByTestId('delivery-restart-rounds')).not.toBeInTheDocument();
  });

  it('collapses a normal multi-round block into one quiet fold line and expands in place', async () => {
    renderLedger([
      { restart_round: 3, status: 'STARTED', dispatch_id: 90 },
      { restart_round: 2, status: 'STARTED', dispatch_id: 88 },
    ], { variant: 'summary' });
    const quiet = screen.getByRole('button', { name: '交付启动记录 · 2 次' });
    expect(quiet).toHaveClass('aw-agent-block-sub', 'is-quiet');
    expect(quiet).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(quiet);
    const block = screen.getByTestId('delivery-restart-rounds');
    expect(within(block).getByText('交付启动记录')).toBeInTheDocument();
    expect(within(block).getByText('第 3 轮')).toBeInTheDocument();
    expect(within(block).getByText('第 2 轮')).toBeInTheDocument();
  });

  it('downgrades a historical failure to the quiet fold for a non-focused block', () => {
    renderLedger([
      { restart_round: 3, status: 'STARTED', dispatch_id: 90 },
      { restart_round: 2, status: 'FAILED', stop_reason: '数字员工未上线' },
    ], { variant: 'summary', currentDispatchId: 90 });
    const quiet = screen.getByRole('button', { name: '交付启动记录 · 2 次' });
    expect(quiet).toHaveClass('is-quiet');
    expect(screen.queryByTestId('recovery-controls')).not.toBeInTheDocument();
    expect(screen.queryByText('数字员工未上线')).not.toBeInTheDocument();
  });

  it('hides a single successful start for a non-focused block', () => {
    const { container } = renderLedger([{ restart_round: 1, status: 'STARTED', dispatch_id: 70 }], { variant: 'summary' });
    expect(container).toBeEmptyDOMElement();
  });

  it('expands a failed summary into the full round list', async () => {
    renderLedger([
      { restart_round: 2, status: 'FAILED', stop_reason: '执行器未连接' },
      { restart_round: 1, status: 'SUPERSEDED', dispatch_id: 30, source_dispatch_id: 29 },
    ], { variant: 'summary' });
    await userEvent.click(screen.getByRole('button', { name: /全部 2 次/ }));
    const block = screen.getByTestId('delivery-restart-rounds');
    expect(within(block).getByText('第 2 轮')).toBeInTheDocument();
    expect(within(block).getByText('Dispatch #30 · 替换 #29')).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-controls')).not.toBeInTheDocument();
  });

  it('renders nothing for deliveries that were never restarted', () => {
    const { container } = renderLedger([]);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('recovery placement', () => {
  it('keeps execution recovery and restart rounds out of the page header', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { closed: false, executions: [{ dispatchId: 100, agentId: 20, attempt: 1, status: 'FAILED', recovery: {} }], restarts: [{ restart_round: 1, status: 'FAILED', stop_reason: '数字员工未上线' }] } });
    const client = newClient();
    render(<QueryClientProvider client={client}><RecoveryControls workitemId="10" /></QueryClientProvider>);
    await screen.findByRole('button', { name: '关闭交付' });
    expect(screen.queryByText(/执行恢复与取消|交付重启轮次|Dispatch|第 1 轮交付启动失败|数字员工未上线/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('delivery-restart-rounds')).not.toBeInTheDocument();
    expect(screen.queryByTestId('recovery-controls')).not.toBeInTheDocument();
  });

  it('shows only the selected dispatch and suppresses retry for an older attempt', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { closed: false, executions: [
      { dispatchId: 100, agentId: 20, attempt: 1, status: 'FAILED', error: 'old failure', recovery: {} },
      { dispatchId: 101, agentId: 20, attempt: 2, status: 'RUNNING', error: 'current detail', recovery: {} },
    ], restarts: [] } });
    const client = newClient();
    const view = (dispatchId: number) => <QueryClientProvider client={client}><RecoveryControls workitemId="10" variant="execution" dispatchId={dispatchId} /></QueryClientProvider>;
    const { rerender } = render(view(100));
    await screen.findByText('old failure');
    expect(screen.queryByText('current detail')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '执行操作' })).not.toBeInTheDocument();
    rerender(view(101));
    await screen.findByText('current detail');
    expect(screen.queryByText('old failure')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '执行操作' })).not.toBeInTheDocument();
  });
});

describe('delivery action placement contract', () => {
  it('renders the delivery descriptor only as a menu item, not an inline state/button group', async () => {
    show(false, 'SUCCEEDED');
    const actionBar = await screen.findByTestId('workitem-action-bar');
    expect(screen.queryByTestId('delivery-toggle')).not.toBeInTheDocument();
    expect(within(actionBar).queryByText('交付已开启')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭交付' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const menu = await openDeliveryMenu();
    expect(menuItem(menu, '关闭交付')).toHaveClass('ant-dropdown-menu-item-danger');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      '重新指派', '指派给真人', '立即对账', '关闭交付', '删除工单',
    ]);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves the standalone button and original confirmation when closed=%s', async (closed) => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { closed, canReopen: true, executions: [] } });
    render(<QueryClientProvider client={newClient()}><RecoveryControls workitemId="10" /></QueryClientProvider>);
    const label = closed ? '重新开启交付' : '关闭交付';
    const button = await screen.findByRole('button', { name: label });
    const group = screen.getByTestId('delivery-toggle');
    expect(group).toHaveClass('aw-delivery-toggle');
    expect(group.children).toHaveLength(2);
    expect(group.children[0]).toHaveClass('aw-delivery-toggle-state');
    expect(group.children[0]).toHaveTextContent(closed ? '交付已关闭' : '交付已开启');
    expect(group.children[1]).toBe(button);
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: label });
    expect(apiClient.post).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: label }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith('/api/workitems/10/recovery', { action: closed ? 'reopen' : 'close', dispatchId: undefined, force: false });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('supplies null while loading then a structured action descriptor without invoking it', async () => {
    const read = pending<{ data: unknown }>();
    vi.mocked(apiClient.get).mockReturnValue(read.promise as never);
    const renderActions = vi.fn((control: DeliveryControlAction | null) => actionBar(control));
    render(<QueryClientProvider client={newClient()}><RecoveryControls workitemId="10" renderActions={renderActions} /></QueryClientProvider>);
    expect(renderActions).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: '再次交付' })).toBeInTheDocument();
    await act(async () => { read.resolve({ data: { closed: false, canReopen: true, executions: [] } }); });
    await waitFor(() => expect(renderActions).toHaveBeenLastCalledWith({
      label: '关闭交付', danger: true, disabled: false, disabledReason: null, pending: false, invoke: expect.any(Function),
    }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('delivery switch state machine', () => {
  it('cancels without a write, closes once, and follows the server readback before reopening', async () => {
    let state = { closed: false, canReopen: true, executions: [] as unknown[] };
    vi.mocked(apiClient.get).mockImplementation(async () => ({ data: state }));
    const writes: Pending<{ data: unknown }>[] = [];
    vi.mocked(apiClient.post).mockImplementation(() => {
      const write = pending<{ data: unknown }>();
      writes.push(write);
      return write.promise as never;
    });
    const { renderActions } = renderDelivery();

    const cancelled = await requestDeliveryAction();
    await userEvent.click(within(cancelled).getByRole('button', { name: /^返\s*回$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiClient.post).not.toHaveBeenCalled();

    const closing = await requestDeliveryAction();
    const confirm = within(closing).getByRole('button', { name: '关闭交付' });
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(renderActions).toHaveBeenLastCalledWith(expect.objectContaining({ label: '关闭交付', pending: true })));
    await userEvent.click(confirm);
    expect(apiClient.post).toHaveBeenCalledTimes(1);

    state = { closed: true, canReopen: true, executions: [] };
    await act(async () => { writes[0].resolve({ data: {} }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const reopenedMenu = await openDeliveryMenu('重新开启交付');
    expect(menuItem(reopenedMenu, '重新开启交付')).toHaveAttribute('aria-disabled', 'false');
    await userEvent.click(menuItem(reopenedMenu, '重新开启交付'));
    const reopening = await screen.findByRole('dialog', { name: '重新开启交付' });
    await userEvent.click(within(reopening).getByRole('button', { name: '重新开启交付' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(apiClient.post).toHaveBeenLastCalledWith('/api/workitems/10/recovery', { action: 'reopen', dispatchId: undefined, force: false });

    state = { closed: false, canReopen: true, executions: [] };
    await act(async () => { writes[1].resolve({ data: {} }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const openMenu = await openDeliveryMenu();
    expect(menuItem(openMenu, '关闭交付')).toHaveAttribute('aria-disabled', 'false');
    expect(within(openMenu).queryByText('重新开启交付')).not.toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledTimes(2);
  });

  it('keeps reopen disabled while runs are unconfirmed and exposes the reason to keyboard focus', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { closed: true, canReopen: false, executions: [] } });
    renderDelivery();
    const menu = await openDeliveryMenu('重新开启交付');
    const reopen = menuItem(menu, '重新开启交付');
    expect(reopen).toHaveAttribute('aria-disabled', 'true');
    const hint = within(menu).getByLabelText('请先结束未完成的取消操作');
    expect(hint.tagName).toBe('SPAN');
    expect(hint).toHaveAttribute('tabindex', '0');
    act(() => { hint.focus(); });
    expect(hint).toHaveFocus();
    expect(await screen.findByRole('tooltip', { name: '请先结束未完成的取消操作' })).toBeInTheDocument();
    await userEvent.click(hint);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('preserves a focusable disabled-reopen reason for the standalone button too', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { closed: true, canReopen: false, executions: [] } });
    render(<QueryClientProvider client={newClient()}><RecoveryControls workitemId="10" /></QueryClientProvider>);
    const reopen = await screen.findByRole('button', { name: '重新开启交付' });
    expect(reopen).toBeDisabled();
    const hint = screen.getByLabelText('请先结束未完成的取消操作');
    expect(hint.tagName).toBe('SPAN');
    expect(hint).toHaveAttribute('tabindex', '0');
    act(() => { hint.focus(); });
    expect(hint).toHaveFocus();
    expect(await screen.findByRole('tooltip', { name: '请先结束未完成的取消操作' })).toBeInTheDocument();
    await userEvent.click(reopen);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('reports a rejected write without claiming the delivery closed', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { closed: false, canReopen: true, executions: [] } });
    const write = pending<{ data: unknown }>();
    vi.mocked(apiClient.post).mockReturnValue(write.promise as never);
    const error = vi.spyOn(message, 'error').mockImplementation(() => undefined as never);
    const success = vi.spyOn(message, 'success').mockImplementation(() => undefined as never);
    renderDelivery();
    const dialog = await requestDeliveryAction();
    await userEvent.click(within(dialog).getByRole('button', { name: '关闭交付' }));
    await act(async () => { write.reject(new Error('关闭交付失败')); });
    await waitFor(() => expect(error).toHaveBeenCalledWith('关闭交付失败'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
    const menu = await openDeliveryMenu();
    expect(menuItem(menu, '关闭交付')).toHaveAttribute('aria-disabled', 'false');
    expect(within(menu).queryByText('重新开启交付')).not.toBeInTheDocument();
  });

  it('keeps the open state until the post-close readback arrives', async () => {
    let gets = 0;
    const readback = pending<{ data: unknown }>();
    vi.mocked(apiClient.get).mockImplementation(async () => {
      gets += 1;
      if (gets === 2) return readback.promise;
      return { data: { closed: false, canReopen: true, executions: [] } };
    });
    const write = pending<{ data: unknown }>();
    vi.mocked(apiClient.post).mockReturnValue(write.promise as never);
    const { renderActions } = renderDelivery();
    const dialog = await requestDeliveryAction();
    await userEvent.click(within(dialog).getByRole('button', { name: '关闭交付' }));
    await act(async () => { write.resolve({ data: {} }); });
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(2));
    // 写成功但回读未到：不提前提供 reopen，弹窗仍在提交中。
    await waitFor(() => expect(renderActions).toHaveBeenLastCalledWith(expect.objectContaining({ label: '关闭交付', pending: true })));
    expect(screen.queryByText('重新开启交付')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    await act(async () => { readback.resolve({ data: { closed: true, canReopen: true, executions: [] } }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(menuItem(await openDeliveryMenu('重新开启交付'), '重新开启交付')).toHaveAttribute('aria-disabled', 'false');
  });

  it('never reuses one workitem delivery state on another workitem', async () => {
    const read = pending<{ data: unknown }>();
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => url.includes('/11/')
      ? read.promise : { data: { closed: false, canReopen: true, executions: [] } });
    const { view, rerender } = renderDelivery();
    const menu = await openDeliveryMenu();
    expect(menuItem(menu, '关闭交付')).toBeInTheDocument();
    rerender(view('11'));
    await waitFor(() => expect(within(menu).queryByText('关闭交付')).not.toBeInTheDocument());
    expect(within(menu).queryByText('重新开启交付')).not.toBeInTheDocument();
    await act(async () => { read.resolve({ data: { closed: true, canReopen: true, executions: [] } }); });
    await within(menu).findByText('重新开启交付');
    expect(within(menu).queryByText('关闭交付')).not.toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith('/api/workitems/11/recovery');
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('shows a load failure instead of guessing the delivery state and retains all primary actions', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('network'));
    const start = vi.fn();
    renderDelivery(start);
    expect(await screen.findByText('交付恢复状态加载失败，请刷新重试')).toBeInTheDocument();
    const bar = screen.getByTestId('workitem-action-bar');
    expect(within(bar).getByRole('button', { name: '流转状态' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: '关注工单' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: '添加评论' })).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: '再次交付' }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('delivery-toggle')).not.toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: '更多工单操作' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByText('关闭交付')).not.toBeInTheDocument();
    expect(within(menu).queryByText('重新开启交付')).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '删除工单' })).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('delivery recovery permission boundary', () => {
  it.each([false, true])('retains the menu entry but denies read-only confirmation writes when closed=%s', async (closed) => {
    useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'O', description: '' }, 'READ_ONLY');
    show(closed, 'SUCCEEDED');
    const label = closed ? '重新开启交付' : '关闭交付';
    const dialog = await requestDeliveryAction(label);
    await userEvent.click(within(dialog).getByRole('button', { name: label }));
    expect(await screen.findByText('当前为只读权限，恢复或关闭交付需要读写权限')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(menuItem(await openDeliveryMenu(label), label)).toHaveAttribute('aria-disabled', 'false');
  });

  it('rechecks current permissions when a confirmation opened with write access is submitted', async () => {
    show(false, 'SUCCEEDED');
    const dialog = await requestDeliveryAction();
    act(() => { useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'O', description: '' }, 'READ_ONLY'); });
    await userEvent.click(within(dialog).getByRole('button', { name: '关闭交付' }));
    expect(await screen.findByText('当前为只读权限，恢复或关闭交付需要读写权限')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});
