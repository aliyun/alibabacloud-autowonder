import { workitemDeleteReason } from './runtimeLabels';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import { PageHeading } from '@/shared/ui/PageHeading';
import { Trans, useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { formatDateTime } from '@/shared/i18n/format';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tag, Space, Card, Segmented, Popconfirm, Tooltip, Input, AutoComplete, Typography, Popover, Empty, Modal, Spin, message } from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import { PlusOutlined, AppstoreOutlined, UnorderedListOutlined, DeleteOutlined, StarOutlined, StarFilled, ExclamationCircleFilled, CloseOutlined, CloseCircleFilled, SearchOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDeleteWorkitem, useWorkitemList, useWorkitemKanbanColumns, useToggleWatch, useWorkitemTagOptions, useTransitionWorkitem } from './hooks';
import { WorkitemTagsCell } from './components/WorkitemTagsCell';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import { WorkitemKanban } from './components/WorkitemKanban';
import { WorkitemAdvancedFilter, type WorkitemAdvancedFilterDraft } from './components/WorkitemAdvancedFilter';
import { WorkitemHealthBadge } from './components/WorkitemHealthBadge';
import { HumanInterventionBadge } from './components/HumanInterventionBadge';
import { ScheduledExecutionBadge } from './components/ScheduledExecutionBadge';
import { workTypeMap, STATUS_COLUMNS, getPriorityMeta } from './constants';
import { displayNameWithoutId } from './nameDisplay';
import { readWorkitemViewPreference, writeWorkitemViewPreference, type WorkitemViewMode } from './viewPreference';
import { toCreatedTimeQuery } from './createdTimeFilter';
import { serializeTagConditions } from './tagConditionFilter';
import {
  mergeWorkitemListFilters,
  parseWorkitemListSearchParams,
  toWorkitemListSearchParams,
  type WorkitemListFilterPatch,
  type WorkitemListScope,
} from './listUrlState';
import { usePageSizePreference } from '@/shared/lib/usePageSizePreference';
import { useQueryClient } from '@tanstack/react-query';
import { useTemplateDetail } from '@/features/statemachine/hooks';
import type { StatusNode } from '@/features/statemachine/types';
import { ApiError, ErrorCodes } from '@/shared/types/common';
import type { Workitem } from '@/shared/types/workitem';
import type { WorkitemStatusCategory } from './api';
import type { ColumnsType } from 'antd/es/table';
import { useAuthStore } from '@/shared/auth/store';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';

import { useKanbanTransition } from './useKanbanTransition';

type ViewMode = WorkitemViewMode;
type Scope = WorkitemListScope;
type StatusCategory = WorkitemStatusCategory;

/** 看板每列首屏加载条数，点「加载更多」按此步长递增 */
const KANBAN_COLUMN_PAGE_SIZE = 50;
const ALL_STATUS_KEYS = STATUS_COLUMNS.map(col => col.key as StatusCategory);

const SCOPE_STORAGE_KEY = 'autowonder.workitems.scope';
const LEGACY_PENDING_KEY = 'autowonder.workitems.onlyMyPendingDecision';

function readScopePreference(): Scope {
  try {
    const stored = window.localStorage.getItem(SCOPE_STORAGE_KEY);
    if (stored === 'ALL' || stored === 'PENDING' || stored === 'CREATED' || stored === 'ASSIGNED' || stored === 'WATCHED' || stored === 'COMMENTED') {
      return stored;
    }
    if (window.localStorage.getItem(LEGACY_PENDING_KEY) === 'true') {
      window.localStorage.setItem(SCOPE_STORAGE_KEY, 'PENDING');
      window.localStorage.removeItem(LEGACY_PENDING_KEY);
      return 'PENDING';
    }
  } catch {
    // ignore
  }
  return 'ALL';
}

function writeScopePreference(value: Scope) {
  try {
    window.localStorage.setItem(SCOPE_STORAGE_KEY, value);
    window.localStorage.removeItem(LEGACY_PENDING_KEY);
  } catch {
    // ignore
  }
}

function scopeToQuery(scope: Scope): { pendingDecisionOnly?: boolean; mineScope?: 'CREATED' | 'ASSIGNED' | 'WATCHED' | 'COMMENTED' } {
  switch (scope) {
    case 'PENDING': return { pendingDecisionOnly: true };
    case 'CREATED': return { mineScope: 'CREATED' };
    case 'ASSIGNED': return { mineScope: 'ASSIGNED' };
    case 'WATCHED': return { mineScope: 'WATCHED' };
    case 'COMMENTED': return { mineScope: 'COMMENTED' };
    default: return {};
  }
}


function creatorCellText(record: Workitem): string {
  if (record.sourceType === 'EXTERNAL') {
    const sourceCreator = record.sourceCreator;
    if (!sourceCreator) return i18n.t('workitem:list.missingSourceCreator');
    return displayNameWithoutId(sourceCreator.displayName) || sourceCreator.subjectId || i18n.t('workitem:list.missingSourceCreator');
  }
  return displayNameWithoutId(record.creatorDisplayName, record.creatorName) || '-';
}

/** 日期+时间双行单元格，列表时间列共用。 */
function renderDateTimeCell(value: string | null | undefined) {
  if (!value) return '-';
  const d = new Date(value);
  const date = formatDateTime(d, { year: 'numeric', month: 'numeric', day: 'numeric' });
  const time = formatDateTime(d, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return (
    <div style={{ whiteSpace: 'nowrap' }}>
      <div>{date}</div>
      <div>{time}</div>
    </div>
  );
}

/** 表头单行显示，禁止逐字换行。 */
function withNowrapHeader(columns: ColumnsType<Workitem>): ColumnsType<Workitem> {
  return columns.map(column => ({ ...column, align: 'dataIndex' in column && column.dataIndex === 'title' ? 'left' : 'center', onHeaderCell: () => ({ style: { whiteSpace: 'nowrap', textAlign: 'center' } }) }));
}

function WatchWorkitemButton({
  record,
  loading,
  onToggle,
}: {
  record: Workitem;
  loading: boolean;
  onToggle: (record: Workitem) => void;
}) {
  const { t } = useTranslation('workitem');
  const watched = !!record.watched;
  return (
    <Tooltip title={watched ? t('actions.unwatch') : t('actions.watch')}>
      <Button
        size="small"
        type="text"
        data-testid="workitem-watch-toggle"
        aria-label={watched ? t('actions.unwatchAria') : t('actions.watchAria')}
        icon={watched ? <StarFilled aria-hidden="true" className="aw-watch-active" /> : <StarOutlined aria-hidden="true" />}
        loading={loading}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(record);
        }}
      />
    </Tooltip>
  );
}

function DeleteWorkitemButton({
  record,
  loading,
  onDelete,
}: {
  record: Workitem;
  loading: boolean;
  onDelete: (id: number) => void;
}) {
  const { t } = useTranslation('workitem');
  if (record.deletable === false) {
    return (
      <Tooltip title={workitemDeleteReason(record)}>
        <span>
          <Button
            danger
            size="small"
            aria-label={t('actions.delete')}
            icon={<DeleteOutlined aria-hidden="true" />}
            disabled
            onClick={(event) => event.stopPropagation()}
          />
        </span>
      </Tooltip>
    );
  }
  return (
    <Popconfirm
      icon={<ExclamationCircleFilled aria-hidden="true" />}
      title={t('actions.delete')}
      description={t('list.deleteDescription')}
      okText={t('list.deleteConfirm')}
      okButtonProps={{ danger: true }}
      cancelText={t('list.cancel')}
      onConfirm={() => onDelete(record.id)}
    >
      <Button
        danger
        size="small"
        aria-label={t('actions.delete')}
        icon={<DeleteOutlined aria-hidden="true" />}
        loading={loading}
        onClick={(event) => event.stopPropagation()}
      />
    </Popconfirm>
  );
}

export function WorkitemListPage() {
  const { t } = useTranslation('workitem');
  const systemLabel = useSystemLabel();
  const scopeOptions: { value: Scope; label: string }[] = [
    { value: 'ALL', label: t('scope.all') },
    { value: 'PENDING', label: t('scope.pending') },
    { value: 'CREATED', label: t('scope.created') },
    { value: 'ASSIGNED', label: t('scope.assigned') },
    { value: 'WATCHED', label: t('scope.watched') },
    { value: 'COMMENTED', label: t('scope.commented') },
  ];
  const navigate = useNavigate();
  const user = useAuthStore(state => state.user);
  const accessCommand = useAccessCommand();
  const kanbanTransition = useKanbanTransition();
  const [searchParams, setSearchParams] = useSearchParams();
  // 地址栏是筛选条件的唯一数据源：分享链接与页面结果始终一致
  const filters = useMemo(
    () => parseWorkitemListSearchParams(searchParams, readScopePreference()),
    [searchParams],
  );
  const { scope, workType, statusCategory, keyword, tag, advancedFilter } = filters;
  const filtersRef = useRef(filters);
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSizePreference('autowonder.workitems.pageSize', [10, 20, 50, 100, 200], 10);
  const [viewMode, setViewMode] = useState<ViewMode>(readWorkitemViewPreference);
  const [keywordInput, setKeywordInput] = useState(keyword ?? '');
  const [tagInput, setTagInput] = useState(tag ?? '');
  const [columnSizes, setColumnSizes] = useState<Record<string, number>>({});
  const { data: tagOptions, isError: tagOptionsError } = useWorkitemTagOptions();

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  // 筛选变更在 handler 内同步写回地址，避免依赖 Router transition 的提交时序
  const applyFilters = useCallback((patch: WorkitemListFilterPatch) => {
    const next = mergeWorkitemListFilters(filtersRef.current, patch);
    filtersRef.current = next;
    setSearchParams(toWorkitemListSearchParams(next), { replace: true });
    setPage(1);
    setColumnSizes({});
  }, [setSearchParams]);

  // 地址真正变化（前进/后退、手工改址或自身写回）时重置分页与列宽
  const appliedSearchRef = useRef(searchParams.toString());
  useEffect(() => {
    const current = searchParams.toString();
    if (current === appliedSearchRef.current) {
      return;
    }
    appliedSearchRef.current = current;
    setPage(1);
    setColumnSizes({});
  }, [searchParams]);

  // 只在 URL 中对应值变化时回填输入框，避免覆盖用户尚未提交的输入；
  // 标签按去空白后比较，保留用户输入框里的原始文本（提交时才 trim）。
  useEffect(() => {
    const next = keyword ?? '';
    setKeywordInput((prev) => (prev === next ? prev : next));
  }, [keyword]);
  useEffect(() => {
    const next = tag ?? '';
    setTagInput((prev) => (prev.trim() === next ? prev : next));
  }, [tag]);

  // 首屏把地址规范化为解析后的条件：补齐缺省 scope、丢弃非法值与未知参数，
  // 保证复制出的地址与当前结果一致且可确定还原。
  const normalizedSearchRef = useRef(false);
  useEffect(() => {
    if (normalizedSearchRef.current) {
      return;
    }
    normalizedSearchRef.current = true;
    const canonical = toWorkitemListSearchParams(filtersRef.current).toString();
    if (canonical === searchParams.toString()) {
      return;
    }
    setSearchParams(new URLSearchParams(canonical), { replace: true });
  }, [searchParams, setSearchParams]);

  const isKanban = viewMode === 'kanban';
  const createdQuery = useMemo(() => toCreatedTimeQuery(advancedFilter.created), [advancedFilter.created]);
  const creatorQuery = advancedFilter.creatorIds.length
    ? { creatorIds: advancedFilter.creatorIds.join(',') }
    : {};
  const squadQuery = advancedFilter.unassignedSquad
    ? { unassignedSquad: true }
    : advancedFilter.squadIds.length
      ? { squadIds: advancedFilter.squadIds.join(',') }
      : {};
  const tagConditionsQuery = useMemo(
    () => serializeTagConditions(advancedFilter.tagConditions),
    [advancedFilter.tagConditions],
  );
  // 高级筛选与其他筛选条件以 AND 组合，表格与看板共用同一份查询条件
  const baseQuery = {
    workType,
    ...scopeToQuery(scope),
    keyword,
    tag,
    ...(tagConditionsQuery ? { tagConditions: tagConditionsQuery } : {}),
    ...createdQuery,
    ...creatorQuery,
    ...squadQuery,
  };

  // 表格视图用全量分页查询；看板视图下只取 total 给页面标题用
  const { data, isLoading } = useWorkitemList(
    { ...baseQuery, statusCategory, page: isKanban ? 1 : page, size: isKanban ? 1 : size },
  );
  const items = data?.list ?? [];
  const total = data?.total ?? 0;

  // 看板每列各自带 statusCategory 去服务端查，列内容不再取决于全量列表的页码
  const visibleColumnKeys = statusCategory ? [statusCategory] : ALL_STATUS_KEYS;
  const kanbanColumns = useWorkitemKanbanColumns(
    baseQuery, visibleColumnKeys, columnSizes, KANBAN_COLUMN_PAGE_SIZE, isKanban,
  );
  const showDecisionSummary = isKanban && scope === 'ALL' && !!user && visibleColumnKeys.includes('PENDING_DECISION');
  const [myPendingColumn] = useWorkitemKanbanColumns(
    {
      workType,
      keyword,
      tag,
      ...(tagConditionsQuery ? { tagConditions: tagConditionsQuery } : {}),
      ...createdQuery,
      ...creatorQuery,
      ...squadQuery,
      pendingDecisionOnly: true,
    },
    showDecisionSummary ? ['PENDING_DECISION'] : [], {}, 1, showDecisionSummary,
  );
  const kanbanItems = useMemo(() => {
    const byId = new Map<number | string, Workitem>();
    kanbanColumns.forEach(col => col.items.forEach(item => byId.set(item.id, item)));
    return Array.from(byId.values());
  }, [kanbanColumns]);
  const columnTotals = Object.fromEntries(kanbanColumns.map(col => [col.key, col.total]));
  const columnHasMore = Object.fromEntries(kanbanColumns.map(col => [col.key, col.hasMore]));
  const kanbanLoading = kanbanColumns.some(col => col.isLoading);

  const deleteMutation = useDeleteWorkitem();
  const watchMutation = useToggleWatch();
  const queryClient = useQueryClient();
  const transitionMutation = useTransitionWorkitem();
  // 只有在打开某一行的候选列表时才按需加载该行的模板，同一模板的工单共用 react-query 缓存
  const [transitionTarget, setTransitionTarget] = useState<Workitem | null>(null);
  const [pendingTransition, setPendingTransition] = useState<{ record: Workitem; node: StatusNode } | null>(null);
  const transitionTemplateId = transitionTarget?.templateId != null ? Number(transitionTarget.templateId) : null;
  const validTransitionTemplateId = transitionTemplateId != null && Number.isFinite(transitionTemplateId)
    ? transitionTemplateId
    : null;
  const { data: transitionTemplate, isLoading: transitionTemplateLoading } = useTemplateDetail(validTransitionTemplateId);
  const recommendedTransitionIds = useMemo(() => new Set(
    (transitionTemplate?.transitions ?? [])
      .filter((edge) => String(edge.fromNodeId) === String(transitionTarget?.statusNodeId))
      .map((edge) => String(edge.toNodeId)),
  ), [transitionTarget, transitionTemplate]);
  // 候选口径与详情页一致：当前模板内除当前节点外的全部节点，推荐流转置顶
  const transitionCandidates = useMemo(() => (transitionTemplate?.nodes ?? [])
    .filter((node) => String(node.id) !== String(transitionTarget?.statusNodeId))
    .sort((a, b) => Number(recommendedTransitionIds.has(String(b.id))) - Number(recommendedTransitionIds.has(String(a.id)))),
  [transitionTarget, transitionTemplate, recommendedTransitionIds]);

  const openTransition = (record: Workitem) => {
    if (transitionTarget?.id === record.id) {
      setTransitionTarget(null);
      return;
    }
    accessCommand('READ_WRITE', t('actions.transition'), () => setTransitionTarget(record));
  };

  const chooseTransitionTarget = (node: StatusNode) => {
    if (!transitionTarget) return;
    setPendingTransition({ record: transitionTarget, node });
    setTransitionTarget(null);
  };

  const renderTransitionCandidates = () => {
    if (transitionTemplateLoading) {
      return <Spin data-testid="workitem-transition-loading" />;
    }
    if (transitionCandidates.length === 0) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('list.transitionNoCandidates')} />;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 180 }} data-testid="workitem-transition-candidates">
        {transitionCandidates.map((node) => (
          <Button
            key={String(node.id)}
            block
            disabled={transitionMutation.isPending}
            data-testid={`workitem-transition-target-${node.id}`}
            onClick={() => chooseTransitionTarget(node)}
          >
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <span>{systemLabel(node.systemLabelKey, node.name)}</span>
              {recommendedTransitionIds.has(String(node.id))
                ? <Tag color="gold" style={{ margin: 0 }}>{t('list.transitionRecommended')}</Tag>
                : null}
            </Space>
          </Button>
        ))}
      </div>
    );
  };

  const confirmTransition = () => {
    if (!pendingTransition) return;
    const { record, node } = pendingTransition;
    accessCommand('READ_WRITE', t('actions.transition'), () => {
      transitionMutation.mutate(
        {
          id: record.id,
          toNodeId: Number(node.id),
          expected: { fromNodeId: record.statusNodeId!, expectedVersion: record.version },
        },
        {
          onSuccess: () => setPendingTransition(null),
          onError: (error) => {
            if ((error as ApiError).code === ErrorCodes.WORKITEM_VERSION_CONFLICT) {
              // 版本冲突不写入，列表与行数据刷新后由用户重新选择目标状态
              message.error(t('list.transitionVersionConflict'));
              void queryClient.invalidateQueries({ queryKey: ['workitems'] });
            } else {
              message.error((error as Error).message || t('transition.updateFailed'));
            }
            setPendingTransition(null);
          },
        },
      );
    });
  };

  const renderStatusTag = (statusName: string | null, record: Workitem) => {
    const label = statusName ? systemLabel(record.statusLabelKey, statusName) : '-';
    const configured = record.templateId != null && record.statusNodeId != null;
    const tag = (
      <Tag
        color={statusName ? 'processing' : undefined}
        style={{ margin: 0, ...(configured ? { cursor: 'pointer' } : {}) }}
        data-testid={`workitem-status-${record.id}`}
        role={configured ? 'button' : undefined}
        tabIndex={configured ? 0 : undefined}
        aria-label={configured ? t('list.transitionStatusAria', { name: label }) : undefined}
        onClick={configured ? (event) => {
          event.stopPropagation();
          openTransition(record);
        } : undefined}
        onKeyDown={configured ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openTransition(record);
          }
        } : undefined}
      >
        {label}
      </Tag>
    );
    if (!configured) {
      return <Tooltip title={t('list.transitionNoWorkflow')}>{tag}</Tooltip>;
    }
    return (
      <Popover
        trigger="click"
        open={transitionTarget?.id === record.id}
        onOpenChange={(next) => {
          if (!next) setTransitionTarget(null);
        }}
        placement="bottom"
        content={renderTransitionCandidates()}
      >
        {tag}
      </Popover>
    );
  };

  const columns: ColumnsType<Workitem> = withNowrapHeader([
    { title: 'ID', dataIndex: 'id', className: 'aw-column-numeric', width: 80 },
    {
      title: t('fields.title'), dataIndex: 'title', className: 'aw-column-title',
      render: (text: string, record: Workitem) => (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, minWidth: 0 }}>
          <EllipsisText lines={2} tooltip={text} placement="topLeft" style={{ flex: '1 1 auto', wordBreak: 'break-all' }}>
            <a onClick={() => navigate(`/workitems/${record.id}`)}>{text}</a>
          </EllipsisText>
          <ScheduledExecutionBadge
            scheduledStartAt={record.scheduledStartAt}
            scheduledStartTriggeredAt={record.scheduledStartTriggeredAt}
            origin={record.origin}
            gmtCreate={record.gmtCreate}
          />
        </div>
      ),
    },
    {
      title: t('fields.type'), dataIndex: 'workType', width: 80,
      render: (t: string) => <Tag color={workTypeMap[t]?.color}>{workTypeMap[t]?.label || t}</Tag>,
    },
    {
      title: t('fields.status'), dataIndex: 'statusName', width: 150,
      render: (s: string | null, record: Workitem) => (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          {renderStatusTag(s, record)}
          <HumanInterventionBadge item={record} />
          <WorkitemHealthBadge item={record} />
        </div>
      ),
    },
    {
      title: t('fields.priority'), dataIndex: 'priority', width: 96,
      render: (p: number) => {
        const meta = getPriorityMeta(p);
        return <Tag color={meta.color} style={{ margin: 0 }}>{meta.label}</Tag>;
      },
    },
    {
      title: t('fields.tags'), dataIndex: 'tags', width: 160,
      render: (_: unknown, record: Workitem) => <WorkitemTagsCell workitem={record} maxVisible={3} />,
    },
    {
      title: t('fields.assignee'), dataIndex: 'assigneeName', width: 120,
      render: (_: string | null, record: Workitem) => {
        const text = displayNameWithoutId(record.assigneeDisplayName, record.assigneeName);
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '100%' }}>
            {record.assigneeType === 'AGENT' ? <Tag color="purple" style={{ margin: 0 }}>AI</Tag> : null}
            <EllipsisText tooltip={text ?? undefined}>
              {text ?? t('assignee.unassigned')}
            </EllipsisText>
          </span>
        );
      },
    },
    {
      title: t('fields.creator'), dataIndex: 'creatorDisplayName', width: 120,
      render: (_: string | null, record: Workitem) => {
        const text = creatorCellText(record);
        const hasCreator = record.sourceType === 'EXTERNAL'
          ? record.sourceCreator?.displayName || record.sourceCreator?.subjectId
          : record.creatorDisplayName || record.creatorName;
        return <EllipsisText tooltip={hasCreator ? text : undefined}>{text}</EllipsisText>;
      },
    },
    {
      title: t('fields.created'), dataIndex: 'gmtCreate', className: 'aw-column-numeric', width: 108,
      render: (value: string) => renderDateTimeCell(value),
    },
    ...(scope === 'COMMENTED'
      ? [{
        title: t('fields.myLastCommentAt'), dataIndex: 'myLastCommentAt', className: 'aw-column-numeric', width: 132,
        render: (value: string | null | undefined) => renderDateTimeCell(value),
      } as ColumnsType<Workitem>[number]]
      : []),
    {
      title: t('fields.actions'),
      dataIndex: 'operation',
      width: 112,
      render: (_: unknown, record: Workitem) => (
        <Space size={4}>
          <WatchWorkitemButton
            record={record}
            loading={watchMutation.isPending}
            onToggle={(target) => watchMutation.mutate({ id: target.id, watched: !!target.watched })}
          />
          <DeleteWorkitemButton
            record={record}
            loading={deleteMutation.isPending}
            onDelete={(workitemId) => accessCommand(
              'READ_WRITE',
              t('actions.delete'),
              () => deleteMutation.mutate({ id: workitemId }),
            )}
          />
        </Space>
      ),
    },
  ]);

  const handleScopeChange = (value: string | number) => {
    const next = value as Scope;
    writeScopePreference(next);
    applyFilters({ scope: next });
  };

  const handlePageChange = (nextPage: number, nextSize: number) => {
    setPage(nextPage);
    setSize(nextSize);
  };

  // 类型、状态与其它高级条件在同一弹窗内应用：一次写回全部条件，
  // 应用创建者条件后顶部范围的「我的」类筛选不再有意义，统一回到「全部」。
  const handleAdvancedFilterApply = (next: WorkitemAdvancedFilterDraft) => {
    const { workType: nextWorkType, statusCategory: nextStatusCategory, ...advancedFilter } = next;
    const patch: WorkitemListFilterPatch = {
      advancedFilter,
      workType: nextWorkType,
      statusCategory: nextStatusCategory,
    };
    if (advancedFilter.creatorIds.length > 0 && scope !== 'ALL') {
      writeScopePreference('ALL');
      applyFilters({ ...patch, scope: 'ALL' });
      return;
    }
    applyFilters(patch);
  };

  return (
    <Card
      className="aw-content-card aw-workitems"
      title={<PageHeading title={t('list.title')} description={<Trans t={t} i18nKey="list.total" count={total} components={{ total: <span className="aw-heading-number">{total}</span> }} />} />}
      extra={
        <Space>
          <Segmented
            value={viewMode}
            onChange={(v) => {
              const next = v as ViewMode;
              setViewMode(next);
              writeWorkitemViewPreference(next);
              setPage(1);
            }}
            options={[
              { value: 'kanban', icon: <AppstoreOutlined aria-label={t('list.kanbanView')} /> },
              { value: 'table', icon: <UnorderedListOutlined aria-label={t('list.tableView')} /> },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined aria-hidden="true" />}
            onClick={() => accessCommand('READ_WRITE', t('actions.new'), () => navigate('/workitems/new'))}>
            {t('actions.new')}
          </Button>
        </Space>
      }
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented
          value={scope}
          onChange={handleScopeChange}
          options={scopeOptions}
          aria-label={t('scope.label')}
        />
        <Input.Search
          value={keywordInput}
          onChange={(event) => {
            const next = event.target.value;
            setKeywordInput(next);
            // 清空输入框即撤销关键词条件，与搜索按钮提交保持同一语义
            if (!next) {
              applyFilters({ keyword: undefined });
            }
          }}
          enterButton={<Button aria-label={t('list.searchWithExternalId')} icon={<SearchOutlined aria-hidden="true" />} />}
          allowClear={{ clearIcon: <CloseCircleFilled aria-label={t('list.clearSearch')} /> }}
          placeholder={t('list.searchWithExternalId')}
          onSearch={(v) => { setKeywordInput(v); applyFilters({ keyword: v || undefined }); }}
          style={{ width: 260 }}
        />
        <AutoComplete
          value={tagInput}
          options={(tagOptions ?? []).map((value) => ({ value }))}
          onChange={(value) => {
            setTagInput(value);
            if (!value) {
              applyFilters({ tag: undefined });
            }
          }}
          onSelect={(value) => {
            setTagInput(value);
            applyFilters({ tag: value });
          }}
          style={{ width: 160 }}
        >
          <Input.Search
            enterButton={<Button aria-label={t('list.tagFilter')} icon={<SearchOutlined aria-hidden="true" />} />}
            allowClear={{ clearIcon: <CloseCircleFilled aria-label={t('list.clearTag')} /> }}
            placeholder={t('list.tagFilter')}
            onSearch={(v) => {
              setTagInput(v ?? '');
              applyFilters({ tag: v?.trim() || undefined });
            }}
          />
        </AutoComplete>
        {tagOptionsError ? (
          <Typography.Text type="warning" data-testid="workitem-tag-options-error">
            {t('tags.loadFailed')}
          </Typography.Text>
        ) : null}
        <WorkitemAdvancedFilter
          applied={advancedFilter}
          workType={workType}
          statusCategory={statusCategory}
          onApply={handleAdvancedFilterApply}
        />
      </Space>

      {kanbanTransition.dialog}
      <Modal
        open={!!pendingTransition}
        title={t('list.transitionConfirmTitle')}
        okText={t('list.transitionConfirmOk')}
        cancelText={t('list.cancel')}
        confirmLoading={transitionMutation.isPending}
        onOk={confirmTransition}
        onCancel={() => {
          if (!transitionMutation.isPending) setPendingTransition(null);
        }}
        closeIcon={<CloseOutlined aria-hidden="true" />}
        maskClosable={!transitionMutation.isPending}
        keyboard={!transitionMutation.isPending}
      >
        <Typography.Paragraph data-testid="workitem-transition-confirm">
          {t('list.transitionConfirmText', {
            from: pendingTransition?.record.statusName
              ? systemLabel(pendingTransition.record.statusLabelKey, pendingTransition.record.statusName)
              : '-',
            to: pendingTransition?.node
              ? systemLabel(pendingTransition.node.systemLabelKey, pendingTransition.node.name)
              : '',
          })}
        </Typography.Paragraph>
      </Modal>
      {viewMode === 'kanban' ? (
        <WorkitemKanban
          onMove={kanbanTransition.move}
          transitionBusy={kanbanTransition.busy}
          onToggleWatch={(item) => accessCommand(
            'READ_WRITE',
            item.watched ? t('actions.unwatch') : t('actions.watch'),
            () => watchMutation.mutate({ id: item.id, watched: !!item.watched }),
          )}
          watchBusyId={watchMutation.isPending && watchMutation.variables ? watchMutation.variables.id : null}
          items={kanbanItems}
          loading={kanbanLoading}
          pendingDecisionSummary={showDecisionSummary && user && myPendingColumn && !myPendingColumn.isLoading ? {
            name: displayNameWithoutId(user.nickname, user.username) ?? user.username,
            count: myPendingColumn.total,
          } : undefined}
          columnKeys={visibleColumnKeys}
          columnTotals={columnTotals}
          columnHasMore={columnHasMore}
          onLoadMore={(key) => setColumnSizes(prev => ({
            ...prev,
            [key]: (prev[key] ?? KANBAN_COLUMN_PAGE_SIZE) + KANBAN_COLUMN_PAGE_SIZE,
          }))}
        />
      ) : (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={isLoading}
          tableLayout="fixed"
          scroll={{ x: 1200 }}
          pagination={{
            current: page,
            pageSize: size,
            total,
            onChange: handlePageChange,
            showSizeChanger: true,
            showTotal: (itemTotal) => t('list.pagination', { count: itemTotal }),
          }}
        />
      )}
    </Card>
  );
}
