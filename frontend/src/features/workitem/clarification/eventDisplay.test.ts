import { describe, expect, it } from 'vitest';
import { eventDisplayBackoffMs, semanticContent, summaryItemsToEvents, SUMMARY_EVENT_TYPE } from './eventDisplay';
import type { EventSummaryItem } from './types';

function item(over: Partial<EventSummaryItem>): EventSummaryItem {
  return {
    eventId: 1, eventType: 'tool_result', dispatchAttempt: 1, eventSeq: 1,
    occurredAt: '2026-01-01T00:00:00Z', state: 'READY', truncated: false,
    detailAvailable: false, summary: '', contentLength: 10, totalSegments: 1,
    payload: '{"tool":"Bash"}', ...over,
  };
}

describe('summaryItemsToEvents', () => {
  it('renders a raw tool fragment before its full JSON envelope is available', () => {
    const payload = semanticContent([JSON.stringify({ type: 'display_content',
      eventType: 'tool_result', field: 'raw', text: '{"output":"partial',
      metadata: { type: 'tool_result', tool: 'Read', callId: 'c1' } })], 'tool_result');
    expect(payload.output).toBe('{"output":"partial');
    expect(payload.tool).toBe('Read');
  });

  it('keeps plain strings visible when an upstream text payload is not JSON', () => {
    const events = summaryItemsToEvents([item({ eventType: 'text', payload: 'raw model text' })], 2);
    expect(events[0].payload?.content).toBe('raw model text');
  });

  it('keeps a plain authorised tool result visible even when it has no JSON envelope', () => {
    const events = summaryItemsToEvents([item({ eventType: 'tool_result', payload: 'raw command output' })], 2);
    expect(events[0].payload?.output).toBe('raw command output');
  });
  it('keeps small events on the existing timeline pipeline', () => {
    const events = summaryItemsToEvents([item({})], 2);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('tool_result');
    expect(events[0].payload).toMatchObject({ tool: 'Bash' });
  });

  it('turns large and unavailable events into deterministic summary nodes', () => {
    const events = summaryItemsToEvents([
      item({ eventId: 2, eventSeq: 2, detailAvailable: true, truncated: true, summary: '摘要', payload: null }),
      item({ eventId: 3, eventSeq: 3, state: 'UNAVAILABLE', summary: null, payload: null }),
    ], 2);
    expect(events.every(event => event.eventType === SUMMARY_EVENT_TYPE)).toBe(true);
    expect(events[0].payload).toMatchObject({ eventId: 2, summary: '摘要', truncated: true, failed: false });
    expect(events[1].payload).toMatchObject({ eventId: 3, failed: true });
  });

  it('keeps event order by seq and attempt', () => {
    const events = summaryItemsToEvents([
      item({ eventId: 3, eventSeq: 3 }), item({ eventId: 1, eventSeq: 1 }), item({ eventId: 2, eventSeq: 2 }),
    ], 2);
    expect(events.map(event => event.eventSeq)).toEqual([1, 2, 3]);
  });
});

describe('eventDisplayBackoffMs', () => {
  it('follows 3/6/12/24/30 seconds with at most 20% jitter', () => {
    expect(eventDisplayBackoffMs(1, () => 0.5)).toBe(3000);
    expect(eventDisplayBackoffMs(2, () => 0.5)).toBe(6000);
    expect(eventDisplayBackoffMs(3, () => 0.5)).toBe(12000);
    expect(eventDisplayBackoffMs(4, () => 0.5)).toBe(24000);
    expect(eventDisplayBackoffMs(5, () => 0.5)).toBe(30000);
    expect(eventDisplayBackoffMs(5, () => 0)).toBe(24000);
    expect(eventDisplayBackoffMs(5, () => 0.999999)).toBe(36000);
    expect(eventDisplayBackoffMs(9, () => 0.5)).toBe(30000);
  });
});
