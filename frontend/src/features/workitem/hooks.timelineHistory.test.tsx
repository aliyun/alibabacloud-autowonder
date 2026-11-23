import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useTimelineHistory } from './hooks';
import * as api from './api';

vi.mock('./api', () => ({ getUnifiedTimeline: vi.fn() }));

beforeEach(() => { vi.mocked(api.getUnifiedTimeline).mockReset(); });

const makeItem = (id: number) => ({ id, type: 'comment' as const, content: String(id), gmtCreate: '2026-11-17', authorId: 1, authorName: 'test', authorType: 'HUMAN', isAgent: false });

function makeClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

it('retains loaded history, removes overlapping records and stops on an empty page', async () => {
  const item = (id: number) => ({ id, type: 'comment' as const, content: String(id), gmtCreate: '2026-11-17', authorId: 1, authorName: 'test', authorType: 'HUMAN', isAgent: false });
  vi.mocked(api.getUnifiedTimeline).mockResolvedValueOnce({ items: [item(3), item(2)], hasMore: true })
    .mockResolvedValueOnce({ items: [item(2), item(1)], hasMore: true })
    .mockResolvedValueOnce({ items: [], hasMore: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, unmount } = renderHook(() => useTimelineHistory('42'), { wrapper });
  await waitFor(() => expect(result.current.data).toHaveLength(2));
  await act(async () => { await result.current.fetchNextPage(); });
  await waitFor(() => expect(result.current.data.map((entry) => entry.id)).toEqual([3, 2, 1]));
  await act(async () => { await result.current.fetchNextPage(); });
  await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  expect(result.current.data).toHaveLength(3);
  unmount();
  client.clear();
});

it('refreshes all loaded windows into one continuous newest-first range after more than 50 new records', async () => {
  let newest = 100;
  vi.mocked(api.getUnifiedTimeline).mockImplementation(async (_id, page = 0) => ({
    items: Array.from({ length: 50 }, (_, offset) => makeItem(newest - page * 50 - offset)),
    hasMore: true,
  }));
  const { client, wrapper } = makeClient();
  const { result, unmount } = renderHook(() => useTimelineHistory('42'), { wrapper });
  await waitFor(() => expect(result.current.data).toHaveLength(50));
  await act(async () => { await result.current.fetchNextPage(); });
  await waitFor(() => expect(result.current.data.map((entry) => entry.id)).toEqual(Array.from({ length: 100 }, (_, offset) => 100 - offset)));

  newest = 151;
  vi.mocked(api.getUnifiedTimeline).mockClear();
  await act(async () => { await result.current.refetch(); });
  expect(vi.mocked(api.getUnifiedTimeline).mock.calls.map(([, page]) => page)).toEqual([0, 1]);
  await waitFor(() => expect(result.current.data.map((entry) => entry.id)).toEqual(Array.from({ length: 100 }, (_, offset) => 151 - offset)));
  expect(result.current.data.some((entry) => entry.id === 101)).toBe(true);
  unmount();
  client.clear();
});

it('keeps loaded records after a failed next page and retries that same page', async () => {
  vi.mocked(api.getUnifiedTimeline).mockResolvedValueOnce({ items: [makeItem(3), makeItem(2)], hasMore: true })
    .mockRejectedValueOnce(new Error('temporary history failure'))
    .mockResolvedValueOnce({ items: [makeItem(1)], hasMore: false });
  const { client, wrapper } = makeClient();
  const { result, unmount } = renderHook(() => useTimelineHistory('42'), { wrapper });
  await waitFor(() => expect(result.current.data).toHaveLength(2));
  await act(async () => { await result.current.fetchNextPage(); });
  await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
  expect(result.current.data.map((entry) => entry.id)).toEqual([3, 2]);
  expect(result.current.hasNextPage).toBe(true);
  await act(async () => { await result.current.fetchNextPage(); });
  expect(vi.mocked(api.getUnifiedTimeline).mock.calls.map(([, page]) => page)).toEqual([0, 1, 1]);
  await waitFor(() => expect(result.current.data.map((entry) => entry.id)).toEqual([3, 2, 1]));
  expect(result.current.hasNextPage).toBe(false);
  unmount();
  client.clear();
});

it('starts another workitem at page zero without showing the previous workitem history', async () => {
  let releaseNewWorkitem!: (value: Awaited<ReturnType<typeof api.getUnifiedTimeline>>) => void;
  vi.mocked(api.getUnifiedTimeline).mockImplementation(async (id, page = 0) => {
    if (id === 'other') return new Promise((resolve) => { releaseNewWorkitem = resolve; });
    return { items: [makeItem(page === 0 ? 3 : 2)], hasMore: page === 0 };
  });
  const { client, wrapper } = makeClient();
  const { result, rerender, unmount } = renderHook(({ id }) => useTimelineHistory(id), { wrapper, initialProps: { id: '42' } });
  await waitFor(() => expect(result.current.data).toHaveLength(1));
  await act(async () => { await result.current.fetchNextPage(); });
  await waitFor(() => expect(result.current.data.map((entry) => entry.id)).toEqual([3, 2]));
  rerender({ id: 'other' });
  expect(result.current.data).toEqual([]);
  expect(result.current.isLoading).toBe(true);
  await waitFor(() => expect(releaseNewWorkitem).toBeTypeOf('function'));
  await act(async () => { releaseNewWorkitem({ items: [makeItem(99)], hasMore: false }); });
  await waitFor(() => expect(result.current.data.map((entry) => entry.id)).toEqual([99]));
  expect(vi.mocked(api.getUnifiedTimeline).mock.calls.filter(([id]) => id === 'other').map(([, page]) => page)).toEqual([0]);
  unmount();
  client.clear();
});
