import { describe, expect, it } from 'vitest';
import { durationText, formatElapsed } from './duration';

const t = (key: string, options?: Record<string, unknown>) => {
  if (!options) return key;
  return `${key}:${String(options.value)}`;
};

describe('formatElapsed', () => {
  it('uses minutes, hours and days at the matching scale', () => {
    expect(formatElapsed(30_000, t)).toBe('duration.lessThanMinute');
    expect(formatElapsed(5 * 60_000, t)).toBe('duration.minutes:5');
    expect(formatElapsed(3 * 3_600_000, t)).toBe('duration.hours:3');
    expect(formatElapsed(2 * 86_400_000, t)).toBe('duration.days:2');
  });
});

describe('durationText', () => {
  const now = Date.parse('2026-11-12T12:00:00.000Z');

  it('shows not started when no reliable start exists', () => {
    expect(durationText({ roundStartedAt: null, roundEndedAt: null, statusCategory: 'IN_PROGRESS' }, now, t))
      .toBe('duration.none / duration.notStarted');
  });

  it('keeps counting for a running agent round', () => {
    expect(durationText({
      roundStartedAt: '2026-11-12T11:50:00.000Z',
      roundEndedAt: null,
      statusCategory: 'IN_PROGRESS',
    }, now, t)).toBe('duration.minutes:10');
  });

  it('freezes a finished round using its end time', () => {
    expect(durationText({
      roundStartedAt: '2026-11-12T09:00:00.000Z',
      roundEndedAt: '2026-11-12T11:00:00.000Z',
      statusCategory: 'DONE',
    }, now, t)).toBe('duration.hours:2');
  });

  it('shows ended without a number when a terminal item lacks a reliable end', () => {
    expect(durationText({ roundStartedAt: '2026-11-12T09:00:00.000Z', roundEndedAt: null, statusCategory: 'CANCELED' }, now, t))
      .toBe('duration.none / duration.ended');
    expect(durationText({ roundStartedAt: null, roundEndedAt: null, statusCategory: 'DONE' }, now, t))
      .toBe('duration.none / duration.ended');
  });

  it('ignores unparseable timestamps', () => {
    expect(durationText({ roundStartedAt: 'not-a-date', roundEndedAt: null, statusCategory: 'IN_PROGRESS' }, now, t))
      .toBe('duration.none / duration.notStarted');
  });

  it('keeps counting to now when the end timestamp is unparseable', () => {
    expect(durationText({
      roundStartedAt: '2026-11-12T11:50:00.000Z',
      roundEndedAt: 'not-a-date',
      statusCategory: 'IN_PROGRESS',
    }, now, t)).toBe('duration.minutes:10');
  });
});
