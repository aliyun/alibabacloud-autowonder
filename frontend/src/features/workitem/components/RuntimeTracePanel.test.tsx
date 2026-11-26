import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { i18n } from '@/shared/i18n';
import type { ProcessGraphNode, RuntimeTrace, RuntimeTraceContextFile, RuntimeTraceObservation, RuntimeTraceTurn } from '@/shared/types/workitem';
import { getRuntimeTrace, getRuntimeTraceContext, getRuntimeTraceObservation, getRuntimeTraceTurn } from '../api';
import { RuntimeTracePanel } from './RuntimeTraceDrawer';

vi.mock('../api', () => ({
  getRuntimeTrace: vi.fn(),
  getRuntimeTraceContext: vi.fn(),
  getRuntimeTraceObservation: vi.fn(),
  getRuntimeTraceTurn: vi.fn(),
}));

const usage = { available: false, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 };
const previewFile: RuntimeTraceContextFile = { contentRef: 'ctx:a', name: 'alpha.txt', role: 'CONTEXT', previewable: true };
const secondFile: RuntimeTraceContextFile = { ...previewFile, contentRef: 'ctx:b', name: 'beta.txt' };
const binaryFile: RuntimeTraceContextFile = { ...previewFile, contentRef: 'ctx:binary', name: 'archive.bin', previewable: false };
const observation = (id: string, output?: string): RuntimeTraceObservation => ({ observationId: id, type: 'TOOL', name: `tool-${id}`, output, children: [] });
const turn = (id: string, output?: string): RuntimeTraceTurn => ({
  traceId: id, turnId: id, output, tokenUsage: usage, eventIds: [], spans: [],
  observations: [observation(`o-${id}`)], contextFiles: [previewFile, secondFile, binaryFile],
});
function trace(dispatchId = 44, source = 'OSS'): RuntimeTrace {
  return {
    dispatchId, source, changed: true, lastSeq: 7, tokenUsage: usage,
    events: [{ eventId: 'runtime', eventType: 'runtime.started', detail: { marker: 'runtime-only-detail' } }],
    sessions: [{
      sessionId: `session-${dispatchId}`, provider: 'qoder', tokenUsage: usage, eventIds: [],
      boundaries: [{ kind: 'checkpoint', label: 'checkpoint-boundary', detail: { marker: 'boundary-detail' } }],
      turns: [turn('t1'), turn('t2')],
    }],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush(action: () => void = () => {}) {
  await act(async () => { action(); });
}
const detailPane = () => screen.getByTestId('runtime-trace-detail-pane');
const selectTurn = (id = 't1') => fireEvent.click(screen.getByText(`Turn ${id}`));
const expandTurn = (id = 't1', count = 1) => fireEvent.click(screen.getByRole('button', { name: i18n.t('workitem:trace.turnSteps', { id, count }) }));
const selectObservation = (id = 't1') => fireEvent.click(screen.getByText(`tool-o-${id}`));
const selectSession = () => fireEvent.click(within(screen.getByTestId('runtime-trace-timeline-pane')).getByRole('button', { name: /session-44/ }));

beforeEach(() => {
  vi.mocked(getRuntimeTrace).mockReset().mockImplementation(async (id) => trace(Number(id)));
  vi.mocked(getRuntimeTraceTurn).mockReset().mockImplementation(async (_id, id) => turn(id, `loaded-${id}`));
  vi.mocked(getRuntimeTraceObservation).mockReset().mockImplementation(async (_id, id) => observation(id, `loaded-${id}`));
  vi.mocked(getRuntimeTraceContext).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RuntimeTracePanel standalone contract', () => {
  it('renders dispatch/status, diagnostics and the existing 42%/58% trace without a graph', async () => {
    render(<RuntimeTracePanel dispatchId={44} status="SUCCEEDED" />);
    await screen.findByText('Turn t1');
    expect(screen.getByTestId('runtime-trace-dispatch-summary')).toHaveTextContent('Dispatch #44');
    expect(screen.getByTestId('runtime-trace-panes')).toHaveStyle({ gridTemplateColumns: 'minmax(240px, 30%) 1fr' });
    expect(screen.getByText(i18n.t('workitem:diagnostics.title'))).toBeInTheDocument();
    expect(document.querySelector('.ant-drawer')).toBeNull();
    expect(getRuntimeTrace).toHaveBeenCalledWith(44, null);
    expect(getRuntimeTraceTurn).not.toHaveBeenCalled();
    expect(getRuntimeTraceObservation).not.toHaveBeenCalled();
    expect(getRuntimeTraceContext).not.toHaveBeenCalled();
  });

  it('shows runtime events without sessions and selects their raw details', async () => {
    vi.mocked(getRuntimeTrace).mockResolvedValue({ ...trace(), sessions: [] });
    render(<RuntimeTracePanel dispatchId={44} />);
    fireEvent.click(await screen.findByText('runtime.started'));
    expect(within(detailPane()).getByText(/runtime-only-detail/)).toBeInTheDocument();
  });

  it('retains failure reasons and continuity only when real graph context is supplied', async () => {
    vi.mocked(getRuntimeTrace).mockResolvedValue({ ...trace(), events: [{ eventType: 'step.failed', detail: { reason: 'raw failure' } }] });
    const node = { key: 'dispatch:44', dispatchId: 44, agentName: 'Agent' };
    render(<RuntimeTracePanel dispatchId={44} status="FAILED" node={node} processGraph={{ nodes: [node], edges: [
      { type: 'CONTINUE', sourceKey: 'dispatch:43', targetKey: node.key, sourceDispatchId: 43, label: '' },
      { type: 'CONTINUE', sourceKey: node.key, targetKey: 'dispatch:45', targetDispatchId: 45, label: '' },
    ] }} />);
    expect(await screen.findByTestId('dispatch-failure-reason')).toHaveTextContent('raw failure');
    expect(screen.getByTestId('runtime-trace-dispatch-summary')).toHaveTextContent('43');
    expect(screen.getByTestId('runtime-trace-dispatch-summary')).toHaveTextContent('45');
  });

  it('fetches only when visible with a non-null dispatch, including dispatch zero', async () => {
    const view = render(<RuntimeTracePanel dispatchId={44} visible={false} />);
    expect(view.container).toBeEmptyDOMElement();
    expect(getRuntimeTrace).not.toHaveBeenCalled();
    view.rerender(<RuntimeTracePanel dispatchId={null} />);
    expect(getRuntimeTrace).not.toHaveBeenCalled();
    view.rerender(<RuntimeTracePanel dispatchId={0} />);
    await screen.findByText('Turn t1');
    expect(getRuntimeTrace).toHaveBeenCalledWith(0, null);
    expect(screen.getByTestId('runtime-trace-dispatch-summary')).toHaveTextContent('Dispatch #0');
  });
});

describe('RuntimeTracePanel polling and lifecycle', () => {
  it('serializes slow requests, advances lastSeq and stops/resets on active changes', async () => {
    vi.useFakeTimers();
    const first = deferred<RuntimeTrace>();
    const poll = deferred<RuntimeTrace>();
    vi.mocked(getRuntimeTrace).mockReturnValueOnce(first.promise).mockReturnValueOnce(poll.promise);
    const view = render(<RuntimeTracePanel dispatchId={44} status="RUNNING" />);
    await flush(() => { vi.advanceTimersByTime(10000); });
    expect(getRuntimeTrace).toHaveBeenCalledTimes(1);
    await flush(() => first.resolve(trace()));
    await flush(() => { vi.advanceTimersByTime(1999); });
    expect(getRuntimeTrace).toHaveBeenCalledTimes(1);
    await flush(() => { vi.advanceTimersByTime(1); });
    expect(getRuntimeTrace).toHaveBeenLastCalledWith(44, 7);
    await flush(() => { vi.advanceTimersByTime(10000); });
    expect(getRuntimeTrace).toHaveBeenCalledTimes(2);
    view.rerender(<RuntimeTracePanel dispatchId={44} status="SUCCEEDED" />);
    expect(screen.queryByTestId('runtime-trace-panes')).not.toBeInTheDocument();
    await flush();
    expect(getRuntimeTrace).toHaveBeenLastCalledWith(44, null);
    await flush(() => poll.resolve({ ...trace(), lastSeq: 999, events: [{ eventType: 'stale.poll', detail: {} }] }));
    expect(screen.queryByText('stale.poll')).not.toBeInTheDocument();
    await flush(() => { vi.advanceTimersByTime(10000); });
    expect(getRuntimeTrace).toHaveBeenCalledTimes(3);
    view.rerender(<RuntimeTracePanel dispatchId={44} status="RUNNING" />);
    await flush();
    expect(getRuntimeTrace).toHaveBeenLastCalledWith(44, null);
  });

  it.each(['RUNNING', 'ACKED', 'DISPATCHED', 'PAUSING'])('polls %s and cancels the scheduled poll when hidden', async (status) => {
    vi.useFakeTimers();
    const view = render(<RuntimeTracePanel dispatchId={44} status={status} />);
    await flush();
    await flush(() => { vi.advanceTimersByTime(2000); });
    expect(getRuntimeTrace).toHaveBeenCalledTimes(2);
    view.rerender(<RuntimeTracePanel dispatchId={44} status={status} visible={false} />);
    expect(view.container).toBeEmptyDOMElement();
    await flush(() => { vi.advanceTimersByTime(10000); });
    expect(getRuntimeTrace).toHaveBeenCalledTimes(2);
    view.rerender(<RuntimeTracePanel dispatchId={44} status={status} />);
    await flush();
    expect(getRuntimeTrace).toHaveBeenLastCalledWith(44, null);
  });

  it.each(['SUCCEEDED', 'FAILED', 'PAUSED', undefined])('does not poll inactive status %s', async (status) => {
    vi.useFakeTimers();
    render(<RuntimeTracePanel dispatchId={44} status={status} />);
    await flush();
    await flush(() => { vi.advanceTimersByTime(10000); });
    expect(getRuntimeTrace).toHaveBeenCalledTimes(1);
  });

  it('isolates consecutive A/B/A dispatch requests, errors and sequence cursors', async () => {
    vi.useFakeTimers();
    const firstA = deferred<RuntimeTrace>();
    const b = deferred<RuntimeTrace>();
    const secondA = deferred<RuntimeTrace>();
    vi.mocked(getRuntimeTrace).mockReturnValueOnce(firstA.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(secondA.promise);
    const view = render(<RuntimeTracePanel dispatchId={44} status="RUNNING" />);
    view.rerender(<RuntimeTracePanel dispatchId={45} status="RUNNING" />);
    view.rerender(<RuntimeTracePanel dispatchId={44} status="RUNNING" />);
    await flush(() => secondA.resolve({ ...trace(), lastSeq: 12 }));
    await flush(() => {
      firstA.resolve({ ...trace(), lastSeq: 999, events: [{ eventType: 'stale.dispatch', detail: {} }] });
      b.reject(new Error('stale dispatch error'));
    });
    expect(screen.queryByText('stale.dispatch')).not.toBeInTheDocument();
    expect(screen.queryByText('stale dispatch error')).not.toBeInTheDocument();
    await flush(() => { vi.advanceTimersByTime(2000); });
    expect(getRuntimeTrace).toHaveBeenLastCalledWith(44, 12);
    expect(getRuntimeTrace).toHaveBeenCalledTimes(4);
  });

  it('rejects a late summary while hidden and reloads cleanly on reopen', async () => {
    const pending = deferred<RuntimeTrace>();
    vi.mocked(getRuntimeTrace).mockReturnValueOnce(pending.promise);
    const view = render(<RuntimeTracePanel dispatchId={44} />);
    await flush(() => {
      view.rerender(<RuntimeTracePanel dispatchId={44} visible={false} />);
      pending.resolve({ ...trace(), events: [{ eventType: 'hidden.summary', detail: {} }] });
    });
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(<RuntimeTracePanel dispatchId={44} />);
    await screen.findByText('Turn t1');
    expect(screen.queryByText('hidden.summary')).not.toBeInTheDocument();
    expect(getRuntimeTrace).toHaveBeenLastCalledWith(44, null);
  });
});

describe('RuntimeTracePanel selection generations', () => {
  it('keeps the newest OSS turn when earlier turn data arrives last', async () => {
    const first = deferred<RuntimeTraceTurn>();
    const second = deferred<RuntimeTraceTurn>();
    vi.mocked(getRuntimeTraceTurn).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<RuntimeTracePanel dispatchId={44} />);
    await screen.findByText('Turn t1');
    selectTurn();
    selectTurn('t2');
    await flush(() => second.resolve(turn('t2', 'newest turn')));
    await flush(() => first.resolve(turn('t1', 'stale turn')));
    expect(within(detailPane()).getByText('newest turn')).toBeInTheDocument();
    expect(screen.queryByText('stale turn')).not.toBeInTheDocument();
    expect(getRuntimeTraceTurn).toHaveBeenNthCalledWith(1, 44, 't1');
    expect(getRuntimeTraceTurn).toHaveBeenNthCalledWith(2, 44, 't2');
  });

  it('keeps the newest OSS observation when earlier observation data arrives last', async () => {
    const first = deferred<RuntimeTraceObservation>();
    const second = deferred<RuntimeTraceObservation>();
    vi.mocked(getRuntimeTraceObservation).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<RuntimeTracePanel dispatchId={44} />);
    await screen.findByText('Turn t1');
    expandTurn();
    expandTurn('t2');
    selectObservation();
    selectObservation('t2');
    await flush(() => second.resolve(observation('o-t2', 'newest observation')));
    await flush(() => first.resolve(observation('o-t1', 'stale observation')));
    expect(within(detailPane()).getByText('newest observation')).toBeInTheDocument();
    expect(screen.queryByText('stale observation')).not.toBeInTheDocument();
  });

  it.each(['session', 'boundary'])('invalidates pending turn and observation even for synchronous %s selection', async (kind) => {
    const pendingTurn = deferred<RuntimeTraceTurn>();
    const pendingObservation = deferred<RuntimeTraceObservation>();
    vi.mocked(getRuntimeTraceTurn).mockReturnValueOnce(pendingTurn.promise);
    vi.mocked(getRuntimeTraceObservation).mockReturnValueOnce(pendingObservation.promise);
    render(<RuntimeTracePanel dispatchId={44} />);
    await screen.findByText('Turn t1');
    expandTurn();
    selectTurn();
    selectObservation();
    if (kind === 'session') selectSession();
    else fireEvent.click(screen.getByText(/checkpoint-boundary/));
    await flush(() => {
      pendingTurn.resolve(turn('t1', 'stale turn'));
      pendingObservation.reject(new Error('stale observation error'));
    });
    expect(screen.queryByText('stale turn')).not.toBeInTheDocument();
    expect(screen.queryByText('stale observation error')).not.toBeInTheDocument();
    expect(detailPane().querySelector('.ant-spin')).toBeNull();
    expect(within(detailPane()).getByText(kind === 'session' ? 'session-44' : /boundary-detail/)).toBeInTheDocument();
  });

  it('does not let a stale failure/finally clear loading for the current selection', async () => {
    const old = deferred<RuntimeTraceTurn>();
    const current = deferred<RuntimeTraceObservation>();
    vi.mocked(getRuntimeTraceTurn).mockReturnValueOnce(old.promise);
    vi.mocked(getRuntimeTraceObservation).mockReturnValueOnce(current.promise);
    render(<RuntimeTracePanel dispatchId={44} />);
    await screen.findByText('Turn t1');
    expandTurn();
    selectTurn();
    selectObservation();
    await flush(() => old.reject(new Error('stale detail error')));
    expect(screen.queryByText('stale detail error')).not.toBeInTheDocument();
    expect(detailPane().querySelector('.ant-spin')).not.toBeNull();
    await flush(() => current.resolve(observation('o-t1', 'current detail')));
    expect(within(detailPane()).getByText('current detail')).toBeInTheDocument();
  });

  it('clears old detail immediately and clears errors on the next synchronous selection', async () => {
    const pending = deferred<RuntimeTraceTurn>();
    render(<RuntimeTracePanel dispatchId={44} />);
    await screen.findByText('Turn t1');
    selectTurn();
    await screen.findByText('loaded-t1');
    vi.mocked(getRuntimeTraceTurn).mockReturnValueOnce(pending.promise);
    selectTurn('t2');
    expect(screen.queryByText('loaded-t1')).not.toBeInTheDocument();
    await flush(() => pending.reject(new Error('current detail failure')));
    expect(screen.getByText('current detail failure')).toBeInTheDocument();
    selectSession();
    expect(screen.queryByText('current detail failure')).not.toBeInTheDocument();
    expect(within(detailPane()).getByText('session-44')).toBeInTheDocument();
  });

  it.each([
    ['dispatch', 'turn'], ['dispatch', 'observation'], ['node', 'turn'], ['node', 'observation'],
    ['hidden', 'turn'], ['hidden', 'observation'], ['active', 'turn'], ['active', 'observation'],
  ] as const)('isolates a pending %s lifecycle / %s detail response', async (change, kind) => {
    const pendingTurn = deferred<RuntimeTraceTurn>();
    const pendingObservation = deferred<RuntimeTraceObservation>();
    vi.mocked(getRuntimeTraceTurn).mockReturnValueOnce(pendingTurn.promise);
    vi.mocked(getRuntimeTraceObservation).mockReturnValueOnce(pendingObservation.promise);
    const node: ProcessGraphNode = { key: 'a', agentName: 'Agent' };
    const view = render(<RuntimeTracePanel dispatchId={44} node={node} />);
    await screen.findByText('Turn t1');
    if (kind === 'turn') selectTurn();
    else { expandTurn(); selectObservation(); }
    view.rerender(<RuntimeTracePanel dispatchId={change === 'dispatch' ? 45 : 44} node={change === 'node' ? { ...node, key: 'b' } : node} visible={change !== 'hidden'} status={change === 'active' ? 'RUNNING' : undefined} />);
    await flush(() => {
      pendingTurn.resolve(turn('t1', 'old lifecycle turn'));
      pendingObservation.resolve(observation('o-t1', 'old lifecycle observation'));
    });
    expect(screen.queryByText('old lifecycle turn')).not.toBeInTheDocument();
    expect(screen.queryByText('old lifecycle observation')).not.toBeInTheDocument();
    if (change === 'hidden') expect(view.container).toBeEmptyDOMElement();
    else expect(detailPane().querySelector('.ant-spin')).toBeNull();
  });
});

describe('RuntimeTracePanel context generations', () => {
  beforeEach(() => {
    vi.mocked(getRuntimeTrace).mockImplementation(async (id) => trace(Number(id), 'LIVE'));
  });

  it('only previews the latest context request and clears a preview on selection', async () => {
    const first = deferred<ArrayBuffer>();
    const second = deferred<ArrayBuffer>();
    vi.mocked(getRuntimeTraceContext).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<RuntimeTracePanel dispatchId={44} />);
    await screen.findByText('Turn t1');
    selectTurn();
    fireEvent.click(screen.getByText(previewFile.name));
    fireEvent.click(screen.getByText(secondFile.name));
    await flush(() => second.resolve(new TextEncoder().encode('latest context').buffer));
    await flush(() => first.resolve(new TextEncoder().encode('stale context').buffer));
    expect(screen.getByText('latest context')).toBeInTheDocument();
    expect(screen.queryByText('stale context')).not.toBeInTheDocument();
    selectSession();
    expect(screen.queryByText('latest context')).not.toBeInTheDocument();
  });

  it('catches current context errors and clears them on the next selection', async () => {
    vi.mocked(getRuntimeTraceContext).mockRejectedValueOnce(new Error('context failed'));
    render(<RuntimeTracePanel dispatchId={44} />);
    await screen.findByText('Turn t1');
    selectTurn();
    fireEvent.click(screen.getByText(previewFile.name));
    expect(await screen.findByText('context failed')).toBeInTheDocument();
    selectSession();
    expect(screen.queryByText('context failed')).not.toBeInTheDocument();
  });

  it('ignores a stale context error after selection changes', async () => {
    const pending = deferred<ArrayBuffer>();
    vi.mocked(getRuntimeTraceContext).mockReturnValueOnce(pending.promise);
    render(<RuntimeTracePanel dispatchId={44} />);
    await screen.findByText('Turn t1');
    selectTurn();
    fireEvent.click(screen.getByText(previewFile.name));
    selectSession();
    await flush(() => pending.reject(new Error('stale context failure')));
    expect(screen.queryByText('stale context failure')).not.toBeInTheDocument();
  });

  it.each([
    ['dispatch', true], ['dispatch', false], ['node', true], ['node', false],
    ['hidden', true], ['hidden', false], ['selection', true], ['selection', false],
    ['active', true], ['active', false], ['unmount', true], ['unmount', false],
  ] as const)('blocks late context preview/download after %s (previewable=%s), including same-microtask responses', async (change, previewable) => {
    const pending = deferred<ArrayBuffer>();
    vi.mocked(getRuntimeTraceContext).mockReturnValueOnce(pending.promise);
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const node: ProcessGraphNode = { key: 'a', agentName: 'Agent' };
    const view = render(<RuntimeTracePanel dispatchId={44} node={node} />);
    await screen.findByText('Turn t1');
    selectTurn();
    fireEvent.click(screen.getByText(previewable ? previewFile.name : binaryFile.name));
    await flush(() => {
      if (change === 'selection') selectSession();
      else if (change === 'unmount') view.unmount();
      else view.rerender(<RuntimeTracePanel dispatchId={change === 'dispatch' ? 45 : 44} node={change === 'node' ? { ...node, key: 'b' } : node} visible={change !== 'hidden'} status={change === 'active' ? 'RUNNING' : undefined} />);
      pending.resolve(new TextEncoder().encode('late context bytes').buffer);
    });
    expect(screen.queryByText('late context bytes')).not.toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    if (change === 'hidden') {
      expect(view.container).toBeEmptyDOMElement();
      view.rerender(<RuntimeTracePanel dispatchId={44} node={node} />);
      await screen.findByText('Turn t1');
      expect(screen.queryByText('late context bytes')).not.toBeInTheDocument();
    }
  });

  it('downloads current non-previewable bytes once with the original file name', async () => {
    vi.mocked(getRuntimeTraceContext).mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    const createObjectURL = vi.fn(() => 'blob:current');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe(binaryFile.name);
      expect(this.href).toBe('blob:current');
    });
    render(<RuntimeTracePanel dispatchId={44} />);
    await screen.findByText('Turn t1');
    selectTurn();
    fireEvent.click(screen.getByText(binaryFile.name));
    await flush();
    expect(getRuntimeTraceContext).toHaveBeenCalledWith(44, binaryFile.contentRef);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:current');
  });

  it('lists LIVE turn spans as nested tree rows and shows a clicked span on the right without requests', async () => {
    const span = (spanId: string, name: string, parentSpanId?: string) => ({
      spanId, parentSpanId, kind: 'tool', name, durationMs: 40, tokenUsage: usage, eventIds: [], input: `input-${spanId}`, output: `output-${spanId}`,
    });
    const live = trace(44, 'LIVE');
    live.sessions[0].turns = [{ ...turn('t1'), observations: [], systemPrompt: 'system body', spans: [span('a', 'read_file'), span('b', 'grep', 'a')] }];
    vi.mocked(getRuntimeTrace).mockResolvedValue(live);
    render(<RuntimeTracePanel dispatchId={44} />);
    const timeline = within(await screen.findByTestId('runtime-trace-timeline-pane'));
    expect(timeline.queryByRole('button', { name: /grep/ })).not.toBeInTheDocument();
    expandTurn('t1', 2);
    const child = await timeline.findByRole('button', { name: /grep/ });
    expect(child.parentElement).toHaveClass('runtime-trace-obs-children');
    expect(child).toHaveAttribute('title', 'grep');
    selectTurn();
    expect(within(detailPane()).getByText('system body')).toHaveClass('runtime-trace-pre');
    expect(within(detailPane()).queryByText('read_file')).not.toBeInTheDocument();
    fireEvent.click(child);
    expect(within(detailPane()).getByText('input-b')).toBeInTheDocument();
    expect(within(detailPane()).getByText('output-b')).toBeInTheDocument();
    expect(getRuntimeTraceTurn).not.toHaveBeenCalled();
    expect(getRuntimeTraceObservation).not.toHaveBeenCalled();
  });
});
