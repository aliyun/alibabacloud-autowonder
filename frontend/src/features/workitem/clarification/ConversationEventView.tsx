import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Typography, Spin } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import type { TimelineNode } from './timeline';
import { renderTimelineNode } from './eventRegistry';
import type { Artifact } from '@/shared/types/workitem';
import { EventWindowBoundary, EventWindowLatest } from './eventContentWindows';
import { FoldScopeContext } from './PersistentFold';

interface ConversationEventViewProps {
  /** 时间线由 useClarificationEvents 产出，这里只负责渲染，不重复归并一遍。 */
  nodes: TimelineNode[];
  isProcessing: boolean;
  artifacts?: Artifact[];
  onArtifactClick?: (artifact: Artifact) => void;
  onOpenEventContent?: (eventId: number, summary: string) => void;
  showProcessingIndicator?: boolean;
  /** 避免不同会话的同名节点共用展开状态。 */
  foldScope?: string;
}

export function ConversationEventView({
  nodes, isProcessing, artifacts, onArtifactClick, onOpenEventContent, showProcessingIndicator = true, foldScope,
}: ConversationEventViewProps) {
  const { t } = useTranslation('workitem');
  // null 表示跟随尾部：新节点到达时窗口随之前移，不依赖与旧长度的比较（异步提交下会滞后卡住）。
  const [windowEnd, setWindowEnd] = useState<number | null>(null);
  const earlier = useRef<HTMLDivElement>(null);
  const later = useRef<HTMLDivElement>(null);
  const end = windowEnd == null ? nodes.length : Math.min(nodes.length, Math.max(200, windowEnd));
  const start = Math.max(0, end - 200);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const length = nodes.length;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (entry.target === earlier.current) setWindowEnd(previous => Math.max(200, Math.min(length, previous ?? length) - 100));
        if (entry.target === later.current) setWindowEnd(previous => {
          const next = Math.min(length, previous ?? length) + 100;
          return next >= length ? null : next;
        });
      }
    }, { rootMargin: '100px' });
    if (earlier.current) observer.observe(earlier.current);
    if (later.current) observer.observe(later.current);
    return () => observer.disconnect();
  }, [start, end, nodes.length]);
  const hasReplyText = nodes.some((node) => node.kind === 'text' && !!node.text);
  const latest = nodes.find(node => node.contentWindow?.navigation)?.contentWindow;

  if (nodes.length === 0 && isProcessing && showProcessingIndicator) {
    return (
      <div style={{ padding: 16, textAlign: 'center' }}>
        <Spin indicator={<LoadingOutlined />} />
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          {t('clarification.waiting')}
        </Typography.Text>
      </div>
    );
  }

  if (nodes.length === 0) {
    return null;
  }

  return (
    <FoldScopeContext.Provider value={foldScope ?? ''}>
    <div className="aw-cl-event-list" style={{ padding: '8px 0' }}>
      {latest && <div style={{ position: 'sticky', top: 0, zIndex: 1 }}><EventWindowLatest window={latest} /></div>}
      {start > 0 && <><div aria-hidden style={{ height: start * 48, overflowAnchor: 'none' }} /><div ref={earlier} data-testid="events-window-earlier" style={{ height: 1, overflowAnchor: 'none' }} /></>}
      {nodes.slice(start, end).map((node) => (
        <div className="aw-cl-event-row" key={node.id} data-event-body={node.id} data-content-first={node.contentWindow?.first}
          data-content-last={node.contentWindow?.last}>
          {node.contentWindow && !node.contentWindow.navigation && (node.contentWindow.first > 0 || node.contentWindow.evicted) &&
            <EventWindowBoundary window={node.contentWindow} direction={node.contentWindow.evicted ? 'restore' : 'earlier'} />}
          {renderTimelineNode(node, (artifacts && onArtifactClick) || onOpenEventContent
            ? {
              artifacts: artifacts ?? [],
              onArtifactClick: onArtifactClick ?? (() => undefined),
              onOpenEventContent,
            }
            : undefined)}
          {node.contentWindow && !node.contentWindow.navigation && node.contentWindow.last + 1 < node.contentWindow.total &&
            <EventWindowBoundary window={node.contentWindow} direction="later" />}
        </div>
      ))}
      {end < nodes.length && <><div ref={later} style={{ height: 1, overflowAnchor: 'none' }} /><div aria-hidden style={{ height: (nodes.length - end) * 48, overflowAnchor: 'none' }} /></>}
      {showProcessingIndicator && isProcessing && !hasReplyText && (
        <Spin indicator={<LoadingOutlined />} style={{ marginTop: 8 }} />
      )}
    </div>
    </FoldScopeContext.Provider>
  );
}
