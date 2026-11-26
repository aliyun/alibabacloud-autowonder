import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/shared/api/client';
import { admittedEventRead } from '@/features/workitem/clarification/eventReadQueue';
import { accountEventCache, releaseEventCache } from '@/features/workitem/clarification/eventCacheBudget';
import { MarkdownView } from './MarkdownView';
import type { ComponentProps } from 'react';
import { Button, message } from 'antd';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { copyTextToClipboard } from '@/shared/lib/clipboard';

interface Segment { content: string; segmentIndex: number; nextCursor: string | null; hasMore: boolean }
export const CONVERSATION_COPY_FEEDBACK_MS = 2000;
export async function readConversationTurnText(base: string, conversationId: number, turnId: number, signal: AbortSignal): Promise<string> {
  const chunks: string[] = []; let cursor: string | undefined; let bytes = 0;
  do {
    const { data } = await admittedEventRead(conversationId, false, signal, () => apiClient.get<Segment>(`${base}/turns/${turnId}/content`, { params: { cursor }, signal }));
    bytes += new TextEncoder().encode(data.content).length;
    if (bytes > 32 * 1024 * 1024) throw new Error('Turn content exceeds the business document limit');
    chunks.push(data.content);
    if (!data.hasMore) return chunks.join('');
    if (data.nextCursor == null || data.nextCursor === cursor) throw new Error('Turn content cursor did not advance');
    cursor = data.nextCursor;
  } while (!signal.aborted);
  throw new DOMException('Aborted', 'AbortError');
}

export function ConversationTurnCopyButton({ base, conversationId, turn, label }: {
  base: string; conversationId: number; turn: { id: number; content: string; contentHasMore?: boolean }; label: string;
}) {
  const { t } = useTranslation('shared');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.hidden) { controller.current?.abort(); setBusy(false); } };
    document.addEventListener('visibilitychange', hide);
    return () => {
      mounted.current = false;
      controller.current?.abort();
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [base, conversationId, turn.id]);
  return <Button type="text" size="small" icon={copied ? <CheckOutlined /> : <CopyOutlined />}
    aria-label={label} title={label} loading={busy} data-testid="copy-message-button"
    data-copy-state={copied ? 'copied' : 'idle'} onClick={async () => {
    const request = new AbortController(); controller.current = request; setBusy(true);
    try {
      const text = turn.contentHasMore ? await readConversationTurnText(base, conversationId, turn.id, request.signal) : turn.content;
      if (request.signal.aborted) return;
      if (!(await copyTextToClipboard(text))) throw new Error('Clipboard write failed');
      if (!mounted.current || request.signal.aborted) return;
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      setCopied(true);
      copiedTimer.current = setTimeout(() => {
        copiedTimer.current = null;
        if (mounted.current) setCopied(false);
      }, CONVERSATION_COPY_FEEDBACK_MS);
    } catch { if (!request.signal.aborted) void message.error(t('copy.failed')); }
    finally {
      if (controller.current === request) controller.current = null;
      if (mounted.current && !request.signal.aborted) setBusy(false);
    }
  }} />;
}
/** Eight UTF-8 16KiB segments bound each mounted bubble to 128KiB. Cursors, never
 * discarded text, let scrolling recover older segments from the server. */
type AutoConversationTurnContentProps = {
  base: string;
  conversationId: number;
  turn: { id: number; content: string; contentHasMore?: boolean };
  enabled?: boolean;
  scrollMode?: 'contained' | 'flow';
} & Omit<ComponentProps<typeof MarkdownView>, 'content'>;

export function AutoConversationTurnContent({ scrollMode = 'contained', ...props }: AutoConversationTurnContentProps) {
  return scrollMode === 'flow'
    ? <FlowConversationTurnContent {...props} />
    : <ContainedConversationTurnContent {...props} />;
}

/** PRD already has a conversation-level scroller, so long replies join that document flow
 * instead of creating a second scrollbar inside one message. */
function FlowConversationTurnContent({ base, conversationId, turn, enabled = true, ...markdown }: AutoConversationTurnContentProps) {
  const { t } = useTranslation('shared');
  const [content, setContent] = useState(turn.content);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setContent(turn.content);
    setError(false);
    if (!turn.contentHasMore || !enabled) return;
    const controller = new AbortController();
    void readConversationTurnText(base, conversationId, turn.id, controller.signal)
      .then(text => { if (!controller.signal.aborted) setContent(text); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [base, conversationId, turn.id, turn.content, turn.contentHasMore, enabled, retry]);
  return <div>
    <MarkdownView {...markdown} content={content} />
    {error && <Button type="link" size="small" onClick={() => setRetry(value => value + 1)}>{t('conversationContent.retry')}</Button>}
  </div>;
}

function ContainedConversationTurnContent({ base, conversationId, turn, enabled = true, ...markdown }: AutoConversationTurnContentProps) {
  const { t } = useTranslation('shared');
  const root = useRef<HTMLDivElement>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [error, setError] = useState(false);
  const owner = useRef(Symbol());
  const recovery = useRef({ index: 0, height: 0 });
  const [placeholderHeight, setPlaceholderHeight] = useState(0);
  const active = useRef<AbortController | null>(null);
  const visible = useRef(false);
  const retryRequest = useRef<{ index: number; prepend: boolean } | null>(null);
  const state = useRef(segments); state.current = segments;
  const load = useCallback((index: number, prepend = false) => {
    if (active.current || !enabled || document.hidden || !visible.current || index < 0) return;
    const controller = new AbortController(); active.current = controller; setError(false);
    // Turn-content cursors are decimal segment indices; derive them instead of
    // retaining one cursor per previously visited segment for the session lifetime.
    const cursor = index === 0 ? undefined : String(index);
    void admittedEventRead(conversationId, false, controller.signal, () => apiClient.get<Segment>(`${base}/turns/${turn.id}/content`, { params: { cursor }, signal: controller.signal }))
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setPlaceholderHeight(0);
        setSegments(previous => {
          const result = prepend ? [data, ...previous.filter(item => item.segmentIndex !== data.segmentIndex)] : [...previous.filter(item => item.segmentIndex !== data.segmentIndex), data];
          return prepend ? result.slice(0, 8) : result.slice(-8);
        });
        if (prepend && root.current) requestAnimationFrame(() => { if (root.current) root.current.scrollTop = 150; });
      }).catch(() => { if (!controller.signal.aborted) { retryRequest.current = { index, prepend }; setError(true); } })
      .finally(() => { if (active.current === controller) active.current = null; });
  }, [base, conversationId, turn.id, enabled]);
  useEffect(() => {
    setSegments([]); recovery.current = { index: 0, height: 0 }; setPlaceholderHeight(0);
    return () => { active.current?.abort(); active.current = null; };
  }, [base, conversationId, turn.id, enabled]);
  const evict = useCallback(() => {
    recovery.current = { index: state.current[0]?.segmentIndex ?? recovery.current.index, height: root.current?.getBoundingClientRect().height ?? recovery.current.height };
    setPlaceholderHeight(recovery.current.height);
    setSegments([]);
  }, []);
  useEffect(() => {
    if (enabled && segments.length) accountEventCache(conversationId, owner.current,
      segments.reduce((bytes, segment) => bytes + new TextEncoder().encode(segment.content).length, 0), evict);
    else releaseEventCache(conversationId, owner.current);
  }, [conversationId, segments, enabled, evict]);
  useEffect(() => () => releaseEventCache(conversationId, owner.current), [conversationId]);
  useEffect(() => {
    if (!turn.contentHasMore || !enabled) return;
    const element = root.current;
    const start = () => {
      if (!state.current.length) load(recovery.current.index);
      else if (root.current && root.current.scrollHeight - root.current.scrollTop - root.current.clientHeight < 180 && state.current.at(-1)?.hasMore) load(state.current.at(-1)!.segmentIndex + 1);
    };
    const visibility = () => { if (document.hidden) { active.current?.abort(); active.current = null; } else if (visible.current) start(); };
    document.addEventListener('visibilitychange', visibility);
    const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
      visible.current = entries[0]?.isIntersecting ?? false;
      if (visible.current) start(); else { active.current?.abort(); active.current = null; evict(); }
    }, { rootMargin: '100px' }) : null;
    if (observer && element) observer.observe(element); else { visible.current = true; start(); }
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', visibility); active.current?.abort(); active.current = null; };
  }, [load, turn.contentHasMore, enabled, evict]);
  useEffect(() => {
    if (!error || !enabled) return;
    const timer = setTimeout(() => { if (retryRequest.current) load(retryRequest.current.index, retryRequest.current.prepend); }, 2000);
    return () => clearTimeout(timer);
  }, [error, enabled, load]);
  const advance = useCallback(() => {
    const element = root.current;
    if (!element) return;
    const first = state.current[0]; const last = state.current.at(-1);
    if (!first) load(recovery.current.index);
    else if (element.scrollTop < 80 && first.segmentIndex > 0) load(first.segmentIndex - 1, true);
    else if (element.scrollHeight - element.scrollTop - element.clientHeight < 180 && last?.hasMore) load(last.segmentIndex + 1);
  }, [load]);
  useEffect(() => {
    if (root.current && root.current.scrollHeight <= root.current.clientHeight && segments.at(-1)?.hasMore) {
      const timer = setTimeout(advance, 0); return () => clearTimeout(timer);
    }
  }, [segments, advance]);
  return <div ref={root} onScroll={advance} style={turn.contentHasMore ? { maxHeight: '70vh', minHeight: placeholderHeight || undefined, overflowY: 'auto', overflowAnchor: 'none' } : undefined}>
    <MarkdownView {...markdown} content={segments.length ? segments.map(segment => segment.content).join('') : turn.content} />
    {error && <div role="status" onMouseEnter={advance}>{t('conversationContent.retry')}</div>}
  </div>;
}
