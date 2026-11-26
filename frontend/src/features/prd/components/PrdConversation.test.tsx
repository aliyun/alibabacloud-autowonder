import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { summaryPage } from '@/test/mocks/handlers';
import { PrdConversation, type PrdConversationHandle } from './PrdConversation';
import { File as UploadFile } from 'node:buffer';

vi.mock('@/features/workitem/clarification/SquadAgentSelector', () => ({ SquadAgentSelector: () => null }));
const ok = (data: unknown) => HttpResponse.json({ success: true, code: '0', data });

beforeEach(() => {
  server.use(http.get('/api/squads/:squadId/members', () => ok([
    { agentId: 42, agentName: 'Designer', roleCode: 'AW_FS_DEV', executorOnline: true },
  ])));
});

describe('PrdConversation API routing', () => {
  it('does not replay completed execution details when restoring chat history', async () => {
    let eventRequests = 0;
    server.use(
      http.get('/api/workitems/18/prd/conversation', () => ok({ id: 71, processingStatus: 'COMPLETED', turns: [
        { id: 1, direction: 'IN', content: 'Finished request', status: 'COMPLETED' },
        { id: 2, direction: 'OUT', content: 'Finished response', status: 'COMPLETED' },
      ] })),
      http.get('/api/workitems/18/prd/conversation/71/turns/:turnId/event-summaries', () => {
        eventRequests += 1;
        return ok(summaryPage([]));
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}><QueryClientProvider client={client}>
      <PrdConversation workitemId="18" />
    </QueryClientProvider></MemoryRouter>);
    expect(await screen.findByText('Finished response')).toBeInTheDocument();
    expect(screen.queryByText('思考过程')).not.toBeInTheDocument();
    expect(eventRequests).toBe(0);
    view.unmount(); client.clear();
  });

  it('warns in the chat panel when the selected employee executor is offline', async () => {
    const onEmployeeOfflineChange = vi.fn();
    server.use(
      http.get('/api/workitems/18/prd/conversation', () => ok({ id: null, turns: [] })),
      http.get('/api/squads/:squadId/members', () => ok([
        { agentId: 42, agentName: 'Designer', roleCode: 'AW_FS_DEV', executorOnline: false },
      ])),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}><QueryClientProvider client={client}>
      <PrdConversation workitemId="18" onEmployeeOfflineChange={onEmployeeOfflineChange} />
    </QueryClientProvider></MemoryRouter>);
    expect(await screen.findByText('当前数字员工离线，请先启动对应执行器；恢复在线后可继续设计。')).toBeInTheDocument();
    expect(onEmployeeOfflineChange).toHaveBeenLastCalledWith(true);
    view.unmount(); client.clear();
  });

  it('can submit the automatic project preparation message before the saved target rerenders', async () => {
    let submitted: unknown;
    server.use(
      http.get('/api/workitems/16/prd/conversation', () => ok({ id: null, turns: [] })),
      http.post('/api/workitems/16/prd/conversation', async ({ request }) => { submitted = await request.json(); return ok(null); }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ref = createRef<PrdConversationHandle>();
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}><QueryClientProvider client={client}>
      <PrdConversation ref={ref} workitemId="16" ready={false} />
    </QueryClientProvider></MemoryRouter>);
    await waitFor(() => expect(ref.current).not.toBeNull());
    await act(async () => ref.current?.startPreparation('Prepare project', 'prd-target-start:16:9', 'PREPARE'));
    expect(submitted).toEqual({
      agentId: 42, content: 'Prepare project', clientMessageId: 'prd-target-start:16:9',
      browser: { codeOnly: true }, runtimeAction: 'PREPARE',
    });
    view.unmount(); client.clear();
  });
  it('keeps one compact loading state and allows queuing while a turn is active', async () => {
    let eventRequests = 0;
    let canceled = false;
    const onProcessingChange = vi.fn();
    server.use(
      http.get('/api/workitems/17/prd/conversation', () => ok({ id: 70,
        processingStatus: canceled ? 'CANCELED' : 'PROCESSING', processingTurnId: canceled ? null : 1,
        cancelSupported: true,
        turns: canceled ? [
          { id: 1, direction: 'IN', content: 'First', status: 'CANCELED', submittedUserId: 7 },
              { id: 3, direction: 'OUT', content: '停止前已产生的回复', status: 'CANCELED', gmtCreate: '2026-11-19T10:20:00Z' },
        ] : [
          { id: 1, direction: 'IN', content: 'First', status: 'PROCESSING', submittedUserId: 7 },
          { id: 2, direction: 'IN', content: 'Second', status: 'QUEUED', submittedUserId: 7 },
        ] })),
      http.post('/api/workitems/17/prd/conversation/70/turns/1/cancel', () => { canceled = true; return ok(null); }),
      http.get('/api/workitems/17/prd/conversation/70/turns/:turnId/event-summaries', () => {
        eventRequests += 1;
        return ok(summaryPage([]));
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}><QueryClientProvider client={client}>
      <PrdConversation workitemId="17" onProcessingChange={onProcessingChange} />
    </QueryClientProvider></MemoryRouter>);
    expect(await screen.findByText('排队中')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll('.ant-spin-spinning')).toHaveLength(1));
    expect(screen.getByRole('textbox', { name: '设计对话' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '加入队列' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '添加截图（也可粘贴）' })).toBeEnabled();
    expect(within(screen.getByRole('region', { name: '待执行意见' })).getByText('Second')).toBeInTheDocument();
    expect(onProcessingChange).toHaveBeenLastCalledWith(true);
    const actions = document.querySelector('.prd-conversation-actions');
    const progress = document.querySelector('.prd-conversation-progress');
    expect(within(actions as HTMLElement).getByRole('button', { name: /停止/ })).toBeInTheDocument();
    expect(within(progress as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
    await userEvent.click(within(actions as HTMLElement).getByRole('button', { name: /停止/ }));
    await waitFor(() => expect(canceled).toBe(true));
    await waitFor(() => expect(onProcessingChange).toHaveBeenLastCalledWith(false));
    expect(await screen.findByText('停止前已产生的回复')).toBeInTheDocument();
    const assistantTurn = screen.getByText('停止前已产生的回复').closest('.aw-cl-turn');
    expect(assistantTurn).toHaveClass('assistant');
    expect(assistantTurn).not.toHaveClass('user');
    expect(assistantTurn?.closest('.prd-conversation-turn-group')).toHaveClass('assistant');
    const assistantActions = assistantTurn?.querySelector('.prd-conversation-message-actions');
    expect(assistantActions?.children[0]).toHaveAttribute('data-testid', 'copy-message-button');
    expect(assistantActions?.children[1]).toHaveClass('prd-conversation-reply-time');
    expect(assistantActions?.children[1]).toHaveAttribute('dateTime', '2026-11-19T10:20:00Z');
    expect(screen.getByText('已停止')).toHaveClass('prd-conversation-turn-status');
    const stoppedActions = screen.getByText('已停止').closest('.prd-conversation-message-actions');
    expect(stoppedActions?.closest('.prd-conversation-turn-group')).toHaveClass('user');
    expect(stoppedActions).toHaveTextContent('已停止');
    expect(stoppedActions?.querySelector('[data-testid="copy-message-button"]')).not.toBeNull();
    const agentAuthor = within(assistantTurn as HTMLElement).getByText('Designer').closest('.prd-conversation-author');
    expect(agentAuthor).toHaveClass('assistant');
    expect(agentAuthor).toHaveTextContent('Designer');
    const userAuthor = screen.getByText('参与者 7').closest('.prd-conversation-author');
    expect(userAuthor).toHaveClass('user');
    expect(userAuthor).toHaveTextContent('参与者 7');
    expect(document.querySelector('.ant-alert-error')).toBeNull();
    expect(eventRequests).toBeGreaterThanOrEqual(1);
    view.unmount(); client.clear();
  });
  it('subscribes to the active turn even when it is outside the latest message window', async () => {
    const subscribed = vi.fn();
    server.use(
      http.get('/api/workitems/13/prd/conversation', () => ok({ id: 62, processingStatus: 'PROCESSING', processingTurnId: 1,
        turns: [{ id: 51, direction: 'IN', content: 'Queued later', status: 'QUEUED' }] })),
      http.get('/api/workitems/13/prd/conversation/62/turns/:turnId/event-summaries', ({ params }) => { subscribed(String(params.turnId)); return ok(summaryPage([])); }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}><QueryClientProvider client={client}><PrdConversation workitemId="13" /></QueryClientProvider></MemoryRouter>);
    await waitFor(() => expect(subscribed).toHaveBeenCalledWith('1'));
    expect(subscribed).not.toHaveBeenCalledWith('51');
    view.unmount(); client.clear();
  });
  it('returns to the latest messages when sending from an older message window', async () => {
    let sent = false;
    server.use(
      http.get('/api/workitems/14/prd/conversation', () => ok({ id: 63, turnsHasMore: true, nextBeforeTurnId: 51,
        turns: [{ id: 51, direction: 'IN', content: sent ? 'New message persisted' : 'Latest message', status: 'COMPLETED' }] })),
      http.get('/api/workitems/14/prd/conversation/63/turns/page', () => ok({ items: [{ id: 1, direction: 'IN', content: 'Older message', status: 'COMPLETED' }], hasMore: false, nextBeforeTurnId: null })),
      http.get('/api/workitems/14/prd/conversation/63/turns/51/event-summaries', () => ok(summaryPage([]))),
      http.post('/api/workitems/14/prd/conversation', () => { sent = true; return ok(null); }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}><QueryClientProvider client={client}><PrdConversation workitemId="14" /></QueryClientProvider></MemoryRouter>);
    await screen.findByText('Latest message');
    fireEvent.scroll(screen.getByRole('log', { name: '设计对话' }));
    expect(await screen.findByText('Older message')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: '设计对话' }), 'Send from history');
    await userEvent.click(screen.getByRole('button', { name: /发\s*送/ }));
    expect(await screen.findByText('New message persisted')).toBeInTheDocument();
    expect(screen.queryByText('Older message')).toBeNull();
    view.unmount(); client.clear();
  });
  it('renders a long assistant reply through the shared conversation content loader', async () => {
    const content = 'Restored readable assistant response';
    server.use(
      http.get('/api/workitems/12/prd/conversation', () => ok({ id: 61, turns: [{ id: 2, direction: 'OUT', content: content.slice(0, 10), contentHasMore: true, status: 'COMPLETED' }] })),
      http.get('/api/workitems/12/prd/conversation/61/turns/2/content', () => ok({ content, segmentIndex: 0, nextCursor: null, hasMore: false })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}><QueryClientProvider client={client}><PrdConversation workitemId="12" /></QueryClientProvider></MemoryRouter>);
    expect(await screen.findByText(content)).toBeInTheDocument();
    view.unmount(); client.clear();
  });
  it('uploads pasted screenshots as multipart and attributes shared messages to their authors', async () => {
    let uploaded = false;
    let submitted: unknown;
    server.use(
      http.get('/api/workitems/10/prd/conversation', () => ok({ id: 50, participants: { 7: 'Alice', 8: 'Bob' }, turns: [
        { id: 1, direction: 'IN', content: 'First idea', sourceContext: '{}', submittedUserId: 7, status: 'COMPLETED' },
        { id: 2, direction: 'IN', content: 'Another idea', sourceContext: '{}', submittedUserId: 8, status: 'COMPLETED' },
      ] })),
      http.get('/api/workitems/10/prd/conversation/50/events', () => ok([])),
      http.post('/api/workitems/10/prd/conversation/prepare', () => ok({ id: 50, turns: [] })),
      http.post('/api/workitems/10/prd/conversation/50/attachments', async ({ request }) => {
        expect(request.headers.get('content-type')).toContain('multipart/form-data');
        const form = await request.formData();
        const file = form.get('file');
        expect(file).toBeInstanceOf(UploadFile);
        const uploadedFile = file as File;
        expect(uploadedFile.name).toBe('screen.png');
        expect(uploadedFile.type).toBe('image/png');
        expect(Array.from(new Uint8Array(await uploadedFile.arrayBuffer()))).toEqual([105, 109, 97, 103, 101]);
        uploaded = true;
        return ok({ id: 90 });
      }),
      http.post('/api/workitems/10/prd/conversation', async ({ request }) => { submitted = await request.json(); return ok(null); }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}>
      <QueryClientProvider client={client}><PrdConversation workitemId="10" /></QueryClientProvider>
    </MemoryRouter>);
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    const firstBubble = screen.getByText('First idea').closest('.aw-cl-bubble');
    expect(firstBubble).not.toBeNull();
    expect(firstBubble).not.toContainElement(screen.getByText('Alice'));
    expect(firstBubble?.previousElementSibling).toHaveTextContent('Alice');
    const firstTurn = firstBubble?.closest('.aw-cl-turn');
    const copy = firstTurn?.querySelector('[data-testid="copy-message-button"]');
    expect(copy).not.toBeNull();
    expect(firstBubble).not.toContainElement(copy as HTMLElement);
    expect(screen.queryByText('internal prompt')).not.toBeInTheDocument();
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [new UploadFile(['image'], 'screen.png', { type: 'image/png' })] } });
    await userEvent.click(screen.getByRole('button', { name: /发\s*送/ }));
    await waitFor(() => expect(submitted).toMatchObject({ agentId: 42, content: '', attachmentIds: [90] }));
    expect(uploaded).toBe(true);
    view.unmount(); client.clear();
  });
  it('attaches the picked prototype element to the next design message', async () => {
    let submitted: unknown;
    const cleared = vi.fn();
    server.use(
      http.get('/api/workitems/11/prd/conversation', () => ok({ id: 60, turns: [
        { id: 1, direction: 'IN', content: 'Round the corners', status: 'COMPLETED', submittedUserId: 7,
          sourceContext: '{"element":{"tag":"button","selector":"#save","cssPath":"body > button","xpath":"/x","text":"Save"}}' },
      ] })),
      http.get('/api/workitems/11/prd/conversation/60/events', () => ok([])),
      http.post('/api/workitems/11/prd/conversation', async ({ request }) => { submitted = await request.json(); return ok(null); }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}>
      <QueryClientProvider client={client}><PrdConversation workitemId="11" onClearElement={cleared} element={{
        tag: 'button', selector: '#save', cssPath: 'body > button', xpath: '/html[1]/body[1]/button[1]', text: 'Save changes', page: 'Home',
      }} /></QueryClientProvider>
    </MemoryRouter>);
    expect(await screen.findByText('Round the corners')).toBeInTheDocument();
    expect(screen.getAllByText('已选中：Save').length).toBeGreaterThan(0);
    expect(screen.getByText('已选中：Save changes')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: '设计对话' }), 'Make the button blue');
    await userEvent.click(screen.getByRole('button', { name: /发\s*送/ }));
    await waitFor(() => expect(submitted).toMatchObject({ content: 'Make the button blue',
      element: { tag: 'button', selector: '#save', text: 'Save changes' } }));
    expect(cleared).toHaveBeenCalledOnce();
    view.unmount(); client.clear();
  });
  it('loads and sends readable chat messages without treating replies as design payloads', async () => {
    let submitted: unknown;
    let artifactRequests = 0;
    server.use(
      http.get('/api/workitems/39089/prd/conversation', ({ request }) => {
        expect(new URL(request.url).searchParams.get('agentId')).toBe('42');
        return ok({ id: 50, turns: [{ id: 60, direction: 'OUT', content: 'I updated the PRD and the demo.', status: 'COMPLETED' }] });
      }),
      http.post('/api/workitems/39089/prd/conversation', async ({ request }) => {
        submitted = await request.json(); return ok(null);
      }),
      http.post('/api/workitems/39089/prd/conversation/preview', () => { artifactRequests += 1; return ok('<h1>Live design</h1>'); }),
      http.post('/api/workitems/39089/prd/conversation/50/turns/60/save', () => { artifactRequests += 1; return ok({ id: 70 }); }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}>
      <QueryClientProvider client={client}><PrdConversation workitemId="39089" /></QueryClientProvider>
    </MemoryRouter>);
    expect(await screen.findByText('I updated the PRD and the demo.')).toBeInTheDocument();
    expect(artifactRequests).toBe(0);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: '设计对话' }), 'Generate PRD');
    await user.click(screen.getByRole('button', { name: /发\s*送/ }));
    await waitFor(() => expect(submitted).toEqual({ agentId: 42, content: 'Generate PRD', clientMessageId: expect.any(String), attachmentIds: [], browser: { codeOnly: true } }));
    expect(screen.queryByRole('button', { name: '采用当前设计' })).not.toBeInTheDocument();
    expect(artifactRequests).toBe(0);
    view.unmount(); client.clear();
  });
  it('sends with Enter and keeps Shift+Enter as a newline', async () => {
    let submitted: { content?: string } | undefined;
    server.use(
      http.get('/api/workitems/19/prd/conversation', () => ok({ id: 72, turns: [] })),
      http.post('/api/workitems/19/prd/conversation', async ({ request }) => {
        submitted = await request.json() as { content?: string };
        return ok(null);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}><QueryClientProvider client={client}>
      <PrdConversation workitemId="19" />
    </QueryClientProvider></MemoryRouter>);
    const textbox = await screen.findByRole('textbox', { name: '设计对话' });
    const user = userEvent.setup();
    await user.type(textbox, 'first');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(textbox, 'second');
    expect(textbox).toHaveValue('first\nsecond');
    expect(submitted).toBeUndefined();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(submitted?.content).toBe('first\nsecond'));
    view.unmount(); client.clear();
  });
  it('falls back to the element selector when the picked element has no text', async () => {
    server.use(
      http.get('/api/workitems/12/prd/conversation', () => ok({ id: 60, turns: [] })),
      http.get('/api/workitems/12/prd/conversation/60/events', () => ok([])),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}>
      <QueryClientProvider client={client}><PrdConversation workitemId="12" element={{
        tag: 'button', selector: '#save', cssPath: 'body > button', xpath: '/html[1]/body[1]/button[1]',
      }} /></QueryClientProvider>
    </MemoryRouter>);
    expect(await screen.findByText('已选中：#save')).toBeInTheDocument();
    view.unmount(); client.clear();
  });
  it('degrades safely when stored turns carry no or broken source context', async () => {
    server.use(
      http.get('/api/workitems/13/prd/conversation', () => ok({ id: 61, participants: { 7: 'Alice' }, turns: [
        { id: 1, direction: 'IN', content: 'raw first idea', status: 'COMPLETED', submittedUserId: 7 },
        { id: 2, direction: 'IN', content: 'raw second idea', status: 'COMPLETED', submittedUserId: 7, sourceContext: 'not-json' },
      ] })),
      http.get('/api/workitems/13/prd/conversation/61/events', () => ok([])),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}>
      <QueryClientProvider client={client}><PrdConversation workitemId="13" /></QueryClientProvider>
    </MemoryRouter>);
    expect(await screen.findByText('raw first idea')).toBeInTheDocument();
    expect(screen.getByText('raw second idea')).toBeInTheDocument();
    expect(screen.queryByText(/已选中/)).not.toBeInTheDocument();
    view.unmount(); client.clear();
  });
  it('retains selected comments and the same message id after a failed send', async () => {
    const submitted: Record<string, unknown>[] = [];
    server.use(
      http.get('/api/workitems/15/prd/conversation', () => ok({ id: 65, turns: [] })),
      http.get('/api/workitems/15/prd/runtime', () => ok({ sourceKey: 'source', conversationId: 65 })),
      http.post('/api/workitems/15/prd/conversation', async ({ request }) => {
        submitted.push(await request.json() as Record<string, unknown>);
        return submitted.length === 1 ? HttpResponse.json({ success: false, code: '10409', message: 'Retry feedback' }) : ok(null);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ref = createRef<PrdConversationHandle>();
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}><QueryClientProvider client={client}><PrdConversation ref={ref} workitemId="15" /></QueryClientProvider></MemoryRouter>);
    act(() => ref.current?.addComments([{ id: 91, commentText: 'Review opinion', selector: '#save', sourceKey: 'source', conversationId: 65 }]));
    await userEvent.type(screen.getByRole('textbox', { name: '设计对话' }), 'Please adjust');
    await userEvent.click(screen.getByRole('button', { name: /发\s*送/ }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(screen.getByRole('textbox', { name: '设计对话' })).toHaveValue('Please adjust');
    expect(screen.getByText('Review opinion')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /发\s*送/ }));
    await waitFor(() => expect(submitted).toHaveLength(2));
    expect(submitted[1]).toEqual(submitted[0]);
    expect(submitted[1].commentIds).toEqual([91]);
    await waitFor(() => expect(screen.queryByText('Review opinion')).not.toBeInTheDocument());
    view.unmount(); client.clear();
  });

  it('queues comment-only feedback during execution and restores it from server history', async () => {
    const submitted: Record<string, unknown>[] = [];
    const cancel = vi.fn();
    let nextStarted = false;
    const sourceContext = JSON.stringify({ reviewComments: [{ id: 91, commentText: 'Improve the font color', routePath: '/home' }] });
    server.use(
      http.get('/api/workitems/20/prd/conversation', () => ok({ id: 73,
        processingStatus: 'PROCESSING', processingTurnId: nextStarted ? 2 : 1, cancelSupported: true,
        turns: [
          { id: 1, direction: 'IN', content: 'Current design', status: nextStarted ? 'COMPLETED' : 'PROCESSING' },
          ...(submitted.length ? [{ id: 2, direction: 'IN', content: '', sourceContext, status: nextStarted ? 'PROCESSING' : 'QUEUED' }] : []),
        ] })),
      http.get('/api/workitems/20/prd/runtime', () => ok({ sourceKey: 'source', conversationId: 73 })),
      http.get('/api/workitems/20/prd/conversation/73/turns/:turnId/event-summaries', () => ok(summaryPage([]))),
      http.post('/api/workitems/20/prd/conversation', async ({ request }) => {
        submitted.push(await request.json() as Record<string, unknown>); return ok(null);
      }),
      http.post('/api/workitems/20/prd/conversation/73/turns/:turnId/cancel', () => { cancel(); return ok(null); }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ref = createRef<PrdConversationHandle>();
    const renderConversation = () => render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}><QueryClientProvider client={client}>
      <PrdConversation ref={ref} workitemId="20" />
    </QueryClientProvider></MemoryRouter>);
    let view = renderConversation();
    await screen.findByText('Current design');
    act(() => ref.current?.addComments([{ id: 91, commentText: 'Improve the font color', selector: '#title', sourceKey: 'source', conversationId: 73 }]));
    await userEvent.click(screen.getByRole('button', { name: '加入队列' }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toMatchObject({ content: '', commentIds: [91], browser: { codeOnly: true } });
    const queue = await screen.findByRole('region', { name: '待执行意见' });
    expect(within(queue).getByText(/Improve the font color/)).toBeInTheDocument();
    expect(screen.queryByLabelText('评审引用')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /停止/ })).toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();
    view.unmount(); client.clear();
    view = renderConversation();
    expect(within(await screen.findByRole('region', { name: '待执行意见' })).getByText(/Improve the font color/)).toBeInTheDocument();
    nextStarted = true;
    await act(async () => { await client.invalidateQueries({ queryKey: ['prd-conversation', '20', 42] }); });
    await waitFor(() => expect(screen.queryByRole('region', { name: '待执行意见' })).not.toBeInTheDocument());
    expect(screen.getByText('Improve the font color')).toBeInTheDocument();
    expect(submitted).toHaveLength(1);
    view.unmount(); client.clear();
  });

  it('preserves a queued draft on failure and queues text with screenshots on Enter without interrupting', async () => {
    const submitted: Record<string, unknown>[] = [];
    server.use(
      http.get('/api/workitems/21/prd/conversation', () => ok({ id: 74, processingStatus: 'PROCESSING', processingTurnId: 1,
        cancelSupported: false, turns: [{ id: 1, direction: 'IN', content: 'Working', status: 'PROCESSING' }] })),
      http.get('/api/workitems/21/prd/conversation/74/turns/1/event-summaries', () => ok(summaryPage([]))),
      http.get('/api/workitems/21/prd/runtime', () => ok({ sourceKey: 'source', conversationId: 74 })),
      http.post('/api/workitems/21/prd/conversation/prepare', () => ok({ id: 74, turns: [] })),
      http.post('/api/workitems/21/prd/conversation/74/attachments', () => ok({ id: 92 })),
      http.post('/api/workitems/21/prd/conversation', async ({ request }) => {
        submitted.push(await request.json() as Record<string, unknown>);
        return submitted.length === 1 ? HttpResponse.json({ success: false, code: '10409', message: 'Queue submission failed' }) : ok(null);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ref = createRef<PrdConversationHandle>();
    const view = render(<MemoryRouter initialEntries={['/?prdAgent=42&prdSquad=7']}><QueryClientProvider client={client}>
      <PrdConversation ref={ref} workitemId="21" />
    </QueryClientProvider></MemoryRouter>);
    await screen.findByText('Working');
    act(() => ref.current?.addComments([{ id: 91, commentText: 'Match this screenshot', selector: '#title', sourceKey: 'source', conversationId: 74 }]));
    const textbox = screen.getByRole('textbox', { name: '设计对话' });
    await userEvent.type(textbox, 'Adjust spacing');
    fireEvent.paste(textbox, { clipboardData: { files: [new UploadFile(['image'], 'spacing.png', { type: 'image/png' })] } });
    await userEvent.click(screen.getByRole('button', { name: '加入队列' }));
    expect(await screen.findByText('Queue submission failed')).toBeInTheDocument();
    expect(textbox).toHaveValue('Adjust spacing');
    expect(screen.getByText('Match this screenshot')).toBeInTheDocument();
    expect(screen.getByText('spacing.png')).toBeInTheDocument();
    await userEvent.click(textbox);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(submitted).toHaveLength(2));
    expect(submitted[1]).toEqual(submitted[0]);
    expect(submitted[1]).toMatchObject({ content: 'Adjust spacing', commentIds: [91], attachmentIds: [92] });
    await waitFor(() => expect(textbox).toHaveValue(''));
    expect(screen.queryByText('Match this screenshot')).not.toBeInTheDocument();
    expect(screen.queryByText('spacing.png')).not.toBeInTheDocument();
    view.unmount(); client.clear();
  });

});
