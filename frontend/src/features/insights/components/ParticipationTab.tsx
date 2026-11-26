import { Trans, useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { formatDateTime, formatNumber } from '@/shared/i18n/format';
import type { ReactNode } from 'react';
import { Spin, Empty, Card, Statistic, Button, Modal, Tooltip, message, Select } from 'antd';
import { ExclamationCircleFilled } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { TimeRangePicker } from '@/shared/ui/TimeRangePicker';
import { useHumanAgentParticipation, useForceRefreshParticipation } from '../hooks';
import { formatDuration } from '@/shared/lib/duration';
import { ParticipationDailyChart, ParticipationDistribution, ParticipationRatioTrend, cumulativeDurations } from './ParticipationPanels';
import { SlowTailTable } from './SlowTailTable';
import { StatValue } from './StatValue';
import { useInsightDateRange, useInsightWorkType, type InsightWorkType } from '../useInsightPreference';
import { ErrorCodes } from '@/shared/types/common';


function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

function defaultDateRange(): [Dayjs, Dayjs] {
  const end = dayjs().subtract(1, 'day');
  const start = end.subtract(29, 'day');
  return [start, end];
}

export function ParticipationTab() {
  const { t } = useTranslation('insights');
  const [dateRange, setDateRange] = useInsightDateRange('participation.dates', defaultDateRange, 181, dayjs(), dayjs().subtract(180, 'day'));
  const [workType, setWorkType] = useInsightWorkType();

  const startDate = dateRange[0].format('YYYY-MM-DD');
  const endDate = dateRange[1].format('YYYY-MM-DD');
  const { data, isLoading, isError, isFetching, refetch } = useHumanAgentParticipation(startDate, endDate, workType);
  const workTypeOptions: { value: InsightWorkType; label: string }[] = [
    { value: 'ALL', label: t('participation.workTypeAll') },
    { value: 'REQ', label: t('participation.workTypeReq') },
    { value: 'BUG', label: t('participation.workTypeBug') },
    { value: 'TASK', label: t('participation.workTypeTask') },
  ];
  const forceRefresh = useForceRefreshParticipation();
  const hasSamples = !!data?.sampleSize;
  const trend = data?.trend ?? [];
  const cumulative = cumulativeDurations(trend);
  const agentDurationShare = cumulative.total > 0 ? cumulative.agent / cumulative.total : null;
  const participationShare = data?.agentWorkitemCount != null && data.sampleSize
    ? data.agentWorkitemCount / data.sampleSize * 100
    : null;
  const meanMedianRatio = data?.average && data.medianTotalSeconds
    ? data.average.totalDurationSeconds / data.medianTotalSeconds
    : null;
  const trendHasSamples = trend.some(row => (row.sampleSize ?? (row.averageTotalSeconds > 0 ? 1 : 0)) > 0);
  const scopeTip = <>
    <p>{t('participation.scopeLifecycle')}</p>
    <p>{t('participation.scopeWeight')}</p>
    <p>{t('participation.scopeSharedSource')}</p>
    <p>{data?.sampleSize != null ? t('participation.scopeRecords', { identified: data.identifiedCompletedCount ?? '—', count: data.sampleSize }) : t('participation.scopeRecordsUnavailable', { identified: data?.identifiedCompletedCount ?? '—' })}</p>
  </>;

  const handleForceRefresh = () => {
    const localeEvent = 'languageChanged';
    const localizedProps = () => ({
      icon: <ExclamationCircleFilled aria-hidden="true" />,
      title: i18n.t('insights:participation.refreshTitle'),
      content: i18n.t('insights:participation.refreshContent'),
      okText: i18n.t('insights:participation.confirmRefresh'),
      cancelText: i18n.t('insights:participation.cancel'),
    });
    const dialog = Modal.confirm({
      ...localizedProps(),
      okButtonProps: { danger: true },
      afterClose: () => i18n.off(localeEvent, refreshLabels),
      onOk: () => {
        forceRefresh.mutate(undefined, {
          onSuccess: () => message.success(i18n.t('insights:participation.refreshSuccess')),
          onError: (err) => {
            const code = errorCode(err);
            const busy = code === ErrorCodes.RETRY_LATER || code === ErrorCodes.SYSTEM_BUSY;
            message.error(i18n.t(busy ? 'insights:participation.refreshBusy' : 'insights:participation.refreshFailure'));
          },
        });
      },
    });
    const refreshLabels = () => dialog.update(localizedProps());
    i18n.on(localeEvent, refreshLabels);
  };

  return (
    <div className="participation-page">
      {/* Controls stay available during empty, loading and error states. */}
      <div className="participation-controls">
        <TimeRangePicker
          ariaLabel={t('participation.range')}
          end={data?.dataThrough ? dayjs(data?.dataThrough) : dayjs().subtract(1, 'day')}
          value={dateRange}
          onChange={setDateRange}
        />
        <Select<InsightWorkType>
          aria-label={t('participation.workTypeFilter')}
          value={workType}
          onChange={setWorkType}
          options={workTypeOptions}
          style={{ width: 140 }}
        />
        <Button
          style={{ marginLeft: 'auto' }}
          icon={<AwStrokeIcon name="refresh" />}
          loading={forceRefresh.isPending}
          onClick={handleForceRefresh}
        >
          {t('participation.refresh')}
        </Button>
      </div>

      <div className="participation-scope">
        <span className="participation-scope-summary"><span>{data?.sampleSize != null ? <Trans ns="insights" i18nKey="participation.scopeSummary" count={data.sampleSize} components={{ date: <span>{data.dataThrough || '—'}</span>, samples: <strong>{data.sampleSize}</strong> }} /> : t('participation.scopeUnavailable', { date: data?.dataThrough || '—' })}</span>
          <Tooltip title={scopeTip}><button type="button" className="participation-help" aria-label={t('participation.scopeAria')}><AwStrokeIcon name="info" /> {t('participation.scopeMethod')}</button></Tooltip>
        </span>
        <span>{isFetching ? t('participation.updating') : data?.generatedAt ? t('participation.updatedAt', { time: formatDateTime(data.generatedAt, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) }) : t('participation.offline')}</span>
      </div>
      {isLoading ? <div className="participation-state"><Spin tip={t('participation.loading')} /></div>
        : isError ? <div className="participation-state"><Empty description={t('participation.loadFailure')}><Button onClick={() => refetch()}>{t('participation.retry')}</Button></Empty></div>
        : !data?.available ? <div className="participation-state"><Empty description={t(data?.refreshTriggered ? 'participation.generating' : 'participation.noData')} /></div>
        : data.sampleSize === 0 ? <div className="participation-state"><Empty description={t('participation.emptyForFilter')} /></div>
        : <>
      {/* Summary cards and charts stay visible but dimmed while a new filter result is in flight. */}
      <Spin spinning={isFetching}>
      {data.average && (
        <div className="participation-stats">
          <StatCard label={t('participation.average')} value={hasSamples ? formatDuration(data.average.totalDurationSeconds) : '—'} splitStat
            detail={hasSamples ? <Trans ns="insights" i18nKey="participation.responsibilityDetail" components={{ human: <span className="is-human">{t('series.human')} {formatDuration(data.average.humanDurationSeconds)}</span>, agent: <span className="is-agent">{t('series.agent')} {formatDuration(data.average.agentDurationSeconds)}</span> }} /> : t('participation.noSamples')} />
          <StatCard label={t('participation.median')} value={hasSamples && data.medianTotalSeconds != null ? formatDuration(data.medianTotalSeconds) : '—'} splitStat
            detail={meanMedianRatio != null
              ? t('participation.medianDetail', { p90: data.p90 ? formatDuration(data.p90.totalDurationSeconds) : '—', ratio: meanMedianRatio.toFixed(1) })
              : t('participation.p90Detail', { duration: data.p90 ? formatDuration(data.p90.totalDurationSeconds) : '—' })}
            tip={t('participation.medianTip')} />
          <StatCard tone="agent" label={t('participation.agentShare')} value={participationShare != null ? t('participation.percentValue', { value: participationShare.toFixed(1) }) : '—'}
            detail={t('participation.sampleFraction', { participating: data.agentWorkitemCount ?? '—', count: data.sampleSize })}
            tip={t('participation.agentShareTip')} />
          <StatCard label={t('participation.agentDurationShare')} value={agentDurationShare != null ? t('participation.percentValue', { value: (agentDurationShare * 100).toFixed(1) }) : '—'}
            detail={agentDurationShare != null
              ? <Trans ns="insights" i18nKey="participation.agentDurationDetail"
                values={{ humanHours: formatNumber(Math.round(cumulative.human / 3600)), agentHours: formatNumber(Math.round(cumulative.agent / 3600)) }}
                components={{ human: <span className="is-human">{t('participation.percentValue', { value: ((1 - agentDurationShare) * 100).toFixed(1) })}</span> }} />
              : '—'} />
        </div>
      )}

      {hasSamples && cumulative.total > 0 && participationShare != null && agentDurationShare != null && (
        <div className="participation-insight">
          <span className="participation-insight-icon" aria-hidden="true"><AwStrokeIcon name="info" size={14} /></span>
          <span className="participation-insight-text">
            <Trans ns="insights" i18nKey="participation.insightBody"
              values={{ participating: data.agentWorkitemCount ?? '—', sample: data.sampleSize, participationShare: participationShare.toFixed(1), agentShare: (agentDurationShare * 100).toFixed(1), humanShare: ((1 - agentDurationShare) * 100).toFixed(1) }}
              components={{ strong: <b /> }} />
            {meanMedianRatio != null && <span className="participation-insight-tail">
              <Trans ns="insights" i18nKey="participation.insightRatio"
                values={{ average: data.average ? formatDuration(data.average.totalDurationSeconds) : '—', median: data.medianTotalSeconds != null ? formatDuration(data.medianTotalSeconds) : '—', ratio: meanMedianRatio.toFixed(1) }}
                components={{ strong: <b /> }} />
            </span>}
          </span>
        </div>
      )}

      {(trendHasSamples || data.average) && <div className="participation-panels">
        <ParticipationDistribution average={data.average ?? null} />
        {trendHasSamples && <ParticipationRatioTrend trend={trend} startDate={startDate} endDate={endDate} />}
        {trendHasSamples && <ParticipationDailyChart trend={trend} startDate={startDate} endDate={endDate} span />}
      </div>}
      </Spin>

      <SlowTailTable key={`${startDate}-${endDate}-${workType}`} startDate={startDate} endDate={endDate} workType={workType} cumulativeSeconds={cumulative.total} />
      </>}
    </div>
  );
}

function StatCard({ label, value, tone, detail, tip, splitStat }: { label: string; value: string; tone?: string; detail?: ReactNode; tip?: ReactNode; splitStat?: boolean }) {
  const { t } = useTranslation('insights');
  return (
    <Card className={`participation-stat ${tone ? `is-${tone}` : ''}`}>
      <Statistic title={<>{label}{tip && <Tooltip title={tip}><button type="button" className="participation-help" aria-label={t('participation.explanationAria', { label })}><AwStrokeIcon name="info" /></button></Tooltip>}</>} value={value}
        formatter={splitStat ? v => <StatValue value={String(v)} /> : undefined} />
      <div className="participation-stat-detail">{detail}</div>
    </Card>
  );
}
