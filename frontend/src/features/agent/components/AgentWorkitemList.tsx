import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import { Empty, Segmented } from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import { listWorkitems } from '@/features/workitem/api';
import { workTypeMap, getPriorityMeta, STATUS_CATEGORY_TAG_COLOR, statusCategoryOf } from '@/features/workitem/constants';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import { StatusTag, type StatusColorKey } from '@/shared/ui/StatusTag';
import { TimeCell } from '@/shared/ui/TimeCell';
import { TableCard, TableFooter } from '@/shared/ui/TableCard';
import { Toolbar } from '@/shared/ui/Toolbar';
import { usePageSizePreference } from '@/shared/lib/usePageSizePreference';
import type { Workitem } from '@/shared/types/workitem';

interface AgentWorkitemListProps {
  agentId: number;
}

type FilterKey = 'ALL' | 'IN_PROGRESS' | 'PENDING_DECISION' | 'DONE';

const PAGE_SIZE_STORAGE_KEY = 'autowonder.agentDetail.workitems.pageSize';

/** priorityMap 的 antd 色名 → StatusTag 色板键（与工单列表页一致）。 */
export const PRIORITY_TAG_COLOR: Record<string, StatusColorKey> = {
  red: 'red', orange: 'amber', blue: 'blue', default: 'gray',
};

/** 缺失值的占位符，语言无关。 */
const MISSING = '-';

/** 服务端分页查询该数字员工名下的工单（与工单列表页同一接口），筛选也下推到服务端。 */
function useAgentWorkitemPage(agentId: number, page: number, size: number, filter: FilterKey) {
  return useQuery({
    queryKey: ['agent', agentId, 'workitems', page, size, filter],
    queryFn: () => listWorkitems({
      page,
      size,
      assigneeType: 'AGENT',
      assigneeRef: agentId,
      statusCategory: filter === 'ALL' ? undefined : filter,
    }),
    enabled: agentId > 0,
  });
}

/** 各筛选项的总数：size=1 只取 total，与看板每列独立查询同一模式。 */
function useAgentWorkitemCounts(agentId: number) {
  const all = useQuery({
    queryKey: ['agent', agentId, 'workitems', 'count', 'ALL'],
    queryFn: () => listWorkitems({ page: 1, size: 1, assigneeType: 'AGENT', assigneeRef: agentId }),
    enabled: agentId > 0,
  });
  const inProgress = useQuery({
    queryKey: ['agent', agentId, 'workitems', 'count', 'IN_PROGRESS'],
    queryFn: () => listWorkitems({ page: 1, size: 1, assigneeType: 'AGENT', assigneeRef: agentId, statusCategory: 'IN_PROGRESS' }),
    enabled: agentId > 0,
  });
  const pending = useQuery({
    queryKey: ['agent', agentId, 'workitems', 'count', 'PENDING_DECISION'],
    queryFn: () => listWorkitems({ page: 1, size: 1, assigneeType: 'AGENT', assigneeRef: agentId, statusCategory: 'PENDING_DECISION' }),
    enabled: agentId > 0,
  });
  const done = useQuery({
    queryKey: ['agent', agentId, 'workitems', 'count', 'DONE'],
    queryFn: () => listWorkitems({ page: 1, size: 1, assigneeType: 'AGENT', assigneeRef: agentId, statusCategory: 'DONE' }),
    enabled: agentId > 0,
  });
  return {
    ALL: all.data?.total ?? 0,
    IN_PROGRESS: inProgress.data?.total ?? 0,
    PENDING_DECISION: pending.data?.total ?? 0,
    DONE: done.data?.total ?? 0,
  };
}

export function AgentWorkitemList({ agentId }: AgentWorkitemListProps) {
  const { t } = useTranslation('workitem');
  const systemLabel = useSystemLabel();
  const filters: { key: FilterKey; label: string }[] = [
    { key: 'ALL', label: t('scope.all') },
    { key: 'IN_PROGRESS', label: t('status.inProgress') },
    { key: 'PENDING_DECISION', label: t('status.pendingDecision') },
    { key: 'DONE', label: t('status.done') },
  ];
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSizePreference(PAGE_SIZE_STORAGE_KEY, [10, 20, 50, 100], 10);
  const counts = useAgentWorkitemCounts(agentId);
  const { data, isLoading } = useAgentWorkitemPage(agentId, page, size, filter);
  const workitems = useMemo(() => data?.list ?? [], [data]);
  const total = data?.total ?? 0;

  const columns: ColumnsType<Workitem> = [
    {
      title: t('fields.type'), dataIndex: 'workType', width: 80,
      render: (type: string) => {
        const meta = workTypeMap[type];
        return <StatusTag label={meta?.label ?? type} colorKey={(meta?.color ?? 'gray') as StatusColorKey} />;
      },
    },
    {
      title: t('fields.title'), dataIndex: 'title', align: 'left', ellipsis: { showTitle: false },
      render: (title: string, r: Workitem) => (
        <EllipsisText tooltip={title}>
          <Link to={`/workitems/${r.id}`}>{title}</Link>
        </EllipsisText>
      ),
    },
    {
      title: t('fields.status'), dataIndex: 'statusName', width: 120,
      render: (s: string | null, r: Workitem) => (
        <StatusTag label={s ? systemLabel(r.statusLabelKey, s) : MISSING} colorKey={STATUS_CATEGORY_TAG_COLOR[statusCategoryOf(r)] ?? 'gray'} dot />
      ),
    },
    {
      title: t('fields.priority'), dataIndex: 'priority', width: 90,
      render: (p: number) => {
        const meta = getPriorityMeta(p);
        return <StatusTag label={meta.label} colorKey={PRIORITY_TAG_COLOR[meta.color] ?? 'gray'} />;
      },
    },
    {
      title: 'SDLC', dataIndex: 'sdlcName', width: 140, ellipsis: { showTitle: false },
      render: (n: string | null) => <EllipsisText tooltip={n ?? undefined}>{n || '-'}</EllipsisText>,
    },
    {
      title: t('fields.updated'), dataIndex: 'gmtModified', width: 120,
      render: (value: string) => <TimeCell value={value} />,
    },
  ];

  return (
    // 原型 13 任务列表 Tab：筛选行 + 表格 + 分页直接落在内容框，不套卡片
    <TableCard
      flush
      className="aw-agent-tab-table"
      footer={
        <TableFooter
          total={total}
          page={page}
          pageSize={size}
          totalText={t('list.pagination', { count: total })}
          onPageChange={(nextPage, nextSize) => {
            setPage(nextPage);
            if (nextSize !== size) setSize(nextSize);
          }}
          onPageSizeChange={setSize}
        />
      }
    >
      <Toolbar
        inCard
        left={
          <Segmented
            aria-label={t('agentList.filterAria')}
            value={filter}
            onChange={(v) => { setFilter(v as FilterKey); setPage(1); }}
            options={filters.map(f => ({ value: f.key, label: t('agentList.filterCount', { label: f.label, count: counts[f.key] }) }))}
          />
        }
      />
      <Table
        rowKey={(r) => String(r.id)}
        columns={columns}
        dataSource={workitems}
        loading={isLoading}
        pagination={false}
        locale={{ emptyText: <Empty description={t('agentList.empty')} /> }}
      />
    </TableCard>
  );
}
