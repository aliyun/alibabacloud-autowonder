import { renderToStaticMarkup } from 'react-dom/server';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { ConversationEventView } from './ConversationEventView';
import { buildTimeline } from './timeline';
import { clearFoldState, isFoldExpanded } from './foldingState';
import type { StreamedEvent } from './hooks';

/** 视图只接收时间线节点，归并由 hook 一次算好；测试沿事件流入口构造节点。 */
const nodesOf = (events: StreamedEvent[]) => buildTimeline(events);

function event(eventType: string, content: string): StreamedEvent {
  return {
    turnId: 1,
    eventSeq: 1,
    eventType,
    payload: { type: eventType, content },
    receivedAt: Date.now(),
  };
}

describe('ConversationEventView', () => {
  afterEach(() => { clearFoldState(); });

  it('keeps an expanded process fold open after it leaves and re-enters the rendered window', () => {
    const observers = new Set<Observer>();
    const original = globalThis.IntersectionObserver;
    class Observer {
      targets = new Set<Element>();
      constructor(public callback: IntersectionObserverCallback) { observers.add(this); }
      observe(target: Element) { this.targets.add(target); }
      disconnect() { observers.delete(this); }
    }
    globalThis.IntersectionObserver = Observer as unknown as typeof IntersectionObserver;
    const intersect = (target: Element) => {
      for (const observer of observers) if (observer.targets.has(target)) observer.callback(
        [{ target, isIntersecting: true } as IntersectionObserverEntry], observer as unknown as IntersectionObserver);
    };
    const nodes = Array.from({ length: 250 }, (_, index) => ({
      id: `thinking-1-0-${index}`, turnId: 1, eventSeq: index, kind: 'thinking' as const, text: `思考 ${index}`,
    }));
    const foldOf = (container: HTMLElement) => container.querySelector<HTMLDetailsElement>(
      '[data-event-body="thinking-1-0-249"] details');
    const view = render(<ConversationEventView nodes={nodes} isProcessing={false} />);
    let remounted: ReturnType<typeof render> | undefined;
    let mounted = true;
    try {
      expect(foldOf(view.container)).toBeTruthy();
      foldOf(view.container)!.open = true;
      fireEvent(foldOf(view.container)!, new Event('toggle'));
      expect(isFoldExpanded('thinking-1-0-249')).toBe(true);

      // 向上滚动把该节点移出 200 节点虚拟窗口：DOM 卸载，但状态按节点身份保留。
      act(() => { intersect(screen.getByTestId('events-window-earlier')); });
      expect(foldOf(view.container)).toBeNull();

      // 重新挂载（滚动回窗口/虚拟化重建）时保持展开。
      view.unmount(); mounted = false;
      remounted = render(<ConversationEventView nodes={nodes} isProcessing={false} />);
      expect(foldOf(remounted.container)!.open).toBe(true);
    } finally {
      if (mounted) view.unmount();
      remounted?.unmount();
      globalThis.IntersectionObserver = original;
    }
  });

  it('scopes fold state to the conversation so identical node ids do not leak', () => {
    const nodes = [{ id: 'thinking-1-0-3', turnId: 1, eventSeq: 3, kind: 'thinking' as const, text: '思考' }];
    const foldOf = (container: HTMLElement) => container.querySelector<HTMLDetailsElement>(
      '[data-event-body="thinking-1-0-3"] details')!;
    const first = render(<ConversationEventView nodes={nodes} isProcessing={false} foldScope="clarification:1" />);
    const second = render(<ConversationEventView nodes={nodes} isProcessing={false} foldScope="clarification:2" />);
    try {
      foldOf(first.container).open = true;
      fireEvent(foldOf(first.container), new Event('toggle'));
      expect(isFoldExpanded('clarification:1:thinking-1-0-3')).toBe(true);
      expect(foldOf(second.container).open).toBe(false);
    } finally { second.unmount(); first.unmount(); }
  });

  it('renders nothing for a thinking node without text', () => {
    const { container } = render(<ConversationEventView
      nodes={[{ id: 'thinking-1-0-9', turnId: 1, eventSeq: 9, kind: 'thinking' }]}
      isProcessing={false} />);
    expect(container.textContent).toBe('');
  });

  it('keeps a two-megabyte reply in a Unicode-safe text viewport and restores its beginning automatically', () => {
    const source = 'EARLIEST 🦊\n' + 'x'.repeat(2 * 1024 * 1024) + '\nLATEST 🦊';
    const observers = new Set<Observer>();
    const original = globalThis.IntersectionObserver;
    class Observer {
      targets = new Set<Element>();
      constructor(public callback: IntersectionObserverCallback) { observers.add(this); }
      observe(target: Element) { this.targets.add(target); }
      disconnect() { observers.delete(this); }
    }
    globalThis.IntersectionObserver = Observer as unknown as typeof IntersectionObserver;
    const view = render(<ConversationEventView nodes={nodesOf([event('text', source)])} isProcessing />);
    try {
      const body = () => view.container.querySelector('[data-text-window-body]')
        ?? view.container.querySelector('.aw-clarify-md');
      expect(body()!.textContent!.length).toBeLessThanOrEqual(64 * 1024);
      expect(body()!.textContent).toContain('LATEST 🦊');
      for (let step = 0; step < 36 && !body()!.textContent!.includes('EARLIEST 🦊'); step++) {
        const target = screen.getByTestId('content-window-earlier');
        act(() => {
          for (const observer of observers) if (observer.targets.has(target)) observer.callback(
            [{ target, isIntersecting: true, boundingClientRect: target.getBoundingClientRect(),
              intersectionRect: target.getBoundingClientRect(), intersectionRatio: 1, rootBounds: null, time: 0 }],
            observer as unknown as IntersectionObserver);
          fireEvent.wheel(screen.getByTestId('text-window-scroll'), { deltaY: -600 });
        });
        expect(body()!.textContent!.length).toBeLessThanOrEqual(64 * 1024);
      }
      expect(body()!.textContent).toContain('EARLIEST 🦊');
      expect(body()!.textContent).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    } finally { view.unmount(); globalThis.IntersectionObserver = original; }
  }, 15000);
  it('keeps at most 200 event bodies mounted for a long conversation', () => {
    const nodes = Array.from({ length: 250 }, (_, index) => ({
      id: `log-${index}`, turnId: 1, eventSeq: index, kind: 'log' as const, text: `line-${index}`,
    }));
    const { container } = render(<ConversationEventView nodes={nodes} isProcessing={false} />);
    expect(container.querySelectorAll('[data-event-body]')).toHaveLength(200);
    expect(screen.queryByText('line-0')).not.toBeInTheDocument();
    expect(screen.getByText('line-249')).toBeInTheDocument();
  });
  it('stops the processing spinner once reply text starts streaming', () => {
    const view = render(
      <ConversationEventView nodes={nodesOf([event('text', '请选择一个方案')])} isProcessing />,
    );

    expect(screen.getByText('请选择一个方案')).toBeInTheDocument();
    expect(view.container.querySelector('.ant-spin')).toBeNull();
  });

  it('keeps the processing spinner while only thinking is available', () => {
    const view = render(
      <ConversationEventView nodes={nodesOf([event('thinking', '正在读取工单')])} isProcessing />,
    );

    expect(view.container.querySelector('.ant-spin')).not.toBeNull();
  });

  it('renders streamed thinking and reply text as markdown', () => {
    render(
      <ConversationEventView
        nodes={nodesOf([
          event('thinking', '**正在读取** `workitem`'),
          { ...event('text', '**需求目标**：完成澄清'), eventSeq: 2 },
        ])}
        isProcessing
      />,
    );

    expect(screen.getByText('正在读取').tagName).toBe('STRONG');
    expect(screen.getByText('workitem').tagName).toBe('CODE');
    expect(screen.getByText('需求目标').tagName).toBe('STRONG');
  });

  it('opens only artifact paths that match reported workitem artifacts', () => {
    const artifact = {
      id: 9, workitemId: 100, dispatchId: 3, name: 'docs-100/demo.html',
      type: 'DELIVERABLE', size: 100, gmtCreate: '2026-01-01T00:00:00',
    };
    const onArtifactClick = vi.fn();
    render(
      <ConversationEventView
        nodes={nodesOf([event('text', '请查看 `docs-100/demo.html`，不要打开 `local-only/demo.html`')])}
        isProcessing={false}
        artifacts={[artifact]}
        onArtifactClick={onArtifactClick}
      />,
    );

    const link = screen.getByRole('button', { name: '打开产物 docs-100/demo.html' });
    fireEvent.click(link);
    expect(onArtifactClick).toHaveBeenCalledWith(artifact);
    expect(screen.queryByRole('button', { name: '打开产物 local-only/demo.html' })).not.toBeInTheDocument();
  });

  it('scopes markdown to the clarification stylesheet class', () => {
    const view = render(
      <ConversationEventView nodes={nodesOf([event('text', '**方案**')])} isProcessing={false} />,
    );

    // jsdom 不加载外部 CSS，只能验证作用域类挂上去了；
    // 实际的 pre/code 样式效果由浏览器核对
    expect(view.container.querySelector('.aw-clarify-md')).not.toBeNull();
  });

  it('uses the theme code surface token for thinking and log blocks', () => {
    const view = renderToStaticMarkup(
      <ConversationEventView
        nodes={nodesOf([
          event('thinking', '正在读取工单'),
          { ...event('log', '日志一行'), eventSeq: 2 },
        ])}
        isProcessing={false}
      />,
    );

    // 代码面交给 .aw-cl-pre / .aw-cl-step-body 样式；行内若再出现底色，只能是主题令牌。
    expect(view).toContain('aw-cl-step-body');
    expect(view).toContain('aw-cl-pre');
    const surfaces = [...view.matchAll(/background-color:([^;"]+)/g)].map(match => match[1]);
    expect(surfaces.every(color => color === 'var(--aw-raised)')).toBe(true);
  });

  /**
   * 同一条不变量必须覆盖 ACP 新增的节点渲染器，否则它只管住了 ACP 之前就有的
   * 两个块，新组件可以悄悄退回旧灰底。
   *
   * diff 的增删底色刻意不在断言范围内：那是语义色（红=删、绿=增），不是主题色。
   */
  it('holds the code surface token across the ACP node renderers', () => {
    const view = renderToStaticMarkup(
      <ConversationEventView
        nodes={nodesOf([
          raw(1, 'acp_plan', {
            type: 'acp_plan',
            data: { entries: [{ content: '确认选型', priority: 'medium', status: 'pending' }] },
          }),
          raw(2, 'tool_use', {
            type: 'tool_use', tool: 'Bash', callId: 'c1',
            data: { kind: 'execute', title: '跑测试', rawInput: 'npm test' },
          }),
          raw(3, 'acp_something_new', { type: 'acp_something_new', content: '兜底' }),
        ])}
        isProcessing={false}
      />,
    );

    expect(view).toContain('aw-cl-plan');
    expect(view).toContain('aw-cl-pre');
    const surfaces = [...view.matchAll(/background-color:([^;"]+)/g)].map(match => match[1]);
    expect(surfaces.every(color => color === 'var(--aw-raised)')).toBe(true);
  });
});

function raw(eventSeq: number, eventType: string, payload: unknown): StreamedEvent {
  return { turnId: 1, eventSeq, eventType, payload: payload as never, receivedAt: Date.now() };
}

describe('ConversationEventView 时间线渲染', () => {
  // 重构前按类型累积（一坨思考 + 一堆工具），真实时序被抹掉。
  it('renders nodes in eventSeq order, interleaving thinking and tool calls', () => {
    const view = render(
      <ConversationEventView
        nodes={nodesOf([
          raw(2, 'tool_use', { type: 'tool_use', tool: 'Bash', callId: 'c1', data: { kind: 'execute', title: '跑测试' } }),
          raw(1, 'thinking', { type: 'thinking', content: '先看看' }),
          raw(3, 'text', { type: 'text', content: '结论' }),
        ])}
        isProcessing={false}
      />,
    );

    const order = Array.from(view.container.querySelectorAll('summary, [data-testid^="tool-call-"], p'))
      .map((el) => el.textContent);
    expect(order[0]).toBe('思考过程');
    expect(view.container.textContent).toContain('跑测试');
    expect(view.container.textContent).toContain('结论');
  });

  it('renders an acp_plan snapshot as the checklist card', () => {
    render(
      <ConversationEventView
        nodes={nodesOf([raw(1, 'acp_plan', {
          type: 'acp_plan',
          data: { entries: [{ content: '确认技术选型', priority: 'medium', status: 'in_progress' }] },
        })])}
        isProcessing={false}
      />,
    );
    expect(screen.getByTestId('plan-entry-in_progress-0')).toBeInTheDocument();
    expect(screen.getByText('确认技术选型')).toBeInTheDocument();
  });

  // F5：未知 eventType 走兜底而不是静默丢弃。
  it('falls back to a raw dump for an event type it has never seen', () => {
    render(
      <ConversationEventView
        nodes={nodesOf([raw(1, 'acp_something_new', { type: 'acp_something_new', content: '未来能力' })])}
        isProcessing={false}
      />,
    );
    expect(screen.getByText('未识别事件：acp_something_new')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-unknown-raw').textContent).toContain('未来能力');
  });

  it('renders nothing when there are no nodes and nothing is processing', () => {
    const { container } = render(<ConversationEventView nodes={[]} isProcessing={false} />);
    expect(container.textContent).toBe('');
  });

  it('shows the waiting spinner before the first event arrives', () => {
    const view = render(<ConversationEventView nodes={[]} isProcessing />);
    expect(screen.getByText('等待 AI 响应...')).toBeInTheDocument();
    expect(view.container.querySelector('.ant-spin')).not.toBeNull();
  });

  it('renders a pending elicitation as nothing (the floating wizard handles it)', () => {
    const { container } = render(
      <ConversationEventView
        nodes={nodesOf([raw(1, 'acp_elicitation', {
          type: 'acp_elicitation',
          data: { requestId: 'req-9', message: '选一个', requestedSchema: { type: 'object', properties: { q0: { type: 'string' } } } },
        })])}
        isProcessing={false}
      />,
    );
    expect(container.textContent).toBe('');
  });
});
