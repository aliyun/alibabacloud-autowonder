import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Drawer, Empty, Segmented, Tag, Tooltip } from 'antd';
import { formatNumber } from '@/shared/i18n/format';
import { hasRecordedStageIdentity, stageConfigurationGroups, stageDefinitions, slowestStageSamples, stageDurationStatistics, canCompareStageTiming, type StageSnapshotIndex, type StageTimeBasis } from '../stageVersionComparison';
import type { StageDurationAgentVersion, StageDurationSample, StageDurationVersionSample } from '../types';
import { StageDurationDetails, StageSampleCount } from './StageDurationDetails';

export function StageVersionOverview({ samples, snapshots, candidate, baseline, duration, basis }: {
  basis: StageTimeBasis;
  samples: StageDurationVersionSample[]; snapshots: StageSnapshotIndex;
  candidate?: StageDurationAgentVersion; baseline?: StageDurationAgentVersion;
  duration: (value: number | null) => string;
}) {
  const { t } = useTranslation('insights');
  const [metric, setMetric] = useState<'p50' | 'p90' | 'average'>('p50');
  const [detail, setDetail] = useState<{ name: string; rows: StageDurationSample[] }>();
  const versionName = (version?: StageDurationAgentVersion) => version?.agentVersionNo != null ? t('stages.versionNumber', { version: version.agentVersionNo })
    : version ? t('stages.versionFallback', { id: version.agentVersionId }) : t('cohorts.noBaseline');
  const selected = useMemo(() => samples.filter(row => String(row.agentVersionId) === String(candidate?.agentVersionId)), [samples, candidate?.agentVersionId]);
  const comparison = useMemo(() => samples.filter(row => String(row.agentVersionId) === String(baseline?.agentVersionId)), [samples, baseline?.agentVersionId]);
  const unidentified = samples.flatMap(row => row.stages).filter(stage => !hasRecordedStageIdentity(stage)).length;
  const rows = useMemo(() => stageDefinitions([...comparison, ...selected]).filter(hasRecordedStageIdentity).map(stage => ({ stage,
    before: stageDurationStatistics(comparison, stage.key, basis, snapshots), after: stageDurationStatistics(selected, stage.key, basis, snapshots),
  })), [comparison, selected, basis, snapshots]);
  const max = Math.max(1, ...rows.flatMap(row => [row.before[metric] ?? 0, row.after[metric] ?? 0]));
  const groups = useMemo(() => stageConfigurationGroups(samples, snapshots), [samples, snapshots]);
  const known = groups.filter(group => group.snapshot);
  const unknown = groups.filter(group => !group.snapshot).reduce((total, group) => total + group.samples.length, 0);
  const shared = known.some(group => group.samples.some(row => String(row.agentVersionId) === String(baseline?.agentVersionId))
    && group.samples.some(row => String(row.agentVersionId) === String(candidate?.agentVersionId)));
  const comparable = rows.filter(row => row.before[metric] != null && row.after[metric] != null
    && canCompareStageTiming(basis, row.before, row.after));
  const openDetails = (key: string, name: string, cohort: StageDurationVersionSample[], version?: StageDurationAgentVersion) => {
    const rows = slowestStageSamples(cohort, key, basis);
    setDetail({ name: t('evolution.detailTitle', { stage: name, version: versionName(version) }), rows });
  };

  return <section className="stage-version-overview" aria-label={t('evolution.overview')}>
    <div className="stage-panel-heading">
      <h3>{t('evolution.overview')}</h3>
      <Segmented aria-label={t('comparison.metric')} value={metric} onChange={setMetric}
        options={(['p50', 'p90', 'average'] as const).map(value => ({ value, label: t(`comparison.${value}`) }))} />
    </div>
    <div className="stage-version-context">
      <span>{t('evolution.flowSamples', { baseline: versionName(baseline), before: comparison.length, candidate: versionName(candidate), after: selected.length })}</span>
      <Tag>{t('evolution.configurationCount', { count: known.length })}</Tag>
      {unknown > 0 && <Tag color="gold">{t('evolution.unknownConfigurations', { count: unknown })}</Tag>}
      {!shared && comparison.length > 0 && selected.length > 0 && <Tooltip trigger={['hover', 'focus']} title={t('configurationDetails.noSharedHint')}>
        <Tag tabIndex={0}>{t('configurationDetails.noShared')}</Tag>
      </Tooltip>}
    </div>
    {!baseline && <Alert type="info" showIcon message={t('evolution.noBaseline')} />}
    {unidentified > 0 && <Alert type="info" showIcon message={t('evolution.unidentifiedStages', { count: unidentified })} />}
    <div className="stage-version-legend"><span className="is-baseline">{t('evolution.versionLegend', { side: t('cohorts.baseline'), version: versionName(baseline) })}</span>
      <span className="is-candidate">{t('evolution.versionLegend', { side: t('cohorts.candidate'), version: versionName(candidate) })}</span><span>{t('evolution.metricHint')}</span></div>
    {!rows.length ? <Empty description={t('cohorts.noStageEvents')} /> : <>
      {!!baseline && !comparable.length && <p className="stage-muted">{t('evolution.noComparableStages')}</p>}
      <div className="stage-version-chart" role="figure" aria-label={t('evolution.chart', { metric: t(`comparison.${metric}`) })}>
        {rows.map(({ stage, before, after }) => {
          const stageName = stage.name || t('stages.stageFallback', { id: stage.stepId ?? stage.stepOrder });
          const name = stage.name && rows.some(row => row.stage.key !== stage.key && row.stage.name === stage.name)
            ? t('cohorts.stageIdentity', { name: stageName, id: stage.stepId ?? stage.stepOrder ?? stage.key }) : stageName;
          const previous = before[metric], value = after[metric];
          const partial = before.measured > 0 && after.measured > 0 && !canCompareStageTiming(basis, before, after);
          const change = previous == null || value == null || partial ? null : value - previous;
          const percent = previous != null && previous > 0 && change != null
            ? formatNumber(Math.abs(change) / previous, { style: 'percent', maximumFractionDigits: 1 }) : null;
          const difference = change == null ? t(partial ? 'stages.partialComparison' : 'evolution.noComparison') : change === 0 ? t('comparison.sameDuration')
            : t(change < 0 ? 'cohorts.lower' : 'cohorts.higher', { duration: duration(Math.abs(change)) });
          const few = change != null && (before.measured < 5 || after.measured < 5);
          return <div className="stage-version-row" key={stage.key}>
            <div className="stage-version-row-heading"><strong>{name}</strong>
              <span className={few || change == null || change === 0 ? 'stage-muted' : change < 0 ? 'stage-faster' : 'stage-slower'}>
                {percent != null && change !== 0 ? t('evolution.changePercent', { difference, percent }) : difference}
              </span>
            </div>
            {[{ stat: before, cohort: comparison, version: baseline, previous: true }, { stat: after, cohort: selected, version: candidate, previous: false }].map(item => {
              const amount = item.stat[metric];
              const label = t('evolution.barLabel', { stage: name, version: versionName(item.version), metric: t(`comparison.${metric}`),
                duration: duration(amount), valid: item.stat.measured, all: item.stat.count });
              return <div className="stage-version-bar-row" key={item.previous ? 'baseline' : 'candidate'}>
                <span className="stage-version-name">{versionName(item.version)}</span>
                <div className="stage-version-bar" role="img" aria-label={label}>
                  <span className={`stage-version-fill${item.previous ? ' is-baseline' : ''}${amount == null ? ' is-missing' : amount === 0 ? ' is-zero' : ''}`}
                    style={{ width: `${amount == null ? 0 : amount / max * 100}%` }} />
                </div>
                <strong>{duration(amount)}</strong>
                <StageSampleCount valid={item.stat.measured} total={item.stat.count} coverage={item.stat.coverage} />
                <Button type="link" size="small" disabled={!item.stat.observed}
                  aria-label={t('evolution.detailTitle', { stage: name, version: versionName(item.version) })}
                  onClick={() => openDetails(stage.key, name, item.cohort, item.version)}>{t('comparison.details')}</Button>
              </div>;
            })}
          </div>;
        })}
      </div>
    </>}
    <Drawer open={!!detail} title={detail?.name} width={1100} onClose={() => setDetail(undefined)} destroyOnClose>
      {detail && <StageDurationDetails samples={detail.rows} basis={basis} />}
    </Drawer>
  </section>;
}
