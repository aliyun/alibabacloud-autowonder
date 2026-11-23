import { apiClient } from '@/shared/api/client';
import type {
  EventContentSegment,
  EventSummaryItem,
  EventSummaryPage,
  ProviderEventPayload,
} from './types';

/** 三类入口各用自己的授权路由，但共用同一套摘要/分段契约。 */
export interface EventDisplaySource {
  summaries(turnId: number, cursor?: number, signal?: AbortSignal): Promise<EventSummaryPage>;
  content(turnId: number, eventId: number, cursor?: number, projectionVersion?: string, signal?: AbortSignal): Promise<EventContentSegment>;
}

export const SUMMARY_EVENT_TYPE = 'event_summary';

export function createEventDisplaySource(base: string): EventDisplaySource {
  return {
    async summaries(turnId, cursor, signal) {
      const resp = await apiClient.get<EventSummaryPage>(
        `${base}/turns/${turnId}/event-summaries`,
        { params: cursor === undefined ? {} : { cursor }, signal },
      );
      return resp.data;
    },
    async content(turnId, eventId, cursor, projectionVersion, signal) {
      const params: Record<string, number | string> = {};
      if (cursor !== undefined) params.cursor = cursor;
      if (projectionVersion) params.projectionVersion = projectionVersion;
      const resp = await apiClient.get<EventContentSegment>(
        `${base}/turns/${turnId}/event-summaries/${eventId}/content`, { params, signal },
      );
      return resp.data;
    },
  };
}

export interface SummaryTimelineEvent {
  dispatchAttempt?: number;
  eventSeq: number;
  turnId: number;
  eventType: string;
  payload: ProviderEventPayload | null;
}

/** 小事件沿用原有时间线渲染；大事件或不可用项生成确定性的摘要节点。 */
export function summaryItemsToEvents(
  items: readonly EventSummaryItem[],
  turnId: number,
): SummaryTimelineEvent[] {
  const ordered = [...items].sort((a, b) =>
    a.eventSeq - b.eventSeq || a.dispatchAttempt - b.dispatchAttempt);
  const events: SummaryTimelineEvent[] = [];
  for (const item of ordered) {
    if (item.state === 'READY' && item.payload != null) {
      events.push({
        dispatchAttempt: item.dispatchAttempt,
        eventSeq: item.eventSeq,
        turnId,
        eventType: item.eventType === 'text_delta' ? 'text' : item.eventType === 'thinking_delta' ? 'thinking' : item.eventType,
        payload: { ...parsePayload(item.payload, item.eventType), displayWindow: item.contentWindow },
      });
      continue;
    }
    if (item.contentWindow) {
      events.push({ dispatchAttempt: item.dispatchAttempt, eventSeq: item.eventSeq, turnId,
        eventType: 'text', payload: { type: 'text', content: '', displayWindow: item.contentWindow } });
      continue;
    }
    events.push({
      dispatchAttempt: item.dispatchAttempt,
      eventSeq: item.eventSeq,
      turnId,
      eventType: SUMMARY_EVENT_TYPE,
      payload: {
        type: SUMMARY_EVENT_TYPE,
        eventId: item.eventId,
        summary: item.summary ?? '',
        detailAvailable: item.detailAvailable,
        failed: item.state === 'UNAVAILABLE',
        deferred: item.deferred,
        truncated: item.truncated,
      },
    });
  }
  return events;
}

export function parsePayload(text: string, eventType = 'text'): ProviderEventPayload {
  const plain = (content: string): ProviderEventPayload => eventType === 'tool_result'
    ? { type: eventType, output: content } : eventType === 'tool_use'
      ? { type: eventType, input: { text: content } } : { type: eventType, content };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as ProviderEventPayload;
    const content = typeof parsed === 'string' ? parsed : text;
    return plain(content);
  } catch {
    return plain(text);
  }
}

/** Each v2 segment is an independently renderable public payload, not part of a JSON envelope. */
export function semanticContent(parts: readonly string[], eventType: string): ProviderEventPayload {
  let metadata: ProviderEventPayload = { type: eventType };
  let field = 'content';
  const text: string[] = [];
  for (const part of parts) {
    const frame = JSON.parse(part) as {
      field: string; text: string; metadata?: ProviderEventPayload;
    };
    field = frame.field;
    metadata = frame.metadata ?? metadata;
    text.push(frame.text ?? '');
  }
  const content = text.join('');
  if (field === 'raw') {
    const payload = parsePayload(content, eventType);
    return { ...metadata, ...payload,
      ...(eventType === 'tool_result' ? { output: payload.output ?? payload.content ?? content } : {}),
      ...(eventType === 'tool_use' ? { input: payload.input ?? { text: payload.content ?? content } } : {}) };
  }
  return { ...metadata, type: metadata.type ?? eventType,
    ...(field === 'input' ? { input: { text: content } } : { [field]: content }) };
}

export const EVENT_DISPLAY_BACKOFF_MS = [3000, 6000, 12000, 24000, 30000];

export function eventDisplayBackoffMs(failures: number, random = Math.random): number {
  const base = EVENT_DISPLAY_BACKOFF_MS[Math.min(Math.max(failures, 1), EVENT_DISPLAY_BACKOFF_MS.length) - 1];
  const jitter = base * 0.2;
  return Math.round(base - jitter + random() * jitter * 2);
}
