import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventWindowBoundary, registerEventWindow } from './eventContentWindows';
import type { EventContentWindow } from './types';

/** jsdom 没有布局和滚动：手动驱动 IntersectionObserver 与 document 的 scroll。 */
function mockWindowObserver() {
  const callbacks: IntersectionObserverCallback[] = [];
  const original = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) { callbacks.push(callback); }
    observe() {} disconnect() {}
  } as unknown as typeof IntersectionObserver;
  return {
    intersect: () => { for (const callback of callbacks) callback(
      [{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); },
    restore: () => { globalThis.IntersectionObserver = original; },
  };
}

const root = () => document.documentElement;

function historyWindow(first = 100, last = 200, total = 1000): EventContentWindow {
  return { key: 'history:1:2:earlier', first, last, total };
}

function scrollTo(top: number) {
  root().scrollTop = top;
  fireEvent.scroll(root());
}

describe('EventWindowBoundary reading intent', () => {
  const observers: { restore: () => void }[] = [];
  const unregister: (() => void)[] = [];
  const views: { unmount: () => void }[] = [];
  afterEach(() => {
    for (const view of views) view.unmount();
    for (const remove of unregister) remove();
    for (const observer of observers) observer.restore();
    views.length = 0; unregister.length = 0; observers.length = 0;
    root().scrollTop = 0;
    vi.restoreAllMocks();
  });

  function mount(restore: (first: number) => Promise<void>, contentWindow = historyWindow()) {
    const observer = mockWindowObserver();
    observers.push(observer);
    unregister.push(registerEventWindow(contentWindow.key, restore));
    const view = render(<EventWindowBoundary window={contentWindow} direction="earlier" />);
    views.push(view);
    act(() => { observer.intersect(); });
    return { observer, view };
  }

  it('ignores layout and scroll-anchoring changes without a reading input', async () => {
    const restore = vi.fn(async () => {});
    mount(restore);
    // 窗口替换/高度变化会把 scrollTop 往小改，旧实现据此重新导航。
    act(() => { scrollTo(300); scrollTo(120); scrollTo(40); });
    await act(async () => { await Promise.resolve(); });
    expect(restore).not.toHaveBeenCalled();
  });

  it('keeps the evicted content window closed to programmatic scroll', async () => {
    const restore = vi.fn(async () => {});
    const observer = mockWindowObserver();
    observers.push(observer);
    unregister.push(registerEventWindow('event:1:2:9', restore));
    views.push(render(<EventWindowBoundary window={{ key: 'event:1:2:9', first: 0, last: 7, total: 40, evicted: true }}
      direction="restore" />));
    // 可见时的首次内容恢复保持自动。
    act(() => { observer.intersect(); });
    await act(async () => { await Promise.resolve(); });
    expect(restore).toHaveBeenCalledTimes(1);
    // 之后的布局滚动不得再触发恢复。
    act(() => { scrollTo(200); scrollTo(400); });
    await act(async () => { await Promise.resolve(); });
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('still pages earlier history from a wheel gesture', async () => {
    const restore = vi.fn(async () => {});
    mount(restore);
    act(() => { scrollTo(300); fireEvent.wheel(root(), { deltaY: -100 }); });
    await act(async () => { await Promise.resolve(); });
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith(92);
  });

  it('still pages earlier history from keyboard scrolling', async () => {
    const restore = vi.fn(async () => {});
    mount(restore);
    act(() => { scrollTo(400); fireEvent.keyDown(root(), { key: 'PageUp' }); scrollTo(300); });
    await act(async () => { await Promise.resolve(); });
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('still pages earlier history when the scrollbar is dragged', async () => {
    Object.defineProperty(root(), 'clientWidth', { configurable: true, value: 300 });
    const restore = vi.fn(async () => {});
    mount(restore);
    // 内容区按下（未命中滚动条）不算阅读意图，拖动滚动条才算。
    act(() => { scrollTo(400); fireEvent.mouseDown(root(), { clientX: 100 }); scrollTo(260); });
    await act(async () => { await Promise.resolve(); });
    expect(restore).not.toHaveBeenCalled();
    act(() => { fireEvent.mouseDown(root(), { clientX: 380 }); scrollTo(120); });
    await act(async () => { await Promise.resolve(); });
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('keeps paging during a scrollbar drag that outlives the input window', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    Object.defineProperty(root(), 'clientWidth', { configurable: true, value: 300 });
    const restore = vi.fn(async () => {});
    mount(restore);
    act(() => { scrollTo(400); fireEvent.mouseDown(root(), { clientX: 380 }); });
    // 拖动超过阅读意图窗口后，mousemove 续期仍让继续拖动可以翻阅历史。
    now += 1_000;
    act(() => { fireEvent.mouseMove(root(), { buttons: 1 }); scrollTo(300); });
    await act(async () => { await Promise.resolve(); });
    expect(restore).toHaveBeenCalledTimes(1);
    // 按键已松开时 mousemove 不产生新的阅读意图。
    now += 1_000;
    act(() => { fireEvent.mouseMove(root(), { buttons: 0 }); scrollTo(200); });
    await act(async () => { await Promise.resolve(); });
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('still pages earlier history from a touch drag', async () => {
    const restore = vi.fn(async () => {});
    mount(restore);
    act(() => { scrollTo(400); fireEvent.touchStart(root()); scrollTo(150); });
    await act(async () => { await Promise.resolve(); });
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('navigates once per gesture and ignores the scroll churn its own batch causes', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let release: (() => void) | undefined;
    const restore = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    mount(restore);
    act(() => { scrollTo(400); fireEvent.wheel(root(), { deltaY: -100 }); });
    expect(restore).toHaveBeenCalledTimes(1);
    // 批次在途时窗口内容被替换：旧实现会再次 re-arm 并交叉改写。
    act(() => { scrollTo(360); fireEvent.wheel(root(), { deltaY: -100 }); });
    await act(async () => { release?.(); await Promise.resolve(); await Promise.resolve(); });
    // 批次结束后，布局/锚定滚动早已超出这次阅读手势的意图窗口。
    now += 10_000;
    act(() => { scrollTo(700); scrollTo(250); scrollTo(150); });
    await act(async () => { await Promise.resolve(); });
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('does not re-arm on remount caused by a window boundary change', async () => {
    const restore = vi.fn(async () => {});
    const { observer, view } = mount(restore);
    act(() => { scrollTo(400); });
    // 窗口边界随游标变化重挂：新的监听不得把布局滚动当成阅读动作。
    view.rerender(<EventWindowBoundary window={historyWindow(92, 200)} direction="earlier" />);
    act(() => { observer.intersect(); scrollTo(300); scrollTo(120); });
    await act(async () => { await Promise.resolve(); });
    expect(restore).not.toHaveBeenCalled();
    // 重挂后真实阅读入口仍可用。
    act(() => { fireEvent.wheel(root(), { deltaY: -100 }); });
    await act(async () => { await Promise.resolve(); });
    expect(restore).toHaveBeenCalledTimes(1);
  });
});
