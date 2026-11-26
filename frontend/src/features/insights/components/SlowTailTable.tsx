import { useTranslation } from 'react-i18next';
import { formatDateTime, formatNumber } from '@/shared/i18n/format';
import { Alert, Button, Card, Empty } from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import type { ColumnsType } from 'antd/es/table';
import { useHumanAgentSlowTail } from '../hooks';
import { formatDuration, formatDurationCompact } from '@/shared/lib/duration';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import type { P90Workitem } from '../types';

const timeOptions: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };

interface SlowTailTableProps {
  startDate: string;
  endDate: string;
  workType: string;
  /** 累计负责时长；缺省时只隐藏占比摘要。 */
  cumulativeSeconds?: number;
}

function humanRatio(item: P90Workitem): number {
  const total = item.humanDurationSeconds + item.agentDurationSeconds;
  if (total === 0) return 0;
  return item.humanDurationSeconds / total;
}

export function SlowTailTable({ startDate, endDate, workType, cumulativeSeconds }: SlowTailTableProps) {
  const { t } = useTranslation('insights');
  const { data, isLoading, isError, refetch } = useHumanAgentSlowTail(startDate, endDate, workType);
  const items = [...(data?.items ?? [])].sort((left, right) => right.totalDurationSeconds - left.totalDurationSeconds);
  const maxDuration = items.reduce((max, item) => Math.max(max, item.totalDurationSeconds), 0);
  const totalSeconds = items.reduce((sum, item) => sum + item.totalDurationSeconds, 0);
  const share = cumulativeSeconds && cumulativeSeconds > 0 ? totalSeconds / cumulativeSeconds * 100 : null;
  const second = items[1]?.totalDurationSeconds ?? 0;
  const ratio = items.length > 1 && second > 0 ? items[0].totalDurationSeconds / second : null;

  const columns: ColumnsType<P90Workitem> = [
    {
      title: t('slowTail.workitem'),
      key: 'workitem',
      render: (_: unknown, record: P90Workitem) => (
        <span className="participation-slow-tail-item">
          <a className="participation-slow-tail-id" href={`/workitems/${record.workitemId}`}>#{record.workitemId}</a>
          <span className="participation-slow-tail-name"><EllipsisText>{record.title}</EllipsisText></span>
        </span>
      ),
    },
    {
      title: t('slowTail.responsibility'),
      key: 'responsibility',
      width: 156,
      render: (_: unknown, record: P90Workitem) => {
        if (record.humanDurationSeconds + record.agentDurationSeconds === 0) return '—';
        const humanPercent = Math.round(humanRatio(record) * 100);
        const agentPercent = 100 - humanPercent;
        const human = <span className="is-human">{t('series.human')} <b>{t('slowTail.percentValue', { value: humanPercent })}</b></span>;
        const agent = <span className="is-agent">{t('series.agent')} <b>{t('slowTail.percentValue', { value: agentPercent })}</b></span>;
        return <span className="participation-slow-tail-phase"
          title={t('slowTail.responsibilityDetail', {
            human: formatDuration(record.humanDurationSeconds),
            agent: formatDuration(record.agentDurationSeconds),
          })}>
          {humanPercent >= agentPercent ? <>{human}<span className="is-sep" aria-hidden="true">{t('slowTail.stageSeparator')}</span>{agent}</> : <>{agent}<span className="is-sep" aria-hidden="true">{t('slowTail.stageSeparator')}</span>{human}</>}
        </span>;
      },
    },
    {
      title: t('slowTail.totalDuration'),
      dataIndex: 'totalDurationSeconds',
      width: 260,
      render: (value: number) => (
        <span className="participation-slow-tail-duration">
          <span className="participation-slow-tail-bar" aria-hidden="true">
            <i style={{ width: `${maxDuration > 0 ? value / maxDuration * 100 : 0}%` }} />
          </span>
          <span className="participation-slow-tail-hours">{formatDurationCompact(value)}</span>
        </span>
      ),
    },
    {
      title: t('slowTail.completedAt'),
      dataIndex: 'completedAt',
      width: 116,
      render: (value: string) => <span className="participation-slow-tail-hours">{formatDateTime(value, timeOptions)}</span>,
    },
  ];

  const title = <span className="participation-slow-tail-title">
    <span>{t('participation.slowTail')}</span>
    <span className="participation-chip participation-chip--specific">{t('participation.topTen')}</span>
    {items.length > 0 && <span className="participation-slow-tail-summary">
      <span>{t('slowTail.summaryTotal', { hours: formatNumber(Math.round(totalSeconds / 3600)) })}</span>
      {share != null && <span>{t('slowTail.summaryShare', { share: share.toFixed(1) })}</span>}
      {ratio != null && <span>{t('slowTail.summaryLongest', { id: items[0].workitemId, ratio: ratio.toFixed(1) })}</span>}
    </span>}
  </span>;

  return (
    <Card className="participation-slow-tail" title={title}>
      {isError
        ? <Alert type="error" showIcon message={t('slowTail.loadFailure')} action={<Button onClick={() => { void refetch(); }}>{t('participation.retry')}</Button>} />
        : <>
          <Table<P90Workitem>
            className="participation-slow-tail-table"
            tableLayout="fixed"
            columns={columns}
            dataSource={items}
            scroll={{ x: 760 }}
            locale={{ emptyText: isLoading ? t('slowTail.loading') : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('slowTail.empty')} /> }}
            rowKey="workitemId"
            size="small"
            loading={isLoading}
            pagination={false}
          />
          {items.length > 0 && <p className="participation-slow-tail-note">{t('slowTail.note')}</p>}
        </>}
    </Card>
  );
}
