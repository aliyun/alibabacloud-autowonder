/** Shared admission: history cannot create one connection per mounted turn. */
const GLOBAL_READS = 4;
type Waiting = { conversation: number; lane: string; signal: AbortSignal; start: () => void; cancel: () => void };
const waiting: Waiting[] = [];
const lanes = new Set<string>();
let active = 0;

function pump() {
  for (let index = 0; active < GLOBAL_READS && index < waiting.length;) {
    const task = waiting[index];
    if (task.signal.aborted) { waiting.splice(index, 1); task.cancel(); continue; }
    const key = `${task.conversation}:${task.lane}`;
    if (lanes.has(key)) { index++; continue; }
    waiting.splice(index, 1);
    active++;
    lanes.add(key);
    task.start();
  }
}

export function admittedEventRead<T>(conversation: number, realtime: boolean, signal: AbortSignal,
  read: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const lane = realtime ? 'realtime' : 'history';
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    const task: Waiting = { conversation, lane, signal, cancel: abort, start: () => {
      signal.removeEventListener('abort', cancel);
      void read().then(resolve, reject).finally(() => {
        active--; lanes.delete(`${conversation}:${lane}`); pump();
      });
    } };
    const cancel = () => {
      const index = waiting.indexOf(task);
      if (index >= 0) waiting.splice(index, 1);
      abort();
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (waiting.length >= 128) {
      signal.removeEventListener('abort', cancel);
      reject(new Error('Event read queue is full'));
      return;
    }
    if (realtime) {
      const firstHistory = waiting.findIndex(entry => entry.lane === 'history');
      waiting.splice(firstHistory < 0 ? waiting.length : firstHistory, 0, task);
    } else waiting.push(task);
    pump();
  });
}
