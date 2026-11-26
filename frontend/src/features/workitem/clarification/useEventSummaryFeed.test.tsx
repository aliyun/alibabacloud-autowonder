import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { EventWindowBoundary, EventWindowLatest } from './eventContentWindows';
import { eventCacheUsage } from './eventCacheBudget';
import { useRealtime } from '@/shared/realtime/useRealtime';
import { useEventSummaryFeed } from './useEventSummaryFeed';
import type { EventDisplaySource } from './eventDisplay';
import type { EventContentSegment, EventSummaryItem, EventSummaryPage } from './types';

vi.mock('@/shared/realtime/useRealtime', () => ({ useRealtime: vi.fn() }));

interface RealtimeOptions {
  enabled?: boolean;
  onReconnect?: () => void;
  onEvent?: (event: { channel: string; type: string; payload: unknown; timestamp: number }) => void;
}
const realtime = { current: null as RealtimeOptions | null };

function page(over: Partial<EventSummaryPage> = {}): EventSummaryPage {
  return {
    items: [], nextCursor: null, hasMore: false, preparationStatus: 'READY',
    projectionVersion: 'v1', pendingCount: 0, failedCount: 0, retryAfterMs: null, ...over,
  };
}

function source(overrides: Partial<EventDisplaySource> = {}): EventDisplaySource {
  return {
    summaries: vi.fn(async () => page()),
    content: vi.fn(),
    ...overrides,
  } as EventDisplaySource;
}

function mount(summaries: EventDisplaySource['summaries'], processing: boolean) {
  return renderHook(() => useEventSummaryFeed({
    source: source({ summaries }), conversationId: 1, turnId: 2, enabled: true, processing,
  }));
}

/** jsdom 没有布局：手动驱动窗口边界的 IntersectionObserver，用于验证阅读动作续读。 */
function mockWindowObserver() {
  const callbacks: IntersectionObserverCallback[] = [];
  const original = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) { callbacks.push(callback); }
    observe() {} disconnect() {}
  } as unknown as typeof IntersectionObserver;
  return {
    intersect: () => { for (const callback of callbacks) callback(
      [{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); },
    restore: () => { globalThis.IntersectionObserver = original; },
  };
}

describe('useEventSummaryFeed', () => {
  it('coalesces model events into one visible update within the 50ms display frame', async () => {
    vi.useFakeTimers();
    const { result, unmount } = mount(async () => page(), true);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => {
      for (let seq = 1; seq <= 20; seq++) realtime.current?.onEvent?.({
        channel: 'conversation:1', type: 'CONVERSATION_TURN_EVENT', timestamp: 0,
        payload: { conversationId: 1, turnId: 2, dispatchAttempt: 1, eventSeq: seq,
          eventType: 'text', payload: { type: 'text', content: `${seq};` } },
      });
    });
    expect(result.current.items).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(49); });
    expect(result.current.items).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.items).toHaveLength(20);
    expect(result.current.timeline.map(node => node.text ?? '').join('')).toBe('1;2;3;4;5;6;7;8;9;10;11;12;13;14;15;16;17;18;19;20;');
    unmount();
  });
  beforeEach(() => {
    realtime.current = null;
    vi.mocked(useRealtime).mockImplementation((_channel, options) => {
      realtime.current = options as RealtimeOptions;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (document as unknown as { hidden?: boolean }).hidden;
  });

  it('stops polling while the page is hidden and resumes when it becomes visible', async () => {
    vi.useFakeTimers();
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    const summaries = vi.fn(async () => page({ preparationStatus: 'PARTIAL' }));

    const { unmount } = mount(summaries, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const initialCalls = summaries.mock.calls.length;
    expect(initialCalls).toBeGreaterThanOrEqual(1);

    hidden = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(3_500); });
    expect(summaries.mock.calls.length).toBe(initialCalls);

    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(summaries.mock.calls.length).toBeGreaterThan(initialCalls);
    unmount();
  });

  it('refreshes once on a matching display-available notification and ignores other turns', async () => {
    const summaries = vi.fn(async () => page());
    const { unmount } = mount(summaries, false);

    await waitFor(() => expect(summaries).toHaveBeenCalledTimes(1));
    // READY + 无更多内容 + 非运行中 → 轮询已停止，只由通知驱动
    expect(realtime.current?.onEvent).toBeTypeOf('function');

    await act(async () => {
      realtime.current!.onEvent!({
        channel: 'conversation:1', type: 'CONVERSATION_EVENT_DISPLAY_AVAILABLE',
        payload: { turnId: 99 }, timestamp: 0,
      });
      await Promise.resolve();
    });
    expect(summaries).toHaveBeenCalledTimes(1);

    await act(async () => {
      realtime.current!.onEvent!({
        channel: 'conversation:1', type: 'CONVERSATION_EVENT_DISPLAY_AVAILABLE',
        payload: { turnId: 2 }, timestamp: 0,
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(summaries).toHaveBeenCalledTimes(2));
    unmount();
  });

  it('backs off after a failed summary page instead of hammering the endpoint', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const summaries = vi.fn().mockRejectedValue(new Error('boom'));

    const { result, unmount } = mount(summaries, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(summaries).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(2_900); });
    expect(summaries).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(summaries).toHaveBeenCalledTimes(2);
    unmount();
  });

  function item(eventId: number): EventSummaryItem {
    return {
      eventId, eventType: 'text', dispatchAttempt: 1, eventSeq: eventId,
      occurredAt: null, state: 'READY', truncated: false, detailAvailable: false,
      summary: null, contentLength: 4, totalSegments: 1,
      payload: JSON.stringify({ type: 'text', content: `t${eventId}` }),
    };
  }

  it('shows a semantic body segment before the next segment finishes without opening details', async () => {
    let finish: ((value: EventContentSegment) => void) | undefined;
    const content = vi.fn(async (_turn: number, _event: number, cursor?: number) => {
      if (cursor === 1) return await new Promise<EventContentSegment>(resolve => { finish = resolve; });
      return {
        eventId: 1, content: JSON.stringify({ type: 'display_content', eventType: 'text',
          field: 'content', text: 'Already visible', metadata: { type: 'text' } }),
        segmentIndex: 0, previousCursor: null, nextCursor: 1, hasMore: true,
        projectionVersion: 'v2-semantic', state: 'READY', retryAfterMs: null,
      };
    }) as EventDisplaySource['content'];
    const { result, unmount } = renderHook(() => useEventSummaryFeed({
      source: source({ summaries: async () => page({ items: [{ ...item(1),
        detailAvailable: true, payload: null, totalSegments: 2 }] }), content }),
      conversationId: 1, turnId: 2, enabled: true, processing: true,
    }));
    await waitFor(() => expect(result.current.timeline.some(node => node.text === 'Already visible')).toBe(true));
    expect(content).toHaveBeenCalledTimes(2);
    unmount();
    finish?.({ eventId: 1, content: '', segmentIndex: 1, previousCursor: 0, nextCursor: null,
      hasMore: false, state: 'READY', projectionVersion: 'v2-semantic', retryAfterMs: null });
  });

  it('renders direct realtime content and replaces it when durable history catches up', async () => {
    const summaries = vi.fn(async () => page());
    const { result, unmount } = mount(summaries, true);
    await waitFor(() => expect(summaries).toHaveBeenCalledTimes(1));
    await act(async () => {
      realtime.current!.onEvent!({ channel: 'conversation:1', type: 'CONVERSATION_TURN_EVENT',
        payload: { conversationId: 1, turnId: 2, eventSeq: 7, dispatchAttempt: 1,
          eventType: 'text', payload: { type: 'text', content: 'live' } }, timestamp: 0 });
    });
    await waitFor(() => expect(result.current.timeline.map(node => node.text).join('')).toBe('live'));
    summaries.mockResolvedValueOnce(page({ items: [{ ...item(9), eventSeq: 7,
      payload: JSON.stringify({ type: 'text', content: 'live' }) }], nextCursor: 1 }));
    await act(async () => { await result.current.resume(); });
    expect(result.current.timeline.map(node => node.text).join('')).toBe('live');
    unmount();
  });

  it('resumes from the saved cursor after a realtime reconnect', async () => {
    const summaries = vi.fn(async (_turnId: number, _cursor?: number) => page({ items: [item(1)], nextCursor: 4 }));
    const { unmount } = mount(summaries, false);
    await waitFor(() => expect(summaries).toHaveBeenCalledTimes(1));
    await act(async () => { realtime.current!.onReconnect?.(); });
    await waitFor(() => expect(summaries).toHaveBeenCalledTimes(2));
    expect(summaries.mock.calls[1][1]).toBe(4);
    unmount();
  });

  it('keeps complete PRD text separately while message content is an automatically restorable eight-segment window', async () => {
    const body = { ...item(1), eventType: 'text', detailAvailable: true, payload: null,
      totalSegments: 20, contentLength: 10000 };
    const content = vi.fn(async (_turn: number, _event: number, cursor = 0): Promise<EventContentSegment> => ({
      eventId: 1, content: JSON.stringify({ type: 'display_content', field: 'content',
        text: `part-${cursor};`, metadata: { type: 'text' } }), segmentIndex: cursor,
      previousCursor: cursor ? cursor - 1 : null, nextCursor: cursor < 19 ? cursor + 1 : null,
      hasMore: cursor < 19, projectionVersion: 'v2-semantic', state: 'READY', retryAfterMs: null,
    }));
    const { result, rerender, unmount } = renderHook(({ processing }) => useEventSummaryFeed({ source: source({
      summaries: async () => page({ items: [body], nextCursor: 1 }), content }), conversationId: 1,
      turnId: 2, processing, enabled: true, retainBusinessText: true }), { initialProps: { processing: true } });
    await waitFor(() => expect(result.current.businessText).toContain('part-19;'));
    expect(result.current.businessText.startsWith('part-0;part-1;')).toBe(true);
    expect(result.current.items[0].contentWindow).toMatchObject({ first: 12, last: 19, total: 20 });
    expect(result.current.items[0].payload).not.toContain('part-0;');
    rerender({ processing: false });
    const callbacks: IntersectionObserverCallback[] = [];
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(callback: IntersectionObserverCallback) { callbacks.push(callback); }
      observe() {} disconnect() {}
    } as unknown as typeof IntersectionObserver;
    try {
      const window = result.current.items[0].contentWindow!;
      const view = render(<EventWindowBoundary window={window} direction="earlier" />);
      act(() => {
        callbacks[0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
        fireEvent.wheel(document.documentElement, { deltaY: -100 });
      });
      await waitFor(() => expect(result.current.items[0].contentWindow?.first).toBe(4));
      expect(result.current.items[0].payload).toContain('part-4;');
      expect(result.current.businessText).toContain('part-0;');
      expect(content).toHaveBeenCalledTimes(20);
      view.unmount();
    } finally { globalThis.IntersectionObserver = original; unmount(); }
  });

  it('stops a completed history at the bounded window instead of sweeping every page', async () => {
    vi.useFakeTimers();
    const cursors: (number | undefined)[] = [];
    const summaries = vi.fn(async (_turn: number, after = 0) => {
      cursors.push(after || undefined);
      const end = Math.min(1200, after + 200);
      return page({ items: Array.from({ length: end - after }, (_, index) => ({
        ...item(after + index + 1), revision: after + index + 1,
      })), nextCursor: end, hasMore: end < 1200, publicationWatermark: 1200 });
    });

    const { result, unmount } = mount(summaries, false);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // 必要初始加载只填满有界窗口：1..1000，游标停在 800。
    expect(result.current.items).toHaveLength(1000);
    expect(result.current.items[0].eventSeq).toBe(1);
    expect(result.current.items.at(-1)?.eventSeq).toBe(1000);
    expect(cursors).toEqual([undefined, 200, 400, 600, 800]);
    expect(result.current.hasMore).toBe(true);
    const ids = result.current.timeline.map(node => node.id);
    expect(result.current.timeline.some(node => node.id === 'history-earlier')).toBe(false);
    expect(result.current.timeline.find(node => node.id === 'history-later')!.contentWindow)
      .toMatchObject({ first: 0, last: 1000, total: 1201 });

    // 没有阅读动作时不再自动续读，已显示节点身份保持不变。
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(cursors).toEqual([undefined, 200, 400, 600, 800]);
    expect(result.current.timeline.map(node => node.id)).toEqual(ids);
    unmount();
  });

  it('loads later and earlier completed history through the existing window boundaries', async () => {
    const cursors: (number | undefined)[] = [];
    const summaries = vi.fn(async (_turn: number, after = 0) => {
      cursors.push(after || undefined);
      const end = Math.min(1200, after + 200);
      return page({ items: Array.from({ length: end - after }, (_, index) => ({
        ...item(after + index + 1), revision: after + index + 1,
      })), nextCursor: end, hasMore: end < 1200, publicationWatermark: 1200 });
    });

    const { result, unmount } = mount(summaries, false);
    await waitFor(() => expect(result.current.items).toHaveLength(1000));
    const ids = result.current.timeline.map(node => node.id).join('|');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
    expect(cursors).toEqual([undefined, 200, 400, 600, 800]);
    expect(result.current.timeline.map(node => node.id).join('|')).toBe(ids);

    const observer = mockWindowObserver();
    try {
      // 更晚历史：沿用窗口边界的滚动阅读动作续读，不靠自动追赶。
      const laterWindow = result.current.timeline.find(node => node.id === 'history-later')!.contentWindow!;
      const later = render(<EventWindowBoundary window={laterWindow} direction="later" />);
      act(() => {
        observer.intersect();
        fireEvent.wheel(document.documentElement, { deltaY: 100 });
      });
      await waitFor(() => expect(result.current.items.at(-1)?.eventSeq).toBe(1200));
      expect(result.current.items[0].eventSeq).toBe(201);
      expect(result.current.timeline.some(node => node.id === 'history-earlier')).toBe(true);

      // 更早历史：同一套边界动作回到最早一页。
      const earlierWindow = result.current.timeline.find(node => node.id === 'history-earlier')!.contentWindow!;
      const earlier = render(<EventWindowBoundary window={earlierWindow} direction="earlier" />);
      act(() => {
        observer.intersect();
        fireEvent.wheel(document.documentElement, { deltaY: -100 });
      });
      await waitFor(() => expect(result.current.items[0].eventSeq).toBe(1));

      // 阅读旧窗口时实时新事件不抢占当前阅读位置。
      act(() => realtime.current?.onEvent?.({ channel: 'conversation:1', type: 'CONVERSATION_TURN_EVENT',
        payload: { conversationId: 1, turnId: 2, dispatchAttempt: 1, eventSeq: 1300,
          eventType: 'text', payload: { type: 'text', content: 'new while reading older history' } }, timestamp: 0 }));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
      expect(result.current.items.some(entry => entry.eventSeq === 1300)).toBe(false);
      expect(result.current.items).toHaveLength(1000);

      // 返回最新仍能看到刚到达的实时事件。
      const navigation = result.current.timeline.find(node => node.id === 'history-latest')!.contentWindow!;
      const latest = render(<EventWindowLatest window={navigation} />);
      fireEvent.click(latest.getByRole('button'));
      await waitFor(() => expect(result.current.timeline.map(node => node.text ?? '').join(''))
        .toContain('new while reading older history'));
      latest.unmount(); earlier.unmount(); later.unmount();
    } finally { observer.restore(); unmount(); }
  });

  it('restores the earliest sparse publication page without subtracting from a publication id', async () => {
    const revisions = [1, 2, ...Array.from({ length: 1200 }, (_, index) => index + 2000)];
    const cursors: (number | undefined)[] = [];
    const summaries = vi.fn(async (_turn: number, after = 0) => {
      cursors.push(after || undefined);
      const remaining = revisions.filter(revision => revision > after);
      const selected = remaining.slice(0, 100);
      return page({ items: selected.map(revision => ({ ...item(revision), revision })),
        nextCursor: selected.at(-1) ?? after, hasMore: remaining.length > selected.length,
        publicationWatermark: 3199 });
    });

    const { result, unmount } = mount(summaries, false);
    await waitFor(() => expect(result.current.items).toHaveLength(1000));
    expect(result.current.items.at(-1)?.revision).toBe(2997);

    const observer = mockWindowObserver();
    try {
      const laterWindow = result.current.timeline.find(node => node.id === 'history-later')!.contentWindow!;
      const later = render(<EventWindowBoundary window={laterWindow} direction="later" />);
      act(() => {
        observer.intersect();
        fireEvent.wheel(document.documentElement, { deltaY: 100 });
      });
      await waitFor(() => expect(result.current.items.at(-1)?.revision).toBe(3199));

      const earlierWindow = result.current.timeline.find(node => node.id === 'history-earlier')!.contentWindow!;
      const earlier = render(<EventWindowBoundary window={earlierWindow} direction="earlier" />);
      act(() => {
        observer.intersect();
        fireEvent.wheel(document.documentElement, { deltaY: -100 });
      });
      await waitFor(() => expect(result.current.items[0].revision).toBe(1));
      expect(result.current.items[1].revision).toBe(2);
      expect(cursors).not.toContain(999);
      earlier.unmount(); later.unmount();
    } finally { observer.restore(); unmount(); }
  });

  it('keeps following a running turn past the bounded window', async () => {
    const summaries = vi.fn(async (_turn: number, after = 0) => {
      const end = Math.min(1200, after + 200);
      return page({ items: Array.from({ length: end - after }, (_, index) => ({
        ...item(after + index + 1), revision: after + index + 1,
      })), nextCursor: end, hasMore: end < 1200, publicationWatermark: 1200 });
    });

    const { result, unmount } = mount(summaries, true);
    await waitFor(() => expect(result.current.items.at(-1)?.eventSeq).toBe(1200), { timeout: 10_000 });
    expect(result.current.hasMore).toBe(false);
    unmount();
  });

  it('consumes the same semantic frame from realtime and durable recovery', async () => {
    const { result, unmount } = mount(async () => page(), true);
    await act(async () => { await Promise.resolve(); });
    act(() => realtime.current?.onEvent?.({ channel: 'conversation:1', type: 'CONVERSATION_TURN_EVENT',
      payload: { conversationId: 1, turnId: 2, eventSeq: 9, dispatchAttempt: 1, eventType: 'text',
        payload: { type: 'display_content', eventType: 'text', field: 'content', text: 'same semantic content',
          metadata: { type: 'text' } } }, timestamp: 0 }));
    await waitFor(() => expect(result.current.timeline[0]?.text).toBe('same semantic content'));
    unmount();
  });

  it('continues from the saved publication cursor on the next tick instead of restarting at zero', async () => {
    vi.useFakeTimers();
    const cursors: (number | undefined)[] = [];
    const summaries = vi.fn(async (_turnId: number, cursor?: number) => {
      cursors.push(cursor);
      if (cursor === undefined) {
        return page({ items: [item(1)], nextCursor: 1, hasMore: true, preparationStatus: 'PARTIAL' });
      }
      if (cursor === 1) {
        return page({ items: [item(2)], nextCursor: 2, hasMore: false, preparationStatus: 'PREPARING' });
      }
      return page({ nextCursor: 2 });
    });

    const { result, unmount } = mount(summaries, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(cursors).toEqual([undefined, 1]);
    expect(result.current.items).toHaveLength(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(3_500); });
    // 第二个 tick 从游标 2 继续；没有回到第一页。
    expect(cursors).toEqual([undefined, 1, 2]);
    unmount();
  });

  it('keeps the cursor even when hasMore is false so later publications are still read', async () => {
    const cursors: (number | undefined)[] = [];
    const summaries = vi.fn(async (_turnId: number, cursor?: number) => {
      cursors.push(cursor);
      if (cursor === undefined) return page({ items: [item(1)], nextCursor: 1 });
      return page({ items: [item(2)], nextCursor: 2, publicationWatermark: 2 });
    });

    const { result, unmount } = mount(summaries, false);
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      realtime.current!.onEvent!({
        channel: 'conversation:1', type: 'CONVERSATION_EVENT_DISPLAY_AVAILABLE',
        payload: { turnId: 2 }, timestamp: 0,
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(cursors).toEqual([undefined, 1]);
    expect(result.current.watermark).toBe(2);
    unmount();
  });

  it('keeps compensating after the turn ends until the published tail arrives', async () => {
    vi.useFakeTimers();
    let tailPublished = false;
    const summaries = vi.fn(async () => (tailPublished
      ? page({ items: [item(1)], nextCursor: 1, preparationStatus: 'READY' })
      : page({ nextCursor: 0, preparationStatus: 'PARTIAL' })));

    const { result, rerender, unmount } = renderHook(
      ({ processing }: { processing: boolean }) => useEventSummaryFeed({
        source: source({ summaries }), conversationId: 1, turnId: 2, enabled: true, processing,
      }),
      { initialProps: { processing: true } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.items).toHaveLength(0);
    expect(result.current.preparationStatus).toBe('PARTIAL');

    // 轮次终态（processing=false），但准备状态仍是 PARTIAL：必须继续补偿。
    rerender({ processing: false });
    expect(result.current.preparationStatus).toBe('PARTIAL');
    tailPublished = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(3_500); });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.preparationStatus).toBe('READY');

    // 排空后不再轮询。
    const calls = summaries.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(summaries.mock.calls.length).toBe(calls);
    unmount();
  });

  it('stops loading more after a 403 and keeps the denied state', async () => {
    const summaries = vi.fn()
      .mockResolvedValueOnce(page({
        items: [item(1)], nextCursor: 1, hasMore: true, preparationStatus: 'PARTIAL',
      }))
      .mockRejectedValueOnce({ response: { status: 403 } });

    const { result, unmount } = mount(summaries, false);
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => { await result.current.loadMore(); });
    expect(summaries).toHaveBeenCalledTimes(2);
    expect(result.current.authDenied).toBe(true);
    expect(result.current.error).toBe(true);

    // 鉴权失败后不再继续续读。
    await act(async () => { await result.current.loadMore(); });
    expect(summaries).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('stops polling after a 403 instead of retrying the denied endpoint', async () => {
    vi.useFakeTimers();
    const summaries = vi.fn().mockRejectedValue({ response: { status: 403 } });

    const { result, unmount } = mount(summaries, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(summaries).toHaveBeenCalledTimes(1);
    expect(result.current.authDenied).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(summaries).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('defers a slow legacy upgrade without declaring stored content unavailable and resumes on a new revision', async () => {
    vi.useFakeTimers();
    let upgraded = false;
    const legacy = { ...item(1), payload: null, detailAvailable: true,
      revision: 1, projectionVersion: 'v1', totalSegments: 100 };
    const content = vi.fn(async (): Promise<EventContentSegment> => ({ eventId: 1,
      content: upgraded ? JSON.stringify({ type: 'display_content', field: 'content',
        text: 'upgraded body', metadata: { type: 'text' } }) : '{"type":"text","content":"legacy"}',
      segmentIndex: 0, previousCursor: null, nextCursor: upgraded ? null : 1,
      hasMore: !upgraded, projectionVersion: upgraded ? 'v2-semantic' : 'v1', state: 'READY', retryAfterMs: null,
    }));
    const { result, unmount } = renderHook(() => useEventSummaryFeed({ source: source({
      summaries: async () => page({ items: [{ ...legacy, ...(upgraded
        ? { revision: 2, projectionVersion: 'v2-semantic', totalSegments: 1 } : {}) }], nextCursor: 2 }), content,
    }), conversationId: 1, turnId: 2, enabled: true, processing: false, keepAllEvents: true }));
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(result.current.preparationStatus).toBe('DEFERRED');
      expect(result.current.items[0].state).toBe('READY');
      expect(result.current.items[0].deferred).toBe(true);
      expect(result.current.syncing).toBe(false);
      const calls = content.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(content).toHaveBeenCalledTimes(calls);
      upgraded = true;
      await act(async () => { await result.current.resume(); });
      expect(result.current.timeline.some(node => node.text === 'upgraded body')).toBe(true);
      expect(result.current.items[0].deferred).not.toBe(true);
    } finally { unmount(); }
  });

  it('aborts an in-flight earlier-content restoration when the document is hidden', async () => {
    const segment = (index: number): EventContentSegment => ({ eventId: 1,
      content: JSON.stringify({ type: 'display_content', field: 'content',
        text: `${index}:` + 'x'.repeat(8192), metadata: { type: 'text' } }),
      segmentIndex: index, previousCursor: index ? index - 1 : null, nextCursor: index < 499 ? index + 1 : null,
      hasMore: index < 499, projectionVersion: 'v2-semantic', state: 'READY', retryAfterMs: null });
    let firstCalls = 0;
    let restorationSignal: AbortSignal | undefined;
    let finish: ((value: EventContentSegment) => void) | undefined;
    const content = async (_turn: number, _event: number, index = 0, _version?: string, signal?: AbortSignal) => {
      if (index === 0 && ++firstCalls > 1) {
        restorationSignal = signal;
        return await new Promise<EventContentSegment>(resolve => { finish = resolve; });
      }
      return segment(index);
    };
    const { result, unmount } = renderHook(() => useEventSummaryFeed({ source: source({ summaries: async () => page({
      items: [{ ...item(1), payload: null, detailAvailable: true, totalSegments: 500, contentLength: 4 * 1024 * 1024 }],
      nextCursor: 1 }), content }), conversationId: 1, turnId: 2, enabled: true, processing: false }));
    const callbacks: IntersectionObserverCallback[] = [];
    const original = globalThis.IntersectionObserver;
    try {
      await waitFor(() => expect(result.current.items[0]?.contentWindow?.last).toBe(499));
      globalThis.IntersectionObserver = class {
        constructor(callback: IntersectionObserverCallback) { callbacks.push(callback); }
        observe() {} disconnect() {}
      } as unknown as typeof IntersectionObserver;
      const view = render(<EventWindowBoundary window={{ ...result.current.items[0].contentWindow!, first: 8 }} direction="earlier" />);
      act(() => {
        callbacks[0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
        fireEvent.wheel(document.documentElement, { deltaY: -100 });
      });
      await waitFor(() => expect(restorationSignal).toBeDefined());
      act(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(restorationSignal?.aborted).toBe(true);
      view.unmount();
    } finally { finish?.(segment(0)); unmount(); globalThis.IntersectionObserver = original; }
  });

  it('keeps loaded history when the turn leaves the viewport and resumes from the saved cursor', async () => {
    const cursors: (number | undefined)[] = [];
    const summaries = async (_turn: number, cursor?: number) => {
      cursors.push(cursor);
      return page({ items: [{ ...item(1), revision: 1,
        payload: JSON.stringify({ type: 'text', content: 'cached historical body' }) }], nextCursor: 1 });
    };
    const { result, rerender, unmount } = renderHook(({ enabled }) => useEventSummaryFeed({
      source: source({ summaries }), conversationId: 4242, turnId: 2, enabled, processing: false,
    }), { initialProps: { enabled: true } });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(eventCacheUsage(4242)).toBeGreaterThan(0);
    // 可见性只决定是否继续读：已加载事件、时间线与缓存都保留，不清空。
    rerender({ enabled: false });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.timeline.some(node => node.text === 'cached historical body')).toBe(true);
    expect(eventCacheUsage(4242)).toBeGreaterThan(0);
    rerender({ enabled: true });
    await waitFor(() => expect(cursors.length).toBeGreaterThan(1));
    // 重新可见从已存游标续读，而不是从窗口起点或 0 重放。
    expect(cursors.slice(0, 2)).toEqual([undefined, 1]);
    expect(result.current.timeline.some(node => node.text === 'cached historical body')).toBe(true);
    unmount();
    expect(eventCacheUsage(4242)).toBe(0);
  });

  it('presents a completed history once at full length without trimming or window replacement', async () => {
    const cursors: (number | undefined)[] = [];
    const summaries = vi.fn(async (_turn: number, after = 0) => {
      cursors.push(after || undefined);
      const end = Math.min(1200, after + 200);
      return page({ items: Array.from({ length: end - after }, (_, index) => ({
        ...item(after + index + 1), revision: after + index + 1,
      })), nextCursor: end, hasMore: end < 1200, publicationWatermark: 1200 });
    });
    const lengths: number[] = [];
    const { result, unmount } = renderHook(() => {
      const feed = useEventSummaryFeed({ source: source({ summaries }), conversationId: 1, turnId: 2,
        enabled: true, processing: false, keepAllEvents: true, atomicHistory: true });
      lengths.push(feed.items.length);
      return feed;
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1200), { timeout: 10_000 });
    // 读完所有页后只提交一次：没有 1000 条裁剪态或逐页增长的中间态。
    expect(lengths.filter(length => length > 0 && length < 1200)).toEqual([]);
    expect(cursors).toEqual([undefined, 200, 400, 600, 800, 1000]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.timeline.some(node => node.id === 'history-earlier'
      || node.id === 'history-later' || node.id === 'history-latest')).toBe(false);
    unmount();
  });

  it('restores an active turn atomically, then resumes incremental live updates', async () => {
    const summaries = vi.fn(async (_turn: number, after = 0) => {
      const end = Math.min(600, after + 200);
      return page({ items: Array.from({ length: end - after }, (_, index) => ({
        ...item(after + index + 1), revision: after + index + 1,
      })), nextCursor: end, hasMore: end < 600, preparationStatus: 'PARTIAL', publicationWatermark: 600 });
    });
    const lengths: number[] = [];
    const { result, unmount } = renderHook(() => {
      const feed = useEventSummaryFeed({ source: source({ summaries }), conversationId: 1, turnId: 2,
        enabled: true, processing: true, keepAllEvents: true, atomicHistory: true });
      lengths.push(feed.items.length);
      return feed;
    });
    await waitFor(() => expect(result.current.items).toHaveLength(600), { timeout: 10_000 });
    expect(lengths.filter(length => length > 0 && length < 600)).toEqual([]);

    act(() => realtime.current?.onEvent?.({
      channel: 'conversation:1', type: 'CONVERSATION_TURN_EVENT', timestamp: 0,
      payload: { conversationId: 1, turnId: 2, dispatchAttempt: 1, eventSeq: 601,
        eventType: 'text', payload: { type: 'text', content: 'live update' } },
    }));
    await waitFor(() => expect(result.current.items).toHaveLength(601));
    expect(result.current.items.at(-1)?.eventSeq).toBe(601);
    unmount();
  });

  it('appends running events past the former window cap without trimming displayed history', async () => {
    const summaries = vi.fn(async (_turn: number, after = 0) => {
      const end = Math.min(1300, after + 200);
      return page({ items: Array.from({ length: end - after }, (_, index) => ({
        ...item(after + index + 1), revision: after + index + 1, eventType: 'tool_use',
        payload: JSON.stringify({ type: 'tool_use', callId: `c${after + index + 1}`, tool: `Tool ${after + index + 1}` }),
      })), nextCursor: end, hasMore: end < 1300, publicationWatermark: 1300 });
    });
    const { result, unmount } = renderHook(() => useEventSummaryFeed({ source: source({ summaries }),
      conversationId: 1, turnId: 2, enabled: true, processing: true, keepAllEvents: true }));
    await waitFor(() => expect(result.current.items.at(-1)?.eventSeq).toBe(1300), { timeout: 10_000 });
    expect(result.current.items).toHaveLength(1300);
    expect(result.current.items[0].eventSeq).toBe(1);
    unmount();
  });

  it('presents a faithful long history with question cards and large outputs once, keeping every event', async () => {
    const TOTAL = 24_000;
    const largeOutput = (eventId: number) => ({
      eventId, revision: eventId, eventSeq: eventId, dispatchAttempt: 1, occurredAt: null,
      eventType: 'tool_result', state: 'READY' as const, truncated: true, detailAvailable: true,
      summary: `大输出 ${eventId}`, payload: null, contentLength: 40_000, totalSegments: 10,
    });
    const summaries = vi.fn(async (_turn: number, after = 0) => {
      const end = Math.min(TOTAL, after + 200);
      const items = Array.from({ length: end - after }, (_, index) => {
        const seq = after + index + 1;
        const common = { eventId: seq, revision: seq, eventSeq: seq, dispatchAttempt: 1, occurredAt: null,
          state: 'READY' as const, truncated: false, detailAvailable: false, summary: null as string | null,
          contentLength: 12, totalSegments: 1 };
        if (seq === 600 || seq === 9000 || seq === 18000) return { ...common, eventType: 'acp_elicitation',
          payload: JSON.stringify({ type: 'acp_elicitation', data: { requestId: `q${seq}`, message: `问题 ${seq}`, requestedSchema: { type: 'object' } } }) };
        if (seq % 997 === 0) return largeOutput(seq);
        if (seq % 2 === 0) return { ...common, eventType: 'thinking_delta',
          payload: JSON.stringify({ type: 'thinking', content: `思考 ${seq};` }) };
        if (seq % 7 === 0) return { ...common, eventType: 'tool_use',
          payload: JSON.stringify({ type: 'tool_use', tool: 'Bash', callId: `c${seq}` }) };
        return { ...common, eventType: 'text_delta', payload: JSON.stringify({ type: 'text', content: `正文 ${seq};` }) };
      });
      return page({ items, nextCursor: end, hasMore: end < TOTAL, publicationWatermark: TOTAL });
    });
    const content = vi.fn(async (_turn: number, eventId: number, cursor = 0): Promise<EventContentSegment> => ({
      eventId, content: JSON.stringify({ type: 'display_content', eventType: 'tool_result',
        field: 'output', text: `大输出 ${eventId}:${cursor};`, metadata: { type: 'tool_result', tool: 'Bash' } }),
      segmentIndex: cursor, previousCursor: cursor ? cursor - 1 : null, nextCursor: cursor < 9 ? cursor + 1 : null,
      hasMore: cursor < 9, projectionVersion: 'v2-semantic', state: 'READY', retryAfterMs: null,
    }));
    const lengths: number[] = [];
    const { result, unmount } = renderHook(() => {
      const feed = useEventSummaryFeed({ source: source({ summaries, content }), conversationId: 1,
        turnId: 2, enabled: true, processing: false, keepAllEvents: true, atomicHistory: true });
      lengths.push(feed.items.length);
      return feed;
    });
    await waitFor(() => expect(result.current.items).toHaveLength(TOTAL), { timeout: 60_000 });
    // 忠实夹具一次呈现：没有逐页/裁剪的中间态，也不出现替换窗口的边界导航。
    expect(lengths.filter(length => length > 0 && length < TOTAL)).toEqual([]);
    expect(result.current.items[0].eventSeq).toBe(1);
    expect(result.current.items.at(-1)?.eventSeq).toBe(TOTAL);
    expect(result.current.timeline.filter(node => node.kind === 'elicitation')).toHaveLength(3);
    expect(result.current.timeline.some(node => node.kind === 'tool')).toBe(true);
    expect(result.current.timeline.some(node => node.id === 'history-earlier'
      || node.id === 'history-later' || node.id === 'history-latest')).toBe(false);
    // 节点按事件顺序推进，身份只增不减；再次续读不重排。
    const nodeIds = result.current.timeline.map(node => node.id);
    const seqs = result.current.timeline.map(node => node.eventSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    await act(async () => { await result.current.resume(); });
    expect(result.current.timeline.map(node => node.id)).toEqual(nodeIds);
    unmount();
  }, 60_000);

  it('evicts payloads beyond the display budget and keeps an explicitly reopened one', async () => {
    const big = 'x'.repeat(1024 * 1024);
    const summaries = vi.fn(async () => page({ nextCursor: 4, items: [1, 2, 3, 4].map(seq => ({
      eventId: seq, revision: seq, eventSeq: seq, dispatchAttempt: 1, occurredAt: null,
      eventType: 'text', state: 'READY' as const, truncated: false, detailAvailable: false,
      summary: null, contentLength: big.length, totalSegments: 1,
      payload: JSON.stringify({ type: 'text', content: `${seq}:${big}` }),
    })) }));
    const { result, unmount } = renderHook(() => useEventSummaryFeed({ source: source({ summaries }),
      conversationId: 777, turnId: 2, enabled: true, processing: false, keepAllEvents: true }));
    await waitFor(() => expect(result.current.items).toHaveLength(4));
    // 4MiB 超过 3MiB 正文预算：较旧条目正文被淘汰，但摘要条目本身不被裁剪。
    const evicted = result.current.items.find(entry => entry.payload == null && entry.contentWindow?.evicted);
    expect(evicted).toBeTruthy();
    expect(result.current.items.filter(entry => entry.payload != null)).toHaveLength(2);

    const observer = mockWindowObserver();
    const view = render(<EventWindowBoundary window={evicted!.contentWindow!} direction="restore" />);
    try {
      act(() => { observer.intersect(); });
      // 用户显式恢复的正文保留下来，不会被当次预算检查立刻再淘汰。
      await waitFor(() => expect(result.current.items.find(entry =>
        entry.eventSeq === evicted!.eventSeq)?.payload).toContain('x'));

      // 后续 tick（轮询/合并提交）按新→旧扫描预算，恢复条目已钉在尾部，不得再次被淘汰。
      await act(async () => { await result.current.resume(); });
      await waitFor(() => {
        const restored = result.current.items.find(entry => entry.eventSeq === evicted!.eventSeq);
        expect(restored?.payload).toContain('x');
        expect(restored?.contentWindow?.evicted).not.toBe(true);
      });
    } finally { view.unmount(); observer.restore(); unmount(); }
  });

  it('keeps an explicitly reopened segmented event after later commits', async () => {
    const segmentText = 'x'.repeat(600 * 1024);
    const detail = { eventId: 1, revision: 1, eventSeq: 1, dispatchAttempt: 1, occurredAt: null,
      eventType: 'tool_result', state: 'READY' as const, truncated: true, detailAvailable: true,
      summary: '大输出', payload: null, contentLength: 2 * 600 * 1024, totalSegments: 2 };
    const filler = { eventId: 9, revision: 9, eventSeq: 9, dispatchAttempt: 1, occurredAt: null,
      eventType: 'text', state: 'READY' as const, truncated: false, detailAvailable: false,
      summary: null, contentLength: 2 * 1024 * 1024, totalSegments: 1,
      payload: JSON.stringify({ type: 'text', content: 'y'.repeat(2 * 1024 * 1024) }) };
    const summaries = vi.fn(async (_turn: number, after = 0) => (after === 0
      ? page({ items: [detail], nextCursor: 1 })
      : page({ items: [detail, filler], nextCursor: 2 })));
    const content = vi.fn(async (_turn: number, _event: number, cursor = 0): Promise<EventContentSegment> => ({
      eventId: 1, content: JSON.stringify({ type: 'display_content', eventType: 'tool_result', field: 'output',
        text: `out-${cursor}:${segmentText}`, metadata: { type: 'tool_result', tool: 'Bash' } }),
      segmentIndex: cursor, previousCursor: cursor ? cursor - 1 : null,
      nextCursor: cursor < 1 ? cursor + 1 : null, hasMore: cursor < 1,
      projectionVersion: 'v2-semantic', state: 'READY', retryAfterMs: null,
    }));
    const { result, unmount } = renderHook(() => useEventSummaryFeed({ source: source({ summaries, content }),
      conversationId: 888, turnId: 2, enabled: true, processing: false, keepAllEvents: true }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await waitFor(() => expect(result.current.syncing).toBe(false));
    // 新页追加超过预算的正文后，较早的分段事件被淘汰并保留恢复入口。
    await act(async () => { await result.current.resume(); });
    await waitFor(() => {
      const target = result.current.items.find(entry => entry.eventId === 1);
      expect(target?.payload).toBeNull();
      expect(target?.contentWindow?.evicted).toBe(true);
    });
    const evicted = result.current.items.find(entry => entry.eventId === 1);

    const observer = mockWindowObserver();
    const view = render(<EventWindowBoundary window={evicted!.contentWindow!} direction="restore" />);
    try {
      act(() => { observer.intersect(); });
      await waitFor(() => expect(result.current.items.find(entry =>
        entry.eventId === 1)?.contentWindow?.evicted).not.toBe(true));
      // 分段恢复同样钉住：后续提交不得再把刚恢复的正文淘汰。
      await act(async () => { await result.current.resume(); });
      await waitFor(() => {
        const restored = result.current.items.find(entry => entry.eventId === 1);
        expect(restored?.payload).toContain('out-0');
        expect(restored?.contentWindow?.evicted).not.toBe(true);
      });
    } finally { view.unmount(); observer.restore(); unmount(); }
  });

  it('stops idle polling once a stable terminal history is caught up and resumes on publication notices', async () => {
    vi.useFakeTimers();
    const summaries = vi.fn(async () => page({ items: [item(1)], nextCursor: 1 }));
    const { result, unmount } = renderHook(() => useEventSummaryFeed({ source: source({ summaries }),
      conversationId: 1, turnId: 2, enabled: true, processing: false, keepAllEvents: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.items).toHaveLength(1);
    const calls = summaries.mock.calls.length;
    // 终态已追平：不再每 30s 空转提交。
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(summaries.mock.calls.length).toBe(calls);
    // 尾部补齐仍由已发布通知驱动。
    await act(async () => {
      realtime.current?.onEvent?.({ channel: 'conversation:1', type: 'CONVERSATION_EVENT_DISPLAY_AVAILABLE',
        payload: { turnId: 2 }, timestamp: 0 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(summaries.mock.calls.length).toBeGreaterThan(calls);
    unmount();
  });

  it('keeps the running timeline intact when the turn completes', async () => {
    const summaries = vi.fn(async () => page({ nextCursor: 2, items: [
      { ...item(1), eventType: 'tool_use', payload: JSON.stringify({ type: 'tool_use', callId: 'c1', tool: 'Bash' }) },
      { ...item(2), eventType: 'thinking', payload: JSON.stringify({ type: 'thinking', content: '收尾' }) },
    ] }));
    const { result, rerender, unmount } = renderHook(({ running }) => useEventSummaryFeed({
      source: source({ summaries }), conversationId: 1, turnId: 2, enabled: true, processing: running,
      keepAllEvents: true }), { initialProps: { running: true } });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    const eventIds = result.current.items.map(entry => entry.eventId);
    const nodeIds = result.current.timeline.map(node => node.id);
    rerender({ running: false });
    expect(result.current.items.map(entry => entry.eventId)).toEqual(eventIds);
    expect(result.current.timeline.map(node => node.id)).toEqual(nodeIds);
    unmount();
  });

  it('does not re-read the stale auto cursor after a completed history navigation', async () => {
    const cursors: (number | undefined)[] = [];
    const summaries = vi.fn(async (_turn: number, after = 0) => {
      cursors.push(after || undefined);
      const end = Math.min(1200, after + 200);
      return page({ items: Array.from({ length: end - after }, (_, index) => ({
        ...item(after + index + 1), revision: after + index + 1,
      })), nextCursor: end, hasMore: end < 1200, publicationWatermark: 1200 });
    });

    const { result, unmount } = mount(summaries, false);
    await waitFor(() => expect(result.current.items).toHaveLength(1000));
    const observer = mockWindowObserver();
    try {
      const laterWindow = result.current.timeline.find(node => node.id === 'history-later')!.contentWindow!;
      const later = render(<EventWindowBoundary window={laterWindow} direction="later" />);
      act(() => {
        observer.intersect();
        fireEvent.wheel(document.documentElement, { deltaY: 100 });
      });
      await waitFor(() => expect(result.current.items.at(-1)?.eventSeq).toBe(1200));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
      // 批次结束后只补详情：导航前的自动游标 800 只能作为批次起点出现一次。
      expect(cursors).toEqual([undefined, 200, 400, 600, 800, 800, 1000]);
      later.unmount();
    } finally { observer.restore(); unmount(); }
  });

  it('drops a reversed history batch while a navigation batch is still in flight', async () => {
    const cursors: (number | undefined)[] = [];
    let block = false;
    let release: (() => void) | undefined;
    const summaries = vi.fn(async (_turn: number, after = 0) => {
      cursors.push(after || undefined);
      if (block && after === 800) await new Promise<void>(resolve => { release = resolve; });
      const end = Math.min(1200, after + 200);
      return page({ items: Array.from({ length: end - after }, (_, index) => ({
        ...item(after + index + 1), revision: after + index + 1,
      })), nextCursor: end, hasMore: end < 1200, publicationWatermark: 1200 });
    });

    const { result, unmount } = mount(summaries, false);
    await waitFor(() => expect(result.current.items).toHaveLength(1000));
    const observer = mockWindowObserver();
    try {
      const later = render(<EventWindowBoundary window={{ key: 'history:1:2:later', first: 0, last: 1000, total: 1201 }}
        direction="later" />);
      const earlier = render(<EventWindowBoundary window={{ key: 'history:1:2:earlier', first: 201, last: 1000, total: 1201 }}
        direction="earlier" />);
      block = true;
      act(() => {
        observer.intersect();
        fireEvent.wheel(document.documentElement, { deltaY: 100 });
      });
      await waitFor(() => expect(release).toBeDefined());
      // 导航批次在途：通知驱动的 tick 也不得插读旧自动游标。
      const readsWhileBlocked = cursors.length;
      act(() => { realtime.current?.onEvent?.({ channel: 'conversation:1',
        type: 'CONVERSATION_EVENT_DISPLAY_AVAILABLE', payload: { turnId: 2 }, timestamp: 0 }); });
      await act(async () => { await Promise.resolve(); });
      expect(cursors).toHaveLength(readsWhileBlocked);
      // 更晚批次在途：反向阅读不得再开一个批次改写当前窗口。
      act(() => { fireEvent.wheel(document.documentElement, { deltaY: -100 }); });
      await act(async () => { await Promise.resolve(); });
      expect(cursors.filter(cursor => cursor === undefined)).toHaveLength(1);
      expect(cursors.filter(cursor => cursor === 800)).toHaveLength(2);
      block = false;
      await act(async () => { release?.(); });
      await waitFor(() => expect(result.current.items.at(-1)?.eventSeq).toBe(1200));
      // 批次结束后反向阅读恢复可用。
      act(() => { fireEvent.wheel(document.documentElement, { deltaY: -100 }); });
      await waitFor(() => expect(cursors.filter(cursor => cursor === undefined)).toHaveLength(2));
      earlier.unmount(); later.unmount();
    } finally { observer.restore(); unmount(); }
  });

  it('releases the navigation guard when the conversation changes mid-batch', async () => {
    const cursors: (number | undefined)[] = [];
    let block = false;
    let release: (() => void) | undefined;
    const summaries = vi.fn(async (_turn: number, after = 0) => {
      cursors.push(after || undefined);
      if (block && after === 800) await new Promise<void>(resolve => { release = resolve; });
      const end = Math.min(1200, after + 200);
      return page({ items: Array.from({ length: end - after }, (_, index) => ({
        ...item(after + index + 1), revision: after + index + 1,
      })), nextCursor: end, hasMore: end < 1200, publicationWatermark: 1200 });
    });
    const { result, rerender, unmount } = renderHook(({ conversationId }) => useEventSummaryFeed({
      source: source({ summaries }), conversationId, turnId: 2, enabled: true, processing: false,
    }), { initialProps: { conversationId: 1 } });
    await waitFor(() => expect(result.current.items).toHaveLength(1000));
    const observer = mockWindowObserver();
    try {
      const later = render(<EventWindowBoundary window={{ key: 'history:1:2:later', first: 0, last: 1000, total: 1201 }}
        direction="later" />);
      block = true;
      act(() => { observer.intersect(); fireEvent.wheel(document.documentElement, { deltaY: 100 }); });
      await waitFor(() => expect(release).toBeDefined());
      const readsBeforeReset = cursors.length;
      rerender({ conversationId: 2 });
      // 上一个批次已随会话切换中止，守卫必须释放：新会话首个 tick 仍读摘要分页。
      await waitFor(() => expect(cursors.length).toBeGreaterThan(readsBeforeReset));
      block = false;
      await act(async () => { release?.(); });
      later.unmount();
    } finally { observer.restore(); unmount(); }
  });
});
