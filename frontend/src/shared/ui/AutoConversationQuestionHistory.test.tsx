import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/shared/api/client';
import { AutoConversationQuestionHistory, readConversationQuestion } from './AutoConversationQuestionHistory';
import type { ClarificationElicitation } from '@/features/workitem/clarification/types';
vi.mock('@/shared/api/client', () => ({ apiClient: { get: vi.fn() } }));
const card: ClarificationElicitation = { historyId: 4, requestId: 'old', turnId: 3, mode: 'form',
  message: 'preview', requestedSchema: null, answerJson: null, status: 'EXPIRED', gmtCreate: '', contentHasMore: true };
afterEach(() => { vi.restoreAllMocks(); });

describe('automatic durable question history', () => {
  it('joins bounded segments before parsing schema/answer and preserves their original strings', async () => {
    const schema = '{"properties":{"answer":{"type":"string","description":"Earlier question"}}}';
    const answer = '{"answer":"Original answer"}';
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { message: 'original ', requestedSchema: schema.slice(0,20), answerJson: answer.slice(0,8), hasMore: true, nextCursor: '1' } })
      .mockResolvedValueOnce({ data: { message: 'question', requestedSchema: schema.slice(20), answerJson: answer.slice(8), hasMore: false, nextCursor: null } });
    const result = await readConversationQuestion('/scope',2,3,card,new AbortController().signal);
    expect(result.card).toMatchObject({ message: 'original question', requestedSchema: schema, answerJson: answer, contentHasMore: false });
    expect((vi.mocked(apiClient.get).mock.calls[1][1]?.params as { cursor?: string } | undefined)?.cursor).toBe('1');
  });
  it('automatically restores a paged expired card and continues with the complete original question', async () => {
    const onContinue = vi.fn();
    vi.mocked(apiClient.get).mockImplementation(async url => ({ data: String(url).endsWith('/page')
      ? { items: [card], hasMore: false, nextBeforeId: 4, nextAfterId: 4 }
      : { message: 'Complete original question', requestedSchema: '{"properties":{}}', answerJson: null, hasMore: false, nextCursor: null } }) as never);
    render(<AutoConversationQuestionHistory base="/restore" conversationId={2} turnId={3} entries={[]} canContinue onContinue={onContinue} />);
    expect(await screen.findByText('Complete original question')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Continue answering|继续回答/ }));
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ message: 'Complete original question', requestedSchema: { properties: {} } }));
  });
  it('cancels and releases incomplete card reads when the page becomes hidden', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(apiClient.get).mockImplementation((url, config) => {
      if (String(url).endsWith('/page')) return Promise.resolve({ data: { items: [card], hasMore: false, nextBeforeId: 4, nextAfterId: 4 } }) as never;
      signal = config?.signal as AbortSignal;
      return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')), { once: true })) as never;
    });
    const view = render(<AutoConversationQuestionHistory base="/hide" conversationId={2} turnId={3} entries={[]} />);
    await waitFor(() => expect(signal).toBeTruthy());
    const hidden = vi.spyOn(document,'hidden','get').mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(signal?.aborted).toBe(true);
    hidden.mockRestore(); view.unmount();
  });
  it('keeps at most 40 question projections while automatically reading all page boundaries', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (_url, config) => {
      const after = (config?.params as { afterId?: number } | undefined)?.afterId ?? 0;
      return { data: { items: Array.from({ length: 20 }, (_, i) => ({ ...card, historyId: after+i+1, requestId: `q-${after+i+1}`, contentHasMore: false })),
        hasMore: after < 40, nextBeforeId: after+1, nextAfterId: after+20 } } as never;
    });
    const view = render(<AutoConversationQuestionHistory base="/many" conversationId={2} turnId={3} entries={[]} />);
    await waitFor(() => expect(view.container.querySelector('[data-question-id="60"]')).toBeTruthy());
    expect(view.container.querySelectorAll('[data-question-id]')).toHaveLength(40);
    expect(view.container.querySelector('[data-question-id="1"]')).toBeFalsy();
    view.unmount();
  });
  it('restores a newly settled durable answer after an initially empty active turn', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { items: [], hasMore: false, nextBeforeId: null, nextAfterId: null } })
      .mockResolvedValueOnce({ data: { items: [{ ...card, contentHasMore: false, message: 'Saved after opening' }], hasMore: false, nextBeforeId: 4, nextAfterId: 4 } });
    const view = render(<AutoConversationQuestionHistory base="/live" conversationId={2} turnId={3} entries={[]} refreshKey="pending" />);
    await waitFor(() => expect(vi.mocked(apiClient.get)).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    view.rerender(<AutoConversationQuestionHistory base="/live" conversationId={2} turnId={3} entries={[]} refreshKey="answered" />);
    expect(await screen.findByText('Saved after opening')).toBeInTheDocument();
    view.unmount();
  });
  it('restores the complete older question when it settles after a newer saved question', async () => {
    let olderSettled = false;
    const newer = { ...card, historyId: 5, requestId: 'newer', contentHasMore: false, message: 'Newer saved question' };
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.questionId !== '5') return originalRect.call(this);
      const top = this.parentElement?.querySelector('[data-question-id="4"]') ? 180 : 100;
      return { ...originalRect.call(this), top, bottom: top + 40 };
    });
    vi.mocked(apiClient.get).mockImplementation(async (url, config) => {
      if (!String(url).endsWith('/page')) return { data: { message: 'Complete older question', requestedSchema: '{"properties":{"answer":{"type":"string"}}}',
        answerJson: '{"answer":"Exact older answer"}', hasMore: false, nextCursor: null } } as never;
      const after = (config?.params as { afterId?: number } | undefined)?.afterId ?? 0;
      return { data: { items: (olderSettled ? [{ ...card, status: 'ANSWERED' }, newer] : [newer]).filter(row => row.historyId! > after),
        hasMore: false, nextBeforeId: olderSettled ? 4 : 5, nextAfterId: 5 } } as never;
    });
    const view = render(<AutoConversationQuestionHistory base="/late" conversationId={2} turnId={3} entries={[]} refreshKey="4-pending-5-settled" />);
    expect(await screen.findByText('Newer saved question')).toBeInTheDocument();
    const container = view.container.firstElementChild as HTMLElement;
    container.scrollTop = 40;
    olderSettled = true;
    view.rerender(<AutoConversationQuestionHistory base="/late" conversationId={2} turnId={3} entries={[]} refreshKey="4-settled-5-settled" />);
    expect(await screen.findByText('Complete older question')).toBeInTheDocument();
    expect(screen.getByText('Exact older answer')).toBeInTheDocument();
    await waitFor(() => expect(container.scrollTop).toBe(120));
    view.unmount();
  });
  it('cancels an obsolete newer page before restarting settlement recovery from zero', async () => {
    let olderSettled = false;
    let obsoleteSignal: AbortSignal | undefined;
    const newer = { ...card, historyId: 5, requestId: 'newer', contentHasMore: false, message: 'Previously settled' };
    vi.mocked(apiClient.get).mockImplementation((url, config) => {
      if ((config?.params as { afterId?: number } | undefined)?.afterId === 5 && !olderSettled) {
        obsoleteSignal = config?.signal as AbortSignal;
        return new Promise((_resolve, reject) => obsoleteSignal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })) as never;
      }
      if (!String(url).endsWith('/page')) return Promise.resolve({ data: { message: 'Older durable original', requestedSchema: '{}', answerJson: '{}', hasMore: false, nextCursor: null } }) as never;
      return Promise.resolve({ data: { items: olderSettled ? [card, newer] : [newer], hasMore: !olderSettled, nextBeforeId: 4, nextAfterId: 5 } }) as never;
    });
    const view = render(<AutoConversationQuestionHistory base="/cancel-refresh" conversationId={2} turnId={3} entries={[]} refreshKey="pending" />);
    await waitFor(() => expect(obsoleteSignal).toBeTruthy());
    olderSettled = true;
    view.rerender(<AutoConversationQuestionHistory base="/cancel-refresh" conversationId={2} turnId={3} entries={[]} refreshKey="settled" />);
    expect(obsoleteSignal?.aborted).toBe(true);
    expect(await screen.findByText('Older durable original')).toBeInTheDocument();
    const latestPage = vi.mocked(apiClient.get).mock.calls.filter(([url]) => String(url).endsWith('/page')).at(-1);
    expect(latestPage?.[1]?.params).toMatchObject({ afterId: 0 });
    view.unmount();
  });
  it('holds the measured height on re-entry until the released page is restored', async () => {
    const observers: Array<{ callback: IntersectionObserverCallback; target?: Element }> = [];
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      record: { callback: IntersectionObserverCallback; target?: Element };
      constructor(callback: IntersectionObserverCallback) { this.record = { callback }; observers.push(this.record); }
      observe(target: Element) { this.record.target = target; }
      disconnect() { /* noop */ }
    } as unknown as typeof IntersectionObserver;
    const resized = new Set<ResizeObserverCallback>();
    const originalResize = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() { resized.add(this.callback); }
      disconnect() { resized.delete(this.callback); }
    } as unknown as typeof ResizeObserver;
    const setVisible = (isIntersecting: boolean) => act(() => {
      for (const { callback, target } of observers) callback([{ isIntersecting, target } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.questionId === '4') return { ...originalRect.call(this), height: this.textContent ? 300 : 5 };
      return this.style.maxHeight === '600px'
        ? { ...originalRect.call(this), height: this.querySelector('[data-question-id]')?.textContent ? 320 : 10 }
        : originalRect.call(this);
    });
    let release!: () => void;
    let pages = 0;
    vi.mocked(apiClient.get).mockImplementation(async () => {
      pages++;
      if (pages > 1) await new Promise<void>(resolve => { release = resolve; });
      return { data: { items: [{ ...card, contentHasMore: false, message: 'Settled question' }], hasMore: false, nextBeforeId: 4, nextAfterId: 4 } } as never;
    });
    try {
      const view = render(<AutoConversationQuestionHistory base="/reenter" conversationId={2} turnId={3} entries={[]} />);
      const container = view.container.firstElementChild as HTMLElement;
      const reveal = async () => {
        setVisible(true);
        await waitFor(() => expect(container.querySelector('[data-question-id="4"]')).toBeTruthy());
        setVisible(true);
        act(() => { for (const callback of resized) callback([], {} as ResizeObserver); });
      };
      await reveal();
      expect(screen.getByText('Settled question')).toBeInTheDocument();
      setVisible(false);
      expect(container.style.minHeight).toBe('320px');
      setVisible(true);
      await waitFor(() => expect(pages).toBe(2));
      expect(container.style.minHeight).toBe('320px');
      await act(async () => { release(); });
      await waitFor(() => expect(container.querySelector('[data-question-id="4"]')).toBeTruthy());
      expect((container.querySelector('[data-question-id="4"]') as HTMLElement).style.minHeight).toBe('300px');
      await reveal();
      expect(screen.getByText('Settled question')).toBeInTheDocument();
      expect(container.style.minHeight).toBe('1px');
      view.unmount();
    } finally { globalThis.IntersectionObserver = original; globalThis.ResizeObserver = originalResize; }
  });
});
