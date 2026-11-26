import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Segmented, Space, Tooltip } from 'antd';
import { CloseCircleFilled, LoadingOutlined } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { Table } from '@/shared/theme/ThemedTable';
import { PageHead } from '@/shared/ui/PageHead';
import { SectionCard } from '@/shared/ui/SectionCard';
import { TableFooter } from '@/shared/ui/TableCard';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import { TimeCell } from '@/shared/ui/TimeCell';
import { StatusTag, type StatusColorKey } from '@/shared/ui/StatusTag';
import { formatNumber } from '@/shared/i18n/format';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import { getPriorityMeta, STATUS_CATEGORY_TAG_COLOR, statusCategoryOf } from '@/features/workitem/constants';
import { Sparkline } from '@/features/insights/components/Sparkline';
import { useCreatedWorkitems, useDeliveryOverview, usePendingWorkitems } from './hooks';
import type { CreatedWorkitem, PendingWorkitem } from './types';
import './DeliveryOverviewPage.css';

/** 与后端 daysInRange / 上一等长周期口径一致：含首尾。 */
const RANGE_DAYS = { week: 7, month: 30 } as const;
const TIMEZONE = 'Asia/Shanghai';
/** 表格卡为整行卡；固定列留足标签与两行时间的呼吸空间，标题列独占剩余宽度。 */
const COLUMN_WIDTH = { id: 60, status: 116, priority: 88, reason: 112, time: 124 } as const;

/** 缺失数据时的占位符，语言无关。 */
const MISSING = '—';

const REASON_KEYS = {
  AWAITING_DECISION: 'pending.reasonAWAITING_DECISION',
  AWAITING_HANDLING: 'pending.reasonAWAITING_HANDLING',
  IN_PROGRESS: 'pending.reasonIN_PROGRESS',
} as const;

/** priorityMap 的 antd 色名 → StatusTag 色板键。 */
const PRIORITY_TAG_COLOR: Record<string, StatusColorKey> = {
  red: 'red', orange: 'amber', blue: 'blue', default: 'gray',
};

function reasonKey(value: string): (typeof REASON_KEYS)[keyof typeof REASON_KEYS] | 'pending.reasonUnknown' {
  return Object.prototype.hasOwnProperty.call(REASON_KEYS, value)
    ? REASON_KEYS[value as keyof typeof REASON_KEYS]
    : 'pending.reasonUnknown';
}

function percent(value: number) {
  return `${value > 0 ? '+' : ''}${formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function today() {
  return dayjs(new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
}

function createdStatusColor(category: string | null): StatusColorKey {
  if (category === 'DONE') return 'green';
  if (category === 'CANCELED') return 'gray';
  return 'blue';
}

function renderId(id: number) {
  return <span style={{ fontFamily: 'var(--aw-font-mono)', fontSize: 11, color: 'var(--aw-text-3)', fontVariantNumeric: 'tabular-nums' }}>{id}</span>;
}

export function DeliveryOverviewPage() {
  const { t } = useTranslation('overview');
  const systemLabel = useSystemLabel();
  const navigate = useNavigate();
  const [rangeKey, setRangeKey] = useState<'week' | 'month'>('week');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [createdPage, setCreatedPage] = useState(1);
  const [createdPageSize, setCreatedPageSize] = useState(10);
  const days = RANGE_DAYS[rangeKey];
  const { start, end } = useMemo(() => {
    const endDay = today();
    return { start: endDay.subtract(days - 1, 'day').format('YYYY-MM-DD'), end: endDay.format('YYYY-MM-DD') };
  }, [days]);

  const overviewQuery = useDeliveryOverview(start, end);
  const pendingQuery = usePendingWorkitems(page, pageSize);
  const createdQuery = useCreatedWorkitems(start, end, createdPage, createdPageSize);
  const data = overviewQuery.data;
  const pendingPage = pendingQuery.data;
  const createdPageData = createdQuery.data;
  const createdTrend = (data?.created.daily ?? []).map((day) => day.count);
  const deliveredTrend = (data?.delivered.daily ?? []).map((day) => day.count);
  const rangeLabel = t(rangeKey === 'week' ? 'toolbar.lastWeek' : 'toolbar.lastMonth');
  const refresh = () => {
    void overviewQuery.refetch();
    void pendingQuery.refetch();
    void createdQuery.refetch();
  };

  const columns: ColumnsType<PendingWorkitem> = [
    {
      title: t('pending.workitem'), dataIndex: 'id', width: COLUMN_WIDTH.id, align: 'left',
      render: renderId,
    },
    {
      title: t('pending.name'), dataIndex: 'title', align: 'left', className: 'overview-title-cell', ellipsis: { showTitle: false },
      render: (title: string, record: PendingWorkitem) => (
        <EllipsisText tooltip={title}>
          <a onClick={(event) => { event.stopPropagation(); navigate(`/workitems/${record.id}`); }}>{title}</a>
        </EllipsisText>
      ),
    },
    {
      title: t('pending.status'), dataIndex: 'statusName', width: COLUMN_WIDTH.status,
      render: (name: string | null, record: PendingWorkitem) => {
        if (!name) return MISSING;
        const label = systemLabel(record.statusLabelKey, name);
        return (
          <Tooltip title={label} trigger={['hover', 'focus']}>
            <StatusTag label={label} colorKey={STATUS_CATEGORY_TAG_COLOR[statusCategoryOf(record)] ?? 'gray'} dot tabIndex={0} className="overview-cell-tag" />
          </Tooltip>
        );
      },
    },
    {
      title: t('pending.priority'), dataIndex: 'priority', width: COLUMN_WIDTH.priority,
      render: (priority: number) => {
        const meta = getPriorityMeta(priority);
        return (
          <Tooltip title={meta.label} trigger={['hover', 'focus']}>
            <StatusTag label={meta.label} colorKey={PRIORITY_TAG_COLOR[meta.color] ?? 'gray'} tabIndex={0} className="overview-cell-tag" />
          </Tooltip>
        );
      },
    },
    {
      title: t('pending.reason'), dataIndex: 'reason', width: COLUMN_WIDTH.reason,
      render: (reason: string) => (
        <Tooltip title={t(reasonKey(reason))} trigger={['hover', 'focus']}>
          <span className="overview-reason" tabIndex={0}>{t(reasonKey(reason))}</span>
        </Tooltip>
      ),
    },
    {
      title: t('pending.updatedAt'), dataIndex: 'gmtModified', width: COLUMN_WIDTH.time, className: 'overview-time-cell',
      render: (value: string) => <TimeCell value={value} />,
    },
  ];

  const createdColumns: ColumnsType<CreatedWorkitem> = [
    {
      title: t('createdList.workitem'), dataIndex: 'id', width: COLUMN_WIDTH.id, align: 'left',
      render: renderId,
    },
    {
      title: t('createdList.name'), dataIndex: 'title', align: 'left', className: 'overview-title-cell', ellipsis: { showTitle: false },
      render: (title: string, record: CreatedWorkitem) => (
        <EllipsisText tooltip={title}>
          <a onClick={(event) => { event.stopPropagation(); navigate(`/workitems/${record.id}`); }}>{title}</a>
        </EllipsisText>
      ),
    },
    {
      title: t('createdList.status'), dataIndex: 'statusName', width: COLUMN_WIDTH.status,
      render: (name: string | null, record: CreatedWorkitem) => {
        if (!name) return MISSING;
        const label = systemLabel(record.statusLabelKey, name);
        return (
          <Tooltip title={label} trigger={['hover', 'focus']}>
            <StatusTag label={label} colorKey={createdStatusColor(record.statusCategory)} dot tabIndex={0} className="overview-cell-tag" />
          </Tooltip>
        );
      },
    },
    {
      title: t('createdList.priority'), dataIndex: 'priority', width: COLUMN_WIDTH.priority,
      render: (priority: number) => {
        const meta = getPriorityMeta(priority);
        return (
          <Tooltip title={meta.label} trigger={['hover', 'focus']}>
            <StatusTag label={meta.label} colorKey={PRIORITY_TAG_COLOR[meta.color] ?? 'gray'} tabIndex={0} className="overview-cell-tag" />
          </Tooltip>
        );
      },
    },
    {
      title: t('createdList.createdAt'), dataIndex: 'createdAt', width: COLUMN_WIDTH.time, className: 'overview-time-cell',
      render: (value: string) => <TimeCell value={value} />,
    },
  ];

  return (
    <div className="delivery-overview-page">
      <PageHead title={t('title')} description={t('description')} />

      <SectionCard data-testid="overview-pending" className="overview-table-card" title={t('pending.title')}>
        {pendingQuery.isError && (
          <div className="overview-card-note">
            <Alert
              type="error" showIcon icon={<CloseCircleFilled aria-hidden="true" />} message={t('pending.loadFailure')}
              action={<Button size="small" onClick={() => { void pendingQuery.refetch(); }}>{t('pending.retry')}</Button>}
            />
          </div>
        )}
        <Table<PendingWorkitem>
          rowKey="id"
          dataSource={pendingPage?.list ?? []}
          loading={pendingQuery.isLoading}
          columns={columns}
          tableLayout="fixed"
          rowClassName={(record) => record.statusCategory === 'PENDING_DECISION' ? 'overview-row-decision' : ''}
          onRow={(record) => ({ onClick: () => navigate(`/workitems/${record.id}`), style: { cursor: 'pointer' } })}
          locale={{ emptyText: pendingQuery.isLoading ? t('pending.loading') : pendingQuery.isError ? t('pending.loadFailure') : t('pending.empty') }}
          pagination={false}
        />
        <TableFooter
          total={pendingPage?.total ?? 0}
          page={page}
          pageSize={pageSize}
          totalText={t('pending.total', { count: pendingPage?.total ?? 0 })}
          onPageChange={(nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); }}
        />
      </SectionCard>

      <hr className="overview-section-divider" />

      <div className="overview-meta-strip">
        <Segmented
          aria-label={t('toolbar.rangeAria')}
          value={rangeKey}
          onChange={(value) => { setRangeKey(value as 'week' | 'month'); setPage(1); setCreatedPage(1); }}
          options={[
            { label: t('toolbar.lastWeek'), value: 'week' },
            { label: t('toolbar.lastMonth'), value: 'month' },
          ]}
        />
        <span>{t('toolbar.rangeSummary', { start, end })}</span>
        <span>{t('toolbar.timezone', { timezone: data?.timezone ?? TIMEZONE })}</span>
        {data && <span>{t('toolbar.dataThrough', { date: data.dataThrough })}</span>}
        <Button
          className="overview-refresh-btn"
          size="small"
          icon={<AwStrokeIcon name="refresh" size={14} />}
          aria-label={t('toolbar.refreshAria')}
          loading={overviewQuery.isFetching || pendingQuery.isFetching || createdQuery.isFetching ? { icon: <LoadingOutlined aria-hidden="true" /> } : false}
          onClick={refresh}
        >{t('toolbar.refresh')}</Button>
      </div>

      {overviewQuery.isError && (
        <Alert
          type="error" showIcon icon={<CloseCircleFilled aria-hidden="true" />} message={t('toolbar.loadFailure')}
          action={<Button size="small" onClick={() => { void overviewQuery.refetch(); }}>{t('toolbar.retry')}</Button>}
        />
      )}

      <div className="overview-stats">
        <div data-testid="overview-created" className="aw-card aw-stat-card overview-stat-card">
          <div className="aw-stat-label">{t('created.title')}</div>
          <div className="aw-stat-value">{data ? formatNumber(data.created.count) : MISSING}</div>
          <span className="overview-sparkline" role="img" aria-label={t('created.trendAria', { days: data?.daysInRange ?? days })}>
            <Sparkline data={createdTrend} color="var(--aw-accent)" width={320} height={36} />
          </span>
          <div className="aw-stat-foot">
            <span>{t('created.caption', { days: data?.daysInRange ?? days })}</span>
          </div>
        </div>
        <div data-testid="overview-delivered" className="aw-card aw-stat-card overview-stat-card">
          <div className="aw-stat-label">
            <Space size={6}>{t('delivered.title')}
              <Tooltip title={t('delivered.method')} trigger={['hover', 'focus']} styles={{ root: { maxWidth: 420 } }}>
                <Button type="text" size="small" aria-label={t('delivered.methodAria')} icon={<AwStrokeIcon name="info" />} style={{ color: 'var(--aw-text-3)' }} />
              </Tooltip>
            </Space>
          </div>
          <div className="aw-stat-value">{data ? formatNumber(data.delivered.count) : MISSING}</div>
          <span className="overview-sparkline" role="img" aria-label={t('delivered.trendAria', { days: data?.daysInRange ?? days })}>
            <Sparkline data={deliveredTrend} color="var(--aw-success)" width={320} height={36} />
          </span>
          {data && <div className="aw-stat-foot">
            <span>{t('delivered.dailyAverage', { value: formatNumber(data.delivered.dailyAverage, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span>
            <span>{data.delivered.changePercent != null ? t('delivered.change', { value: percent(data.delivered.changePercent) }) : t('delivered.noBase')}</span>
            <span>{t('delivered.previous', { count: data.delivered.previous.count, start: data.delivered.previous.startDate, end: data.delivered.previous.endDate })}</span>
            <span>{t('delivered.caption')}</span>
          </div>}
        </div>
      </div>

      <SectionCard data-testid="overview-created-list" className="overview-table-card"
        title={t('createdList.title', { range: rangeLabel })}>
        {createdQuery.isError && (
          <div className="overview-card-note">
            <Alert
              type="error" showIcon icon={<CloseCircleFilled aria-hidden="true" />} message={t('createdList.loadFailure')}
              action={<Button size="small" onClick={() => { void createdQuery.refetch(); }}>{t('createdList.retry')}</Button>}
            />
          </div>
        )}
        <Table<CreatedWorkitem>
          rowKey="id"
          dataSource={createdPageData?.list ?? []}
          loading={createdQuery.isLoading}
          columns={createdColumns}
          tableLayout="fixed"
          onRow={(record) => ({ onClick: () => navigate(`/workitems/${record.id}`), style: { cursor: 'pointer' } })}
          locale={{ emptyText: createdQuery.isLoading ? t('createdList.loading') : createdQuery.isError ? t('createdList.loadFailure') : t('createdList.empty') }}
          pagination={false}
        />
        <TableFooter
          total={createdPageData?.total ?? 0}
          page={createdPage}
          pageSize={createdPageSize}
          totalText={t('createdList.total', { count: createdPageData?.total ?? 0 })}
          onPageChange={(nextPage, nextPageSize) => { setCreatedPage(nextPage); setCreatedPageSize(nextPageSize); }}
        />
      </SectionCard>
    </div>
  );
}
