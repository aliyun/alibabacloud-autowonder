import { describe, expect, it } from 'vitest';
import { admittedEventRead } from './eventReadQueue';

describe('shared event reads', () => {
  it('limits global concurrency and keeps realtime requests in FIFO order ahead of history', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const release = new Map<number, (value: number) => void>();
    const read = (id: number, realtime = true) => admittedEventRead(id, realtime, controller.signal,
      () => new Promise<number>(resolve => { started.push(id); release.set(id, resolve); }));
    const calls = [read(1), read(2), read(3), read(4), read(5), read(6), read(7, false)];
    try {
      expect(started).toEqual([1, 2, 3, 4]);
      release.get(1)!(1);
      await calls[0]; await Promise.resolve();
      expect(started).toEqual([1, 2, 3, 4, 5]);
    } finally {
      controller.abort();
      for (const [id, finish] of release) finish(id);
      await Promise.allSettled(calls);
    }
  });

  it('cancels a queued read before it can consume another connection', async () => {
    const first = new AbortController(), queued = new AbortController();
    let finish: ((value: string) => void) | undefined;
    const running = admittedEventRead(101, true, first.signal, () => new Promise<string>(resolve => { finish = resolve; }));
    let started = false;
    const cancelled = admittedEventRead(101, true, queued.signal, async () => { started = true; return 'bad'; });
    queued.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    expect(started).toBe(false);
    finish!('done'); await running;
  });
});
