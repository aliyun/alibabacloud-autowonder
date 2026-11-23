import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/test/mocks/server';
import { ChiefTurnEvents } from '@/features/chiefOfStaff/ChiefTurnEvents';
import { TurnDetailToggle } from './TurnDetailToggle';

function itemsPage(base: string, total: number, cursors: number[], pageSize = 100) {
  return http.get(base, ({ request }) => {
    const after = Number(new URL(request.url).searchParams.get('cursor') ?? 0);
    cursors.push(after);
    const end = Math.min(total, after + pageSize);
    return HttpResponse.json({ success: true, code: '0', data: {
      items: Array.from({ length: end - after }, (_, index) => {
        const seq = after + index + 1;
        return { eventId: seq, revision: seq, eventSeq: seq, dispatchAttempt: 1,
          eventType: 'tool_use', state: 'READY', detailAvailable: false, truncated: false,
          summary: null, contentLength: 50, totalSegments: 1, occurredAt: null,
          payload: JSON.stringify({ type: 'tool_use', callId: `c${seq}`, tool: `Tool ${seq}` }) };
      }), nextCursor: end, hasMore: end < total, preparationStatus: 'READY',
      projectionVersion: 'v2-semantic', pendingCount: 0, failedCount: 0, retryAfterMs: null,
      publicationWatermark: total,
    } });
  });
}

function mockObservers() {
  const observers = new Set<Observer>();
  class Observer {
    targets = new Set<Element>();
    constructor(public callback: IntersectionObserverCallback) { observers.add(this); }
    observe(target: Element) {
      this.targets.add(target);
      if ((target as HTMLElement).style.minHeight === '1px') queueMicrotask(() => this.callback(
        [{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
    }
    disconnect() { observers.delete(this); }
  }
  const original = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = Observer as unknown as typeof IntersectionObserver;
  return {
    intersect: (target: Element) => {
      for (const observer of observers) if (observer.targets.has(target)) observer.callback(
        [{ target, isIntersecting: true } as IntersectionObserverEntry], observer as unknown as IntersectionObserver);
    },
    restore: () => { globalThis.IntersectionObserver = original; },
  };
}

describe('conversation history event windows', () => {
  it('clarification presents the completed process once and scrolls the rendered window, never replacing history', async () => {
    const cursors: number[] = [];
    const base = '/api/workitems/100/clarification-conversations/1';
    server.use(itemsPage(`${base}/turns/8/event-summaries`, 1500, cursors));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const io = mockObservers();
    const view = render(<QueryClientProvider client={client}>
      <TurnDetailToggle workitemId={100} conversationId={1} turnId={9} eventTurnId={8} />
    </QueryClientProvider>);
    try {
      fireEvent.click(screen.getByTestId('turn-detail-toggle-9'));
      // 整轮历史一次读完：游标一路到最后一页，没有被 1000 事件窗口截断。
      await waitFor(() => expect(screen.getByTestId('tool-call-c1500')).toBeInTheDocument(), { timeout: 10000 });
      expect(cursors).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400]);
      // 不再出现「更早/更晚」整批换窗口的边界导航。
      expect(screen.queryByTestId('content-window-later')).not.toBeInTheDocument();
      expect(screen.queryByTestId('content-window-earlier')).not.toBeInTheDocument();
      // DOM 仍由 200 节点虚拟窗口承载，只有滚动才扩展/收缩。
      expect(view.container.querySelectorAll('[data-event-body]').length).toBeLessThanOrEqual(200);
      await act(async () => { await Promise.resolve(); });
      for (let attempt = 0; attempt < 16 && !screen.queryByTestId('tool-call-c1'); attempt++) {
        const earlier = screen.queryByTestId('events-window-earlier');
        if (!earlier) break;
        // 让渲染窗口的观察器 effect 先落定，再触发滚动阅读。
        await act(async () => { io.intersect(earlier); });
      }
      expect(screen.getByTestId('tool-call-c1')).toBeInTheDocument();
      // 滚动只是渲染窗口变化，不产生新一轮摘要请求。
      expect(cursors).toHaveLength(15);
      expect(screen.queryByTestId('content-window-earlier')).not.toBeInTheDocument();
    } finally { view.unmount(); io.restore(); }
  }, 20000);

  it('chief keeps completed details unread until opened, then presents the process once without replacing it', async () => {
    const cursors: number[] = [];
    const base = '/api/platform/conversations/1';
    server.use(itemsPage(`${base}/turns/8/event-summaries`, 1500, cursors));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const io = mockObservers();
    const view = render(<QueryClientProvider client={client}>
      <ChiefTurnEvents scope={['test']} conversationId={1} turnId={8} processing={false} />
    </QueryClientProvider>);
    try {
      // 历史默认收起：未点击时不读取执行详情。
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(cursors).toEqual([]);
      fireEvent.click(screen.getByTestId('chief-turn-detail-toggle-8'));
      // 整轮历史一次读完：游标一路到最后一页，没有被 1000 事件窗口截断。
      await waitFor(() => expect(screen.getByTestId('tool-call-c1500')).toBeInTheDocument(), { timeout: 10000 });
      expect(cursors).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400]);
      // 不再出现「更早/更晚」整批换窗口的边界导航。
      expect(screen.queryByTestId('content-window-later')).not.toBeInTheDocument();
      expect(screen.queryByTestId('content-window-earlier')).not.toBeInTheDocument();
      // DOM 仍由 200 节点虚拟窗口承载，只有滚动才扩展/收缩。
      expect(view.container.querySelectorAll('[data-event-body]').length).toBeLessThanOrEqual(200);
      await act(async () => { await Promise.resolve(); });
      for (let attempt = 0; attempt < 16 && !screen.queryByTestId('tool-call-c1'); attempt++) {
        const earlier = screen.queryByTestId('events-window-earlier');
        if (!earlier) break;
        await act(async () => { io.intersect(earlier); });
      }
      expect(screen.getByTestId('tool-call-c1')).toBeInTheDocument();
      // 滚动只是渲染窗口变化，不产生新一轮摘要请求。
      expect(cursors).toHaveLength(15);
      expect(screen.queryByTestId('content-window-earlier')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '加载更多执行详情' })).not.toBeInTheDocument();
    } finally { view.unmount(); io.restore(); }
  }, 20000);
});
