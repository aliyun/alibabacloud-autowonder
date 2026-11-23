import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useConversationTurnHistory } from './useConversationTurnHistory';
import { apiClient } from '@/shared/api/client';
vi.mock('@/shared/api/client', () => ({ apiClient: { get: vi.fn() } }));
describe('bounded conversation turns', () => {
  it('restores evicted newer pages automatically at the bottom of a 300-turn history', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ id: (i + 1) * 7 }));
    vi.mocked(apiClient.get).mockImplementation(async (_url, config) => {
      const before = (config?.params as { beforeTurnId?: number } | undefined)?.beforeTurnId;
      const after = (config?.params as { afterTurnId?: number } | undefined)?.afterTurnId;
      const items = after != null ? rows.filter(row => row.id > after).slice(0, 50)
        : rows.filter(row => row.id < Number(before)).slice(-50);
      return { data: { items, hasMore: after != null ? items.at(-1)?.id !== rows.at(-1)?.id : items[0]?.id !== 7,
        nextBeforeTurnId: items[0]?.id } } as never;
    });
    const { result } = renderHook(() => useConversationTurnHistory({ base: '/both', conversationId: 9,
      snapshot: { turns: rows.slice(-50), turnsHasMore: true, nextBeforeTurnId: 251 * 7 } }));
    const element = { scrollTop: 0, scrollHeight: 2000, clientHeight: 400 } as HTMLElement;
    for (const first of [201, 151, 101]) {
      await act(async () => result.current.onScroll(element));
      await waitFor(() => expect(result.current.turns[0].id).toBe(first * 7));
    }
    element.scrollTop = 1600;
    await act(async () => result.current.onScroll(element));
    await waitFor(() => expect(result.current.turns.at(-1)?.id).toBe(250 * 7));
    expect(result.current.turns).toHaveLength(100);
    await act(async () => result.current.onScroll(element));
    await waitFor(() => expect(result.current.turns.at(-1)?.id).toBe(300 * 7));
    expect(result.current.turns).toHaveLength(100);
  });
  it('returns to live messages and aborts stale history when sending from an old window', async () => {
    let signal: AbortSignal | undefined;
    let finish: ((value: unknown) => void) | undefined;
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { items: [{ id: 1 }], hasMore: true, nextBeforeTurnId: 1 } })
      .mockImplementationOnce((_url, config) => {
        signal = config?.signal as AbortSignal;
        return new Promise(resolve => { finish = resolve; }) as never;
      });
    const { result, rerender } = renderHook(({ turns }) => useConversationTurnHistory({ base: '/send', conversationId: 3, snapshot: { turns, turnsHasMore: true, nextBeforeTurnId: 51 } }), { initialProps: { turns: [{ id: 51 }] } });
    await act(async () => result.current.onScroll({ scrollTop: 0 } as HTMLElement));
    await waitFor(() => expect(result.current.browsingHistory).toBe(true));
    act(() => result.current.onScroll({ scrollTop: 0 } as HTMLElement));
    await waitFor(() => expect(signal).toBeTruthy());
    act(() => result.current.returnLatest());
    expect(signal?.aborted).toBe(true);
    rerender({ turns: [{ id: 51 }, { id: 52 }] });
    finish?.({ data: { items: [{ id: 0 }], hasMore: false, nextBeforeTurnId: null } });
    await waitFor(() => expect(result.current.turns.map(turn => turn.id)).toEqual([51, 52]));
    expect(result.current.browsingHistory).toBe(false);
  });
  it('cancels an admitted page read when the conversation unmounts', async () => {
    let signal: AbortSignal | undefined;
    let finish: ((value: unknown) => void) | undefined;
    vi.mocked(apiClient.get).mockImplementation((_url, config) => {
      signal = config?.signal as AbortSignal;
      return new Promise(resolve => { finish = resolve; }) as never;
    });
    const { result, unmount } = renderHook(() => useConversationTurnHistory({ base: '/cancel', conversationId: 2, snapshot: { turns: [{ id: 51 }], turnsHasMore: true, nextBeforeTurnId: 51 } }));
    act(() => result.current.onScroll({ scrollTop: 0 } as HTMLElement));
    await waitFor(() => expect(signal).toBeTruthy());
    unmount();
    expect(signal?.aborted).toBe(true);
    finish?.({ data: { items: [], hasMore: false, nextBeforeTurnId: null } });
  });
  it('loads earlier turns automatically and retains at most 100, then restores latest', async () => {
    const latest = Array.from({ length: 50 }, (_, i) => ({ id: i + 101, content: '' }));
    vi.mocked(apiClient.get).mockImplementation(async (_url, config) => {
      const before = Number((config?.params as { beforeTurnId?: number } | undefined)?.beforeTurnId);
      return { data: { items: Array.from({ length: 50 }, (_, i) => ({ id: before - 50 + i, content: '' })), hasMore: true, nextBeforeTurnId: before - 50 } } as never;
    });
    const { result } = renderHook(() => useConversationTurnHistory({ base: '/test', conversationId: 1, snapshot: { turns: latest, turnsHasMore: true, nextBeforeTurnId: 101 } }));
    await act(async () => result.current.onScroll({ scrollTop: 0 } as HTMLElement));
    await waitFor(() => expect(result.current.turns.length).toBe(100));
    await act(async () => result.current.onScroll({ scrollTop: 0 } as HTMLElement));
    await waitFor(() => expect(result.current.turns[0].id).toBe(1));
    expect(result.current.turns.length).toBe(100);
    act(() => result.current.returnLatest());
    expect(result.current.turns).toEqual(latest);
  });
});
