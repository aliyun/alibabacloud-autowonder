import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { emptyContentSegment, summaryPage } from '@/test/mocks/handlers';
import type { ClarificationElicitation } from '@/features/workitem/clarification/types';
import { ChiefTurnEvents } from './ChiefTurnEvents';

const SUMMARIES = '/api/platform/conversations/1/turns/2/event-summaries';
const CONTENT = '/api/platform/conversations/1/turns/2/event-summaries/:eventId/content';

function item(over: Record<string, unknown>) {
  return {
    eventId: 1, eventType: 'tool_result', dispatchAttempt: 1, eventSeq: 1,
    occurredAt: '2026-01-01T00:00:00Z', state: 'READY', truncated: false,
    detailAvailable: false, summary: '', contentLength: 1, totalSegments: 1, payload: '{}', ...over,
  };
}

function mount(processing: boolean, props: {
  questionHistory?: ClarificationElicitation[] | null;
  questionHistoryPaged?: boolean;
  onSettledQuestions?: (conversationId: number, turnId: number, requestIds: readonly string[]) => void;
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (running: boolean) => (
    <QueryClientProvider client={client}>
      <ChiefTurnEvents scope={['test']} conversationId={1} turnId={2} processing={running} {...props} />
    </QueryClientProvider>
  );
  const view = render(ui(processing));
  return { setProcessing: (running: boolean) => view.rerender(ui(running)) };
}

describe('ChiefTurnEvents detail presentation', () => {
  it('keeps historical execution details collapsed and unread until the reader opens them', async () => {
    let calls = 0;
    server.use(http.get(SUMMARIES, () => {
      calls += 1;
      return HttpResponse.json({
        success: true, code: '0', data: summaryPage([item({
          payload: JSON.stringify({ tool: 'Bash', callId: 'c1', status: 'completed', output: 'latest reply' }),
        })]),
      });
    }));
    const user = userEvent.setup();
    mount(false);
    expect(screen.queryByText('Bash')).not.toBeInTheDocument();
    expect(screen.queryByText('latest reply')).not.toBeInTheDocument();
    expect(calls).toBe(0);
    await user.click(screen.getByRole('button', { name: '查看执行详情' }));
    expect(await screen.findByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('latest reply')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起执行详情' })).toBeInTheDocument();
    expect(calls).toBeGreaterThan(0);
  });

  it('presents the completed turn whole and re-expands from retained content and the stored cursor', async () => {
    const cursors: string[] = [];
    server.use(http.get(SUMMARIES, ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor') ?? '';
      cursors.push(cursor);
      if (!cursor) return HttpResponse.json({
        success: true, code: '0',
        data: summaryPage([item({ eventId: 1, eventSeq: 1, eventType: 'log', payload: JSON.stringify({ type: 'log', content: 'first page' }) })],
          { hasMore: true, nextCursor: 10, preparationStatus: 'PARTIAL' }),
      });
      if (cursor === '10') return HttpResponse.json({
        success: true, code: '0',
        data: summaryPage([item({ eventId: 2, eventSeq: 2, eventType: 'log', payload: JSON.stringify({ type: 'log', content: 'second page' }) })],
          { hasMore: false, nextCursor: 11 }),
      });
      return HttpResponse.json({ success: true, code: '0', data: summaryPage([]) });
    }));
    const user = userEvent.setup();
    mount(false);
    await user.click(screen.getByRole('button', { name: '查看执行详情' }));
    expect(await screen.findByText('first page')).toBeInTheDocument();
    expect(await screen.findByText('second page')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '收起执行详情' }));
    expect(screen.queryByText('first page')).not.toBeInTheDocument();
    const resumedFrom = cursors.length;
    await user.click(screen.getByRole('button', { name: '查看执行详情' }));
    expect(await screen.findByText('first page')).toBeInTheDocument();
    expect(await screen.findByText('second page')).toBeInTheDocument();
    await waitFor(() => expect(cursors.length).toBeGreaterThan(resumedFrom));
    // 再次展开只从已存游标补尾部，不从 0 重读整轮。
    expect(cursors.slice(resumedFrom).every(cursor => cursor !== '')).toBe(true);
  });

  it('reads a large completed turn once without window navigation or automatic re-reads', async () => {
    const rows = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, index) => item({
      eventId: start + index, eventSeq: start + index, eventType: 'log',
      payload: JSON.stringify({ type: 'log', content: `event ${start + index}` }),
    }));
    let calls = 0;
    server.use(http.get(SUMMARIES, ({ request }) => {
      calls += 1;
      const cursor = new URL(request.url).searchParams.get('cursor');
      return HttpResponse.json({
        success: true, code: '0',
        data: cursor ? summaryPage(rows(1001, 1600), { hasMore: false, nextCursor: 1601 })
          : summaryPage(rows(1, 1000), { hasMore: true, nextCursor: 1000 }),
      });
    }));
    const user = userEvent.setup();
    mount(false);
    await user.click(screen.getByRole('button', { name: '查看执行详情' }));
    expect(await screen.findByText('event 1600')).toBeInTheDocument();
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.queryByTestId('content-window-earlier')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content-window-later')).not.toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 50));
    // 追平终态后不再自动续读，也不会按 1000 事件窗口整批替换。
    expect(calls).toBe(2);
  });

  it('shows the live process while running and collapses it when the turn completes', async () => {
    server.use(http.get(SUMMARIES, () => HttpResponse.json({
      success: true, code: '0', data: summaryPage([item({
        eventType: 'tool_result', payload: JSON.stringify({ tool: 'Bash', callId: 'live', status: 'running', output: 'live output' }),
      })]),
    })));
    const view = mount(true);
    expect(await screen.findByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('live output')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起执行详情' })).toBeInTheDocument();
    view.setProcessing(false);
    expect(screen.queryByText('Bash')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看执行详情' })).toBeInTheDocument();
  });

  it('keeps answered question history outside the collapsed tool details', () => {
    const answered: ClarificationElicitation = {
      requestId: 'q1', turnId: 2, mode: 'form', message: 'Pick one',
      requestedSchema: '{"type":"object","properties":{"value":{"type":"string"}}}',
      status: 'ANSWERED', answerJson: '{"value":"A"}', gmtCreate: '',
    };
    mount(false, { questionHistory: [answered], questionHistoryPaged: false });
    expect(screen.getByText('Pick one')).toBeInTheDocument();
    expect(screen.queryByText('Bash')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看执行详情' })).toBeInTheDocument();
  });

  it('reports paged question settlement without reading collapsed tool details', async () => {
    const onSettledQuestions = vi.fn();
    let reads = 0;
    server.use(
      http.get('/api/platform/conversations/1/turns/2/questions/page', () => HttpResponse.json({
        success: true, code: '0',
        data: { items: [{ historyId: 11, contentHasMore: false, requestId: 'q-page', turnId: 2,
          mode: 'form', message: 'Paged question',
          requestedSchema: '{"type":"object","properties":{"value":{"type":"string"}}}',
          status: 'ANSWERED', answerJson: '{"value":"A"}', gmtCreate: '' }],
        hasMore: false, nextAfterId: 12 },
      })),
      http.get(SUMMARIES, () => {
        reads += 1;
        return HttpResponse.json({ success: true, code: '0', data: summaryPage([]) });
      }),
    );
    mount(false, { questionHistoryPaged: true, onSettledQuestions });
    expect(await screen.findByText('Paged question')).toBeInTheDocument();
    await waitFor(() => expect(onSettledQuestions).toHaveBeenCalledWith(1, 2, ['q-page']));
    // 结算判定来自独立的问题历史分页，不依赖工具详情是否展开。
    expect(reads).toBe(0);
    expect(screen.queryByText('Bash')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看执行详情' })).toBeInTheDocument();
  });

  it('automatically shows bounded large tool output without opening a drawer', async () => {
    server.use(
      http.get(SUMMARIES, () => HttpResponse.json({
        success: true, code: '0', data: summaryPage([item({
          eventId: 42, eventType: 'tool_result', eventSeq: 3, detailAvailable: true,
          truncated: true, summary: '很长的输出摘要', payload: null, totalSegments: 2,
        })]),
      })),
      http.get(CONTENT, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        const index = cursor ? Number(cursor) : 0;
        return HttpResponse.json({
          success: true, code: '0',
          data: { ...emptyContentSegment(), eventId: 42, segmentIndex: index,
            projectionVersion: 'v2-semantic',
            content: JSON.stringify({ type: 'display_content', eventType: 'tool_result', field: 'output',
              text: `分段内容 ${index}`, metadata: { type: 'tool_result', tool: 'Bash', callId: 'large' } }),
            hasMore: index === 0, nextCursor: index === 0 ? 1 : null, previousCursor: index === 0 ? null : 0 },
        });
      }),
    );
    const user = userEvent.setup();
    mount(false);
    await user.click(screen.getByRole('button', { name: '查看执行详情' }));
    expect(await screen.findByText('分段内容 0分段内容 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看完整内容' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('event-content-more')).not.toBeInTheDocument();
  });
});
