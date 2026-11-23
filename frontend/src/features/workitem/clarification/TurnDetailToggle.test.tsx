import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { emptyContentSegment, summaryPage } from '@/test/mocks/handlers';
import { processNodesOf, TurnDetailToggle } from './TurnDetailToggle';

const SUMMARIES = '/api/workitems/100/clarification-conversations/1/turns/8/event-summaries';
const CONTENT = '/api/workitems/100/clarification-conversations/1/turns/8/event-summaries/:eventId/content';

function item(over: Record<string, unknown>) {
  return {
    eventId: 1, eventType: 'thinking', dispatchAttempt: 1, eventSeq: 1,
    occurredAt: '2026-01-01T00:00:00Z', state: 'READY', truncated: false,
    detailAvailable: false, summary: '', contentLength: 1, totalSegments: 1,
    payload: JSON.stringify({ type: 'thinking', content: '过程' }), ...over,
  };
}

function summaries(items: unknown[], over: Record<string, unknown> = {}) {
  server.use(http.get(SUMMARIES, () => HttpResponse.json({
    success: true, code: '0', data: summaryPage(items, over),
  })));
}

function renderToggle(coveredQuestionIds?: ReadonlySet<string>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* 9 是 OUT 气泡（详情挂在这里），8 是事件真正落库的 IN 轮次 */}
      <TurnDetailToggle workitemId="100" conversationId={1} turnId={9} eventTurnId={8} coveredQuestionIds={coveredQuestionIds} />
    </QueryClientProvider>,
  );
}

function toggleDetails() {
  fireEvent.click(screen.getByTestId('turn-detail-toggle-9'));
}

describe('TurnDetailToggle', () => {
  it('keeps completed execution details collapsed until requested and can collapse them again', async () => {
    let calls = 0;
    server.use(http.get(SUMMARIES, () => {
      calls += 1;
      return HttpResponse.json({ success: true, code: '0', data: summaryPage([item({})]) });
    }));

    renderToggle();
    const expand = screen.getByTestId('turn-detail-toggle-9');
    expect(expand).toHaveTextContent('查看执行详情');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(calls).toBe(0);
    expect(screen.queryByText('思考过程')).not.toBeInTheDocument();

    fireEvent.click(expand);
    expect(await screen.findByText('思考过程')).toBeInTheDocument();
    expect(calls).toBe(1);
    expect(screen.getByTestId('turn-detail-toggle-9')).toHaveTextContent('收起执行详情');

    fireEvent.click(screen.getByTestId('turn-detail-toggle-9'));
    expect(screen.queryByText('思考过程')).not.toBeInTheDocument();
    expect(screen.getByTestId('turn-detail-toggle-9')).toHaveTextContent('查看执行详情');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(calls).toBe(1);
  });

  it('keeps automatic history navigation when persisted reply text is omitted', () => {
    const nodes = processNodesOf([
      { id: 'reply', kind: 'text', turnId: 8, eventSeq: 1, text: 'already in reply bubble' },
      { id: 'history-earlier', kind: 'text', turnId: 8, eventSeq: 0, text: '',
        contentWindow: { key: 'history:1:8:earlier', first: 1000, last: 2000, total: 2000 } },
    ]);
    expect(nodes.map(node => node.id)).toEqual(['history-earlier']);
  });
  it('requests bounded summaries for the inbound turn id, not the bubble turn id', async () => {
    const requestedPaths: string[] = [];
    server.use(http.get(SUMMARIES, ({ request }) => {
      requestedPaths.push(new URL(request.url).pathname);
      return HttpResponse.json({ success: true, code: '0', data: summaryPage([item({})]) });
    }));

    renderToggle();
    toggleDetails();

    await waitFor(() => expect(requestedPaths).toHaveLength(1));
    expect(requestedPaths[0]).toBe(
      '/api/workitems/100/clarification-conversations/1/turns/8/event-summaries',
    );
  });

  it('reopens already loaded details immediately and only catches up from the saved cursor', async () => {
    const cursors: Array<string | null> = [];
    server.use(http.get(SUMMARIES, ({ request }) => {
      cursors.push(new URL(request.url).searchParams.get('cursor'));
      return HttpResponse.json({ success: true, code: '0',
        data: summaryPage(cursors.length === 1 ? [item({})] : [], { nextCursor: 1, hasMore: false }) });
    }));

    renderToggle();
    toggleDetails();
    expect(await screen.findByText('思考过程')).toBeInTheDocument();
    toggleDetails();
    toggleDetails();
    expect(screen.getByText('思考过程')).toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.getByText('思考过程')).toBeInTheDocument();
    expect(cursors[0]).toBeNull();
    expect(cursors.slice(1).every(cursor => cursor === '1')).toBe(true);
  });

  it('replays the process without repeating the reply text already in the bubble', async () => {
    const reply = '没在想什么特别的。当前无待办任务。';
    summaries([
      item({ eventId: 1, eventSeq: 1, payload: JSON.stringify({ type: 'thinking', content: '先看看有没有待办' }) }),
      item({ eventId: 2, eventSeq: 2, eventType: 'text', payload: JSON.stringify({ type: 'text', content: reply }) }),
    ]);

    renderToggle();
    toggleDetails();

    expect(await screen.findByText('思考过程')).toBeInTheDocument();
    expect(screen.queryByText(reply)).toBeNull();
  });

  it('keeps normal empty and loading process states silent', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    server.use(http.get(SUMMARIES, async () => {
      await pending;
      return HttpResponse.json({ success: true, code: '0', data: summaryPage([]) });
    }));
    const { container } = renderToggle();
    toggleDetails();
    expect(container.querySelector('.ant-spin')).toBeNull();
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.queryByText('无执行详情')).not.toBeInTheDocument());
  });

  it('surfaces a load failure instead of silently showing nothing', async () => {
    server.use(http.get(SUMMARIES, () => HttpResponse.json(
      { success: false, code: 'BOOM', message: '炸了', traceId: null, data: null },
      { status: 500 },
    )));
    renderToggle();
    toggleDetails();
    expect(await screen.findByText('执行详情加载失败')).toBeInTheDocument();
  });

  it('suppresses only visible history identities and keeps event-only legacy questions', async () => {
    summaries([
      item({ eventId: 1, eventSeq: 1, eventType: 'acp_elicitation', payload: JSON.stringify({ data: { requestId: 'covered', message: 'Covered question' } }) }),
      item({ eventId: 2, eventSeq: 2, eventType: 'acp_elicitation_resolved', payload: JSON.stringify({ data: { requestId: 'covered', action: 'accept', content: { value: 'Covered answer' } } }) }),
      item({ eventId: 3, eventSeq: 3, eventType: 'acp_elicitation', payload: JSON.stringify({ data: { requestId: 'legacy', message: 'Legacy question' } }) }),
      item({ eventId: 4, eventSeq: 4, eventType: 'acp_elicitation_resolved', payload: JSON.stringify({ data: { requestId: 'legacy', action: 'accept', content: { value: 'Legacy answer' } } }) }),
      item({ eventId: 5, eventSeq: 5, eventType: 'tool_use', payload: JSON.stringify({ tool: 'Bash', callId: 'process' }) }),
    ]);
    renderToggle(new Set(['8:covered']));
    toggleDetails();
    expect(await screen.findByText('Legacy answer')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.queryByText('Covered question')).not.toBeInTheDocument();
    expect(screen.queryByText('Covered answer')).not.toBeInTheDocument();
  });

  it('loads the complete requested turn without a manual load-more button', async () => {
    let calls = 0;
    server.use(http.get(SUMMARIES, () => {
      calls += 1;
      return HttpResponse.json({
        success: true, code: '0',
        data: calls === 1
          ? summaryPage([item({})], { nextCursor: 1, hasMore: true })
          : summaryPage([
            item({ eventId: 2, eventSeq: 2, eventType: 'tool_use', payload: JSON.stringify({ tool: 'Bash', callId: 'c2' }) }),
          ], { nextCursor: 2, hasMore: false }),
      });
    }));

    renderToggle();
    toggleDetails();
    await waitFor(() => expect(calls).toBe(2));
    expect(await screen.findByText('Bash')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多执行详情' })).not.toBeInTheDocument();
  });

  it('streams large output into requested historical details', async () => {
    summaries([item({
      eventId: 77, eventSeq: 1, eventType: 'tool_result', detailAvailable: true,
      truncated: true, summary: '大输出摘要', payload: null, totalSegments: 1,
    })]);
    let contentCalls = 0;
    server.use(http.get(CONTENT, () => {
      contentCalls += 1;
      return HttpResponse.json({
        success: true, code: '0',
        data: { ...emptyContentSegment(), eventId: 77, projectionVersion: 'v2-semantic',
          content: JSON.stringify({ type: 'display_content', eventType: 'tool_result',
            field: 'output', text: '完整输出正文', metadata: { type: 'tool_result', tool: 'Bash' } }), hasMore: false },
      });
    }));

    renderToggle();
    toggleDetails();
    expect(await screen.findByText('完整输出正文')).toBeInTheDocument();
    expect(contentCalls).toBe(1);
  });
});
