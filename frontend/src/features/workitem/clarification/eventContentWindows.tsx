import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'antd';
import type { EventContentWindow } from './types';

export const EVENT_WINDOW_SEGMENTS = 8;
/** 真实阅读输入之后这段时间内产生的同向滚动才算阅读意图。 */
const READ_INTENT_MS = 400;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);
const restorers = new Map<string, (first: number) => Promise<void>>();

export function registerEventWindow(key: string, restore: (first: number) => Promise<void>) {
  restorers.set(key, restore);
  return () => { if (restorers.get(key) === restore) restorers.delete(key); };
}

export function EventWindowLatest({ window }: { window: EventContentWindow }) {
  const { t } = useTranslation('workitem');
  return <Button size="small" onClick={() => { void restorers.get(window.key)?.(0); }}>
    {t('clarification.latestEvents')}
  </Button>;
}

export function EventWindowBoundary({ window, direction }: {
  window: EventContentWindow; direction: 'earlier' | 'later' | 'restore';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cursor = direction === 'earlier' ? Math.max(0, window.first - EVENT_WINDOW_SEGMENTS)
    : direction === 'later' ? window.last + 1 : window.first;
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    let active = true;
    let intersecting = false;
    let armed = direction === 'restore';
    let intentUntil = 0;
    const markIntent = () => { intentUntil = Date.now() + READ_INTENT_MS; };
    const restore = () => {
      if (!active || !intersecting || !armed) return;
      active = false; armed = false; intentUntil = 0;
      const pending = restorers.get(window.key)?.(cursor);
      void Promise.resolve(pending).finally(() => {
        // 一次阅读手势只导航一次：批次自身造成的布局滚动不得再次 re-arm。
        armed = false; active = true;
      });
    };
    let scroller: HTMLElement | null = node.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const target = scroller ?? document.documentElement;
    let lastTop = target.scrollTop;
    const scroll = () => {
      const next = target.scrollTop;
      const moved = direction === 'earlier' ? next < lastTop : next > lastTop;
      lastTop = next;
      // 窗口替换、内容高度变化和浏览器滚动锚定同样会产生 scroll；只有紧跟真实输入
      // （滚轮、键盘、滚动条拖动、触控）的同向滚动才代表阅读意图。
      if (!moved || Date.now() > intentUntil) return;
      armed = true; restore();
    };
    const wheel = (event: WheelEvent) => {
      if (direction === 'earlier' ? event.deltaY < 0 : event.deltaY > 0) { markIntent(); armed = true; }
      restore();
    };
    const keydown = (event: KeyboardEvent) => { if (SCROLL_KEYS.has(event.key)) markIntent(); };
    // 滚动条拖动只会在滚动条上按下，拖动过程中持续产生 mousemove/touchmove。
    const press = (event: MouseEvent) => {
      const rect = target.getBoundingClientRect();
      if (event.clientX - rect.left > target.clientWidth) markIntent();
    };
    const drag = (event: MouseEvent) => { if (event.buttons) markIntent(); };
    const touch = () => markIntent();
    const observer = new IntersectionObserver(entries => {
      intersecting = entries.some(entry => entry.isIntersecting); restore();
    }, { rootMargin: '32px' });
    observer.observe(node);
    target.addEventListener('scroll', scroll, { passive: true });
    target.addEventListener('wheel', wheel, { passive: true });
    target.addEventListener('keydown', keydown);
    target.addEventListener('mousedown', press);
    target.addEventListener('mousemove', drag);
    target.addEventListener('touchstart', touch, { passive: true });
    target.addEventListener('touchmove', touch, { passive: true });
    return () => { observer.disconnect(); target.removeEventListener('scroll', scroll);
      target.removeEventListener('wheel', wheel); target.removeEventListener('keydown', keydown);
      target.removeEventListener('mousedown', press); target.removeEventListener('mousemove', drag);
      target.removeEventListener('touchstart', touch); target.removeEventListener('touchmove', touch); };
  }, [cursor, direction, window.key]);
  return <div ref={ref} data-testid={`content-window-${direction}`} style={{ minHeight: 20 }} />;
}
