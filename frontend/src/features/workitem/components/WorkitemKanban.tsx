import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import { i18n } from '@/shared/i18n';
import type { DragEvent } from 'react';
import { Button, Card, Tooltip, Typography, Empty, Spin } from 'antd';
import { LinkOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { workTypeMap, getPriorityMeta, CANCELED_STATUS_COLUMN, STATUS_COLUMNS, statusCategoryOf } from '../constants';
import { displayNameWithoutId } from '../nameDisplay';
import { isMyPendingDecision } from '../decisionGrouping';
import { WorkitemHealthBadge } from './WorkitemHealthBadge';
import { ScheduledExecutionBadge } from './ScheduledExecutionBadge';
import { WorkitemTagsCell } from './WorkitemTagsCell';
import { StatusTag, type StatusColorKey } from '@/shared/ui/StatusTag';
import { AiIdentity } from '@/shared/ui/AiIdentity';
import type { Workitem } from '@/shared/types/workitem';
import './WorkitemKanban.css';

const { Text, Paragraph } = Typography;

function reporterLabel(item: Workitem) {
  const reporter = item.sourceCreator;
  if (!reporter) return i18n.t('workitem:kanban.notReturned');
  return displayNameWithoutId(reporter.displayName) || reporter.subjectId || i18n.t('workitem:kanban.notReturned');
}

function sourceProviderLabel(provider?: string | null) {
  if (!provider) return i18n.t('workitem:kanban.externalWorkitem');
  if (provider.toUpperCase() === 'AONE') return 'Aone';
  return provider.charAt(0).toUpperCase() + provider.slice(1).toLowerCase();
}

interface CardDragProps {
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
}

function WorkitemCard({ item, hot, dragging, watchBusy, onToggleWatch, ...dragProps }: {
  item: Workitem;
  hot?: boolean;
  dragging?: boolean;
  watchBusy?: boolean;
  onToggleWatch?: (item: Workitem) => void;
} & CardDragProps) {
  const { t } = useTranslation('workitem');
  const systemLabel = useSystemLabel();
  const navigate = useNavigate();
  const priority = getPriorityMeta(item.priority);
  const workType = workTypeMap[item.workType] || { color: 'default', label: item.workType };
  const category = statusCategoryOf(item);
  const assigneeText = displayNameWithoutId(item.assigneeDisplayName, item.assigneeName) ?? t('assignee.unassigned');
  const queued = item.executionStatus === 'PENDING' && category !== 'DONE';
  const healthy = category === 'NEW' && !queued && item.health === 'OK';
  const reporterText = item.sourceType === 'EXTERNAL'
    ? t('kanban.sourceReporter', { name: reporterLabel(item) })
    : null;

  return (
    <Card
      {...dragProps}
      className={`aw-kb-card${hot ? ' hot' : ''}${dragging ? ' dragging' : ''}`}
      data-testid={`workitem-card-${item.id}`}
      size="small"
      hoverable
      onClick={() => navigate(`/workitems/${item.id}`)}
      style={{ cursor: dragProps.draggable ? 'grab' : 'pointer', opacity: category === 'DONE' ? 0.82 : undefined }}
      styles={{ body: { padding: '10px 12px' } }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <StatusTag size="sm" label={workType.label} colorKey={(workType.color === 'default' ? 'gray' : workType.color) as StatusColorKey} />
        <StatusTag size="sm" colorKey="blue"
          title={t('kanban.status', { name: item.statusName ? systemLabel(item.statusLabelKey, item.statusName) : t('kanban.notProvided') })}
          style={{ minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
          label={item.statusName ? systemLabel(item.statusLabelKey, item.statusName) : i18n.t('workitem:kanban.notProvided')} />
        {queued && <StatusTag size="sm" dot label={t('status.queued')} colorKey="amber" />}
        {healthy && <StatusTag size="sm" dot label={t('kanban.healthOk')} colorKey="green" />}
        <WorkitemHealthBadge item={item} size="sm" />
        <StatusTag size="sm" label={priority.label} colorKey="outline" style={{ marginLeft: 'auto' }} />
        <Tooltip title={item.watched ? t('actions.unwatch') : t('actions.watch')}>
          <Button
            size="small"
            type="text"
            className="aw-kb-star"
            data-testid={`workitem-card-watch-${item.id}`}
            aria-label={item.watched ? t('actions.unwatchAria') : t('actions.watchAria')}
            icon={item.watched ? <StarFilled aria-hidden="true" className="aw-watch-active" /> : <StarOutlined aria-hidden="true" />}
            loading={watchBusy}
            onClick={(event) => {
              event.stopPropagation();
              onToggleWatch?.(item);
            }}
          />
        </Tooltip>
      </div>
      <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 6, fontWeight: 500, lineHeight: '20px', minHeight: 40 }}>
        {item.title}{' '}
        <ScheduledExecutionBadge
          scheduledStartAt={item.scheduledStartAt}
          scheduledStartTriggeredAt={item.scheduledStartTriggeredAt}
          origin={item.origin}
          gmtCreate={item.gmtCreate}
        />
      </Paragraph>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: 4, minHeight: 18, overflow: 'hidden' }}>
        <WorkitemTagsCell workitem={item} maxVisible={2} />
      </div>
      {item.sourceType === 'EXTERNAL' && (
        <div className="aw-kb-src" onClick={(event) => event.stopPropagation()}>
          {item.sourceUrl ? (
            <Typography.Link className="aw-kb-src-link" href={item.sourceUrl} target="_blank" rel="noreferrer">
              <LinkOutlined /> {t('kanban.source', { provider: sourceProviderLabel(item.sourceProvider) })}
            </Typography.Link>
          ) : (
            <Text className="aw-kb-src-text"><LinkOutlined /> {t('kanban.source', { provider: sourceProviderLabel(item.sourceProvider) })}</Text>
          )}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--aw-text-3)' }}>
        <span style={{ fontFamily: 'var(--aw-font-mono)', flexShrink: 0 }}>{item.id}</span>
        {reporterText ? (
          <Text ellipsis title={reporterText} style={{ fontSize: 11, color: 'var(--aw-text-3)', minWidth: 0 }}>
            {reporterText}
          </Text>
        ) : null}
        <AiIdentity
          name={assigneeText}
          avatar
          icon={item.assigneeType === 'AGENT'}
          size="sm"
          title={t('kanban.assignee', { name: assigneeText })}
          style={{ marginLeft: 'auto', minWidth: 0, maxWidth: '60%', fontSize: 11, color: 'var(--aw-text-3)' }}
        />
      </div>
    </Card>
  );
}

interface WorkitemKanbanProps {
  items: Workitem[];
  loading?: boolean;
  /** 仅展示需要当前登录人决策的待决策工单 */
  onlyMine?: boolean;
  /** 当前登录人 id，用于 onlyMine 过滤 */
  currentUserId?: number | null;
  /** 需要展示的状态列，默认展示全部四列 */
  columnKeys?: string[];
  /** 全部筛选下当前用户的待决策汇总，数量来自服务端。 */
  pendingDecisionSummary?: { name: string; count: number };
  /** 各列的服务端真实总数，与当前加载条数无关 */
  columnTotals?: Record<string, number>;
  /** 各列是否还有未加载的工单 */
  columnHasMore?: Record<string, boolean>;
  onLoadMore?: (key: string) => void;
  onMove?: (item: Workitem, columnKey: string) => void;
  transitionBusy?: boolean;
  /** 关注 / 取消关注入口，由页面按权限与当前关注态注入。 */
  onToggleWatch?: (item: Workitem) => void;
  /** 正在提交关注状态的工单 id，仅该卡片展示 loading。 */
  watchBusyId?: number | string | null;
}

export function WorkitemKanban({
  items,
  loading,
  onlyMine = false,
  currentUserId = null,
  columnKeys,
  pendingDecisionSummary,
  columnTotals,
  columnHasMore,
  onLoadMore,
  onMove,
  transitionBusy = false,
  onToggleWatch,
  watchBusyId = null,
}: WorkitemKanbanProps) {
  const { t } = useTranslation('workitem');
  const dragged = useRef<Workitem | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const resetDrag = () => { dragged.current = null; setOverColumn(null); setDraggingId(null); };
  const renderCard = (item: Workitem, hot?: boolean) => (
    <WorkitemCard key={String(item.id)} item={item} hot={hot} dragging={draggingId === item.id}
      watchBusy={watchBusyId != null && String(watchBusyId) === String(item.id)}
      onToggleWatch={onToggleWatch}
      draggable={!!onMove && !loading && !transitionBusy}
      onDragStart={(event) => {
        // Links within a card keep their native behavior, but must not move the card.
        if (!onMove || loading || transitionBusy || (event.target as HTMLElement).closest('a')) {
          event.preventDefault();
          return;
        }
        dragged.current = item;
        setDraggingId(item.id);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(item.id));
      }}
      onDragEnd={resetDrag}
    />
  );
  const visibleColumns = useMemo(
    () => (columnKeys
      ? [...STATUS_COLUMNS, CANCELED_STATUS_COLUMN].filter(col => columnKeys.includes(col.key))
      : STATUS_COLUMNS),
    [columnKeys],
  );
  const grouped = useMemo(() => {
    const groups: Record<string, Workitem[]> = {};
    visibleColumns.forEach(col => { groups[col.key] = []; });
    items.forEach(item => {
      // 未渲染的列（默认看板不含 CANCELED）与未知分类不落列。
      const key = statusCategoryOf(item);
      if (!groups[key]) return;
      groups[key].push(item);
    });
    return groups;
  }, [items, visibleColumns]);

  return (
    <Spin spinning={!!loading || transitionBusy} tip={transitionBusy ? t('kanban.updating') : undefined}>
    <div className="aw-kanban" style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '12px 0 4px', minHeight: 240 }}>
      {visibleColumns.map(col => {
        const isPending = col.key === 'PENDING_DECISION';
        const colItems = isPending && onlyMine
          ? grouped[col.key].filter(i => isMyPendingDecision(i, currentUserId))
          : grouped[col.key];
        // onlyMine 会在本地二次过滤，此时服务端总数不再代表可见条数
        const serverTotal = isPending && onlyMine ? undefined : columnTotals?.[col.key];
        const badgeCount = serverTotal ?? colItems.length;
        const hot = isPending && !onlyMine && !!pendingDecisionSummary && pendingDecisionSummary.count > 0;
        return (
          <div
            key={col.key}
            data-testid={`kanban-column-${col.key}`}
            className={`aw-kb-col${overColumn === col.key ? ' drop-target' : ''}${hot ? ' hot' : ''}`}
            onDragOver={(event) => {
              if (!dragged.current || transitionBusy || statusCategoryOf(dragged.current) === col.key) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setOverColumn(col.key);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverColumn(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const item = dragged.current;
              resetDrag();
              if (item && !transitionBusy && statusCategoryOf(item) !== col.key) onMove?.(item, col.key);
            }}
            style={{
              flex: '1 1 0',
              minWidth: 260,
              // 多列（默认 4 列）等分铺满整行；状态筛选后仅剩 1 列，保留 360px 上限并靠左
              maxWidth: visibleColumns.length > 1 ? undefined : 360,
            }}
          >
            <div className="aw-kb-col-head">
              <div className="aw-kb-col-title">
                <span className="aw-kb-dot" style={{ background: col.color }} />
                {col.title}
                {isPending && !onlyMine && !!pendingDecisionSummary?.count && (
                  <span aria-label={t('kanban.decisionSummary')} className="aw-kb-mybadge" style={{ marginLeft: 6 }}>
                    {t('kanban.myPendingDecision', { count: pendingDecisionSummary.count })}
                  </span>
                )}
              </div>
              <span className="aw-kb-count" style={{ marginLeft: 'auto' }}>{badgeCount}</span>
            </div>
            <div className="aw-kb-col-body" style={{ flex: 1 }}>
              {colItems.length > 0 ? (
                // 待决策列不再按决策人分组（验收返修 8/11），仅保留我的待决策高亮与 onlyMine 专属空态
                colItems.map(item => renderCard(item, isPending && !onlyMine && isMyPendingDecision(item, currentUserId)))
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={isPending && onlyMine ? t('kanban.emptyDecision') : t('kanban.empty')} />
              )}
              {columnHasMore?.[col.key] && onLoadMore ? (
                <Button
                  className="aw-kb-more"
                  block
                  size="small"
                  type="text"
                  onClick={() => onLoadMore(col.key)}
                >
                  {t('kanban.loadMore', { shown: colItems.length, total: badgeCount })}
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
    </Spin>
  );
}
