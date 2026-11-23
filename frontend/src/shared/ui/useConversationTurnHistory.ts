import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/shared/api/client';
import { admittedEventRead } from '@/features/workitem/clarification/eventReadQueue';

interface Turn { id: number; submittedUserId?: number }
interface Metadata<M> { participants?: Record<string, string>; attachments?: Record<string, M[]> }
interface Snapshot<T, M> extends Metadata<M> { turns: T[]; turnsHasMore?: boolean; nextBeforeTurnId?: number | null }
const EMPTY_TURNS: never[] = [];
export function useConversationTurnHistory<T extends Turn, M = unknown>({ base, conversationId, snapshot, enabled = true }: {
  base: string; conversationId: number | null | undefined; snapshot?: Snapshot<T, M>; enabled?: boolean;
}) {
  const [window, setWindow] = useState<Metadata<M> & { base: string; turns: T[]; hasMore: boolean; newer: boolean; before: number | null } | null>(null);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const latest = useRef(snapshot); latest.current = snapshot;
  useEffect(() => { generation.current++; active.current?.abort(); active.current = null; setWindow(null); }, [base, conversationId, enabled]);
  useEffect(() => () => { generation.current++; active.current?.abort(); }, []);
  const current = window?.base === base ? window : null;
  const returnLatest = useCallback(() => { generation.current++; active.current?.abort(); active.current = null; setWindow(null); }, []);
  const onScroll = useCallback((element: HTMLElement) => {
    if (!enabled || !conversationId || active.current || document.hidden) return;
    const source = window?.base === base ? window : null;
    const forward = element.scrollTop > 120 && element.scrollHeight - element.clientHeight - element.scrollTop <= 120 && !!source?.newer;
    if (!forward && element.scrollTop > 120) return;
    const before = source?.before ?? latest.current?.nextBeforeTurnId;
    if (!forward && (!(source?.hasMore ?? latest.current?.turnsHasMore) || before == null)) return;
    const after = source?.turns.at(-1)?.id;
    const controller = new AbortController(); active.current = controller;
    const requestGeneration = generation.current;
    const height = element.scrollHeight;
    // Retain an actual DOM row and its viewport offset across either end's eviction.
    const anchor = Array.from(element.querySelectorAll?.<HTMLElement>('[data-turn-id]') ?? [])
      .find(node => node.getBoundingClientRect().bottom > element.getBoundingClientRect().top);
    const anchorId = anchor?.dataset.turnId;
    const anchorTop = anchor?.getBoundingClientRect().top;
    void admittedEventRead(conversationId, false, controller.signal, () => apiClient.get<Metadata<M> & { items: T[]; hasMore: boolean; nextBeforeTurnId: number | null }>(`${base}/turns/page`, { params: { ...(forward ? { afterTurnId: after } : { beforeTurnId: before }), limit: 50 }, signal: controller.signal }))
      .then(({ data }) => {
        if (controller.signal.aborted || requestGeneration !== generation.current) return;
        const existing = source?.turns ?? latest.current?.turns ?? [];
        const unique = new Map([...data.items, ...existing].map(turn => [turn.id, turn]));
        const sorted = [...unique.values()].sort((a, b) => a.id - b.id);
        const turns = forward ? sorted.slice(-100) : sorted.slice(0, 100);
        const attachments = { ...latest.current?.attachments, ...source?.attachments, ...data.attachments };
        const participants = { ...latest.current?.participants, ...source?.participants, ...data.participants };
        setWindow({ base, turns, hasMore: forward ? (source?.hasMore || sorted.length > 100) : data.hasMore,
          before: forward ? turns[0]?.id ?? null : data.nextBeforeTurnId,
          newer: forward ? data.hasMore : (source?.newer || sorted.length > 100) ?? false,
          attachments: Object.fromEntries(turns.filter(turn => attachments[String(turn.id)]).map(turn => [String(turn.id), attachments[String(turn.id)]])),
          participants: Object.fromEntries(turns.filter(turn => participants[String(turn.submittedUserId)]).map(turn => [String(turn.submittedUserId), participants[String(turn.submittedUserId)]])),
        });
        requestAnimationFrame(() => {
          if (controller.signal.aborted || requestGeneration !== generation.current) return;
          const retained = anchorId && element.querySelector?.<HTMLElement>(`[data-turn-id="${anchorId}"]`);
          if (retained && anchorTop != null) element.scrollTop += retained.getBoundingClientRect().top - anchorTop;
          else if (!forward) element.scrollTop += Math.max(0, element.scrollHeight - height);
        });
      }).catch(() => { /* The next viewport approach retries transient failures. */ })
      .finally(() => { if (active.current === controller) active.current = null; });
  }, [base, conversationId, enabled, window]);
  useEffect(() => {
    const hide = () => { if (document.hidden) { generation.current++; active.current?.abort(); active.current = null; } };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  return { turns: current?.turns ?? snapshot?.turns ?? EMPTY_TURNS, participants: current?.participants ?? snapshot?.participants, attachments: current?.attachments ?? snapshot?.attachments, browsingHistory: !!current, onScroll, returnLatest };
}
