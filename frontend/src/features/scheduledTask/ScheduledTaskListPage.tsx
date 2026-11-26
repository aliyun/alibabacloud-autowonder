import { formatNumber } from '@/shared/i18n/format';
import { Trans, useTranslation } from 'react-i18next';
import { PageHead } from '@/shared/ui/PageHead';
import { Toolbar } from '@/shared/ui/Toolbar';
import { TableCard, TableFooter } from '@/shared/ui/TableCard';
import { StatusTag, type StatusColorKey } from '@/shared/ui/StatusTag';
import { TimeCell } from '@/shared/ui/TimeCell';
import { AiIdentity } from '@/shared/ui/AiIdentity';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useState } from 'react';
import { Button, Input, Popconfirm, Segmented, Select, Space, Tabs } from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import { CloseCircleFilled } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { useAuthStore } from '@/shared/auth/store';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { usePageSizePreference } from '@/shared/lib/usePageSizePreference';
import { listSquads } from '@/features/squad/api';
import { listAgents } from '@/features/agent/api';
import { useQuery, useQueries } from '@tanstack/react-query';
import { readViewPreference, writeViewPreference } from '@/shared/lib/viewPreference';
import { getScheduledTaskSummary, listScheduledTaskRuns } from './api';
import { useDeleteScheduledTask, useRunScheduledTaskNow, useScheduledTaskList } from './hooks';
import { RunStatusTag } from './components/RunStatusTag';
import { ScheduledWorkitemsPanel } from './ScheduledWorkitemsPanel';
import type { ScheduledTask, ScheduledTaskStatus } from './types';

/** 定时任务页的标签页：既有调度任务与新增的定时工单聚合。 */
type TabKey = 'tasks' | 'workitems';

const TAB_STORAGE_KEY = 'autowonder.scheduled-tasks.tab';
const TAB_KEYS: TabKey[] = ['tasks', 'workitems'];

function createRequestId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID() : `scheduled-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type TaskFilters = { status?: ScheduledTaskStatus; squadId?: number; keyword: string };

function ScheduledTasksPanel({ filters, onFiltersChange }: { filters: TaskFilters; onFiltersChange: (patch: Partial<TaskFilters>) => void }) {
  const { t } = useTranslation('scheduledTask');
  const { status, squadId, keyword } = filters;
  const STATUS_META: Record<ScheduledTaskStatus, { label: string; colorKey: StatusColorKey }> = {
    ACTIVE: { label: t('taskStatus.active'), colorKey: 'green' }, PAUSED: { label: t('taskStatus.paused'), colorKey: 'gray' },
    EXHAUSTED: { label: t('taskStatus.exhausted'), colorKey: 'amber' }, ARCHIVED: { label: t('taskStatus.archived'), colorKey: 'gray' },
  };
  const navigate = useNavigate();
  const accessCommand = useAccessCommand();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [scope, setScope] = useState('ALL');
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = usePageSizePreference('autowonder.scheduledTasks.pageSize', [10, 20, 50], 10);
  const { data, isLoading } = useScheduledTaskList({ creatorId: scope === 'CREATED' ? currentUserId : undefined, status, squadId, keyword: keyword || undefined, size: pageSize, offset });
  const runNow = useRunScheduledTaskNow();
  const removeTask = useDeleteScheduledTask();
  const tasks = data?.list ?? [];
  const { data: squads } = useQuery({ queryKey: ['squads', 'scheduled-task-list'], queryFn: () => listSquads({ pageNum: 1, pageSize: 100 }) });
  const { data: agents = [] } = useQuery({ queryKey: ['agents', 'scheduled-task-list'], queryFn: () => listAgents({ page: 1, size: 100 }) });
  const runQueries = useQueries({ queries: tasks.map((task) => ({ queryKey: ['scheduled-task-runs', task.id, 'latest'], queryFn: () => listScheduledTaskRuns(task.id, 1, 0) })) });
  const latestRunByTaskId = new Map(tasks.map((task, index) => [task.id, runQueries[index]?.data?.[0]]));
  const agentName = (id: number) => agents.find((agent) => agent.id === id)?.name || t('labels.agentId', { id });
  const columns: ColumnsType<ScheduledTask> = [
    { title: t('columns.name'), align: 'left', dataIndex: 'name', width: 260, render: (name: string, record) => (
      <div style={{ minWidth: 0 }}>
        <a onClick={() => navigate(`/scheduled-tasks/${record.id}`)}>{name}</a>
        {record.instructionMd?.trim() ? (
          <div title={record.instructionMd} style={{ fontSize: 11, color: 'var(--aw-text-3)', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
            {record.instructionMd.trim()}
          </div>
        ) : null}
      </div>
    ) },
    { title: t('columns.status'), dataIndex: 'status', width: 110, render: (value: ScheduledTaskStatus) => <StatusTag dot label={Object.prototype.hasOwnProperty.call(STATUS_META, value) ? STATUS_META[value].label : value} colorKey={Object.prototype.hasOwnProperty.call(STATUS_META, value) ? STATUS_META[value].colorKey : 'gray'} /> },
    { title: t('labels.agent'), width: 170, dataIndex: 'initialAgentId', render: (id: number) => <AiIdentity name={agentName(id)} avatar icon size="sm" /> },
    { title: t('columns.nextExecution'), dataIndex: 'nextFireAt', width: 130, render: (value: string | null) => <TimeCell value={value} /> },
    { title: t('columns.latestResult'), width: 170, render: (_, record) => { const run = latestRunByTaskId.get(record.id); return run ? <span style={{ display: 'inline-flex', alignItems: 'center' }}><RunStatusTag status={run.status} /><TimeCell value={run.finishedAt ?? run.startedAt ?? run.scheduledAt} inline /></span> : record.lastFireAt ? t('list.awaitingResult') : '-'; } },
    { title: t('columns.actions'), width: 100, render: (_, record) => <Space size={6}><Popconfirm title={t('confirm.runNow')} okText={t('actions.runNow')} cancelText={t('actions.cancel')} disabled={record.status !== 'ACTIVE'} onConfirm={() => accessCommand('READ_WRITE', t('commands.runNow'), () => runNow.mutate({ id: record.id, version: record.version, requestId: createRequestId() }))}><Button aria-label={t('actions.runNow')} size="small" type="text" className="aw-op-btn" icon={<AwStrokeIcon name="play" />} disabled={record.status !== 'ACTIVE'} loading={runNow.isPending} /></Popconfirm><Popconfirm title={t('confirm.deleteTask')} okText={t('actions.confirmDelete')} okButtonProps={{ danger: true }} cancelText={t('actions.cancel')} onConfirm={() => accessCommand('READ_WRITE', t('commands.deleteTask'), () => removeTask.mutate({ id: record.id, version: record.version }))}><Button aria-label={t('actions.delete')} size="small" type="text" className="aw-op-btn aw-op-btn--del" icon={<AwStrokeIcon name="trash" />} loading={removeTask.isPending} /></Popconfirm></Space> },
  ];
  const totalCount = data?.total ?? tasks.length;
  return (
    <>
      <Toolbar
        left={<>
          <Segmented aria-label={t('list.scopeAria')} options={[{ value: 'ALL', label: t('scope.all') }, { value: 'CREATED', label: t('scope.created'), disabled: currentUserId == null }]} value={scope} onChange={(value) => { setScope(value); setOffset(0); }} />
          <Input aria-label={t('list.keywordAria')} placeholder={t('list.searchPlaceholder')} prefix={<AwStrokeIcon name="search" />} onPressEnter={(event) => { onFiltersChange({ keyword: (event.target as HTMLInputElement).value }); setOffset(0); }} onChange={(event) => { if (!event.target.value) { onFiltersChange({ keyword: '' }); setOffset(0); } }} allowClear={{ clearIcon: <CloseCircleFilled aria-label={t('actions.clearTaskSearch')} /> }} style={{ width: 220 }} />
          <Select aria-label={t('list.squadFilter')} allowClear placeholder={t('list.squadFilter')} style={{ width: 150 }} value={squadId} onChange={(value) => { onFiltersChange({ squadId: value }); setOffset(0); }} options={(squads?.list ?? []).map((squad) => ({ value: squad.id, label: squad.name }))} />
          <Select aria-label={t('list.statusFilter')} allowClear placeholder={t('list.statusFilter')} style={{ width: 130 }} value={status} onChange={(value) => { onFiltersChange({ status: value }); setOffset(0); }} options={Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))} />
        </>}
        right={<Button type="primary" icon={<AwStrokeIcon name="plus" />} onClick={() => accessCommand('READ_WRITE', t('create.title'), () => navigate('/scheduled-tasks/new'))}>{t('actions.newTask')}</Button>}
      />
      <TableCard
        flush
        className="aw-scheduled-list"
        footer={
          <TableFooter
            total={totalCount}
            page={Math.floor(offset / pageSize) + 1}
            pageSize={pageSize}
            totalText={t('list.totalRows', { count: totalCount, total: formatNumber(totalCount) })}
            onPageChange={(page, nextSize) => { setOffset((page - 1) * nextSize); if (nextSize !== pageSize) { setPageSize(nextSize); setOffset(0); } }}
            onPageSizeChange={setPageSize}
          />
        }
      >
        <Table rowKey="id" columns={columns} dataSource={tasks} loading={isLoading} pagination={false} />
      </TableCard>
    </>
  );
}

export function ScheduledTaskListPage() {
  const { t } = useTranslation('scheduledTask');
  const [activeKey, setActiveKey] = useState<TabKey>(() => readViewPreference(TAB_STORAGE_KEY, TAB_KEYS, 'tasks'));
  const [filters, setFilters] = useState<TaskFilters>({ keyword: '' });
  const { status, squadId, keyword } = filters;
  const { data: summary = { running: 0, today: 0, success30d: 0, completed30d: 0, attention: 0 } } = useQuery({ queryKey: ['scheduled-tasks', 'summary', status, squadId, keyword], queryFn: () => getScheduledTaskSummary({ status, squadId, keyword: keyword || undefined }) });
  const successRate = summary.completed30d ? Math.round(summary.success30d * 100 / summary.completed30d) : 0;
  return (
    <>
      <PageHead
        title={t('list.tasksTitle')}
        description={
          <Space wrap size={14} aria-label={t('list.summaryAria')} title={t('list.summaryScope')}>
            <span className="aw-sum-badge b-ok"><Trans t={t} ns="scheduledTask" i18nKey="list.runningCount" count={summary.running ?? 0} values={{ total: summary.running == null ? '—' : formatNumber(summary.running) }} components={{ number: <b /> }} /></span>
            <span className="aw-sum-badge"><Trans t={t} ns="scheduledTask" i18nKey="list.todayCount" count={summary.today ?? 0} values={{ total: summary.today == null ? '—' : formatNumber(summary.today) }} components={{ number: <b /> }} /></span>
            <span className="aw-sum-badge b-ok"><Trans t={t} ns="scheduledTask" i18nKey="list.successRate" values={{ rate: formatNumber(successRate), success: summary.success30d == null ? '—' : formatNumber(summary.success30d), completed: summary.completed30d == null ? '—' : formatNumber(summary.completed30d) }} components={{ rate: <b />, success: <b />, completed: <b /> }} /></span>
            <span className="aw-sum-badge b-warn"><Trans t={t} ns="scheduledTask" i18nKey="list.attentionCount" count={summary.attention ?? 0} values={{ total: summary.attention == null ? '—' : formatNumber(summary.attention) }} components={{ number: <b /> }} /></span>
          </Space>
        }
      />
      <Tabs
        className="aw-list-tabs"
        activeKey={activeKey}
        onChange={(key) => {
          const next = key as TabKey;
          setActiveKey(next);
          writeViewPreference(TAB_STORAGE_KEY, next);
        }}
        items={[
          { key: 'tasks', label: t('list.tasksTab'), children: <ScheduledTasksPanel filters={filters} onFiltersChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))} /> },
          { key: 'workitems', label: t('list.workitemsTitle'), children: <ScheduledWorkitemsPanel /> },
        ]}
      />
    </>
  );
}
