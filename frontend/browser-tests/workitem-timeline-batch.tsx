import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocaleProvider } from '../src/shared/i18n/LocaleProvider';
import { UnifiedTimeline } from '../src/features/workitem/components/UnifiedTimeline';
import { ScrollToEdgeButton } from '../src/features/workitem/components/ScrollToEdgeButton';
import type { TimelineItem } from '../src/shared/types/workitem';

function makeItems(count: number, newest: number): TimelineItem[] {
  return Array.from({ length: count }, (_, offset) => ({
    id: newest - offset, type: 'comment', authorId: 7, authorName: 'Reader',
    authorType: 'HUMAN', isAgent: false, content: `comment-${newest - offset}`,
    gmtCreate: '2026-11-01T00:00:00Z',
  }));
}
function Fixture({ paged = false }: { paged?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState(() => makeItems(paged ? 45 : 120, 120));
  const [loadingMore, setLoadingMore] = useState(false);
  const [requests, setRequests] = useState(0);
  const hasMore = paged && items.length < 120;
  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setRequests(value => value + 1);
    window.setTimeout(() => {
      setItems(current => [...current, ...makeItems(Math.min(50, 120 - current.length), 120 - current.length)]);
      setLoadingMore(false);
    }, 300);
  };
  return <div data-testid={paged ? 'timeline-paged-fixture' : 'timeline-batch-fixture'} style={{ position: 'relative', marginBottom: 24 }}>
    <button data-testid="fixture-add-new-comment" onClick={() => setItems(current => [...makeItems(1, Number(current[0].id) + 1), ...current])}>add new comment</button>
    <output data-testid="request-count">{requests}</output>
    <div ref={containerRef} data-testid="timeline-scroll-container" style={{ height: 420, overflowY: 'auto', paddingRight: 38 }}>
      <UnifiedTimeline items={items} hasMore={hasMore} onLoadMore={paged ? loadMore : undefined}
        loadingMore={loadingMore} scrollContainerRef={containerRef} />
    </div>
    <ScrollToEdgeButton containerRef={containerRef} />
  </div>;
}
// 状态变更备注：只有携带 note 且为 STATUS_CHANGE 的事件才渲染备注行。
const noteItems: TimelineItem[] = [
  {
    id: 201, type: 'system', authorId: 7, authorName: 'Reader', authorType: 'HUMAN', isAgent: false,
    content: '', gmtCreate: '2026-11-02T00:00:00Z', eventType: 'STATUS_CHANGE',
    fromValDisplay: '开发中', toValDisplay: '已上线', operatorDisplayName: 'Reader', note: '与需求方确认后流转',
  },
  {
    id: 202, type: 'system', authorId: 7, authorName: 'Reader', authorType: 'HUMAN', isAgent: false,
    content: '', gmtCreate: '2026-11-01T00:00:00Z', eventType: 'STATUS_CHANGE',
    fromValDisplay: '待处理', toValDisplay: '开发中', operatorDisplayName: 'Reader',
  },
];
function StatusNoteFixture() {
  return <section data-testid="timeline-status-note-fixture" style={{ marginBottom: 24 }}>
    <UnifiedTimeline items={noteItems} />
  </section>;
}
createRoot(document.getElementById('root')!).render(<LocaleProvider><Fixture /><Fixture paged /><StatusNoteFixture /></LocaleProvider>);
