import { describe, expect, it } from 'vitest';
import { accountEventCache, eventCacheUsage, releaseEventCache } from './eventCacheBudget';

describe('conversation-wide event content budget', () => {
  it('does not grow one cache per historical turn and leaves another conversation independent', () => {
    const first = Symbol(), second = Symbol(), other = Symbol();
    let firstRetained = true, secondRetained = true;
    accountEventCache(7001, first, 5 * 1024 * 1024, () => { firstRetained = false; });
    accountEventCache(7002, other, 5 * 1024 * 1024, () => {});
    accountEventCache(7001, second, 5 * 1024 * 1024, () => { secondRetained = false; });
    expect(firstRetained).toBe(false);
    expect(secondRetained).toBe(true);
    expect(eventCacheUsage(7001)).toBe(5 * 1024 * 1024);
    expect(eventCacheUsage(7002)).toBe(5 * 1024 * 1024);
    releaseEventCache(7001, second); releaseEventCache(7002, other);
    expect(eventCacheUsage(7001)).toBe(0);
  });

  it('retains only a bounded amount after browsing a hundred turn caches', () => {
    const retained = new Set<symbol>();
    for (let turn = 0; turn < 100; turn++) {
      const owner = Symbol(); retained.add(owner);
      accountEventCache(7003, owner, 1024 * 1024, () => { retained.delete(owner); });
    }
    expect(eventCacheUsage(7003)).toBe(8 * 1024 * 1024);
    expect(retained.size).toBe(8);
    for (const owner of retained) releaseEventCache(7003, owner);
  });
});
