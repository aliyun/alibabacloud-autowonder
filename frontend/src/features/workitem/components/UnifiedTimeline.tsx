import { externalPrincipalName, timelineSystemContent } from '../runtimeLabels';
import { Trans, useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { formatDateTime } from '@/shared/i18n/format';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Button, Typography, Spin, Segmented } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { AgentInitial } from './SquadMembers';
import { MarkdownView } from '@/shared/ui/MarkdownView';
import { CopyContentMenu } from '@/shared/ui/CopyContentMenu';
import './WorkitemSection.css';
import './UnifiedTimeline.css';
import type { Artifact, CommentInteraction, Participant, TimelineItem } from '@/shared/types/workitem';
import { ArtifactPreviewModal } from './ArtifactPreviewModal';
import { CommentInteractionCard } from './CommentInteractionCard';

const TIMELINE_PAGE_SIZE = 50;
// 超过限高的评论正文默认折叠，渲染高度高于该值 + 渐隐余量才提供展开/收起。
const COMMENT_CLAMP_MAX = 220;
const COMMENT_CLAMP_GUARD = 24;
// 过滤值是技术值：模块级常量避免 JSX 内裸字符串被 AST 文案检查器误拦。
const FILTER_ALL = 'all' as const;
const FILTER_COMMENTS = 'comments' as const;
const FILTER_EVENTS = 'events' as const;
type TimelineFilter = typeof FILTER_ALL | typeof FILTER_COMMENTS | typeof FILTER_EVENTS;
const FILTER_OPTIONS: { value: TimelineFilter }[] = [
  { value: FILTER_ALL },
  { value: FILTER_COMMENTS },
  { value: FILTER_EVENTS },
];

const EMPTY_PARTICIPANTS: Participant[] = [];
const EMPTY_ARTIFACTS: Artifact[] = [];

interface UnifiedTimelineProps {
  items: TimelineItem[];
  participants?: Participant[];
  artifacts?: Artifact[];
  loading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  scrollContainerRef?: RefObject<HTMLElement>;
  loadedPageCount?: number;
  /** Optional per-interaction action slot; only pages that may control interactions pass it. */
  renderInteractionActions?: (interaction: CommentInteraction) => ReactNode;
  composer?: ReactNode;
}

function formatTime(gmtCreate: string): string {
  const now = Date.now();
  const ts = new Date(gmtCreate).getTime();
  const diffMs = now - ts;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return i18n.t('workitem:timeline.justNow');
  if (diffMin < 60) return i18n.t('workitem:timeline.minutes', { count: diffMin });
  if (diffHour < 24) return i18n.t('workitem:timeline.hours', { count: diffHour });

  return formatDateTime(gmtCreate, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

const CommentCard = memo(function CommentCard({
  item,
  mentionNames,
  artifacts,
  onArtifactClick,
  renderInteractionActions,
}: {
  item: TimelineItem;
  mentionNames: string[];
  artifacts?: Artifact[];
  onArtifactClick?: (artifact: Artifact) => void;
  renderInteractionActions?: (interaction: CommentInteraction) => ReactNode;
}) {
  const { t } = useTranslation('workitem');
  const authorName = externalPrincipalName(item.authorName, item.authorNameFallback);
  // Lombok 把 boolean isAgent 序列化为 agent，前端 isAgent 恒缺失，以 authorType 为准
  const isAgent = item.authorType === 'AGENT';
  // 整条评论折叠：头部常驻折叠钮，把正文、展开切换与数字人回复一并收起，只留作者行。
  const [folded, setFolded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [collapsible, setCollapsible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const bodyOverflows = (element: HTMLDivElement | null) =>
    element != null && element.isConnected && element.scrollHeight > COMMENT_CLAMP_MAX + COMMENT_CLAMP_GUARD;
  // MarkdownView 同步渲染，挂载即可测高；折叠态 overflow:hidden 不影响 scrollHeight。展开折叠钮会卸载正文，重挂时需重测。
  useLayoutEffect(() => {
    setCollapsible(bodyOverflows(bodyRef.current));
  }, [item.content, mentionNames, artifacts, folded]);
  // 列宽变化后重测，避免挂载瞬间的宽度污染折叠判定。
  useEffect(() => {
    const element = bodyRef.current;
    if (element == null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setCollapsible(bodyOverflows(bodyRef.current));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [item.content, mentionNames, artifacts, folded]);
  const clamped = collapsible && !expanded;

  return (
    <div className="aw-tlc">
      {isAgent
        ? <span className="aw-feed-avatar ai" role="img" aria-label={t('members.agentAvatar')}><AgentInitial name={authorName} /></span>
        : <span className="aw-feed-avatar">{authorName ? Array.from(authorName)[0] : <AwStrokeIcon name="user" size={14} />}</span>}
      <div className="aw-tlc-main">
        <div className="aw-tlc-head">
          <strong className="aw-tlc-author">{authorName || t('timeline.unknown')}</strong>
          <button
            type="button"
            className={folded ? 'aw-tlc-fold aw-tlc-fold--folded' : 'aw-tlc-fold'}
            aria-expanded={!folded}
            aria-label={folded ? t('timeline.unfoldComment') : t('timeline.foldComment')}
            title={folded ? t('timeline.unfoldComment') : t('timeline.foldComment')}
            onClick={() => setFolded((value) => !value)}
          >
            <AwStrokeIcon name="chev-d" />
          </button>
          <span className="aw-tlc-ops">
            <CopyContentMenu contentMd={item.content} tooltip={t('timeline.copyComment')} />
          </span>
          <span className="aw-tlc-time">{formatTime(item.gmtCreate)}</span>
        </div>
        {!folded && (
          <>
            <div className={clamped ? 'aw-tlc-body aw-tlc-body--clamped' : 'aw-tlc-body'} ref={bodyRef}>
              <MarkdownView
                className="aw-feed-md"
                content={item.content}
                mentionNames={mentionNames}
                artifacts={artifacts}
                onArtifactClick={onArtifactClick}
              />
            </div>
            {collapsible && (
              <Button
                type="link"
                size="small"
                className={expanded ? 'aw-tlc-toggle aw-tlc-toggle--open' : 'aw-tlc-toggle'}
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? t('timeline.collapse') : t('timeline.expand')}
                <AwStrokeIcon name="chev-d" />
              </Button>
            )}
            {item.interactions?.filter(interaction => interaction.status !== 'APPLIED' || interaction.replyContent).map(interaction => (
              <CommentInteractionCard key={`${interaction.guidanceId}-${interaction.dispatchId || ''}`} interaction={interaction}
                createdAt={item.gmtCreate} artifacts={artifacts} onArtifactClick={onArtifactClick}
                actions={renderInteractionActions?.(interaction)} />
            ))}
          </>
        )}
      </div>
    </div>
  );
});

function formatParticipantLabel(participant: Participant | undefined, id: string): string {
  if (!participant?.name) return id;
  const displayId = participant.displayId || id;
  return `${participant.name}（${displayId}）`;
}

function formatSystemContent(content: string, participants: Participant[] = []): string {
  const match = content.match(/^ASSIGN:\s*(\d+)\s*(?:→|->)\s*(\d+)\s*$/);
  if (!match) return content;

  const [, fromId, toId] = match;
  const participantById = new Map(participants.map((participant) => [String(participant.userId), participant]));
  return `ASSIGN: ${formatParticipantLabel(participantById.get(fromId), fromId)} -> ${formatParticipantLabel(participantById.get(toId), toId)}`;
}

function renderSystemItem(item: TimelineItem, participants: Participant[] = []) {
  const content = item.eventType ? timelineSystemContent(item) : formatSystemContent(item.content, participants);
  if (item.sourceProvider === 'AONE' && item.sourceExternalWorkitemId && (item.eventType === 'AONE_IMPORT' || item.eventType === 'AONE_UPDATE')) {
    const workitemId = item.sourceExternalWorkitemId;
    const link = item.sourceExternalUrl ? <Typography.Link href={item.sourceExternalUrl} target="_blank" rel="noreferrer">{workitemId}</Typography.Link> : <span>{workitemId}</span>;
    return <Trans ns="workitem" i18nKey={item.eventType === 'AONE_IMPORT' ? 'projection.aoneImport' : 'projection.aoneUpdate'} components={{ source: link }} />;
  }
  return content;
}

function eventIconName(eventType?: string | null) {
  if (eventType === 'ASSIGN' || eventType === 'HANDOFF') return 'transfer' as const;
  if (eventType === 'STATUS_CHANGE') return 'shuffle' as const;
  return 'history' as const;
}

const SystemCard = memo(function SystemCard({ item, participants }: { item: TimelineItem; participants?: Participant[] }) {
  // renderSystemItem 走 i18n 单例，需订阅语言变化才能让 memo 卡片随切换重渲染
  const { t } = useTranslation('workitem');
  const note = item.eventType === 'STATUS_CHANGE' ? item.note?.trim() : '';
  return (
    <div className="aw-tle">
      <span className="aw-event-icon"><AwStrokeIcon name={eventIconName(item.eventType)} size={12} /></span>
      <div className="aw-tle-head">
        <span className="aw-tle-title">{renderSystemItem(item, participants)}</span>
        <span className="aw-tle-time">{formatTime(item.gmtCreate)}</span>
      </div>
      {note ? <div className="aw-tle-note">{t('projection.event.status_change.note', { note })}</div> : null}
    </div>
  );
});

export const UnifiedTimeline = memo(function UnifiedTimeline({
  items,
  participants = EMPTY_PARTICIPANTS,
  artifacts = EMPTY_ARTIFACTS,
  loading,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  scrollContainerRef,
  loadedPageCount = 0,
  renderInteractionActions,
  composer,
}: UnifiedTimelineProps) {
  const { t } = useTranslation('workitem');
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);
  const [visibleCount, setVisibleCount] = useState(TIMELINE_PAGE_SIZE);
  const sectionRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<TimelineFilter>(FILTER_ALL);
  // 只在 participants 引用变化时重建，避免每次时间线渲染都给所有评论换一个新的 mentionNames 引用。
  const mentionNames = useMemo(
    () => participants
      .map((participant) => participant.name)
      .filter((name): name is string => Boolean(name)),
    [participants],
  );
  const handleArtifactClick = useCallback((artifact: Artifact) => setPreviewArtifact(artifact), []);
  const handlePreviewClose = useCallback(() => setPreviewArtifact(null), []);

  const commentCount = useMemo(() => items.filter((item) => item.type === 'comment').length, [items]);
  const eventCount = items.length - commentCount;
  // API 按最新在前返回，窗口取数组头部即最近 N 条；展开时在下方追加更旧条目，当前视口不移动。
  const filteredItems = filter === FILTER_COMMENTS
    ? items.filter((item) => item.type === 'comment')
    : filter === FILTER_EVENTS
      ? items.filter((item) => item.type !== 'comment')
      : items;
  // 服务端无限加载模式下由父级追加窗口；本地模式在观察器触发时扩大可见条数。
  const hiddenCount = Math.max(0, filteredItems.length - visibleCount);
  const more = onLoadMore ? hasMore : hiddenCount > 0;
  const loadRef = useRef({ loading, loadingMore, more, onLoadMore, count: filteredItems.length });
  const loadingCycleRef = useRef(false);
  if (loadingMore) loadingCycleRef.current = true;
  loadRef.current = { loading, loadingMore, more, onLoadMore, count: filteredItems.length };
  useEffect(() => {
    const end = endRef.current;
    if (!end || !more || typeof IntersectionObserver === 'undefined') return;
    let root = scrollContainerRef?.current ?? sectionRef.current?.parentElement ?? null;
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    let requested = false;
    const load = () => {
      const state = loadRef.current;
      if (requested || state.loading || state.loadingMore || !state.more) return;
      requested = true;
      loadingCycleRef.current = false;
      if (state.onLoadMore) state.onLoadMore();
      else setVisibleCount((current) => Math.min(state.count, current + TIMELINE_PAGE_SIZE));
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load();
    }, { root, rootMargin: '0px 0px 100px 0px' });
    observer.observe(end);
    // A fresh scroll gesture can retry a failed request without an automatic retry loop.
    const onScroll = () => {
      if (!root || root.scrollTop + root.clientHeight < root.scrollHeight - 100) return;
      if (!loadRef.current.onLoadMore || (requested && !loadingCycleRef.current)) return;
      requested = false;
      load();
    };
    root?.addEventListener('scroll', onScroll);
    root?.addEventListener('wheel', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      root?.removeEventListener('scroll', onScroll);
      root?.removeEventListener('wheel', onScroll);
    };
  }, [filteredItems.length, visibleCount, more, scrollContainerRef, loadedPageCount]);

  const visibleItems = onLoadMore ? filteredItems : filteredItems.slice(0, visibleCount);

  return (
    <section ref={sectionRef} data-testid="workitem-timeline-section" className="aw-wi-section aw-tl-section">
      <div className="aw-wi-section-head aw-tl-head">
        <span className="aw-wi-section-title">{t('timeline.title')}</span>
        <span className="aw-tl-count">
          {t('timeline.sectionSub', { commentCount, eventCount })}
        </span>
        <Segmented
          size="small"
          style={{ marginLeft: 'auto' }}
          value={filter}
          onChange={(value) => setFilter(value as TimelineFilter)}
          options={FILTER_OPTIONS.map(({ value }) => ({
            value,
            label: value === FILTER_ALL
              ? t('timeline.filterAll')
              : value === FILTER_COMMENTS
                ? t('timeline.filterComments')
                : t('timeline.filterEvents'),
          }))}
        />
      </div>
      <div className="aw-wi-section-body">
        {loading && items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : (
          <div className="aw-tl-feed">
            {visibleItems.map((item) => (
              // 评论与系统事件的 ID 序列重叠，key 需带类型限定，否则切换过滤器会错位复用节点。
              <div key={`${item.type}-${item.id}`} data-testid="timeline-item" className="aw-tl-entry">
                {item.type === 'comment'
                  ? (
                    <CommentCard
                      item={item}
                      mentionNames={mentionNames}
                      artifacts={artifacts}
                      onArtifactClick={handleArtifactClick}
                      renderInteractionActions={renderInteractionActions}
                    />
                  )
                  : <SystemCard item={item} participants={participants} />}
              </div>
            ))}
          </div>
        )}
        {more && (
          <div
            ref={endRef}
            data-testid="timeline-load-more"
            aria-busy={loadingMore}
            className={loadingMore ? 'aw-tl-loadmore aw-tl-loadmore--active' : 'aw-tl-loadmore'}
          >
            {loadingMore && (
              <span className="aw-tl-loadmore__status" role="status" aria-live="polite">
                <Spin size="small" />
                <span>{t('timeline.loadingEarlier')}</span>
              </span>
            )}
          </div>
        )}
        {composer ? <div className="aw-review-composer">{composer}</div> : null}
      </div>
      <ArtifactPreviewModal
        open={previewArtifact != null}
        artifact={previewArtifact}
        onClose={handlePreviewClose}
      />
    </section>
  );
});
