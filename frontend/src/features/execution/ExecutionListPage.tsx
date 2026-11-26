import { useTranslation } from 'react-i18next';
import { useState, useRef, useCallback, useEffect } from 'react';
import { Button, Empty, Input, Segmented, Select } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Table } from '@/shared/theme/ThemedTable';
import { PageHead } from '@/shared/ui/PageHead';
import { Toolbar } from '@/shared/ui/Toolbar';
import { TableCard, TableFooter } from '@/shared/ui/TableCard';
import { StatusTag } from '@/shared/ui/StatusTag';
import { AiIdentity } from '@/shared/ui/AiIdentity';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import { formatDateTime } from '@/shared/i18n/format';
import { usePageSizePreference } from '@/shared/lib/usePageSizePreference';
import { useDispatches } from './hooks';
import { listAgents } from '@/features/agent/api';
import { statusMeta } from './statusMeta';
import type { ColumnsType } from 'antd/es/table';
import type { DispatchVO, DispatchTimeRange } from './types';
import { ExecutionDetailDrawer } from './components/ExecutionDetailDrawer';
import './ExecutionListPage.css';

const STATUS_OPTIONS = [
  'PENDING', 'PACKAGING', 'DISPATCHED', 'ACKED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMEOUT', 'CANCELED',
].map((s) => ({ label: s, value: s }));

// 原型 .time-cell：日期正文一行 + 时间微字一行（保留秒级精度，与既有行为一致）
const DATE_OPTIONS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };
const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false };

export function ExecutionListPage() {
  const { t } = useTranslation('execution');
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSizePreference('autowonder.executions.pageSize', [10, 20, 50, 100, 200], 10);
  const [status, setStatus] = useState<string | undefined>();
  const [agentId, setAgentId] = useState<number | undefined>();
  const [workitemId, setWorkitemId] = useState<number | undefined>();
  const [timeRange, setTimeRange] = useState<DispatchTimeRange>('30d');
  const [detailId, setDetailId] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const handleWorkitemIdChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    clearTimeout(debounceRef.current);
    const raw = e.target.value;
    debounceRef.current = setTimeout(() => {
      const n = Number(raw);
      setWorkitemId(raw && !Number.isNaN(n) ? n : undefined);
      setPage(1);
    }, 300);
  }, []);
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const { data, isFetching, refetch } = useDispatches({ page, pageSize, status, agentId, workitemId, timeRange });
  const { data: agents } = useQuery({ queryKey: ['agents-for-filter'], queryFn: () => listAgents({ page: 1, size: 200 }) });
  const total = data?.total ?? 0;

  const columns: ColumnsType<DispatchVO> = [
    {
      title: t('list.time'), dataIndex: 'gmtCreate', width: 160,
      render: (v: string) => (
        <div className="exec-time-cell">
          <span className="d">{formatDateTime(v, DATE_OPTIONS)}</span>
          <span className="t">{formatDateTime(v, TIME_OPTIONS)}</span>
        </div>
      ),
    },
    { title: t('list.workitem'), align: 'left', dataIndex: 'workitemTitle', ellipsis: { showTitle: false },
      render: (_: unknown, r) => r.workitemId && r.workitemTitle
        ? (
          <EllipsisText tooltip={r.workitemTitle}>
            <a className="exec-title-link" onClick={(e) => { e.stopPropagation(); navigate(`/workitems/${r.workitemId}`); }}>{r.workitemTitle}</a>
          </EllipsisText>
        )
        : '—' },
    { title: t('list.agent'), dataIndex: 'agentName', width: 120, render: (v: string | null) => <AiIdentity name={v} avatar icon size="sm" /> },
    { title: t('list.executor'), dataIndex: 'executorName', width: 130, render: (v: string | null) => <AiIdentity name={v} avatar size="sm" /> },
    { title: t('list.status'), dataIndex: 'status', width: 130,
      render: (s: string) => <StatusTag dot label={statusMeta(s).label} colorKey={statusMeta(s).color} /> },
    { title: t('list.attempt'), dataIndex: 'attempt', width: 70, render: (v: number | null) => v ?? '—' },
    { title: t('list.actions'), width: 80,
      render: (_: unknown, r) => <a onClick={(e) => { e.stopPropagation(); setDetailId(r.id); }}>{t('list.details')}</a> },
  ];

  return (
    <div className="executions-page">
      <PageHead
        title={t('list.title')}
        description={t('list.autoRefresh')}
      />
      <Toolbar
        right={<Button icon={<AwStrokeIcon name="refresh" />} onClick={() => refetch()}>{t('list.refresh')}</Button>}
        left={<>
          <Select allowClear aria-label={t('list.allAgents')} placeholder={t('list.allAgents')} style={{ width: 160 }} value={agentId}
            onChange={(v) => { setAgentId(v); setPage(1); }}
            options={(agents ?? []).map((a) => ({ label: a.name, value: a.id }))} />
          <Select allowClear aria-label={t('list.allStatuses')} placeholder={t('list.allStatuses')} style={{ width: 140 }} value={status}
            onChange={(v) => { setStatus(v); setPage(1); }} options={STATUS_OPTIONS.map(option => ({ ...option, label: statusMeta(option.value).label }))} />
          <Input allowClear aria-label={t('list.workitemId')} placeholder={t('list.workitemId')} style={{ width: 200 }}
            onChange={handleWorkitemIdChange} />
          <Segmented aria-label={t('list.rangeAria')} value={timeRange} onChange={(v) => { setTimeRange(v as DispatchTimeRange); setPage(1); }}
            options={[{ label: t('list.last7Days'), value: '7d' }, { label: t('list.last30Days'), value: '30d' }, { label: t('list.last90Days'), value: '90d' }]} />
        </>}
      />
      <TableCard
        flush
        className="aw-executions"
        footer={
          <TableFooter
            total={total}
            totalText={t('list.total', { count: total, total })}
            page={page}
            pageSize={pageSize}
            onPageChange={(p, ps) => { setPage(p); if (ps !== pageSize) setPageSize(ps); }}
            onPageSizeChange={setPageSize}
          />
        }
      >
        <Table<DispatchVO>
          rowKey="id"
          loading={isFetching}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('list.empty')} data-testid="executions-empty" /> }}
          columns={columns}
          dataSource={data?.list ?? []}
          onRow={(r) => ({ onClick: () => setDetailId(r.id) })}
          pagination={false}
        />
      </TableCard>
      <ExecutionDetailDrawer dispatchId={detailId} open={detailId != null} onClose={() => setDetailId(null)} />
    </div>
  );
}
