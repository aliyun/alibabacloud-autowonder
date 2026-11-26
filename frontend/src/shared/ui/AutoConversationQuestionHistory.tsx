import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Button, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/shared/api/client';
import { admittedEventRead } from '@/features/workitem/clarification/eventReadQueue';
import { AnswerHistory } from '@/features/workitem/clarification/cards/AnswerHistory';
import { projectQuestionHistory, type QuestionHistoryEntry } from '@/features/workitem/clarification/answerHistory';
import type { ClarificationElicitation } from '@/features/workitem/clarification/types';

interface Page { items: ClarificationElicitation[]; hasMore: boolean; nextBeforeId: number | null; nextAfterId: number | null }
interface Segment { message: string | null; requestedSchema: string | null; answerJson: string | null; hasMore: boolean; nextCursor: string | null }
const DOCUMENT_BYTES = 32 * 1024 * 1024;
// At most two in-flight or retained large documents. Small completed cards release
// their reservation; the bounded metadata window still limits those to 40 per turn.
let reservations = 0;
const waiters = new Set<() => void>();
async function reserve(signal: AbortSignal): Promise<() => void> {
  while (reservations >= 2) {
    await new Promise<void>((resolve, reject) => {
      const wake = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
      const cleanup = () => { waiters.delete(wake); signal.removeEventListener('abort', abort); };
      waiters.add(wake); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  reservations++;
  let released = false;
  return () => { if (!released) { released = true; reservations--; [...waiters].forEach(wake => wake()); } };
}

/** Three SQL character blocks per response; never parse an incomplete schema/answer. */
export async function readConversationQuestion(base: string, conversationId: number, turnId: number,
  card: ClarificationElicitation, signal: AbortSignal): Promise<{ card: ClarificationElicitation; bytes: number }> {
  const chunks: Record<'message' | 'requestedSchema' | 'answerJson', string[]> = { message: [], requestedSchema: [], answerJson: [] };
  const present = { message: false, requestedSchema: false, answerJson: false };
  let cursor: string | undefined; let bytes = 0;
  do {
    const { data } = await admittedEventRead(conversationId, false, signal, () => apiClient.get<Segment>(`${base}/turns/${turnId}/questions/${card.historyId}/content`, { params: { cursor }, signal }));
    for (const field of ['message', 'requestedSchema', 'answerJson'] as const) {
      if (data[field] != null) { present[field] = true; bytes += new TextEncoder().encode(data[field]!).length; chunks[field].push(data[field]!); }
    }
    if (bytes > DOCUMENT_BYTES) throw new Error('Question exceeds the business document limit');
    if (!data.hasMore) return { bytes, card: { ...card, contentHasMore: false,
      message: present.message ? chunks.message.join('') : null,
      requestedSchema: present.requestedSchema ? chunks.requestedSchema.join('') : null,
      answerJson: present.answerJson ? chunks.answerJson.join('') : null } };
    if (data.nextCursor == null || data.nextCursor === cursor) throw new Error('Question content cursor did not advance');
    cursor = data.nextCursor;
  } while (!signal.aborted);
  throw new DOMException('Aborted', 'AbortError');
}

function useVisibility(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [foreground, setForeground] = useState(!document.hidden);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '100px' });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { const change = () => setForeground(!document.hidden); document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change); }, []);
  return { ref, visible: enabled && visible && foreground };
}

// 只在内容呈现时记录高度：隐藏时内容与测量发生在同一次提交，事后测量得到的是塌陷后的高度。
function useRetainedHeight(ref: RefObject<HTMLDivElement | null>, showing: boolean, minimum: number,
  cache?: Map<number, number>, key?: number) {
  const height = useRef(key != null ? cache?.get(key) ?? minimum : minimum);
  const showingRef = useRef(showing); showingRef.current = showing;
  const record = useCallback(() => {
    if (!showingRef.current || !ref.current) return;
    height.current = Math.max(minimum, ref.current.getBoundingClientRect().height);
    if (key != null) cache?.set(key, height.current);
  }, [ref, minimum, cache, key]);
  useLayoutEffect(record);
  useEffect(() => {
    const element = ref.current;
    if (!showing || !element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(record); observer.observe(element);
    return () => observer.disconnect();
  }, [showing, record, ref]);
  return height;
}

interface Props {
  base: string; conversationId: number; turnId: number; enabled?: boolean;
  entries: readonly QuestionHistoryEntry[]; onContinue?: (entry: QuestionHistoryEntry) => void; canContinue?: boolean;
  onSettledQuestions?: (turnId: number, requestIds: readonly string[]) => void;
  paged?: boolean;
  refreshKey?: string;
  deliveryStatuses?: readonly ClarificationElicitation[] | null;
}
function Question({ card, base, conversationId, turnId, enabled, onContinue, canContinue, deliveryStatuses, heights }: Omit<Props, 'entries'> & { card: ClarificationElicitation; heights: Map<number, number> }) {
  const { t } = useTranslation('workitem');
  const { ref, visible } = useVisibility(enabled !== false);
  const [full, setFull] = useState<ClarificationElicitation | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const automaticRetries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    automaticRetries.current = 0;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, [base, conversationId, turnId, card.historyId, card.requestId]);
  useEffect(() => {
    setFull(null); setError(false);
    if (!visible || !card.contentHasMore) return;
    const controller = new AbortController(); let release: (() => void) | undefined;
    void reserve(controller.signal).then(async slot => {
      release = slot;
      const result = await readConversationQuestion(base, conversationId, turnId, card, controller.signal);
      if (controller.signal.aborted) return;
      automaticRetries.current = 0;
      setFull(result.card);
      if (result.bytes <= 64 * 1024) { release(); release = undefined; }
    }).catch(() => {
      if (!controller.signal.aborted) {
        if (automaticRetries.current < 2) {
          const delay = 300 * 2 ** automaticRetries.current++;
          retryTimer.current = setTimeout(() => { retryTimer.current = null; setRetry(value => value + 1); }, delay);
        } else setError(true);
      }
      release?.(); release = undefined;
    });
    return () => {
      controller.abort(); release?.();
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
    };
  }, [base, conversationId, turnId, card, visible, retry, ref]);
  const ready = !card.contentHasMore ? card : full;
  const height = useRetainedHeight(ref, visible && !!ready, 70, heights, card.historyId ?? undefined);
  const deliveryStatus = deliveryStatuses?.find(row => row.requestId === card.requestId)?.deliveryStatus;
  return <div ref={ref} data-question-id={card.historyId} style={{ minHeight: visible && (ready || error) ? 1 : height.current }}>
    {visible && ready ? <AnswerHistory entries={projectQuestionHistory(turnId, [{ ...ready, deliveryStatus: deliveryStatus ?? ready.deliveryStatus }])} onContinue={onContinue} canContinue={canContinue} />
      : visible ? <div aria-live="polite"><Typography.Text>{card.message}</Typography.Text>
        {error && <div>{t('clarification.history.contentFailed')}<Button size="small" onClick={() => {
          automaticRetries.current = 0; setRetry(value => value + 1);
        }}>{t('clarification.history.retry')}</Button></div>}</div> : null}
  </div>;
}

/** Automatically pages the visible turn's durable questions. Both directions retain
 * at most 40 small projections. Leaving the viewport releases all hydrated content. */
function QuestionWindow({ entries, enabled = true, onSettledQuestions, ...props }: Props) {
  const { t } = useTranslation('workitem');
  const { ref, visible } = useVisibility(enabled);
  const [page, setPage] = useState<{ items: ClarificationElicitation[]; older: boolean; newer: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const active = useRef<AbortController | null>(null);
  const automaticRetries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryBefore = useRef(false);
  const generation = useRef(0);
  const refreshKey = useRef(props.refreshKey);
  const restoreAnchor = useRef<{ id: string; top: number } | null>(null);
  const cardHeights = useRef(new Map<number, number>());
  const recovery = useRef({ first: 0, older: false, top: 0 });
  const state = useRef(page); state.current = page;
  const load = useCallback((before = false) => {
    if (!visible || active.current || document.hidden) return;
    const current = state.current;
    if (current && !(before ? current.older : current.newer)) return;
    retryBefore.current = before;
    const controller = new AbortController(); active.current = controller; setFailed(false); setLoading(true);
    const requestGeneration = generation.current;
    const element = ref.current;
    const anchor = Array.from(element?.querySelectorAll<HTMLElement>('[data-question-id]') ?? [])
      .find(node => node.getBoundingClientRect().bottom > element!.getBoundingClientRect().top);
    const anchorId = anchor?.dataset.questionId; const top = anchor?.getBoundingClientRect().top;
    const params = before ? { beforeId: current?.items[0]?.historyId }
      : { afterId: current?.items.at(-1)?.historyId ?? Math.max(0, recovery.current.first - 1) };
    void admittedEventRead(props.conversationId, false, controller.signal, () => apiClient.get<Page>(`${props.base}/turns/${props.turnId}/questions/page`, { params, signal: controller.signal }))
      .then(({ data }) => {
        if (controller.signal.aborted || requestGeneration !== generation.current) return;
        automaticRetries.current = 0;
        const all = [...new Map([...(current?.items ?? []), ...data.items].map(card => [card.historyId, card])).values()]
          .sort((a, b) => a.historyId! - b.historyId!);
        const items = before ? all.slice(0, 40) : all.slice(-40);
        // Clear admission before publishing the page: React may commit the page
        // before a promise's finally callback and immediately request its next edge.
        if (active.current === controller) active.current = null;
        setLoading(false);
        setPage({ items, older: before ? data.hasMore : !!current?.older || recovery.current.older || all.length > 40,
          newer: before ? !!current?.newer || all.length > 40 : data.hasMore });
        requestAnimationFrame(() => {
          if (controller.signal.aborted || requestGeneration !== generation.current || document.hidden || !element?.isConnected) return;
          const restore = restoreAnchor.current;
          const retainedId = restore?.id ?? anchorId;
          const retained = retainedId && element.querySelector<HTMLElement>(`[data-question-id="${retainedId}"]`);
          const previousTop = restore?.top ?? top;
          if (retained && previousTop != null) {
            element.scrollTop += retained.getBoundingClientRect().top - previousTop;
            restoreAnchor.current = null;
          } else if (!current && (!restore || !data.hasMore)) {
            element.scrollTop = recovery.current.top;
            restoreAnchor.current = null;
          }
        });
      }).catch(() => {
        if (!controller.signal.aborted) {
          if (automaticRetries.current < 2) {
            const delay = 300 * 2 ** automaticRetries.current++;
            retryTimer.current = setTimeout(() => { retryTimer.current = null; setRetry(value => value + 1); }, delay);
          } else setFailed(true);
        }
      })
      .finally(() => { if (active.current === controller) { active.current = null; setLoading(false); } });
  }, [visible, props.base, props.conversationId, props.turnId, props.refreshKey, retry, ref]);
  // Settlement order differs from ID order: an older pending card can settle
  // behind the current cursor. Restart the bounded scan instead of marking only
  // the newer edge dirty, and automatically recover the reader's retained row.
  useEffect(() => {
    if (refreshKey.current === props.refreshKey) return;
    refreshKey.current = props.refreshKey;
    const element = ref.current;
    const anchor = Array.from(element?.querySelectorAll<HTMLElement>('[data-question-id]') ?? [])
      .find(node => node.getBoundingClientRect().bottom > element!.getBoundingClientRect().top);
    if (anchor?.dataset.questionId) restoreAnchor.current = { id: anchor.dataset.questionId, top: anchor.getBoundingClientRect().top };
    recovery.current = { first: 0, older: false, top: element?.scrollTop ?? 0 };
    generation.current++; active.current?.abort(); active.current = null;
    automaticRetries.current = 0;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    state.current = null; setPage(null); setLoading(false); setFailed(false);
  }, [props.refreshKey, ref]);
  useEffect(() => {
    if (visible) { load(); return; }
    const current = state.current;
    if (current) recovery.current = { first: current.items[0]?.historyId ?? 0, older: current.older,
      top: ref.current?.scrollTop ?? 0 };
    generation.current++; active.current?.abort(); active.current = null; setPage(null);
  }, [visible, load, ref]);
  useEffect(() => () => {
    generation.current++; active.current?.abort(); active.current = null;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, [props.base, props.conversationId, props.turnId]);
  useEffect(() => {
    if (!visible || !page || failed || loading) return;
    onSettledQuestions?.(props.turnId, page.items.map(card => card.requestId));
    const element = ref.current;
    const restoring = restoreAnchor.current && (page.items.at(-1)?.historyId ?? 0) < Number(restoreAnchor.current.id);
    if (page.newer && (restoring || element && element.scrollHeight - element.clientHeight - element.scrollTop <= 120)) load();
  }, [page, visible, failed, loading, load, onSettledQuestions, props.turnId, ref]);
  const durable = new Set(page?.items.map(card => card.requestId));
  const height = useRetainedHeight(ref, visible && !!page, 1);
  // 重新进入可视区时保留离开时的高度直到内容恢复，否则先塌陷再撑开会推挤后续消息。
  return <div ref={ref} style={{ maxHeight: 600, overflowY: 'auto', minHeight: visible && (page || failed) ? 1 : height.current }}
    onScroll={event => { const element = event.currentTarget;
      if (element.scrollTop <= 100 && page?.older) load(true);
      else if (element.scrollHeight - element.clientHeight - element.scrollTop <= 120) load(); }}>
    {page?.items.map(card => <Question key={card.historyId} {...props} enabled={visible} card={card} heights={cardHeights.current} />)}
    <AnswerHistory entries={entries.filter(entry => !durable.has(entry.requestId))} onContinue={props.onContinue} canContinue={props.canContinue} />
    {failed && <div role="status">{t('clarification.history.contentFailed')} <Button size="small" onClick={() => {
      automaticRetries.current = 0; load(retryBefore.current);
    }}>{t('clarification.history.retry')}</Button></div>}
  </div>;
}

export function AutoConversationQuestionHistory(props: Props) {
  if (props.paged === false) return <AnswerHistory entries={props.entries} onContinue={props.onContinue} canContinue={props.canContinue} />;
  return <QuestionWindow key={`${props.base}:${props.turnId}`} {...props} />;
}
