import { i18n } from '@/shared/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UnifiedTimeline } from './UnifiedTimeline';
import { copyTextToClipboard } from '@/shared/lib/clipboard';
import type { Participant, TimelineItem } from '@/shared/types/workitem';

vi.mock('@/shared/lib/clipboard', () => ({
  copyTextToClipboard: vi.fn(),
}));

const copyMock = vi.mocked(copyTextToClipboard);

const observers: { callback: IntersectionObserverCallback; targets: Set<Element> }[] = [];
beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('IntersectionObserver', class {
    targets = new Set<Element>();
    constructor(callback: IntersectionObserverCallback) { observers.push({ callback, targets: this.targets }); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

function reachTimelineEnd() {
  const target = screen.getByTestId('timeline-load-more');
  act(() => {
    for (const observer of [...observers]) {
      if (observer.targets.has(target)) observer.callback([{ target, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  });
}

function makeComment(overrides: Partial<TimelineItem>): TimelineItem {
  return {
    id: 1,
    type: 'comment',
    authorId: 10,
    authorName: '蔡何',
    authorType: 'HUMAN',
    isAgent: false,
    content: '评论内容',
    gmtCreate: '2026-08-07T07:00:00Z',
    ...overrides,
  };
}

describe('UnifiedTimeline copy entries', () => {
  beforeEach(() => {
    copyMock.mockReset();
    copyMock.mockResolvedValue(true);
  });

  it('copies only the clicked main comment, not other comments', async () => {
    render(
      <UnifiedTimeline
        items={[
          makeComment({ id: 1, content: '第一条评论正文' }),
          makeComment({ id: 2, content: '第二条评论正文' }),
        ]}
      />,
    );

    const [firstCopy] = screen.getAllByRole('button', { name: '复制评论' });
    await userEvent.click(firstCopy);
    await userEvent.click(await screen.findByText('复制原始 Markdown'));

    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(copyMock).toHaveBeenCalledWith('第一条评论正文');
  });

  it('copies only the clicked agent reply, not the parent comment', async () => {
    render(
      <UnifiedTimeline
        items={[
          makeComment({
            id: 1,
            content: '父评论正文',
            interactions: [{
              guidanceId: 9,
              targetAgentId: 40013,
              targetAgentName: '全栈开发',
              status: 'APPLIED',
              replyContent: '数字人回复正文',
              repliedAt: '2026-08-07T08:00:00Z',
            }],
          }),
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '复制回复' }));
    await userEvent.click(await screen.findByText('复制原始 Markdown'));

    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(copyMock).toHaveBeenCalledWith('数字人回复正文');
  });

  it('hides the copy entry for comments with empty content', () => {
    render(
      <UnifiedTimeline
        items={[makeComment({ id: 1, content: '   ' })]}
      />,
    );

    expect(screen.queryByRole('button', { name: '复制评论' })).not.toBeInTheDocument();
  });
});

describe('UnifiedTimeline automatic server history', () => {
  it('loads history at the bottom even when nested replies leave fewer than 50 rows', () => {
    const loadMore = vi.fn();
    const items = Array.from({ length: 45 }, (_, id) => makeComment({ id }));
    render(<UnifiedTimeline items={items} hasMore onLoadMore={loadMore} />);
    expect(loadMore).not.toHaveBeenCalled();
    reachTimelineEnd();
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '查看更早的记录' })).toBeNull();
    expect(screen.queryByRole('button', { name: '查看较新的记录' })).toBeNull();
  });

  it('retains every loaded row while loading more and after the final page', () => {
    const loadMore = vi.fn();
    const first = Array.from({ length: 50 }, (_, id) => makeComment({ id, content: `loaded-${id}` }));
    const { rerender } = render(<UnifiedTimeline items={first} hasMore onLoadMore={loadMore} />);
    rerender(<UnifiedTimeline items={first} hasMore loadingMore onLoadMore={loadMore} />);
    expect(screen.getAllByTestId('timeline-item')).toHaveLength(50);
    expect(screen.getByText('loaded-0')).toBeInTheDocument();
    reachTimelineEnd();
    expect(loadMore).not.toHaveBeenCalled();

    const all = [...first, makeComment({ id: 51, content: 'last-history' })];
    rerender(<UnifiedTimeline items={all} hasMore={false} onLoadMore={loadMore} />);
    expect(screen.getAllByTestId('timeline-item')).toHaveLength(51);
    expect(screen.getByText('loaded-0')).toBeInTheDocument();
    expect(screen.getByText('last-history')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-load-more')).toBeNull();
  });
});

describe('UnifiedTimeline null participant names', () => {
  it('renders comments without crashing when a participant name is null', () => {
    const participants: Participant[] = [
      {
        userId: 10000,
        targetType: 'HUMAN',
        name: '蔡何',
        displayId: '10000',
        role: 'HUMAN',
        roleName: '真人',
        isAgent: false,
        online: false,
      },
      {
        userId: 40013,
        targetType: 'AGENT',
        name: null as unknown as string,
        displayId: '40013',
        role: 'AGENT',
        roleName: '开发小队成员',
        isAgent: true,
        online: false,
      },
    ];

    render(
      <UnifiedTimeline
        items={[makeComment({ content: '请 @蔡何 确认结论' })]}
        participants={participants}
      />,
    );

    expect(screen.getByText('@蔡何')).toBeInTheDocument();
    expect(screen.getByText(/确认结论/)).toBeInTheDocument();
  });
});

describe('UnifiedTimeline batching and accessibility', () => {
  it('loads only one local batch when intersection and scroll events arrive together', () => {
    const root = document.createElement('div');
    root.style.overflowY = 'auto';
    Object.defineProperties(root, {
      scrollHeight: { value: 1000 }, clientHeight: { value: 200 }, scrollTop: { value: 800 },
    });
    render(<UnifiedTimeline items={Array.from({ length: 120 }, (_, id) => makeComment({ id }))} scrollContainerRef={{ current: root }} />);
    const target = screen.getByTestId('timeline-load-more');
    act(() => {
      for (const observer of [...observers]) {
        if (observer.targets.has(target)) observer.callback([{ target, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      }
      root.dispatchEvent(new Event('scroll'));
    });
    expect(screen.getAllByTestId('timeline-item')).toHaveLength(100);
  });
  // 后端 unified-timeline 按 gmtCreate DESC, id DESC 返回，数组头是最新评论。
  function makeManyComments(count: number): TimelineItem[] {
    return Array.from({ length: count }, (_, index) => makeComment({
      id: count - index,
      content: `评论 ${count - index}`,
    }));
  }

  it('renders only the newest 50 entries and loads earlier ones 50 at a time', async () => {
    render(<UnifiedTimeline items={makeManyComments(120)} />);

    const initialEntries = screen.getAllByTestId('timeline-item');
    expect(initialEntries).toHaveLength(50);
    expect(initialEntries[0]).toHaveTextContent('评论 120');
    expect(initialEntries[49]).toHaveTextContent('评论 71');
    expect(screen.queryByText('评论 70')).not.toBeInTheDocument();
    expect(screen.queryByText('评论 1')).not.toBeInTheDocument();

    reachTimelineEnd();

    const expandedEntries = screen.getAllByTestId('timeline-item');
    expect(expandedEntries).toHaveLength(100);
    expect(expandedEntries[0]).toHaveTextContent('评论 120');
    expect(screen.getByText('评论 21')).toBeInTheDocument();
    expect(screen.queryByText('评论 20')).not.toBeInTheDocument();
    reachTimelineEnd();

    expect(screen.getAllByTestId('timeline-item')).toHaveLength(120);
    expect(screen.getByText('评论 1')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-load-more')).not.toBeInTheDocument();
  });

  it('keeps the expanded window and shows a newly arrived comment at the head', async () => {
    const { rerender } = render(<UnifiedTimeline items={makeManyComments(120)} />);
    reachTimelineEnd();
    expect(screen.getAllByTestId('timeline-item')).toHaveLength(100);

    rerender(<UnifiedTimeline items={makeManyComments(121)} />);

    const entries = screen.getAllByTestId('timeline-item');
    expect(entries).toHaveLength(100);
    expect(entries[0]).toHaveTextContent('评论 121');
    expect(screen.getByText('评论 22')).toBeInTheDocument();
    expect(screen.queryByText('评论 21')).not.toBeInTheDocument();
  });

  it('does not offer the load-earlier control for timelines within the first page', () => {
    render(<UnifiedTimeline items={makeManyComments(50)} />);

    expect(screen.getAllByTestId('timeline-item')).toHaveLength(50);
    expect(screen.getByText('评论 50')).toBeInTheDocument();
    expect(screen.getByText('评论 1')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-load-more')).not.toBeInTheDocument();
  });

  it('keeps timeline entries out of display locking for native accessibility updates', () => {
    render(<UnifiedTimeline items={makeManyComments(2)} />);

    for (const item of screen.getAllByTestId('timeline-item')) {
      const style = item.getAttribute('style') ?? '';
      // Chrome's AXBlockFlowData neighbor traversal can encounter detached text
      // fragments when changing inline content under content-visibility:auto.
      // The real-browser regression exercises the crash; this guards the CSS.
      expect(style).not.toContain('content-visibility');
      expect(style).not.toContain('contain-intrinsic-size');
    }
  });

  it('renders the automatic loading sentinel after the visible entries', () => {
    render(<UnifiedTimeline items={makeManyComments(120)} />);

    const entries = screen.getAllByTestId('timeline-item');
    const control = screen.getByTestId('timeline-load-more');
    expect(entries[entries.length - 1].compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('UnifiedTimeline segmented filter', () => {
  // 评论与系统事件的 ID 来自不同后端序列，真实数据里两段会重叠（同一工单下 id 10011 同时存在两种类型）。
  function makeSystemItem(overrides: Partial<TimelineItem>): TimelineItem {
    return {
      id: 100,
      type: 'system',
      authorId: 10000,
      authorName: '蔡何(10000)',
      authorType: 'HUMAN',
      isAgent: false,
      content: '工单状态已变更: verifying → closed （操作人：蔡何(10000)）',
      gmtCreate: '2026-08-07T07:00:00Z',
      ...overrides,
    };
  }

  const overlappingItems = [
    makeComment({ id: 3, content: '评论三' }),
    makeSystemItem({ id: 3 }),
    makeComment({ id: 2, content: '评论二' }),
    makeSystemItem({ id: 2 }),
    makeComment({ id: 1, content: '评论一' }),
  ];

  it('shows comment and event counts in the section head', () => {
    render(<UnifiedTimeline items={overlappingItems} />);

    expect(screen.getByText('3 条评论 · 2 条事件')).toBeInTheDocument();
    expect(screen.getAllByTestId('timeline-item')).toHaveLength(5);
  });

  it('subsets the list when switching between comments-only and events-only', async () => {
    render(<UnifiedTimeline items={overlappingItems} />);

    await userEvent.click(screen.getByText('仅评论'));
    let entries = screen.getAllByTestId('timeline-item');
    expect(entries).toHaveLength(3);
    expect(entries.every((entry) => entry.textContent?.includes('评论'))).toBe(true);
    expect(screen.queryByText('工单状态已变更')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('仅时间线'));
    entries = screen.getAllByTestId('timeline-item');
    expect(entries).toHaveLength(2);
    expect(screen.queryByText('评论三')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('全部'));
    expect(screen.getAllByTestId('timeline-item')).toHaveLength(5);
  });
});

describe('UnifiedTimeline long comment collapse', () => {
  it('clamps long comment bodies behind an expand toggle and collapses them back', async () => {
    // jsdom 无布局，scrollHeight 恒为 0；以 getter 桩模拟超限高的正文。
    const heightSpy = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(600);
    const longContent = Array.from({ length: 120 }, (_, line) => `第 ${line} 行：这是一段很长的评论正文`).join('\n');
    const { unmount } = render(<UnifiedTimeline items={[makeComment({ id: 901, content: longContent })]} />);

    const expand = screen.getByRole('button', { name: '展开全文' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.aw-tlc-body--clamped')).not.toBeNull();

    await userEvent.click(expand);
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.aw-tlc-body--clamped')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.getByRole('button', { name: '展开全文' })).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.aw-tlc-body--clamped')).not.toBeNull();

    unmount();
    heightSpy.mockRestore();
  });

  it('keeps short comments unclamped without a toggle', () => {
    render(<UnifiedTimeline items={[makeComment({ id: 902, content: '短评论正文' })]} />);

    expect(screen.queryByRole('button', { name: '展开全文' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收起' })).not.toBeInTheDocument();
    expect(document.querySelector('.aw-tlc-body--clamped')).toBeNull();
  });
});

describe('UnifiedTimeline whole comment collapse', () => {
  const agentComment = makeComment({
    id: 903,
    authorId: 10004,
    authorName: '验收修复06(10004)',
    authorType: 'AGENT',
    isAgent: true,
    content: '数字人发布影响分析的完整回复正文',
    interactions: [{
      guidanceId: 9,
      targetAgentId: 40013,
      targetAgentName: '全栈开发',
      status: 'APPLIED',
      replyContent: '数字人回复正文',
      repliedAt: '2026-08-07T08:00:00Z',
    }],
  });

  it('folds the whole comment entry down to its header row', async () => {
    render(<UnifiedTimeline items={[agentComment]} />);

    expect(document.querySelector('.aw-tlc-body')).not.toBeNull();
    expect(screen.getByText('数字人回复正文')).toBeInTheDocument();

    const fold = screen.getByRole('button', { name: '收起评论' });
    expect(fold).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(fold);
    expect(document.querySelector('.aw-tlc-body')).toBeNull();
    expect(screen.queryByText('数字人回复正文')).not.toBeInTheDocument();
    expect(screen.queryByText('数字人发布影响分析的完整回复正文')).not.toBeInTheDocument();
    expect(screen.getByText('验收修复06(10004)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开评论' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('restores the body and agent replies after unfolding', async () => {
    render(<UnifiedTimeline items={[agentComment]} />);

    await userEvent.click(screen.getByRole('button', { name: '收起评论' }));
    await userEvent.click(screen.getByRole('button', { name: '展开评论' }));

    expect(document.querySelector('.aw-tlc-body')).not.toBeNull();
    expect(screen.getByText('数字人回复正文')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起评论' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('UnifiedTimeline operator display', () => {
  function makeSystemItem(overrides: Partial<TimelineItem>): TimelineItem {
    return {
      id: 100,
      type: 'system',
      authorId: 10000,
      authorName: '蔡何(10000)',
      authorType: 'HUMAN',
      isAgent: false,
      content: '工单状态已变更: verifying → closed （操作人：蔡何(10000)）',
      gmtCreate: '2026-08-07T07:00:00Z',
      ...overrides,
    };
  }

  it('renders the operator on status change and assignment events', () => {
    render(
      <UnifiedTimeline
        items={[
          makeSystemItem({ id: 100 }),
          makeSystemItem({
            id: 101,
            authorId: 40015,
            authorName: 'AW测试工程师(40015)',
            authorType: 'AGENT',
            isAgent: true,
            content: '交付负责人已变更: AW测试工程师(40015) → 蔡何(10000) （操作人：AW测试工程师(40015)）',
          }),
        ]}
      />,
    );

    expect(screen.getByText('工单状态已变更: verifying → closed （操作人：蔡何(10000)）')).toBeInTheDocument();
    expect(screen.getByText('交付负责人已变更: AW测试工程师(40015) → 蔡何(10000) （操作人：AW测试工程师(40015)）')).toBeInTheDocument();
  });
});

it('updates cached finite system events and keeps legacy, unknown and authored same-looking content raw', async () => {
  const base = { type: 'system' as const, authorId: 10, authorName: '工单已创建', authorType: 'HUMAN', isAgent: false, gmtCreate: '2026-08-07T07:00:00Z' };
  const items: TimelineItem[] = [
    { ...base, id: 1, content: '工单已创建: <b>raw</b>', eventType: 'CREATE', toValDisplay: '<b>raw</b>' },
    { ...base, id: 2, content: '工单已创建', eventType: 'UNKNOWN' },
    { ...base, id: 3, content: '工单已创建' },
    { ...base, id: 4, type: 'comment', content: '工单已创建' },
  ];
  render(<UnifiedTimeline items={items} />);
  await act(async () => { await i18n.changeLanguage('en-US'); });
  expect(screen.getByText('Work item created: <b>raw</b>')).toBeInTheDocument();
  expect(screen.getAllByText('工单已创建').length).toBeGreaterThanOrEqual(3);
  expect(document.querySelector('b')).toBeNull();
  await act(async () => { await i18n.changeLanguage('zh-CN'); });
});

it('renders fresh Aone source and raw operator parameters safely while legacy same-prefix content remains raw', async () => {
  const base = { id: 1, type: 'system' as const, authorId: null, authorName: null, authorType: 'SYSTEM', isAgent: false, content: '已从 Aone 工单导入', gmtCreate: '2026-08-07T07:00:00Z', sourceProvider: 'AONE', sourceExternalWorkitemId: '<b>42</b>', sourceExternalUrl: 'https://aone.example/42' };
  render(<UnifiedTimeline items={[{ ...base, eventType: 'AONE_IMPORT' }, { ...base, id: 2, content: '已从 Aone 工单 raw legacy' }, { ...base, id: 3, eventType: 'STATUS_CHANGE', fromValDisplay: '工单已创建', toValDisplay: '<b>raw</b>', operatorDisplayName: '操作人 <b>raw</b>' }]} />);
  await act(async () => { await i18n.changeLanguage('en-US'); });
  expect(screen.getByRole('link', { name: '<b>42</b>' })).toHaveAttribute('href', 'https://aone.example/42');
  expect(screen.getByText('Imported from Aone work item', { exact: false })).toBeInTheDocument();
  expect(screen.getByText('已从 Aone 工单 raw legacy')).toBeInTheDocument();
  expect(screen.getByText('Work item status changed: 工单已创建 → <b>raw</b> (operator: 操作人 <b>raw</b>)')).toBeInTheDocument();
  expect(document.querySelector('b')).toBeNull();
  await act(async () => { await i18n.changeLanguage('zh-CN'); });
});

it('switches held external fallback names and values without a new query or losing a draft, preserving authored collisions', async () => {
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { useUnifiedTimeline } = await import('../hooks');
  const { server } = await import('@/test/mocks/server');
  const { http, HttpResponse } = await import('msw');
  let requests = 0;
  const fallback = { provider: 'AONE', subjectId: '<b>123456789012345</b>', displayName: null };
  const raw = 'Aone 用户（staffId: <b>123456789012345</b>）';
  const items = [
    makeComment({ id: 601, authorName: raw, authorType: 'EXTERNAL', ...{ authorNameFallback: fallback } }),
    makeComment({ id: 602, authorName: raw, authorType: 'EXTERNAL' }),
    makeComment({ id: 603, authorName: '<b>authored</b>', authorType: 'EXTERNAL', ...{ authorNameFallback: { ...fallback, displayName: '<b>authored</b>' } } }),
    { ...makeComment({ id: 604 }), type: 'system' as const, eventType: 'EXTERNAL_BUSINESS_OWNER_CHANGE', fromValDisplay: raw, toValDisplay: raw, ...{ fromValNameFallback: fallback, toValNameFallback: fallback } },
  ];
  server.use(http.get('/api/workitems/601/unified-timeline/window', () => {
    requests += 1; return HttpResponse.json({ success: true, code: '0', message: '', data: items });
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Held() { const { data = [] } = useUnifiedTimeline(601); return <><input aria-label="raw draft" defaultValue="draft" /><UnifiedTimeline items={data} /></>; }
  const view = render(<QueryClientProvider client={client}><Held /></QueryClientProvider>);
  await screen.findAllByText(raw);
  await userEvent.type(screen.getByRole('textbox', { name: 'raw draft' }), ' preserved');
  await act(async () => { await i18n.changeLanguage('en-US'); });
  expect(screen.getByText('Aone user (staffId: <b>123456789012345</b>)')).toBeInTheDocument();
  expect(screen.getByText('External business owner changed: Aone user (staffId: <b>123456789012345</b>) → Aone user (staffId: <b>123456789012345</b>)')).toBeInTheDocument();
  expect(screen.getByText(raw)).toBeInTheDocument();
  expect(screen.getByText('<b>authored</b>')).toBeInTheDocument();
  expect(view.container.querySelector('b')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'raw draft' })).toHaveValue('draft preserved');
  expect(requests).toBe(1);
  await act(async () => { await i18n.changeLanguage('zh-CN'); });
  expect(screen.getAllByText(raw)).toHaveLength(2);
  expect(requests).toBe(1);
  view.unmount(); client.clear();
});


it('renders interaction actions only when the page supplies the slot', () => {
  const item = makeComment({
    id: 801,
    content: '请检查兼容性',
    interactions: [{
      guidanceId: 9, dispatchId: 91, targetAgentId: 40013, targetAgentName: 'AW全栈开发',
      status: 'APPLIED', replyContent: '已完成',
    }],
  });

  const { rerender } = render(<UnifiedTimeline items={[item]} />);
  expect(screen.queryByRole('button', { name: '结束本次执行' })).not.toBeInTheDocument();

  rerender(<UnifiedTimeline items={[item]} renderInteractionActions={() => <button type="button">结束本次执行</button>} />);
  expect(screen.getByRole('button', { name: '结束本次执行' })).toBeInTheDocument();
});

it('renders the human transition note only for status changes that carry one', () => {
  const withNote = makeComment({
    id: 901, type: 'system', content: '', eventType: 'STATUS_CHANGE',
    fromValDisplay: '开发中', toValDisplay: '已上线', operatorDisplayName: '蔡何', note: '与需求方确认后流转',
  });
  const withoutNote = makeComment({
    id: 902, type: 'system', content: '', eventType: 'STATUS_CHANGE',
    fromValDisplay: '待处理', toValDisplay: '开发中', operatorDisplayName: '蔡何',
  });

  const { container, rerender } = render(<UnifiedTimeline items={[withNote]} />);
  expect(screen.getByText('备注：与需求方确认后流转')).toBeInTheDocument();

  rerender(<UnifiedTimeline items={[withoutNote]} />);
  expect(container.querySelector('.aw-tle-note')).toBeNull();

  rerender(<UnifiedTimeline items={[makeComment({ ...withNote, id: 903, note: '   ' })]} />);
  expect(container.querySelector('.aw-tle-note')).toBeNull();

  rerender(<UnifiedTimeline items={[makeComment({ id: 904, type: 'system', eventType: 'ASSIGN', content: 'ASSIGN: 1 -> 2', note: '不应展示' })]} />);
  expect(container.querySelector('.aw-tle-note')).toBeNull();
});
