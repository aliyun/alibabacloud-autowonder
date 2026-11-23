import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Button, Card, Empty, Input, Pagination, Segmented, Select, Spin, Tag, Tooltip, Typography } from 'antd';
import { PlusOutlined, SearchOutlined, SwapOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Table } from '@/shared/theme/ThemedTable';
import { PageHeading } from '@/shared/ui/PageHeading';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import { RobotHeadIcon } from '@/shared/ui/RobotHeadIcon';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import { formatDateTime } from '@/shared/i18n/format';
import { useAuthStore } from '@/shared/auth/store';
import { listAgents } from '@/features/agent/api';
import type { Agent } from '@/features/agent/api';
import { listWorkitems } from '@/features/workitem/api';
import type { WorkitemQuery } from '@/features/workitem/api';
import { listNotifications } from '@/features/notification/api';
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
const ACTIVE_CATEGORIES = 'NEW,IN_PROGRESS,PENDING_DECISION';
const STATUS_PENDING_DECISION = 'PENDING_DECISION';
const NOTIFICATION_UNREAD = 'UNREAD';

type FollowingScope = 'ALL' | 'CREATED' | 'WATCHED' | 'COMMENTED';
type StatusFilter = 'UNFINISHED' | 'ALL' | 'NEW' | 'IN_PROGRESS' | 'PENDING_DECISION' | 'DONE' | 'CANCELED';

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

function TodoSection() {
  const { t } = useTranslation('workbench');
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const workspaceId = useAuthStore((state) => state.currentWorkspace?.id ?? null);
  const systemLabel = useSystemLabel();
  const [page, setPage] = useWorkbenchState(`aw.workbench.todo.${workspaceId ?? 'none'}.page`, 1);
  const [size, setSize] = useWorkbenchState(`aw.workbench.todo.${workspaceId ?? 'none'}.size`, DEFAULT_PAGE_SIZE);

  const query = useQuery({
    queryKey: ['workbench', 'todo', workspaceId, user?.id, page, size],
    queryFn: () => listWorkitems({
      page,
      size,
      assigneeType: 'HUMAN',
      assigneeRef: user?.id,
      statusCategories: ACTIVE_CATEGORIES,
      sortBy: 'UPDATED',
    }),
    enabled: !!workspaceId && !!user?.id,
  });

  const rows = query.data?.list ?? [];
  const total = query.data?.total ?? 0;

  // 操作使末页为空时回退到仍然存在的有效页码。
  useEffect(() => {
    if (!query.data) return;
    const lastPage = Math.max(1, Math.ceil(query.data.total / size));
    if (page > lastPage) setPage(lastPage);
  }, [page, query.data, size]);

  return (
    <Card
      className="aw-workbench-card"
      title={t('todo.title')}
      extra={<Typography.Text type="secondary">{t('todo.count', { total })}</Typography.Text>}
    >
      {query.isLoading ? <Spin /> : query.isError ? (
        <div className="aw-workbench-error">
          <Typography.Text type="danger">{t('following.loadFailed')}</Typography.Text>
          <Button size="small" onClick={() => { void query.refetch(); }}>{t('following.retry')}</Button>
        </div>
      ) : rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('todo.empty')} />
      ) : (
        <ul className="aw-workbench-todo">
          {rows.map((record) => {
            const external = record.externalCollaboration;
            const reason = record.statusCategory === STATUS_PENDING_DECISION
              ? t('todo.reason.pendingDecision')
              : t('todo.reason.assigned');
            return (
              <li key={record.id} className="aw-workbench-todo-row" data-testid={`workbench-todo-${record.id}`}>
                <Tag className="aw-workbench-todo-status" color="processing">
                  {systemLabel(record.statusLabelKey, record.statusName ?? '') || t('fields.emptyValue')}
                </Tag>
                <EllipsisText tooltip={record.title} style={{ flex: '1 1 auto' }}>
                  <a onClick={() => navigate(`/workitems/${record.id}`)}>{record.title}</a>
                </EllipsisText>
                <a className="aw-workbench-todo-handle" onClick={() => navigate(`/workitems/${record.id}`)}>
                  {t('todo.handle')}
                </a>
                <span className="aw-workbench-todo-id">
                  {t('fields.idWithHash', { id: record.id })}
                  {external?.externalWorkitemId
                    ? t('fields.externalWithSeparator', {
                        provider: external.provider,
                        id: external.externalWorkitemId,
                      })
                    : ''}
                </span>
                <span className="aw-workbench-todo-reason">{reason}</span>
                <span className="aw-workbench-todo-updated">{formatUpdated(record.gmtModified)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {total > size ? (
        <Pagination
          className="aw-workbench-pagination"
          size="small"
          current={page}
          pageSize={size}
          total={total}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          showSizeChanger
          showQuickJumper
          showTotal={(count) => t('todo.count', { total: count })}
          onChange={(nextPage, nextSize) => {
            if (nextSize !== size) {
              setSize(nextSize);
              setPage(1);
              return;
            }
            setPage(nextPage);
          }}
        />
      ) : null}
    </Card>
  );
}

function AssigneeCell({ record, agentById }: { record: Workitem; agentById: Map<number, Agent> }) {
  const { t } = useTranslation('workbench');
  if (record.assigneeType === 'AGENT' && record.assigneeRef != null) {
    const agent = agentById.get(record.assigneeRef);
    const name = record.assigneeDisplayName || record.assigneeName || agent?.name || `#${record.assigneeRef}`;
    const squad = record.assigneeSquadName || agent?.squadNames?.[0] || null;
    return (
      <div className="aw-workbench-assignee">
        <span className="aw-workbench-assignee-line">
          <Avatar size={18} src={agent?.avatarUrl || undefined} icon={<RobotHeadIcon aria-hidden="true" />} />
          <EllipsisText tooltip={name}>{name}</EllipsisText>
        </span>
        {squad ? <span className="aw-workbench-assignee-squad" title={squad}>{squad}</span> : null}
      </div>
    );
  }
  if (record.assigneeType === 'HUMAN' && record.assigneeRef != null) {
    const name = record.assigneeDisplayName || record.assigneeName || `#${record.assigneeRef}`;
    return <EllipsisText tooltip={name}>{name}</EllipsisText>;
  }
  return <Typography.Text type="secondary">{t('fields.unassigned')}</Typography.Text>;
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
      <EllipsisText tooltip={record.title} lines={2}>
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
        ? { statusCategories: ACTIVE_CATEGORIES }
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
          <Tag color="processing">{systemLabel(record.statusLabelKey, record.statusName ?? '') || t('fields.emptyValue')}</Tag>
          <Tooltip title={t('following.changeStatus.action')}>
            <Button
              className="aw-workbench-status-change"
              type="text"
              size="small"
              icon={<SwapOutlined aria-hidden="true" />}
              aria-label={t('following.changeStatus.action')}
              loading={statusTransition.pendingId === record.id}
              onClick={() => statusTransition.open(record)}
            />
          </Tooltip>
        </div>
      ),
    },
    {
      title: t('following.columns.assignee'), key: 'assignee', width: 160, align: 'center',
      render: (_: unknown, record: Workitem) => <AssigneeCell record={record} agentById={agentById} />,
    },
    {
      title: t('following.columns.duration'), key: 'duration', width: 130, align: 'center',
      render: (_: unknown, record: Workitem) => <span>{durationText(record, now, translate)}</span>,
    },
    {
      title: t('following.columns.updated'), dataIndex: 'gmtModified', key: 'updated', width: 130, align: 'center',
      render: (value: string) => formatUpdated(value),
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
    <Card className="aw-workbench-card" title={t('following.title')}>
      <div className="aw-workbench-filters">
        <Segmented
          value={scope}
          onChange={(value) => { setScope(value as FollowingScope); resetPage(); }}
          options={[
            { value: 'ALL', label: t('following.tabs.all') },
            { value: 'CREATED', label: t('following.tabs.created') },
            { value: 'WATCHED', label: t('following.tabs.watched') },
            { value: 'COMMENTED', label: t('following.tabs.commented') },
          ]}
        />
        <Input
          className="aw-workbench-search"
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
          className="aw-workbench-filter-select"
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
          className="aw-workbench-filter-select"
          value={assignee}
          onChange={(value) => { setAssignee(value); resetPage(); }}
          options={assigneeOptions}
          showSearch
          optionFilterProp="label"
        />
      </div>
      <Table<Workitem>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rows}
        loading={listQuery.isLoading}
        pagination={false}
        scroll={{ x: 870 }}
        locale={{ emptyText: listQuery.isError ? t('following.loadFailed') : t('following.empty') }}
      />
      <div className="aw-workbench-table-footer">
        {listQuery.isError ? (
          <Button size="small" onClick={() => { void listQuery.refetch(); }}>{t('following.retry')}</Button>
        ) : null}
        <Pagination
          size="small"
          current={page}
          pageSize={size}
          total={total}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          showSizeChanger
          showQuickJumper
          showTotal={(count) => t('todo.count', { total: count })}
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
    </Card>
  );
}

function ActivitySection() {
  const { t } = useTranslation('workbench');
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['workbench', 'activity'],
    queryFn: () => listNotifications({ page: 1, size: 6 }),
    staleTime: 30_000,
  });
  const items: Notification[] = query.data?.items ?? [];

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
    <Card
      className="aw-workbench-card aw-workbench-activity"
      title={t('activity.title')}
      extra={<a onClick={() => navigate('/notifications')}>{t('activity.viewAll')}</a>}
    >
      {query.isLoading ? <Spin size="small" /> : items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('activity.empty')} />
      ) : (
        <ul className="aw-workbench-activity-list">
          {items.map((item) => (
            <li key={item.id} className="aw-workbench-activity-row" onClick={() => open(item)}>
              <div className="aw-workbench-activity-title">
                {item.status === NOTIFICATION_UNREAD ? <span className="aw-workbench-unread-dot" aria-label={t('activity.unread')} /> : null}
                <EllipsisText tooltip={item.title}>{item.title}</EllipsisText>
              </div>
              {item.content ? <div className="aw-workbench-activity-content">{item.content}</div> : null}
              <div className="aw-workbench-activity-time">{formatUpdated(item.gmtCreate)}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function WorkbenchPage() {
  const { t } = useTranslation('workbench');
  const user = useAuthStore((state) => state.user);
  const now = useNowTick();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="aw-workbench">
      <PageHeading
        title={t('title')}
        extra={(
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden="true" />}
            disabled={!user}
            onClick={() => setCreateOpen(true)}
          >
            {t('newWorkitem')}
          </Button>
        )}
      />
      <div className="aw-workbench-grid">
        <div className="aw-workbench-main">
          <TodoSection />
          <FollowingSection now={now} />
        </div>
        <div className="aw-workbench-side">
          <ActivitySection />
        </div>
      </div>
      <NewWorkitemModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
