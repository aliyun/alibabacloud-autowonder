import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AutoConversationTurnContent, readConversationTurnText } from './AutoConversationTurnContent';
import { apiClient } from '@/shared/api/client';
import { accountEventCache, eventCacheUsage, releaseEventCache } from '@/features/workitem/clarification/eventCacheBudget';
vi.mock('@/shared/api/client', () => ({ apiClient: { get: vi.fn() } }));
vi.mock('./MarkdownView', () => ({ MarkdownView: ({ content }: { content: string }) => <div>{content}</div> }));
describe('automatic turn content', () => {
  it('shares the conversation cache budget and recovers an evicted body from its bounded checkpoint', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { content: 'cached original', segmentIndex: 0, nextCursor: null, hasMore: false } });
    const view = render(<AutoConversationTurnContent base="/conversation/91" conversationId={91} turn={{ id: 1, content: 'preview', contentHasMore: true }} />);
    await waitFor(() => expect(screen.getByText('cached original')).toBeTruthy());
    expect(eventCacheUsage(91)).toBeGreaterThan(0);
    const other = Symbol();
    act(() => accountEventCache(91, other, 8 * 1024 * 1024, () => {}));
    expect(screen.queryByText('cached original')).toBeNull();
    expect(eventCacheUsage(91)).toBeLessThanOrEqual(8 * 1024 * 1024);
    releaseEventCache(91, other);
    fireEvent.scroll(view.container.firstElementChild!);
    await waitFor(() => expect(screen.getByText('cached original')).toBeTruthy());
    view.unmount();
    expect(eventCacheUsage(91)).toBe(0);
  });
  it('reads complete business content using opaque cursors and an abort signal', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { content: 'first', segmentIndex: 0, nextCursor: 'opaque', hasMore: true } })
      .mockResolvedValueOnce({ data: { content: 'last', segmentIndex: 1, nextCursor: null, hasMore: false } });
    const signal = new AbortController().signal;
    expect(await readConversationTurnText('/conversation/1', 1, 4, signal)).toBe('firstlast');
    expect(apiClient.get).toHaveBeenLastCalledWith('/conversation/1/turns/4/content', { params: { cursor: 'opaque' }, signal });
  });
  it('lets a parent conversation own scrolling while loading the complete reply', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { content: 'first', segmentIndex: 0, nextCursor: '1', hasMore: true } })
      .mockResolvedValueOnce({ data: { content: 'last', segmentIndex: 1, nextCursor: null, hasMore: false } });
    const { container } = render(<AutoConversationTurnContent base="/conversation/1" conversationId={1}
      turn={{ id: 5, content: 'preview', contentHasMore: true }} scrollMode="flow" />);
    await waitFor(() => expect(screen.getByText('firstlast')).toBeTruthy());
    expect(container.firstElementChild).not.toHaveStyle({ maxHeight: '70vh', overflowY: 'auto' });
  });
  it('replaces the preview with the first exact segment without duplication', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { content: 'complete original', segmentIndex: 0, nextCursor: null, hasMore: false } });
    render(<AutoConversationTurnContent base="/conversation/1" conversationId={1} turn={{ id: 2, content: 'complete', contentHasMore: true }} />);
    await waitFor(() => expect(screen.getByText('complete original')).toBeTruthy());
    expect(screen.queryByText('complete')).toBeNull();
  });
  it('keeps eight segments over a long traversal and derives recovery cursors without retaining prior content', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (_url, config) => {
      const index = Number((config?.params as { cursor?: string } | undefined)?.cursor ?? 0);
      return { data: { content: `segment-${index}|`, segmentIndex: index, nextCursor: String(index + 1), hasMore: index < 100 } } as never;
    });
    const { container } = render(<AutoConversationTurnContent base="/conversation/1" conversationId={1} turn={{ id: 3, content: 'preview', contentHasMore: true }} />);
    const root = container.firstElementChild!;
    Object.defineProperties(root, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 }, scrollTop: { writable: true, value: 900 } });
    await waitFor(() => expect(root.textContent).toContain('segment-0|'));
    for (let index = 1; index <= 80; index++) {
      fireEvent.scroll(root);
      await waitFor(() => expect(root.textContent).toContain(`segment-${index}|`));
    }
    expect(root.textContent).not.toContain('segment-0|');
    expect(root.textContent?.match(/segment-/g)).toHaveLength(8);
    root.scrollTop = 0; fireEvent.scroll(root);
    await waitFor(() => expect(root.textContent).toContain('segment-72|'));
    expect(root.textContent).not.toContain('segment-80|');
    expect(apiClient.get).toHaveBeenLastCalledWith('/conversation/1/turns/3/content', expect.objectContaining({ params: { cursor: '72' } }));
  });
});
