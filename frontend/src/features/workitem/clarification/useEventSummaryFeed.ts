import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRealtime } from '@/shared/realtime/useRealtime';
import { ApiError, ErrorCodes } from '@/shared/types/common';
import { buildTimeline } from './timeline';
import { eventDisplayBackoffMs, semanticContent, summaryItemsToEvents, type EventDisplaySource } from './eventDisplay';
import { admittedEventRead } from './eventReadQueue';
import { EVENT_WINDOW_SEGMENTS, registerEventWindow } from './eventContentWindows';
import { accountEventCache, releaseEventCache } from './eventCacheBudget';
import type { ConversationRealtimeEvent, EventDisplayPreparationStatus, EventSummaryItem } from './types';

export const EVENT_SUMMARY_POLL_MS = 3000;
const MAX_PAGES_PER_TICK = 5;
const MAX_EVENT_BYTES = 32 * 1024 * 1024;
const CACHE_BYTES = 3 * 1024 * 1024;
const MAX_CACHED_EVENTS = 1000;
const TERMINAL_PREPARATION: EventDisplayPreparationStatus[] = ['READY', 'UNAVAILABLE', 'EMPTY', 'DEFERRED'];
const logicalKey = (item: { dispatchAttempt?: number; eventSeq: number }) => `${item.dispatchAttempt ?? 0}:${item.eventSeq}`;
const businessIdentity = (item: EventSummaryItem) => ({ dispatchAttempt: item.dispatchAttempt, eventSeq: item.eventSeq });

export function isEventDisplayAuthDenied(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 401 || status === 403 || error instanceof ApiError
    && (error.code === ErrorCodes.UNAUTHORIZED || error.code === ErrorCodes.NO_PERMISSION);
}

/**
 * Durable cursors recover dropped pushes; live and recovered events share one logical identity.
 *
 * <p>`keepAllEvents` 关闭 1000 事件窗口裁剪：可见性只影响是否读，已显示事件不因窗口上限消失。
 * <p>`atomicHistory` 让历史在一个 tick 内读完并一次提交；活跃轮次追平后恢复实时增量。
 */
export function useEventSummaryFeed({ source, conversationId, turnId, enabled, processing,
  retainBusinessText = false, keepAllEvents = false, atomicHistory = false }: {
  source: EventDisplaySource; conversationId: number | null; turnId: number | null;
  enabled: boolean; processing: boolean;
  retainBusinessText?: boolean;
  keepAllEvents?: boolean;
  atomicHistory?: boolean;
}) {
  const stableHistory = keepAllEvents || atomicHistory;
  const [items, setItems] = useState<EventSummaryItem[]>([]);
  const [preparationStatus, setPreparationStatus] = useState<EventDisplayPreparationStatus>('PREPARING');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [authDenied, setAuthDenied] = useState(false);
  const [watermark, setWatermark] = useState(0);
  const [hydrating, setHydrating] = useState(false);
  const [businessText, setBusinessText] = useState('');
  const [businessPaused, setBusinessPaused] = useState(false);
  const sourceRef = useRef(source); sourceRef.current = source;
  const itemsRef = useRef(new Map<string, EventSummaryItem>());
  const cursorRef = useRef(0);
  const inFlight = useRef(false);
  const requested = useRef(false);
  const failures = useRef(0);
  const statusRef = useRef<EventDisplayPreparationStatus>('PREPARING');
  const moreRef = useRef(false);
  const epochRef = useRef(0);
  const authDeniedRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const details = useRef(new Map<number, { signature: string; parts: Map<number, string>; cursor: number;
    complete: boolean; bytes: number; version?: string; anchor?: number; legacyAttempts?: number; retryAt?: number }>());
  const businessParts = useRef(new Map<string, { item: ReturnType<typeof businessIdentity>; parts: string[] }>());
  const businessAttempt = useRef(-1);
  const unregister = useRef(new Map<number, () => void>());
  const restoreControllers = useRef(new Set<AbortController>());
  const windowAnchor = useRef<number | null>(null);
  /** 历史窗口导航批次在途：同一次阅读只允许一个批次改写显示窗口。 */
  const navigating = useRef(false);
  const highestRevision = useRef(0);
  const liveItems = useRef(new Map<string, EventSummaryItem>());
  const pagesSeen = useRef(new Map<number, { first: number; last: number }>());
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const pendingLive = useRef(new Map<string, ConversationRealtimeEvent>());
  const cacheOwner = useRef(Symbol('conversation-event-cache'));
  /** 原子历史批次在途：期间的合并不逐页提交，整批结束后一次呈现。 */
  const atomicBatches = useRef(new Set<symbol>());
  /** 活跃轮次首次进入也原子恢复已有历史；追平后切回实时增量。 */
  const initialAtomicHistoryComplete = useRef(false);
  const liveTimer = useRef<ReturnType<typeof setTimeout>>();
  const clearLive = useCallback(() => {
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = undefined; pendingLive.current.clear();
  }, []);

  const refreshBusinessText = useCallback(() => {
    if (!retainBusinessText) return;
    const entries = [...businessParts.current.values()].sort((a, b) =>
      a.item.dispatchAttempt - b.item.dispatchAttempt || a.item.eventSeq - b.item.eventSeq);
    const latest = entries.at(-1)?.item.dispatchAttempt;
    const text = entries.filter(entry => entry.item.dispatchAttempt === latest)
      .map(entry => entry.parts.join('')).join('');
    if (new TextEncoder().encode(text).length + entries.length * 128 > MAX_EVENT_BYTES) {
      const last = entries.at(-1);
      if (last) businessParts.current.delete(logicalKey(last.item));
      setBusinessPaused(true); return;
    }
    setBusinessText(text);
  }, [retainBusinessText]);

  const pageBefore = useCallback((revision: number) => {
    const matches = [...pagesSeen.current.entries()].filter(([, page]) => page.first <= revision && page.last >= revision);
    return matches.at(-1)?.[0] ?? 0;
  }, []);
  const commitItems = useCallback(() => {
    // 原子批次期间只累积，整批结束由 runTick 统一提交，避免逐页重绘。
    if (atomicBatches.current.size > 0) return;
    // 稳定呈现模式长期保留全部摘要条目；只为正文被预算淘汰的条目登记恢复入口，
    // 避免超长轮次持有与事件数同阶的无用闭包。
    const restoreEvicted = (item: EventSummaryItem) => {
      if (unregister.current.has(item.eventId) || conversationId == null || turnId == null) return;
      const key = logicalKey(item);
      unregister.current.set(item.eventId, registerEventWindow(`event:${conversationId}:${turnId}:${item.eventId}`, async () => {
        if (!enabledRef.current || document.hidden) return;
        const controller = new AbortController(); restoreControllers.current.add(controller);
        const epoch = epochRef.current;
        try {
          const page = await admittedEventRead(conversationId, false, controller.signal,
            () => sourceRef.current.summaries(turnId, pageBefore(item.revision ?? 0) || undefined, controller.signal));
          if (controller.signal.aborted || epoch !== epochRef.current) return;
          const restored = page.items.find(candidate => logicalKey(candidate) === key);
          if (!restored?.payload) return;
          const current = itemsRef.current.get(key);
          // 显式恢复即钉住：把条目提升到 Map 尾部，预算扫描（新→旧）最后才可能淘汰它，
          // 后续轮询/合并提交不会再把刚恢复的正文清掉（与基线 delete+set 语义一致）。
          itemsRef.current.delete(key);
          itemsRef.current.set(key, { ...restored, contentWindow: current?.contentWindow
            ? { ...current.contentWindow, evicted: false } : restored.contentWindow });
          commitItems();
        } catch { if (!controller.signal.aborted && epoch === epochRef.current) setError(true); }
        finally { restoreControllers.current.delete(controller); }
      }));
    };
    const ordered = [...itemsRef.current.entries()].sort((a, b) =>
      (a[1].revision ?? a[1].eventSeq) - (b[1].revision ?? b[1].eventSeq));
    if (!stableHistory) {
      let start = Math.max(0, ordered.length - MAX_CACHED_EVENTS);
      if (windowAnchor.current != null) {
        const anchor = ordered.findIndex(([, item]) => (item.revision ?? item.eventSeq) >= windowAnchor.current!);
        start = Math.max(0, Math.min(anchor < 0 ? 0 : anchor, ordered.length - MAX_CACHED_EVENTS));
      }
      const retained = new Set(ordered.slice(start, start + MAX_CACHED_EVENTS).map(([key]) => key));
      for (const [key, item] of ordered) if (!retained.has(key)) {
        itemsRef.current.delete(key); details.current.delete(item.eventId);
        unregister.current.get(item.eventId)?.(); unregister.current.delete(item.eventId);
      }
    }
    // 3MiB visible payloads + 3MiB source segments + 2MiB live tail, independently bounded.
    let bytes = 0;
    for (const item of [...itemsRef.current.values()].reverse()) {
      bytes += item.payload == null ? 0 : new TextEncoder().encode(item.payload).length;
      if (bytes > CACHE_BYTES) {
        itemsRef.current.set(logicalKey(item), {
          ...item, payload: null, contentWindow: item.contentWindow
            ? { ...item.contentWindow, evicted: true }
            : { key: `event:${conversationId}:${turnId}:${item.eventId}`, first: item.revision ?? item.eventSeq, last: item.revision ?? item.eventSeq,
              total: item.revision ?? item.eventSeq, evicted: true },
        });
        if (item.payload != null) restoreEvicted(item);
      }
    }
    let segmentBytes = 0;
    for (const detail of [...details.current.values()].reverse()) {
      for (const [index, part] of [...detail.parts.entries()].reverse()) {
        segmentBytes += new TextEncoder().encode(part).length;
        if (segmentBytes > CACHE_BYTES && detail.version === 'v2-semantic') detail.parts.delete(index);
      }
    }
    setItems([...itemsRef.current.values()].sort((a, b) =>
      a.dispatchAttempt - b.dispatchAttempt || a.eventSeq - b.eventSeq));
    if (conversationId != null) {
      const size = (text: string | null) => text == null ? 0 : new TextEncoder().encode(text).length;
      const payloadBytes = [...itemsRef.current.values()].reduce((sum, item) => sum + size(item.payload), 0);
      const sourceBytes = [...details.current.values()].reduce((sum, detail) =>
        sum + [...detail.parts.values()].reduce((partSum, part) => partSum + size(part), 0), 0);
      const liveBytes = [...liveItems.current.values()].reduce((sum, item) => sum + size(item.payload), 0);
      accountEventCache(conversationId, cacheOwner.current, payloadBytes + sourceBytes + liveBytes, () => {
        for (const [key, item] of itemsRef.current) if (item.payload) {
          itemsRef.current.set(key, {
            ...item, payload: null, contentWindow: { ...(item.contentWindow ?? {
              key: `event:${conversationId}:${turnId}:${item.eventId}`, first: item.revision ?? item.eventSeq,
              last: item.revision ?? item.eventSeq, total: item.revision ?? item.eventSeq }), evicted: true },
          });
          restoreEvicted(item);
        }
        for (const detail of details.current.values()) detail.parts.clear();
        for (const [key, item] of liveItems.current) liveItems.current.set(key, { ...item, payload: null });
        setItems([...itemsRef.current.values()].sort((a, b) =>
          a.dispatchAttempt - b.dispatchAttempt || a.eventSeq - b.eventSeq));
      });
    }
  }, [conversationId, pageBefore, stableHistory, turnId]);
  const rememberPage = useCallback((after: number, page: Awaited<ReturnType<EventDisplaySource['summaries']>>) => {
    if (!page.items.length) return;
    const revisions = page.items.map(item => item.revision ?? item.eventSeq);
    pagesSeen.current.set(after, { first: Math.min(...revisions), last: Math.max(...revisions) });
    if (pagesSeen.current.size > 4096) pagesSeen.current.delete([...pagesSeen.current.keys()].find(key => key !== 0)!);
  }, []);
  const merge = useCallback((incoming: readonly EventSummaryItem[], live = true, commit = true) => {
    for (const item of incoming) {
      const key = logicalKey(item);
      const old = itemsRef.current.get(key);
      if (old && (old.eventId !== item.eventId || old.revision !== item.revision
        || old.projectionVersion !== item.projectionVersion)) {
        unregister.current.get(old.eventId)?.(); unregister.current.delete(old.eventId);
        details.current.delete(old.eventId);
      }
      if (item.eventId > 0) highestRevision.current = Math.max(highestRevision.current, item.revision ?? item.eventSeq);
      if (live) {
        liveItems.current.delete(key); liveItems.current.set(key, item);
        while (liveItems.current.size > 200) liveItems.current.delete(liveItems.current.keys().next().value!);
        let bytes = 0;
        for (const [entryKey, entry] of [...liveItems.current].reverse()) {
          bytes += entry.payload == null ? 0 : new TextEncoder().encode(entry.payload).length;
          if (bytes > 2 * 1024 * 1024) liveItems.current.set(entryKey, { ...entry, payload: null });
        }
      }
      const detail = details.current.get(item.eventId);
      const unchanged = detail?.signature === `${item.revision ?? 0}:${item.projectionVersion ?? ''}:${item.contentLength}:${item.totalSegments}`;
      itemsRef.current.set(key, (detail?.legacyAttempts ?? 0) >= 10 && unchanged ? { ...item, deferred: true }
        : item.payload == null && old?.payload != null
          ? { ...item, payload: old.payload, contentWindow: old.contentWindow } : item);
      if (retainBusinessText && !item.detailAvailable && item.payload && ['text', 'text_delta'].includes(item.eventType)) {
        if (item.dispatchAttempt > businessAttempt.current) {
          businessParts.current.clear(); businessAttempt.current = item.dispatchAttempt;
          setBusinessPaused(false);
        }
        if (item.dispatchAttempt < businessAttempt.current) continue;
        try {
          const payload = JSON.parse(item.payload) as { content?: string };
          businessParts.current.set(key, { item: businessIdentity(item), parts: [payload.content ?? item.payload] });
        } catch { businessParts.current.set(key, { item: businessIdentity(item), parts: [item.payload] }); }
      }
    }
    if (commit) { commitItems(); refreshBusinessText(); }
  }, [commitItems, conversationId, refreshBusinessText, retainBusinessText, turnId]);

  const publishWindow = useCallback((item: EventSummaryItem) => {
    const detail = details.current.get(item.eventId);
    if (!detail || !detail.parts.size) return;
    const lastReceived = Math.max(...detail.parts.keys());
    const first = detail.anchor ?? Math.max(0, lastReceived - EVENT_WINDOW_SEGMENTS + 1);
    const last = Math.min(lastReceived, first + EVENT_WINDOW_SEGMENTS - 1);
    const parts = Array.from({ length: last - first + 1 }, (_, index) => detail.parts.get(first + index) ?? '');
    if (parts.some(part => !part)) return;
    const payload = detail.version === 'v2-semantic'
      ? JSON.stringify(semanticContent(parts, item.eventType)) : parts.join('');
    const key = logicalKey(item);
    // 分段恢复同样“恢复即钉住”：只有被淘汰过的条目才提升插入顺序，首次补正文不改预算优先级。
    if (itemsRef.current.get(key)?.contentWindow?.evicted) itemsRef.current.delete(key);
    itemsRef.current.set(key, { ...item, payload, contentWindow: detail.version === 'v2-semantic'
      ? { key: `${conversationId}:${turnId}:${item.eventId}`, first, last, total: item.totalSegments ?? last + 1 } : undefined });
    commitItems();
  }, [commitItems, conversationId, turnId]);

  /**
   * 稳定呈现模式（澄清历史与实时）必须读完：已显示内容不再因窗口上限被裁剪或替换。
   * 其余入口沿用有界窗口，填满后只靠阅读动作续读；运行中、尾部未发布时仍需继续续读。
   */
  const autoReadsHistory = useCallback(() => stableHistory
    || processing
    || !TERMINAL_PREPARATION.includes(statusRef.current)
    || itemsRef.current.size < MAX_CACHED_EVENTS, [processing, stableHistory]);

  const runTick = useCallback(async (reset = false, hydrateOnly = false) => {
    if (!enabled || authDeniedRef.current || conversationId == null || turnId == null
      || (typeof document !== 'undefined' && document.hidden)) return;
    if (inFlight.current) { requested.current = true; return; }
    // 历史导航在途时不读自动游标分页，只补详情：旧游标回读会与导航窗口交错。
    if (navigating.current) hydrateOnly = true;
    inFlight.current = true;
    // 原子历史：整轮历史在一次 tick 内读完，期间不提交，结束后一次呈现。
    const batchToken = atomicHistory && (!processing || !initialAtomicHistoryComplete.current)
      ? Symbol('atomic-history') : null;
    const atomic = batchToken != null;
    if (batchToken) atomicBatches.current.add(batchToken);
    let settled = false;
    const controller = new AbortController(); controllerRef.current = controller;
    const epoch = epochRef.current;
    const valid = () => epoch === epochRef.current && !controller.signal.aborted;
    setLoading(true);
    if (reset) cursorRef.current = 0;
    const read = <T,>(operation: () => Promise<T>) => admittedEventRead(conversationId,
      processing, controller.signal, operation);
    try {
      let pageCount = 0;
      while (!hydrateOnly) {
        const before = cursorRef.current;
        const page = await read(() => sourceRef.current.summaries(turnId, before || undefined, controller.signal));
        if (!valid()) return;
        rememberPage(before, page);
        merge(page.items, true, !atomic);
        if (page.nextCursor != null) cursorRef.current = Math.max(cursorRef.current, page.nextCursor);
        if (page.publicationWatermark != null) setWatermark(previous => Math.max(previous, page.publicationWatermark!));
        statusRef.current = page.preparationStatus;
        moreRef.current = page.hasMore;
        setPreparationStatus(page.preparationStatus); setHasMore(page.hasMore);
        pageCount++;
        if (!page.hasMore || cursorRef.current <= before || !autoReadsHistory() || navigating.current) break;
        if (!atomic && pageCount >= MAX_PAGES_PER_TICK) break;
      }

      for (const item of [...itemsRef.current.values()]) {
        if (!valid()) return;
        if (!item.detailAvailable || item.state !== 'READY') continue;
        const signature = `${item.revision ?? 0}:${item.projectionVersion ?? ''}:${item.contentLength}:${item.totalSegments}`;
        let detail = details.current.get(item.eventId);
        if (detail?.signature !== signature) {
          detail = { signature, parts: new Map(), cursor: 0, complete: false, bytes: 0 };
          details.current.set(item.eventId, detail);
          unregister.current.get(item.eventId)?.(); unregister.current.delete(item.eventId);
          if (retainBusinessText && ['text', 'text_delta'].includes(item.eventType)) {
            if (item.dispatchAttempt > businessAttempt.current) {
              businessParts.current.clear(); businessAttempt.current = item.dispatchAttempt;
              setBusinessPaused(false);
            }
            if (item.dispatchAttempt === businessAttempt.current) {
              businessParts.current.set(logicalKey(item), { item: businessIdentity(item), parts: [] });
            }
          }
        }
        if (detail.complete) continue;
        if ((detail.retryAt ?? 0) > Date.now()) {
          statusRef.current = 'DEFERRED'; setPreparationStatus('DEFERRED'); continue;
        }
        setHydrating(true);
        let publishedAt = 0;
        while (!detail.complete && valid()) {
          const segment = await read(() => sourceRef.current.content(turnId, item.eventId,
            detail!.cursor, detail!.version, controller.signal));
          if (!valid()) return;
          if (segment.state === 'UNAVAILABLE') {
            itemsRef.current.set(logicalKey(item), { ...item, state: 'UNAVAILABLE' });
            detail.complete = true; commitItems(); break;
          }
          if (segment.state !== 'READY') break;
          detail.version = segment.projectionVersion;
          if (segment.projectionVersion !== 'v2-semantic') {
            // Legacy envelopes are upgraded server-side. Never rebuild a 32MiB JSON in a browser.
            detail.parts.clear();
            detail.legacyAttempts = (detail.legacyAttempts ?? 0) + 1;
            if (detail.legacyAttempts >= 10) {
              detail.retryAt = Date.now() + 30_000;
              itemsRef.current.set(logicalKey(item), { ...item, deferred: true });
              statusRef.current = 'DEFERRED'; setPreparationStatus('DEFERRED');
              commitItems();
            } else { statusRef.current = 'PARTIAL'; setPreparationStatus('PARTIAL'); }
            break;
          }
          const text = segment.content ?? '';
          detail.bytes += new TextEncoder().encode(text).length;
          if ((item.contentLength ?? 0) > MAX_EVENT_BYTES || detail.bytes > MAX_EVENT_BYTES * 2)
            throw new Error('Event content exceeds bounded display budget');
          detail.parts.set(segment.segmentIndex, text);
          detail.complete = segment.nextCursor == null;
          detail.cursor = segment.nextCursor ?? segment.segmentIndex;
          const semantic = true;
          if (retainBusinessText && semantic && ['text', 'text_delta'].includes(item.eventType)) {
            const frame = JSON.parse(text) as { field: string; text: string };
            if (frame.field === 'content') {
              const business = businessParts.current.get(logicalKey(item));
              if (business) business.parts[segment.segmentIndex] = frame.text;
            }
          }
          if ((semantic || detail.complete) && (Date.now() - publishedAt >= 50 || detail.complete)) {
            publishWindow(item);
            refreshBusinessText(); publishedAt = Date.now();
          }
        }
        if (detail.version === 'v2-semantic' && !unregister.current.has(item.eventId)) {
          const key = `${conversationId}:${turnId}:${item.eventId}`;
          let restoring = false;
          unregister.current.set(item.eventId, registerEventWindow(key, async first => {
            if (restoring || !enabledRef.current || document.hidden) return;
            restoring = true;
            const restoreController = new AbortController(); restoreControllers.current.add(restoreController);
            const restoreEpoch = epochRef.current;
            const restoreSignature = detail!.signature;
            const restoreValid = () => restoreEpoch === epochRef.current && !restoreController.signal.aborted
              && details.current.get(item.eventId)?.signature === restoreSignature;
            try {
              const total = item.totalSegments ?? 0;
              for (let index = first; index < Math.min(total, first + EVENT_WINDOW_SEGMENTS); index++) {
                if (!detail!.parts.has(index)) {
                  const segment = await admittedEventRead(conversationId, false, restoreController.signal,
                    () => sourceRef.current.content(turnId, item.eventId, index,
                      detail!.version, restoreController.signal));
                  if (!restoreValid()) return;
                  if (segment.state !== 'READY' || !segment.content) return;
                  detail!.parts.set(index, segment.content);
                }
              }
              detail!.anchor = first;
              publishWindow(item);
            } catch { if (restoreValid()) setError(true); }
            finally { restoreControllers.current.delete(restoreController); restoring = false; }
          }));
        }
      }
      if (!valid()) return;
      failures.current = 0; setError(false); settled = true;
    } catch (thrown) {
      if (!valid()) return;
      failures.current++; setError(true); settled = true;
      if (isEventDisplayAuthDenied(thrown)) { authDeniedRef.current = true; setAuthDenied(true); }
    } finally {
      if (epoch === epochRef.current) { inFlight.current = false; setLoading(false); setHydrating(false); }
      if (batchToken) atomicBatches.current.delete(batchToken);
      // 中止（切走/隐藏）时不提交半轮历史，保留累积数据供下次续读后一次性呈现。
      if (batchToken && settled && epoch === epochRef.current) {
        initialAtomicHistoryComplete.current = true;
        commitItems(); refreshBusinessText();
      }
    }
  }, [atomicHistory, autoReadsHistory, commitItems, conversationId, enabled, merge, processing, publishWindow, refreshBusinessText, rememberPage, retainBusinessText, turnId]);
  const runRef = useRef(runTick); runRef.current = runTick;

  useEffect(() => {
    if (conversationId == null || turnId == null || !enabled) return;
    const restore = async (cursor: number, latest = false) => {
      // 同一窗口一次只跑一个导航批次：早晚两侧的导航不得互相反向重入或交错改写窗口。
      if (navigating.current) return;
      navigating.current = true;
      let navigated = false;
      const controller = new AbortController(); restoreControllers.current.add(controller);
      const epoch = epochRef.current;
      try {
        controllerRef.current?.abort();
        windowAnchor.current = latest ? null : Math.max(0, cursor);
        if (latest) {
          itemsRef.current.clear();
          merge([...liveItems.current.values()], false);
        }
        let after = Math.max(0, cursor);
        for (let pages = 0; pages < 10; pages++) {
          const page = await admittedEventRead(conversationId, false, controller.signal,
            () => sourceRef.current.summaries(turnId, after || undefined, controller.signal));
          if (epoch !== epochRef.current || controller.signal.aborted) return;
          rememberPage(after, page);
          merge(page.items, false);
          if (!page.hasMore || page.nextCursor == null || page.nextCursor <= after) break;
          after = page.nextCursor;
        }
        navigated = true;
      } catch { if (!controller.signal.aborted && epoch === epochRef.current) setError(true); }
      finally { restoreControllers.current.delete(controller); navigating.current = false; }
      // 批次结束后只补详情，不再用导航前的自动游标回读摘要分页。
      if (navigated) void runRef.current(false, true);
    };
    const prefix = `history:${conversationId}:${turnId}`;
    const earlier = registerEventWindow(`${prefix}:earlier`, async () => {
      const first = Math.min(...[...itemsRef.current.values()].map(item => item.revision ?? item.eventSeq));
      const boundaries = [...pagesSeen.current.entries()].sort((a, b) => a[1].first - b[1].first);
      const current = boundaries.findIndex(([, page]) => page.first >= first);
      const before = boundaries[Math.max(0, current < 0 ? 0 : current - 10)]?.[0] ?? 0;
      await restore(before);
    });
    const later = registerEventWindow(`${prefix}:later`, async () => {
      const last = Math.max(...[...itemsRef.current.values()].map(item => item.revision ?? item.eventSeq));
      const after = [...pagesSeen.current.entries()].find(([, page]) => page.first > last)?.[0] ?? pageBefore(last);
      await restore(after);
    });
    const latest = registerEventWindow(`${prefix}:latest`, async () => {
      const revisions = [...liveItems.current.values()].filter(item => item.eventId > 0).map(item => item.revision ?? item.eventSeq);
      await restore(pageBefore(revisions.length ? Math.min(...revisions) : highestRevision.current), true);
    });
    return () => { earlier(); later(); latest(); };
  }, [conversationId, enabled, merge, pageBefore, rememberPage, turnId]);

  useEffect(() => {
    epochRef.current++; controllerRef.current?.abort(); inFlight.current = false;
    // 切换会话/轮次时上一个导航批次已中止，守卫必须随之释放，否则新窗口首个 tick 会被降级。
    navigating.current = false;
    clearLive();
    authDeniedRef.current = false; cursorRef.current = 0; failures.current = 0;
    itemsRef.current.clear(); details.current.clear();
    windowAnchor.current = null; highestRevision.current = 0;
    atomicBatches.current.clear();
    initialAtomicHistoryComplete.current = false;
    liveItems.current.clear(); pagesSeen.current.clear();
    for (const controller of restoreControllers.current) controller.abort(); restoreControllers.current.clear();
    businessParts.current.clear();
    businessAttempt.current = -1;
    for (const remove of unregister.current.values()) remove();
    unregister.current.clear(); setBusinessText(''); setBusinessPaused(false);
    statusRef.current = 'PREPARING'; moreRef.current = false;
    setItems([]); setPreparationStatus('PREPARING'); setHasMore(false);
    setError(false); setAuthDenied(false); setWatermark(0); setHydrating(false);
    return () => { epochRef.current++; controllerRef.current?.abort();
      clearLive();
      for (const controller of restoreControllers.current) controller.abort(); restoreControllers.current.clear();
      for (const remove of unregister.current.values()) remove(); unregister.current.clear(); };
  }, [clearLive, conversationId, turnId]);

  useEffect(() => {
    if (!enabled || conversationId == null || turnId == null || authDenied) {
      controllerRef.current?.abort();
      if (!enabled) {
        // 可见性只决定是否继续读取：已加载的过程事件与展开状态必须保留，
        // 重新可见时从已存游标与已显示窗口续读，而不是清空后从起点重放。
        clearLive();
        for (const controller of restoreControllers.current) controller.abort(); restoreControllers.current.clear();
      }
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (cancelled || authDeniedRef.current) return;
      // 隐藏页不读也不排下一拍，避免中止后在后台空转；恢复可见由 visibilitychange 驱动。
      if (typeof document !== 'undefined' && document.hidden) return;
      // 完成态窗口已满但仍有更早分页：不再自动推进，等待窗口导航或已发布通知触发的续读。
      if (moreRef.current && !autoReadsHistory()) return;
      const caughtUp = TERMINAL_PREPARATION.includes(statusRef.current) && !moreRef.current && !processing;
      // 稳定呈现模式追平终态后不再空转轮询；尾部补齐由发布通知、断线重连与可见性恢复驱动。
      // 读期间收到的显式请求仍要补一拍，DEFERRED 也仍需重试，二者不在此停止。
      if (stableHistory && caughtUp && statusRef.current !== 'DEFERRED' && !requested.current) return;
      const immediate = requested.current || moreRef.current; requested.current = false;
      const delay = failures.current ? eventDisplayBackoffMs(failures.current)
        : immediate ? 50 : caughtUp ? 30_000 : EVENT_SUMMARY_POLL_MS;
      timer = setTimeout(() => { void runRef.current().then(schedule); }, delay);
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearLive();
        controllerRef.current?.abort();
        for (const controller of restoreControllers.current) controller.abort();
        restoreControllers.current.clear(); return;
      }
      if (timer) clearTimeout(timer);
      void runRef.current().then(schedule);
    };
    void runRef.current().then(schedule);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { cancelled = true; if (timer) clearTimeout(timer);
      controllerRef.current?.abort(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [authDenied, autoReadsHistory, clearLive, conversationId, enabled, processing, stableHistory, turnId]);

  useEffect(() => () => {
    if (conversationId != null) releaseEventCache(conversationId, cacheOwner.current);
  }, [conversationId]);

  const resume = useCallback(() => runRef.current(), []);
  const reload = useCallback(() => runRef.current(true), []);
  const receive = useCallback((payload: ConversationRealtimeEvent) => {
    if (payload.turnId !== turnId || payload.conversationId !== conversationId || !payload.payload) return;
    if (authDeniedRef.current || document.hidden) return;
    const key = logicalKey(payload);
    if (itemsRef.current.has(key)) return;
    pendingLive.current.set(key, payload);
    while (pendingLive.current.size > 128) pendingLive.current.delete(pendingLive.current.keys().next().value!);
    if (liveTimer.current) return;
    liveTimer.current = setTimeout(() => {
      liveTimer.current = undefined;
      const batch = [...pendingLive.current.values()]; pendingLive.current.clear();
      merge(batch.filter(event => !itemsRef.current.has(logicalKey(event))).map(event => {
        const content = event.payload!.type === 'display_content'
          ? semanticContent([JSON.stringify(event.payload)], event.eventType) : event.payload;
        return { eventId: -event.eventSeq - (event.dispatchAttempt ?? 0) * 1_000_000_000_000,
          eventType: event.eventType, dispatchAttempt: event.dispatchAttempt ?? 0, eventSeq: event.eventSeq,
          occurredAt: null, state: 'READY' as const, truncated: false, detailAvailable: false,
          summary: null, contentLength: null, totalSegments: 1, payload: JSON.stringify(content) };
      }));
    }, 50);
  }, [conversationId, merge, turnId]);
  useRealtime(conversationId ? `conversation:${conversationId}` : null, {
    enabled: enabled && conversationId != null && !authDenied,
    onReconnect: () => { void resume(); },
    onEvent: event => {
      const payload = event.payload as ConversationRealtimeEvent | null;
      if (payload?.turnId !== turnId) return;
      if (event.type === 'CONVERSATION_TURN_EVENT') receive(payload);
      else if (event.type === 'CONVERSATION_EVENT_DISPLAY_AVAILABLE') { void resume(); }
    },
  });
  const timeline = useMemo(() => {
    const nodes = buildTimeline(summaryItemsToEvents(items, turnId ?? 0));
    if (items.length) {
      const first = Math.min(...items.map(item => item.revision ?? item.eventSeq));
      const last = Math.max(...items.map(item => item.revision ?? item.eventSeq));
      // 完成态不再自动追赶整轮历史，窗口外分页靠已发布水位给出更早/更晚阅读入口；
      // 运行中仍按已加载的最大事件判断，避免实时追加时凭空出现「更晚」边界。
      const total = processing ? highestRevision.current : Math.max(highestRevision.current, watermark);
      // 稳定呈现模式已读全整轮且不裁剪，不存在需要整批替换的窗口，也就不提供边界导航。
      // 「更早」只在窗口本身是满的、或已通过窗口导航离开过起点时才存在，
      // 否则单条 revision 偏大的事件会被误判成还有更早分页。
      if (!stableHistory && (items.length === MAX_CACHED_EVENTS || windowAnchor.current != null)) {
        if (first > 1) nodes.unshift({ id: 'history-earlier', kind: 'text', turnId: turnId ?? 0,
          eventSeq: 0, text: '', contentWindow: { key: `history:${conversationId}:${turnId}:earlier`,
            first, last: total, total } });
        if (last < total) nodes.push({ id: 'history-later', kind: 'text', turnId: turnId ?? 0,
          eventSeq: last, text: '', contentWindow: { key: `history:${conversationId}:${turnId}:later`,
            first: 0, last, total: total + 1 } });
      }
    }
    if (windowAnchor.current != null) nodes.push({ id: 'history-latest', kind: 'text', turnId: turnId ?? 0,
      eventSeq: highestRevision.current, text: '', contentWindow: { key: `history:${conversationId}:${turnId}:latest`,
        first: 0, last: 0, total: 0, navigation: true } });
    return nodes;
  }, [conversationId, items, processing, stableHistory, turnId, watermark]);
  const syncing = !authDenied && (processing || hydrating || preparationStatus === 'PREPARING'
    || preparationStatus === 'PARTIAL' || hasMore);
  return { items, timeline, loading, error, authDenied, hasMore, allLoaded: !hasMore,
    businessText, businessPaused,
    preparationStatus, syncing, watermark, isFetchingMore: loading, loadMore: resume, reload, resume, receive };
}
