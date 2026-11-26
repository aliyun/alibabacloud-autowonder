import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useIsFetching, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar, Button, Input, Pagination, Segmented, Select, Tooltip } from 'antd';
import { SearchOutlined, SwapOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Table } from '@/shared/theme/ThemedTable';
import { PageHead } from '@/shared/ui/PageHead';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import { RobotHeadIcon } from '@/shared/ui/RobotHeadIcon';
import { StatusTag } from '@/shared/ui/StatusTag';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import { formatDateTime } from '@/shared/i18n/format';
import { useAuthStore } from '@/shared/auth/store';
import { listAgents, listPendingReviews, getPendingReviewCount } from '@/features/agent/api';
import type { Agent } from '@/features/agent/api';
import { PENDING_REVIEWS_QUERY_KEY, PENDING_REVIEW_COUNT_QUERY_KEY } from '@/features/agent/hooks';
import { listWorkitems } from '@/features/workitem/api';
import type { WorkitemQuery } from '@/features/workitem/api';
import { STATUS_CATEGORY_TAG_COLOR, workTypeMap } from '@/features/workitem/constants';
import { listNotifications, getUnreadNotificationCount } from '@/features/notification/api';
import { getScheduledTaskSummary, listScheduledTasks, listScheduledTaskRuns } from '@/features/scheduledTask/api';
import { relativeTime } from '@/features/scheduledTask/relativeTime';
import { getRunningWorkitems } from '@/features/insights/realtime/api';
import type { RunningWorkitem } from '@/features/insights/realtime/api';
import { useMembers } from '@/features/settings/hooks';
import type { Workitem } from '@/shared/types/workitem';
import type { Notification } from '@/shared/types/notification';
import { durationText } from './duration';
import type { Translate } from './duration';
import { NewWorkitemModal } from './components/NewWorkitemModal';
import { useFollowingStatusTransition } from './useFollowingStatusTransition';
import './workbench.css';

const PAGE_SIZE_OPTIONS = ['5', '10', '20'];
const DEFAULT_PAGE_SIZE = 5;
const FOLLOWING_ACTIVE_CATEGORIES = 'NEW,IN_PROGRESS,PENDING_DECISION';
const DECISION_CATEGORIES = 'PENDING_DECISION';
const ASSIGNED_CATEGORIES = 'NEW,IN_PROGRESS';
const NOTIFICATION_UNREAD = 'UNREAD';
/** 行动队列每页条数与单来源取数上限（客户端归并，不新增后端接口）。 */
const QUEUE_PAGE_SIZE = 8;
const QUEUE_FETCH_SIZE = 50;
/** 与后端 summarizeRuns 的 attention 判定同字段：运行 FAILED / PAUSED 需要关注。 */
const ATTENTION_RUN_STATUSES = new Set(['FAILED', 'PAUSED']);
/** 概览右栏只展示少量条目，完整列表走「执行记录」「全部通知」。 */
const RUNNING_PREVIEW_LIMIT = 5;
const ACTIVITY_PREVIEW_LIMIT = 6;

type FollowingScope = 'ALL' | 'CREATED' | 'WATCHED' | 'COMMENTED';
type StatusFilter = 'UNFINISHED' | 'ALL' | 'NEW' | 'IN_PROGRESS' | 'PENDING_DECISION' | 'DONE' | 'CANCELED';
type QueueKind = 'decision' | 'assigned' | 'review' | 'alert';
type QueueFilter = 'all' | QueueKind;

interface QueueRow {
  key: string;
  kind: QueueKind;
  title: string;
  path: string;
  workitemId?: number;
  typeLabel?: string;
  reason: string;
  updatedAt: string | null;
}

interface QueueCounts {
  decision: number;
  assigned: number;
  review: number;
  alert: number;
}

/** 页面筛选统一用 antd Segmented（队列与「我在跟进」同一控件形态），计数为无盒副文本。 */
function FilterSegmented<T extends string>({ ariaLabel, value, options, onChange }: {
  ariaLabel: string;
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
}) {
  return (
    <Segmented
      aria-label={ariaLabel}
      value={value}
      onChange={(next) => onChange(next as T)}
      options={options.map((option) => ({
        value: option.value,
        label: (
          <span className="aw-wb-seg-label">
            {option.label}
            {option.count != null ? (
              <span className={`aw-wb-filter-count${option.count === 0 ? ' zero' : ''}`}>{option.count}</span>
            ) : null}
          </span>
        ),
      }))}
    />
  );
}

/** 统一节奏刷新计时展示，不逐行发起请求。 */
function useNowTick(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * 列表条件与页码按空间保存在当前标签会话内：进入详情再返回时仍保留上下文，
 * 不新增后端偏好，也不会跨空间串用。
 */
function useWorkbenchState<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw == null ? initial : JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 存储不可用时只保留内存状态。
    }
  }, [key, value]);
  return [value, setValue];
}

function formatUpdated(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return formatDateTime(date, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 相对时间优先（12 分钟前 / 昨天），无效时间回退绝对时间。 */
function updatedText(value: string | null | undefined): string {
  if (!value) return '-';
  return relativeTime(value) || formatUpdated(value);
}

function timeValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** 骨架占位：结构与真实行一致，不使用 spinner。 */
function SkeletonRows() {
  return (
    <div className="aw-wb-skeleton" aria-hidden="true">
      <div className="aw-wb-sk w2" />
      <div className="aw-wb-sk w1" />
      <div className="aw-wb-sk w3" />
      <div className="aw-wb-sk w2" />
    </div>
  );
}

/** 单卡错误行：失败只影响本卡，重试不波及其他区域。 */
function ErrLine({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('workbench');
  return (
    <div className="aw-wb-errline">
      <AwStrokeIcon name="alert-c" size={14} />
      {t('following.loadFailed')}
      <Button size="small" className="aw-wb-btn-sm aw-wb-errline-retry" onClick={onRetry}>{t('following.retry')}</Button>
    </div>
  );
}

function Overview({ counts, reviewVisible, unread, refreshing, onRefresh, onCreate, canCreate }: {
  counts: QueueCounts;
  reviewVisible: boolean;
  unread: number;
  refreshing: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  canCreate: boolean;
}) {
  const { t } = useTranslation('workbench');
  return (
    <div className="aw-wb-overview">
      <div className="aw-wb-kpis">
        <span className="aw-wb-kpi warn">
          <span className="aw-wb-k-label">{t('overview.decision')}</span>
          <b>{counts.decision}</b>
        </span>
        <span className="aw-wb-kpi info">
          <span className="aw-wb-k-label">{t('overview.assigned')}</span>
          <b>{counts.assigned}</b>
        </span>
        {reviewVisible ? (
          <span className="aw-wb-kpi review">
            <span className="aw-wb-k-label">{t('overview.review')}</span>
            <b>{counts.review}</b>
          </span>
        ) : null}
        <span className="aw-wb-kpi">
          <span className="aw-wb-k-label">{t('overview.unread')}</span>
          <b>{unread}</b>
        </span>
      </div>
      <div className="aw-wb-ph-acts">
        <Button
          icon={<AwStrokeIcon name="refresh" />}
          loading={refreshing}
          onClick={onRefresh}
        >
          {t('overview.refresh')}
        </Button>
        <Button
          type="primary"
          icon={<AwStrokeIcon name="plus" />}
          disabled={!canCreate}
          onClick={onCreate}
        >
          {t('newWorkitem')}
        </Button>
      </div>
    </div>
  );
}

function ActionQueueSection({ rows, counts, reviewVisible, alertVisible, loading, error, onRetry }: {
  rows: QueueRow[];
  counts: QueueCounts;
  reviewVisible: boolean;
  alertVisible: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation('workbench');
  const navigate = useNavigate();
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [page, setPage] = useState(1);

  const bucketCount = (kind: QueueFilter): number => {
    if (kind === 'all') {
      return counts.decision + counts.assigned + (reviewVisible ? counts.review : 0) + (alertVisible ? counts.alert : 0);
    }
    if (kind === 'review') return reviewVisible ? counts.review : 0;
    if (kind === 'alert') return alertVisible ? counts.alert : 0;
    return counts[kind];
  };

  // 来源失效（如审核 403）时回到「全部」，避免停留在已隐藏的筛选项。
  useEffect(() => {
    if ((filter === 'review' && !reviewVisible) || (filter === 'alert' && !alertVisible)) {
      setFilter('all');
      setPage(1);
    }
  }, [filter, reviewVisible, alertVisible]);

  const visibleRows = filter === 'all' ? rows : rows.filter((row) => row.kind === filter);
  const lastPage = Math.max(1, Math.ceil(visibleRows.length / QUEUE_PAGE_SIZE));
  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage]);
  const pageRows = visibleRows.slice((page - 1) * QUEUE_PAGE_SIZE, page * QUEUE_PAGE_SIZE);

  const filterOptions: { value: QueueFilter; label: string }[] = [
    { value: 'all', label: t('queue.filter.all') },
    { value: 'decision', label: t('queue.filter.decision') },
    { value: 'assigned', label: t('queue.filter.assigned') },
    ...(reviewVisible ? [{ value: 'review' as QueueFilter, label: t('queue.filter.review') }] : []),
    ...(alertVisible ? [{ value: 'alert' as QueueFilter, label: t('queue.filter.alert') }] : []),
  ];

  const go = (row: QueueRow) => navigate(row.path);
  const allCount = bucketCount('all');

  return (
    <section className="aw-wb-card" id="aw-workbench-queue">
      <div className="aw-wb-card-h">
        <h3>{t('queue.title')}</h3>
        <span className="aw-wb-cnt">{allCount}</span>
        <span className="aw-wb-sp" />
        <span className="aw-wb-hint">{t('queue.sortedHint')}</span>
      </div>
      <div className="aw-wb-qbar">
        <FilterSegmented
          ariaLabel={t('queue.filterAria')}
          value={filter}
          onChange={(value) => { setFilter(value); setPage(1); }}
          options={filterOptions.map((option) => ({ ...option, count: bucketCount(option.value) }))}
        />
      </div>
      {loading ? <SkeletonRows /> : error ? <ErrLine onRetry={onRetry} /> : visibleRows.length === 0 ? (
        <div className="aw-wb-empty">
          {allCount === 0 ? (
            <>
              <b>{t('queue.empty.title')}</b>
              <p>{t('queue.empty.description')}</p>
              <Button
                size="small"
                className="aw-wb-btn-sm"
                onClick={() => document.getElementById('aw-workbench-following')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                {t('queue.empty.viewFollowing')}
              </Button>
            </>
          ) : (
            <p>{t('queue.filterEmpty')}</p>
          )}
        </div>
      ) : (
        <>
          <ul className="aw-wb-acts">
            {pageRows.map((row, index) => (
              <li
                key={row.key}
                className={`aw-wb-act${index === 0 ? ' first-visible' : ''}`}
                data-testid={`workbench-queue-${row.key}`}
              >
                <span className={`aw-wb-kind ${row.kind}`}>
                  <span className="dot" aria-hidden="true" />
                  {t(`queue.kind.${row.kind}`)}
                </span>
                <span className="aw-wb-act-main">
                  <span className="aw-wb-act-title">
                    <EllipsisText tooltip={row.title}>
                      <a onClick={() => go(row)}>{row.title}</a>
                    </EllipsisText>
                  </span>
                  <span className="aw-wb-act-meta">
                    {row.workitemId != null ? <span className="mono">{t('fields.idWithHash', { id: row.workitemId })}</span> : null}
                    {row.typeLabel ? <span>{row.typeLabel}</span> : null}
                    <span className="why">{row.reason}</span>
                    {row.updatedAt ? <span>{updatedText(row.updatedAt)}</span> : null}
                  </span>
                </span>
                <a className="aw-wb-act-go" onClick={() => go(row)}>{t(`queue.action.${row.kind}`)}</a>
              </li>
            ))}
          </ul>
          <div className="aw-wb-card-f">
            <span aria-live="polite">{t('totalRows', { total: bucketCount(filter) })}</span>
            <Pagination
              size="small"
              current={page}
              pageSize={QUEUE_PAGE_SIZE}
              total={visibleRows.length}
              showSizeChanger={false}
              onChange={(nextPage) => setPage(nextPage)}
            />
          </div>
        </>
      )}
    </section>
  );
}

function AssigneeCell({ record, agentById }: { record: Workitem; agentById: Map<number, Agent> }) {
  const { t } = useTranslation('workbench');
  const assigned = (record.assigneeType === 'AGENT' || record.assigneeType === 'HUMAN') && record.assigneeRef != null;
  if (!assigned) {
    return <span className="aw-wb-dim">{t('fields.unassigned')}</span>;
  }
  const agent = record.assigneeType === 'AGENT' ? agentById.get(record.assigneeRef!) : undefined;
  const name = record.assigneeDisplayName || record.assigneeName || agent?.name || `#${record.assigneeRef}`;
  return (
    <span className="aw-workbench-assignee">
      <Avatar
        size={18}
        className={record.assigneeType === 'AGENT' ? 'aw-workbench-assignee-avatar is-ai' : 'aw-workbench-assignee-avatar'}
      >
        {name.slice(0, 1)}
      </Avatar>
      <EllipsisText tooltip={name}>{name}</EllipsisText>
    </span>
  );
}

function WorkitemCell({ record }: { record: Workitem }) {
  const { t } = useTranslation('workbench');
  const navigate = useNavigate();
  const external = record.externalCollaboration;
  const externalId = external?.externalWorkitemId;
  const externalUrl = external?.externalUrl || record.sourceUrl;
  const provider = external?.provider || record.sourceProvider || '';
  return (
    <div className="aw-workbench-workitem">
      <EllipsisText tooltip={record.title}>
        <a onClick={() => navigate(`/workitems/${record.id}`)}>{record.title}</a>
      </EllipsisText>
      <div className="aw-workbench-workitem-meta">
        <span>{t('fields.idWithHash', { id: record.id })}</span>
        {externalId ? (
          <span>
            {t('fields.externalSeparator')}
            {externalUrl
              ? <a href={externalUrl} target="_blank" rel="noreferrer">{t('fields.externalSource', { provider, id: externalId }).trim()}</a>
              : t('fields.externalSource', { provider, id: externalId })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function FollowingSection({ now }: { now: number }) {
  const { t } = useTranslation('workbench');
  const navigate = useNavigate();
  const translate = t as unknown as Translate;
  const workspaceId = useAuthStore((state) => state.currentWorkspace?.id ?? null);
  const systemLabel = useSystemLabel();
  const statusTransition = useFollowingStatusTransition();
  const agentsQuery = useQuery({
    queryKey: ['workbench', 'agents'],
    queryFn: () => listAgents({ page: 1, size: 200 }),
    staleTime: 60_000,
  });
  const membersQuery = useMembers();
  const [scope, setScope] = useWorkbenchState<FollowingScope>(`aw.workbench.following.${workspaceId ?? 'none'}.scope`, 'ALL');
  const [statusFilter, setStatusFilter] = useWorkbenchState<StatusFilter>(`aw.workbench.following.${workspaceId ?? 'none'}.status`, 'UNFINISHED');
  const [assignee, setAssignee] = useWorkbenchState(`aw.workbench.following.${workspaceId ?? 'none'}.assignee`, '');
  const [keyword, setKeyword] = useWorkbenchState(`aw.workbench.following.${workspaceId ?? 'none'}.keyword`, '');
  const [searchInput, setSearchInput] = useState(keyword);
  const [page, setPage] = useWorkbenchState(`aw.workbench.following.${workspaceId ?? 'none'}.page`, 1);
  const [size, setSize] = useWorkbenchState(`aw.workbench.following.${workspaceId ?? 'none'}.size`, DEFAULT_PAGE_SIZE);

  const agentById = useMemo(
    () => new Map((agentsQuery.data ?? []).map((agent) => [agent.id, agent])),
    [agentsQuery.data],
  );

  // 负责人选项来自成员与数字员工目录，不依赖当前页数据，避免只覆盖本页。
  const assigneeOptions = useMemo(() => {
    const options = [{ value: '', label: t('following.assignee.all') }];
    for (const member of membersQuery.data ?? []) {
      options.push({ value: `HUMAN:${member.userId}`, label: member.nickname || member.username });
    }
    for (const agent of agentsQuery.data ?? []) {
      options.push({ value: `AGENT:${agent.id}`, label: agent.name });
    }
    return options;
  }, [agentsQuery.data, membersQuery.data, t]);

  const query = useMemo<WorkitemQuery>(() => {
    const assigneeParams: Pick<WorkitemQuery, 'assigneeType' | 'assigneeRef'> = {};
    if (assignee.startsWith('HUMAN:')) {
      assigneeParams.assigneeType = 'HUMAN';
      assigneeParams.assigneeRef = Number(assignee.slice('HUMAN:'.length));
    } else if (assignee.startsWith('AGENT:')) {
      assigneeParams.assigneeType = 'AGENT';
      assigneeParams.assigneeRef = Number(assignee.slice('AGENT:'.length));
    }
    return {
      page,
      size,
      ...(scope === 'ALL' ? { mineScopes: 'CREATED,WATCHED,COMMENTED' } : { mineScope: scope }),
      ...(statusFilter === 'UNFINISHED'
        ? { statusCategories: FOLLOWING_ACTIVE_CATEGORIES }
        : statusFilter === 'ALL' ? {} : { statusCategories: statusFilter }),
      ...assigneeParams,
      ...(keyword ? { keyword } : {}),
      sortBy: 'UPDATED',
    };
  }, [assignee, keyword, page, scope, size, statusFilter]);

  const listQuery = useQuery({
    queryKey: ['workbench', 'following', workspaceId, query],
    queryFn: () => listWorkitems(query),
    enabled: !!workspaceId,
  });

  const resetPage = () => setPage(1);

  const columns: ColumnsType<Workitem> = [
    {
      title: t('following.columns.workitem'), dataIndex: 'title', key: 'workitem', width: 300, align: 'left',
      render: (_: unknown, record: Workitem) => <WorkitemCell record={record} />,
    },
    {
      title: t('following.columns.status'), dataIndex: 'statusName', key: 'status', width: 150, align: 'center',
      render: (_: unknown, record: Workitem) => (
        <div className="aw-workbench-status-cell">
          <Tooltip title={t('following.changeStatus.action')}>
            <Button
              className="aw-workbench-status-btn"
              type="text"
              size="small"
              aria-label={t('following.changeStatus.action')}
              loading={statusTransition.pendingId === record.id}
              onClick={() => statusTransition.open(record)}
            >
              <StatusTag
                dot
                size="sm"
                label={systemLabel(record.statusLabelKey, record.statusName ?? '') || t('fields.emptyValue')}
                colorKey={(record.statusCategory && STATUS_CATEGORY_TAG_COLOR[record.statusCategory]) || 'gray'}
              />
              <SwapOutlined aria-hidden="true" className="aw-workbench-status-icon" />
            </Button>
          </Tooltip>
        </div>
      ),
    },
    {
      title: t('following.columns.assignee'), key: 'assignee', width: 160, align: 'left',
      render: (_: unknown, record: Workitem) => <AssigneeCell record={record} agentById={agentById} />,
    },
    {
      title: t('following.columns.duration'), key: 'duration', width: 130, align: 'center',
      render: (_: unknown, record: Workitem) => <span className="aw-wb-dim">{durationText(record, now, translate)}</span>,
    },
    {
      title: t('following.columns.updated'), dataIndex: 'gmtModified', key: 'updated', width: 120, align: 'center',
      render: (value: string) => <span className="aw-wb-dim">{updatedText(value)}</span>,
    },
  ];

  const rows = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  useEffect(() => {
    if (!listQuery.data) return;
    const lastPage = Math.max(1, Math.ceil(listQuery.data.total / size));
    if (page > lastPage) setPage(lastPage);
  }, [listQuery.data, page, size]);

  return (
    <section className="aw-wb-card" id="aw-workbench-following">
      <div className="aw-wb-card-h">
        <h3>{t('following.title')}</h3>
        <span className="aw-wb-cnt">{total}</span>
        <span className="aw-wb-sp" />
        <a className="aw-wb-link" onClick={() => navigate('/workitems')}>{t('following.viewAll')}</a>
      </div>
      <div className="aw-wb-bar">
        <FilterSegmented
          ariaLabel={t('following.tabsAria')}
          value={scope}
          onChange={(value) => { setScope(value); resetPage(); }}
          options={[
            { value: 'ALL', label: t('following.tabs.all') },
            { value: 'CREATED', label: t('following.tabs.created') },
            { value: 'WATCHED', label: t('following.tabs.watched') },
            { value: 'COMMENTED', label: t('following.tabs.commented') },
          ]}
        />
        <Input
          className="aw-wb-search"
          allowClear
          prefix={<SearchOutlined aria-hidden="true" />}
          placeholder={t('following.searchPlaceholder')}
          value={searchInput}
          onChange={(event) => {
            const next = event.target.value;
            setSearchInput(next);
            if (next === '') {
              setKeyword('');
              resetPage();
            }
          }}
          onPressEnter={() => { setKeyword(searchInput.trim()); resetPage(); }}
        />
        <Select
          className="aw-wb-filter-select"
          value={statusFilter}
          onChange={(value) => { setStatusFilter(value); resetPage(); }}
          options={[
            { value: 'UNFINISHED', label: t('following.status.unfinished') },
            { value: 'ALL', label: t('following.status.all') },
            { value: 'NEW', label: t('following.status.new') },
            { value: 'IN_PROGRESS', label: t('following.status.inProgress') },
            { value: 'PENDING_DECISION', label: t('following.status.pendingDecision') },
            { value: 'DONE', label: t('following.status.done') },
            { value: 'CANCELED', label: t('following.status.canceled') },
          ]}
        />
        <Select
          className="aw-wb-filter-select"
          value={assignee}
          onChange={(value) => { setAssignee(value); resetPage(); }}
          options={assigneeOptions}
          showSearch
          optionFilterProp="label"
        />
      </div>
      <div className="aw-wb-tbl">
        <Table<Workitem>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          loading={listQuery.isLoading}
          pagination={false}
          tableLayout="fixed"
          scroll={{ x: 870 }}
          locale={{ emptyText: listQuery.isError ? t('following.loadFailed') : t('following.empty') }}
        />
      </div>
      <div className="aw-wb-card-f">
        {listQuery.isError ? (
          <Button size="small" className="aw-wb-btn-sm" onClick={() => { void listQuery.refetch(); }}>{t('following.retry')}</Button>
        ) : null}
        <span aria-live="polite">{t('totalRows', { total })}</span>
        <Pagination
          size="small"
          current={page}
          pageSize={size}
          total={total}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          showSizeChanger
          onChange={(nextPage, nextSize) => {
            if (nextSize !== size) {
              setSize(nextSize);
              setPage(1);
              return;
            }
            setPage(nextPage);
          }}
        />
      </div>
      {statusTransition.dialog}
    </section>
  );
}

/** 已运行时长：分钟 / 小时 / 小时+分，i18n 复数键按语言类别覆盖。 */
function runningFor(minutes: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const total = Math.max(0, Math.floor(minutes));
  if (total < 60) return t('running.minutes', { count: total });
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? t('running.hours', { count: hours }) : t('running.hoursMinutes', { count: hours, minutes: rest });
}

function RunningSection() {
  const { t } = useTranslation('workbench');
  const navigate = useNavigate();
  const workspaceId = useAuthStore((state) => state.currentWorkspace?.id ?? null);
  const query = useQuery({
    queryKey: ['workbench', 'running'],
    queryFn: getRunningWorkitems,
    enabled: !!workspaceId,
  });
  const items: RunningWorkitem[] = query.data ?? [];
  const visible = items.slice(0, RUNNING_PREVIEW_LIMIT);

  return (
    <section className="aw-wb-card">
      <div className="aw-wb-card-h">
        <h3>{t('running.title')}</h3>
        <span className="aw-wb-cnt">{items.length}</span>
        <span className="aw-wb-sp" />
        <a className="aw-wb-link" onClick={() => navigate('/executions')}>{t('running.viewExecutions')}</a>
      </div>
      {query.isLoading ? <SkeletonRows /> : query.isError ? (
        <ErrLine onRetry={() => { void query.refetch(); }} />
      ) : items.length === 0 ? (
        <div className="aw-wb-empty"><p>{t('running.empty')}</p></div>
      ) : (
        <>
          <ul className="aw-wb-runs">
            {visible.map((item) => (
              <li key={item.workitemId} className="aw-wb-run" data-testid={`workbench-running-${item.workitemId}`}>
                <Avatar size={22} className="aw-wb-run-avatar" icon={<RobotHeadIcon aria-hidden="true" />} />
                <span className="aw-wb-run-main">
                  <span className="aw-wb-run-top">
                    {item.agentName ? <span className="aw-wb-run-name">{item.agentName}</span> : null}
                    {item.stepName ? <span className="aw-wb-run-step">{item.stepName}</span> : null}
                  </span>
                  <span className="aw-wb-run-title">
                    <a onClick={() => navigate(`/workitems/${item.workitemId}`)}>
                      {item.title || t('fields.idWithHash', { id: item.workitemId })}
                    </a>
                  </span>
                  <span className="aw-wb-run-time">
                    <span className="aw-wb-live pulse" aria-hidden="true" />
                    {runningFor(item.runningMinutes, t as unknown as (key: string, options?: Record<string, unknown>) => string)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {items.length > RUNNING_PREVIEW_LIMIT ? (
            <div className="aw-wb-card-f">
              {t('running.previewHint', { limit: RUNNING_PREVIEW_LIMIT, total: items.length })}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function ActivitySection() {
  const { t } = useTranslation('workbench');
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['workbench', 'activity'],
    queryFn: () => listNotifications({ page: 1, size: ACTIVITY_PREVIEW_LIMIT }),
    staleTime: 30_000,
  });
  const items: Notification[] = query.data?.items ?? [];
  const total = query.data?.total ?? items.length;

  const open = (item: Notification) => {
    if (item.refType === 'WORKITEM' && item.refId != null) {
      navigate(`/workitems/${item.refId}`);
      return;
    }
    if (item.link && item.link.startsWith('/')) {
      navigate(item.link);
    }
  };

  return (
    <section className="aw-wb-card">
      <div className="aw-wb-card-h">
        <h3>{t('activity.title')}</h3>
        <span className="aw-wb-sp" />
        <a className="aw-wb-link" onClick={() => navigate('/notifications')}>{t('activity.viewAll')}</a>
      </div>
      {query.isLoading ? <SkeletonRows /> : query.isError ? (
        <ErrLine onRetry={() => { void query.refetch(); }} />
      ) : items.length === 0 ? (
        <div className="aw-wb-empty"><p>{t('activity.empty')}</p></div>
      ) : (
        <>
          <ul className="aw-wb-feed">
            {items.map((item) => (
              <li key={item.id} className="aw-wb-feed-row" onClick={() => open(item)}>
                <span
                  className={`aw-wb-unread${item.status === NOTIFICATION_UNREAD ? '' : ' read'}`}
                  aria-label={item.status === NOTIFICATION_UNREAD ? t('activity.unread') : undefined}
                />
                <span className="aw-wb-feed-body">
                  <EllipsisText tooltip={item.title}>{item.title}</EllipsisText>
                  {item.content ? (
                    <EllipsisText tooltip={item.content} style={{ fontSize: 11, color: 'var(--aw-text-3)' }}>
                      {item.content}
                    </EllipsisText>
                  ) : null}
                </span>
                <time className="aw-wb-feed-time">{updatedText(item.gmtCreate)}</time>
              </li>
            ))}
          </ul>
          {total > ACTIVITY_PREVIEW_LIMIT ? (
            <div className="aw-wb-card-f">
              {t('activity.previewHint', { limit: ACTIVITY_PREVIEW_LIMIT, total })}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export function WorkbenchPage() {
  const { t } = useTranslation('workbench');
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const workspaceId = useAuthStore((state) => state.currentWorkspace?.id ?? null);
  // 与侧栏审核角标（useAgentPendingReviewCount）同一权限门槛；无权限不渲染审核桶。
  const canReview = useAuthStore((state) => state.hasAccess('READ_WRITE'));
  const now = useNowTick();
  const [createOpen, setCreateOpen] = useState(false);

  const decisionQuery = useQuery({
    queryKey: ['workbench', 'queue', 'decision', workspaceId, user?.id],
    queryFn: () => listWorkitems({
      page: 1,
      size: QUEUE_FETCH_SIZE,
      assigneeType: 'HUMAN',
      assigneeRef: user?.id,
      statusCategories: DECISION_CATEGORIES,
      sortBy: 'UPDATED',
    }),
    enabled: !!workspaceId && !!user?.id,
  });

  const assignedQuery = useQuery({
    queryKey: ['workbench', 'queue', 'assigned', workspaceId, user?.id],
    queryFn: () => listWorkitems({
      page: 1,
      size: QUEUE_FETCH_SIZE,
      assigneeType: 'HUMAN',
      assigneeRef: user?.id,
      statusCategories: ASSIGNED_CATEGORIES,
      sortBy: 'UPDATED',
    }),
    enabled: !!workspaceId && !!user?.id,
  });

  // 审核计数与列表复用审核页缓存键；403/失败时整桶隐藏，不阻塞其他来源。
  const reviewCountQuery = useQuery({
    queryKey: PENDING_REVIEW_COUNT_QUERY_KEY,
    queryFn: getPendingReviewCount,
    enabled: canReview,
    retry: false,
  });
  const reviewListQuery = useQuery({
    queryKey: PENDING_REVIEWS_QUERY_KEY,
    queryFn: listPendingReviews,
    enabled: canReview,
    retry: false,
  });
  const reviewVisible = canReview && !reviewCountQuery.isError && !reviewListQuery.isError;

  const alertSummaryQuery = useQuery({
    queryKey: ['workbench', 'scheduled-summary'],
    queryFn: () => getScheduledTaskSummary({}),
    enabled: !!workspaceId,
    retry: false,
  });
  const attentionCount = alertSummaryQuery.data?.attention ?? 0;
  const alertVisible = !alertSummaryQuery.isError;
  const alertTasksQuery = useQuery({
    queryKey: ['workbench', 'scheduled-tasks'],
    queryFn: () => listScheduledTasks({ size: QUEUE_FETCH_SIZE, offset: 0 }),
    enabled: !!workspaceId && attentionCount > 0,
    retry: false,
  });
  const alertTasks = alertTasksQuery.data?.list ?? [];
  // 与定时任务列表页共用「最近一次运行」缓存键；attention>0 才取任务与运行。
  const alertRunQueries = useQueries({
    queries: alertTasks.map((task) => ({
      queryKey: ['scheduled-task-runs', task.id, 'latest'],
      queryFn: () => listScheduledTaskRuns(task.id, 1, 0),
      staleTime: 30_000,
    })),
  });

  const unreadQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: getUnreadNotificationCount,
    enabled: !!user,
  });

  const counts: QueueCounts = {
    decision: decisionQuery.data?.total ?? 0,
    assigned: assignedQuery.data?.total ?? 0,
    review: reviewCountQuery.data ?? 0,
    alert: attentionCount,
  };

  const queueRows = useMemo<QueueRow[]>(() => {
    const rows: QueueRow[] = [];
    for (const record of decisionQuery.data?.list ?? []) {
      rows.push({
        key: `decision-${record.id}`,
        kind: 'decision',
        title: record.title,
        path: `/workitems/${record.id}`,
        workitemId: record.id,
        typeLabel: workTypeMap[record.workType]?.label ?? record.workType,
        reason: t('queue.reason.decision'),
        updatedAt: record.gmtModified,
      });
    }
    for (const record of assignedQuery.data?.list ?? []) {
      rows.push({
        key: `assigned-${record.id}`,
        kind: 'assigned',
        title: record.title,
        path: `/workitems/${record.id}`,
        workitemId: record.id,
        typeLabel: workTypeMap[record.workType]?.label ?? record.workType,
        reason: t('queue.reason.assigned'),
        updatedAt: record.gmtModified,
      });
    }
    if (reviewVisible) {
      for (const agent of reviewListQuery.data ?? []) {
        rows.push({
          key: `review-${agent.id}`,
          kind: 'review',
          title: agent.latestVersionNo != null
            ? t('queue.reviewTitleVersioned', { name: agent.name, version: agent.latestVersionNo })
            : t('queue.reviewTitle', { name: agent.name }),
          path: '/agents?tab=reviews',
          typeLabel: t('queue.source.agent'),
          reason: t('queue.reason.review'),
          updatedAt: agent.gmtCreate,
        });
      }
    }
    if (alertVisible) {
      alertTasks.forEach((task, index) => {
        const run = alertRunQueries[index]?.data?.[0];
        if (!run || !ATTENTION_RUN_STATUSES.has(run.status)) return;
        rows.push({
          key: `alert-${task.id}`,
          kind: 'alert',
          title: t('queue.alertTitle', { name: task.name }),
          path: `/scheduled-tasks/${task.id}`,
          typeLabel: t('queue.source.scheduledTask'),
          reason: t('queue.reason.alert'),
          updatedAt: run.finishedAt ?? run.startedAt ?? run.scheduledAt ?? task.gmtModified,
        });
      });
    }
    return rows.sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionQuery.data, assignedQuery.data, reviewListQuery.data, reviewVisible, alertVisible, alertTasks, alertRunQueries.map((q) => q.dataUpdatedAt).join('|'), t]);

  const refreshing = useIsFetching({ queryKey: ['workbench'] }) > 0;
  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['workbench'] });
    void queryClient.invalidateQueries({ queryKey: PENDING_REVIEWS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: PENDING_REVIEW_COUNT_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
    void queryClient.invalidateQueries({ queryKey: ['scheduled-tasks', 'summary'] });
  };

  return (
    <div className="aw-workbench">
      <section className="aw-wb-card aw-wb-head">
        <PageHead title={t('title')} description={t('description')} />
        <Overview
          counts={counts}
          reviewVisible={reviewVisible}
          unread={unreadQuery.data ?? 0}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onCreate={() => setCreateOpen(true)}
          canCreate={!!user}
        />
      </section>
      <div className="aw-wb-grid">
        <div className="aw-wb-col">
          <ActionQueueSection
            rows={queueRows}
            counts={counts}
            reviewVisible={reviewVisible}
            alertVisible={alertVisible}
            loading={decisionQuery.isLoading || assignedQuery.isLoading}
            error={decisionQuery.isError || assignedQuery.isError}
            onRetry={() => { void decisionQuery.refetch(); void assignedQuery.refetch(); }}
          />
          <FollowingSection now={now} />
        </div>
        <div className="aw-wb-col">
          <RunningSection />
          <ActivitySection />
        </div>
      </div>
      <NewWorkitemModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}