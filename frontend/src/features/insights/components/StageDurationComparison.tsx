import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Collapse, Drawer, Empty, Segmented, Select, Tag, Tooltip } from 'antd';
import { formatDateTime } from '@/shared/i18n/format';
import { Table } from '@/shared/theme/ThemedTable';
import { compareStageSnapshots, previousStageConfiguration, observedRange, hasRecordedStageIdentity, snapshotValue, stageConfigurationGroups, stageDefinitions as stagesOf, stageDurationStatistics, canCompareStageTiming, stageExecutionDate,
  slowestStageSamples, summarizeStageExecutions, indexStageSnapshots, type StageSnapshotIndex, type StageTimeBasis, type StageComparisonView, type StageConfigurationGroup } from '../stageVersionComparison';
import type { StageDurationAgentVersion, StageDurationFlowSnapshot, StageDurationReport, StageDurationSample, StageDurationStepSample, StageDurationVersionSample } from '../types';
import { StageDurationDetails, StageSampleCount, formatStageDuration } from './StageDurationDetails';
import { StageVersionOverview } from './StageVersionOverview';

function ConfigurationVersions({ group }: { group: StageConfigurationGroup }) {
  const { t } = useTranslation('insights');
  const versions = [...new Map(group.samples.map(sample => [String(sample.agentVersionId), sample])).values()]
    .sort((a, b) => (b.agentVersionNo ?? -1) - (a.agentVersionNo ?? -1))
    .map(sample => sample.agentVersionNo != null ? t('stages.versionNumber', { version: sample.agentVersionNo })
      : sample.agentVersionId != null ? t('stages.versionFallback', { id: sample.agentVersionId }) : t('stages.unknownVersion'));
  return <span>{t('cohorts.executionVersions', { versions: versions.join(', ') })}</span>;
}

export function StageDurationComparison({ data, loading, view, candidate, baseline }: {
  data?: StageDurationReport; loading: boolean; view: StageComparisonView;
  candidate?: StageDurationAgentVersion; baseline?: StageDurationAgentVersion;
}) {
  const { t } = useTranslation('insights');
  const daily = view === 'daily';
  const samples = data?.versionSamples ?? [];
  const snapshots = useMemo(() => indexStageSnapshots(data?.flowSnapshots ?? []), [data?.flowSnapshots]);
  const groups = useMemo(() => stageConfigurationGroups(samples, snapshots), [samples, snapshots]);
  const duration = formatStageDuration;
  const selected = samples.filter(row => String(row.agentVersionId) === String(candidate?.agentVersionId));
  const comparison = samples.filter(row => String(row.agentVersionId) === String(baseline?.agentVersionId));
  const versionName = (version?: StageDurationAgentVersion) => version?.agentVersionNo != null ? t('stages.versionNumber', { version: version.agentVersionNo })
    : version ? t('stages.versionFallback', { id: version.agentVersionId }) : t('cohorts.noBaseline');
  const range = (rows: StageDurationVersionSample[]) => {
    const dates = rows.map(row => stageExecutionDate(row.createdAt)).sort();
    return dates.length ? t('cohorts.dateRange', { start: dates[0], end: dates[dates.length - 1] }) : t('stages.noValue');
  };
  if (loading) return <div className="stage-comparison-empty" role="status">{t('comparison.loading')}</div>;
  if (!samples.length) return <Empty description={t(data ? 'cohorts.empty' : 'stages.unavailable')} />;

  return <div className="stage-timeline">
    {!daily && <div className="stage-cohort-cards">{[{ value: baseline, cohort: comparison }, { value: candidate, cohort: selected }].map(({ value, cohort }, index) => {
      return <div className="stage-cohort-card" key={index}>
        <span>{t(index === 0 ? 'cohorts.baseline' : 'cohorts.candidate')}</span>
        <h3>{versionName(value)}{value?.currentAgentVersion && <Tag color="green">{t('stages.currentVersion')}</Tag>}</h3>
        <strong>{t('cohorts.executionCount', { count: cohort.length, limit: data?.sampleLimit ?? 30 })}</strong>
        <p>{range(cohort)}</p>
        <p>{t('evolution.succeededExecutions', { succeeded: cohort.filter(row => row.status === 'SUCCEEDED').length, all: cohort.length })}</p>
      </div>;
    })}</div>}
    <StageFlowComparison groups={groups} snapshots={snapshots} duration={duration} view={view} candidate={candidate} baseline={baseline} />
  </div>;
}

function StageFlowComparison({ groups, snapshots, duration, view, candidate, baseline }: {
  groups: StageConfigurationGroup[]; snapshots: StageSnapshotIndex; duration: (value: number | null) => string;
  view: StageComparisonView; candidate?: StageDurationAgentVersion; baseline?: StageDurationAgentVersion;
}) {
  const { t } = useTranslation('insights');
  const daily = view === 'daily';
  const [basis, setBasis] = useState<StageTimeBasis>('total');
  const [selectedFlow, setSelectedFlow] = useState<string>();
  const [changesOpen, setChangesOpen] = useState(false);
  const flows = useMemo(() => [...new Set(groups.map(group => String(group.samples[0].sdlcId)))].map(key => {
    const configurations = groups.filter(group => String(group.samples[0].sdlcId) === key);
    const name = configurations[0].samples[0].sdlcName || t('stages.flow');
    return { key, name, configurations, count: configurations.reduce((total, group) => total + group.samples.length, 0) };
  }).sort((a, b) => {
    const paired = (row: typeof a) => row.configurations.some(group => group.samples.some(sample => String(sample.agentVersionId) === String(baseline?.agentVersionId)))
      && row.configurations.some(group => group.samples.some(sample => String(sample.agentVersionId) === String(candidate?.agentVersionId)));
    return Number(paired(b)) - Number(paired(a)) || b.count - a.count || a.key.localeCompare(b.key);
  }), [groups, baseline?.agentVersionId, candidate?.agentVersionId, t]);
  const flow = flows.find(row => row.key === selectedFlow) ?? flows[0];
  const samples = useMemo(() => flow.configurations.flatMap(group => group.samples), [flow.configurations]);
  return <>
    <div className="stage-flow-scope">
      <label>{t('cohorts.executedWorkflow')}<Select aria-label={t('cohorts.executedWorkflow')} value={flow.key} onChange={setSelectedFlow}
        showSearch optionFilterProp="label" options={flows.map(row => ({ value: row.key, label: t('cohorts.workflowOption', {
          name: flows.filter(item => item.name === row.name).length > 1 ? t('cohorts.flowContext', { name: row.name, id: row.key }) : row.name, count: row.count,
        }) }))} /></label>
      <Segmented<StageTimeBasis> aria-label={t('stages.timeBasis')} value={basis} onChange={setBasis}
        options={[{ value: 'total', label: t('stages.elapsed') }, { value: 'adjusted', label: t('stages.afterKnownWait') }]} />
    </div>
    {daily ? <>
      <StageConfigurationChart key={flow.key} groups={flow.configurations} snapshots={snapshots} basis={basis} duration={duration} />
      <Collapse key={flow.configurations.map(group => group.key).join('|')} className="stage-condition-details" destroyInactivePanel
        defaultActiveKey={flow.configurations.slice(0, 4).map(group => group.key)} items={flow.configurations.map(group => ({
          key: group.key,
          label: group.snapshot ? t('comparison.snapshot', { id: group.snapshot.id, hash: group.snapshot.contentHash.slice(0, 7) }) : t('comparison.unknownSnapshot'),
          children: <StageConfigurationPanel group={group} snapshots={snapshots} basis={basis} view="daily" duration={duration} />,
        }))} />
    </> : <>
      <StageVersionOverview basis={basis} key={flow.key} samples={samples} snapshots={snapshots}
        candidate={candidate} baseline={baseline} duration={duration} />
      <Collapse className="stage-condition-details" items={[{ key: 'conditions', label: t('evolution.conditionDetails'), children: <>
        {flow.configurations.map(group => <StageConfigurationPanel key={group.key} group={group} snapshots={snapshots} basis={basis} view={view}
          candidate={candidate} baseline={baseline} duration={duration} />)}
      </> }]} />
    </>}
    {!daily && <div className="stage-detail-actions">
      <Button disabled={!baseline} onClick={() => setChangesOpen(true)}>{t('timeline.configurationChanges')}</Button>
    </div>}
    <Drawer open={changesOpen} title={t('timeline.configurationChanges')} width={900} onClose={() => setChangesOpen(false)} destroyOnClose>
      {changesOpen && <SnapshotChanges key={flow.key}
        left={samples.filter(row => String(row.agentVersionId) === String(candidate?.agentVersionId))}
        right={samples.filter(row => String(row.agentVersionId) === String(baseline?.agentVersionId))} snapshots={snapshots} />}
    </Drawer>
  </>;
}

function StageConfigurationChart({ groups, snapshots, duration, basis }: { snapshots: StageSnapshotIndex; basis: StageTimeBasis; groups: StageConfigurationGroup[]; duration: (value: number | null) => string }) {
  const { t } = useTranslation('insights');
  const [metric, setMetric] = useState<'p50' | 'p90' | 'average'>('p50');
  const [selectedStage, setSelectedStage] = useState<string>();
  const [selectedConfigurations, setSelectedConfigurations] = useState<string[]>();
  const [changePair, setChangePair] = useState<{ before: StageDurationFlowSnapshot; after: StageDurationFlowSnapshot }>();
  const configurationName = (group: StageConfigurationGroup) => group.snapshot
    ? t('comparison.snapshot', { id: group.snapshot.id, hash: group.snapshot.contentHash.slice(0, 7) }) : t('comparison.unknownSnapshot');
  const configurationTitle = (group: StageConfigurationGroup) => group.snapshot
    ? t('timeline.configuration', { id: group.snapshot.id }) : t('comparison.unknownSnapshot');
  const points = useMemo(() => groups.flatMap(group => {
    const flow = group.samples[0];
    return stagesOf(group.samples, group.snapshot).map(stage => ({ group, stage,
      stageGroup: hasRecordedStageIdentity(stage) ? stage.key : `${group.key}:${stage.key}`,
      name: stage.name || t('stages.stageFallback', { id: stage.stepId ?? stage.stepOrder }),
      flow: t('cohorts.flowContext', { name: flow.sdlcName || t('stages.flow'), id: flow.sdlcId ?? t('stages.noValue') }),
      stat: stageDurationStatistics(group.samples, stage.key, basis, snapshots),
    }));
  }), [groups, snapshots, basis, t]);
  // Renamed stages retain identity; recreated stages with the same name stay separate.
  const series = useMemo(() => {
    const pointsByStage = new Map<string, typeof points>();
    for (const point of points) {
      const group = pointsByStage.get(point.stageGroup) ?? [];
      group.push(point); pointsByStage.set(point.stageGroup, group);
    }
    return [...pointsByStage].map(([key, points]) => ({ key, name: points[0].name, points }));
  }, [points]);
  const names = new Map<string, number>();
  for (const row of series) names.set(row.name, (names.get(row.name) ?? 0) + 1);
  const seriesName = (row: typeof series[number]) => names.get(row.name)! > 1
    ? t('cohorts.stageIdentity', { name: row.name, id: row.points[0].stage.stepId ?? row.points[0].stage.stepOrder ?? row.key }) : row.name;
  const active = series.find(row => row.key === selectedStage) ?? series[0];
  const options = useMemo(() => [...new Map((active?.points ?? []).map(point => [point.group.key, {
    value: point.group.key, label: configurationTitle(point.group),
    title: t('cohorts.configurationIdentity', { flow: point.flow, configuration: configurationName(point.group) }),
  }])).values()], [active, t]);
  const configurationKeys = useMemo(() => (selectedConfigurations ?? options.slice(0, 4).map(option => option.value))
    .filter(key => options.some(option => option.value === key)), [selectedConfigurations, options]);
  const visiblePoints = useMemo(() => (active?.points ?? []).filter(point => configurationKeys.includes(point.group.key)).map(point => {
    const older = previousStageConfiguration(groups, point.group);
    const comparable = point.group.snapshot && older;
    const differences = comparable ? compareStageSnapshots(older, point.group.snapshot!) : [];
    const changes = [...new Set(differences.flatMap(change => change.type === 'modified'
      ? change.fields.map(field => t(`comparison.fields.${field.key}`)) : [t(change.type === 'added' ? 'cohorts.addedStage' : 'cohorts.removedStage')]))];
    return { ...point, older, comparable, changes };
  }), [active, configurationKeys, groups, t]);
  const max = Math.max(1, ...visiblePoints.map(point => point.stat[metric] ?? 0));
  return <section className="stage-configuration-chart" aria-label={t('cohorts.configurationChart')}>
    <div className="stage-panel-heading"><h3>{t('cohorts.configurationChart')}</h3>
      <Segmented aria-label={t('comparison.metric')} value={metric} onChange={setMetric}
        options={(['p50', 'p90', 'average'] as const).map(value => ({ value, label: t(`comparison.${value}`) }))} />
    </div>
    {groups.some(group => !group.snapshot) && <p>{t('cohorts.unverifiedTimingHint')}</p>}
    {!active ? <Empty description={t('cohorts.noStageEvents')} /> : <>
      <div className="stage-configuration-filters">
        <label>{t('cohorts.chartStage')}<Select aria-label={t('cohorts.chartStage')} value={active.key}
          options={series.map(row => ({ value: row.key, label: seriesName(row) }))} showSearch optionFilterProp="label"
          onChange={value => { setSelectedStage(value); setSelectedConfigurations(undefined); }} /></label>
        <label>{t('cohorts.chartConfigurations')}<Select aria-label={t('cohorts.chartConfigurations')} mode="multiple"
          value={configurationKeys} options={options} onChange={setSelectedConfigurations} allowClear
          maxTagCount="responsive" optionFilterProp="label" placeholder={t('cohorts.selectConfigurations')} /></label>
      </div>
      {!visiblePoints.length ? <Empty description={t('cohorts.selectConfigurations')} /> :
        <figure className="stage-configuration-series" aria-label={t('cohorts.chartTitle', { stage: active.name, metric: t(`comparison.${metric}`) })}>
          {visiblePoints.some(point => (point.stat[metric] ?? 0) > 0) && <div className="stage-configuration-axis" aria-hidden="true">
            <div><span>{duration(0)}</span><span>{duration(max / 2)}</span><span>{duration(max)}</span></div>
          </div>}
          <div className="stage-configuration-bars">{visiblePoints.map(({ group, stage, flow, stat, older, comparable, changes }) => {
            const value = stat[metric];
            const configuration = configurationName(group);
            const label = t('cohorts.configurationPoint', { flow, stage: seriesName(active), configuration,
              metric: t(`comparison.${metric}`), duration: duration(value), valid: stat.measured, all: stat.count });
            return <div className="stage-configuration-entry" key={`${group.key}:${stage.key}`}><Tooltip title={label} trigger={['hover', 'focus']}>
              <div className="stage-configuration-point" tabIndex={0} role="img" aria-label={label}>
                <span className="stage-configuration-label">
                  <strong>{configurationTitle(group)}</strong>
                  <span>{t('evolution.usedDates', observedRange(group.samples))}</span>
                  <span className="stage-configuration-meta"><ConfigurationVersions group={group} />
                    <StageSampleCount valid={stat.measured} total={stat.count} coverage={stat.coverage} /></span>
                </span>
                <div className="stage-configuration-measurement">
                  <div className="stage-configuration-track"><span className={value == null ? 'is-missing' : value === 0 ? 'is-zero' : ''}
                    style={{ width: `${value == null ? 0 : value / max * 100}%` }} /></div>
                  <strong>{duration(value)}</strong>
                </div>
              </div>
            </Tooltip>
              <div className="stage-configuration-change">
                <span>{comparable ? changes.length ? t('cohorts.changedFromPrevious', { fields: changes.join(', ') }) : t('comparison.sameConfiguration')
                  : group.snapshot ? t('cohorts.noEarlierConfiguration') : t('comparison.unknownSnapshot')}</span>
                {comparable && changes.length > 0 && <Button type="link" size="small" onClick={() => setChangePair({ before: older!, after: group.snapshot! })}>{t('cohorts.viewConfigurationChanges')}</Button>}
              </div>
            </div>;
          })}</div>
        </figure>}
    </>}
    <Drawer open={!!changePair} title={t('cohorts.viewConfigurationChanges')} width={900} onClose={() => setChangePair(undefined)} destroyOnClose>
      {changePair && <SnapshotDifferenceDetails before={changePair.before} after={changePair.after} />}
    </Drawer>
  </section>;
}

function StageConfigurationPanel({ group, snapshots, view, candidate, baseline, duration, basis }: {
  snapshots: StageSnapshotIndex;
  basis: StageTimeBasis;
  group: StageConfigurationGroup; view: StageComparisonView;
  candidate?: StageDurationAgentVersion; baseline?: StageDurationAgentVersion;
  duration: (value: number | null) => string;
}) {
  const { t } = useTranslation('insights');
  const daily = view === 'daily';
  const samples = group.samples, flow = samples[0];
  const [detail, setDetail] = useState<{ title: string; rows: StageDurationSample[]; total: boolean }>();
  const { selected, comparison, cohorts, rows } = useMemo(() => {
    const selected = daily ? samples : samples.filter(row => String(row.agentVersionId) === String(candidate?.agentVersionId));
    const comparison = samples.filter(row => String(row.agentVersionId) === String(baseline?.agentVersionId));
    const cohorts = daily ? [{ key: 'daily', samples, version: undefined, isBaseline: false }]
      : [{ key: 'baseline', samples: comparison, version: baseline, isBaseline: true },
        { key: 'candidate', samples: selected, version: candidate, isBaseline: false }].filter(cohort => cohort.samples.length > 0);
    const rows = stagesOf(samples, group.snapshot).flatMap(stage => {
      const baselineStat = stageDurationStatistics(comparison, stage.key, basis, snapshots);
      return cohorts.map((cohort, index) => ({ key: stage.key + '.' + cohort.key, stage,
        stat: cohort.isBaseline ? baselineStat : stageDurationStatistics(cohort.samples, stage.key, basis, snapshots),
        baselineStat, isBaseline: cohort.isBaseline, cohort, first: index === 0 }));
    });
    return { selected, comparison, cohorts, rows };
  }, [samples, group.snapshot, daily, candidate, baseline, basis, snapshots]);
  const versionName = (version?: StageDurationAgentVersion) => version?.agentVersionNo != null ? t('stages.versionNumber', { version: version.agentVersionNo })
    : version ? t('stages.versionFallback', { id: version.agentVersionId }) : t('cohorts.noBaseline');
  const stageName = (row: StageDurationStepSample) => row.name || t('stages.stageFallback', { id: row.stepId ?? row.stepOrder });
  const dailySamples = new Map<string, StageDurationVersionSample[]>();
  if (daily) for (const sample of samples) {
    const day = stageExecutionDate(sample.createdAt), bucket = dailySamples.get(day) ?? [];
    bucket.push(sample); dailySamples.set(day, bucket);
  }
  const bars = daily ? [...dailySamples.keys()].sort().map(day => ({ key: day, label: day, rows: dailySamples.get(day)! }))
    : cohorts.map(cohort => ({ key: cohort.key, label: versionName(cohort.version), rows: cohort.samples }));
  type StageRow = typeof rows[number];
  const stageCell = (row: StageRow) => ({ rowSpan: row.first ? cohorts.length : 0 });
  const openDetails = (row?: StageDurationStepSample, cohortSamples = samples, version?: StageDurationAgentVersion) => {
    const rows = row ? slowestStageSamples(cohortSamples, row.key, basis) : [...cohortSamples]
      .sort((a, b) => (b.durationMs ?? -1) - (a.durationMs ?? -1) || a.dispatchId - b.dispatchId).slice(0, 10);
    setDetail({ title: row ? version ? t('evolution.detailTitle', { stage: stageName(row), version: versionName(version) }) : stageName(row) : t('cohorts.sampleDetails'), total: !row, rows });
  };
  const title = t('cohorts.flowContext', { name: flow.sdlcName || t('stages.flow'), id: flow.sdlcId ?? t('stages.noValue') });
  const shared = comparison.length > 0 && selected.length > 0;
  const relationship = shared ? t(group.snapshot ? 'configurationDetails.shared' : 'configurationDetails.unknown')
    : t('configurationDetails.onlyVersion', { version: versionName(comparison.length ? baseline : candidate) });
  return <section className="stage-trend-panel" aria-label={title}>
    <div className="stage-panel-heading"><div><h3>{group.snapshot ? t('timeline.configuration', { id: group.snapshot.id }) : t('comparison.unknownSnapshot')}
      {!daily && <Tag color={shared && group.snapshot ? 'blue' : 'default'}>{relationship}</Tag>}</h3>
      {daily && <p><ConfigurationVersions group={group} /></p>}
      <p>{group.snapshot
      ? t('cohorts.verifiedConfiguration', { hash: group.snapshot.contentHash.slice(0, 7), count: samples.length }) : t('cohorts.unverifiedConfiguration', { count: samples.length })}</p></div>
    </div>
    {!group.snapshot && <p>{t('cohorts.unverifiedTimingHint')}</p>}
    <Table<StageRow> className="stage-breakdown-table" size="small" rowKey="key" dataSource={rows} pagination={false} scroll={{ x: daily || cohorts.length === 1 ? 680 : 840 }}
      locale={{ emptyText: t('cohorts.noStageEvents') }} columns={[
        { title: t('stages.stage'), align: 'left', width: 220, onCell: stageCell, render: (_, row) => <span className="stage-row-name">{stageName(row.stage)}</span> },
        ...(!daily && cohorts.length > 1 ? [{ title: t('stages.agentVersion'), width: 130, render: (_: unknown, row: StageRow) => <div className="stage-stat-cell">
          <strong>{versionName(row.cohort.version)}</strong>
        </div> }] : []),
        ...(['p50', 'p90', 'average'] as const).map(metric => ({ title: t(`comparison.${metric}`), width: 120, render: (_: unknown, row: StageRow) => {
          const value = row.stat[metric], before = row.baselineStat[metric];
          return <div className="stage-stat-cell"><strong>{duration(value)}</strong>
            {!daily && !row.isBaseline && group.snapshot && canCompareStageTiming(basis, row.baselineStat, row.stat) && value != null && before != null && <small>
              {value === before ? t('comparison.sameDuration') : t(value < before ? 'cohorts.lower' : 'cohorts.higher', { duration: duration(Math.abs(value - before)) })}
            </small>}
          </div>;
        } })),
        { title: t('cohorts.validSamples'), width: 110, render: (_, row) => <Tooltip title={t('cohorts.stageQuality', { observed: row.stat.observed, excluded: row.stat.excluded })}>
          <span><StageSampleCount valid={row.stat.measured} total={row.stat.count} coverage={row.stat.coverage} /></span>
        </Tooltip> },
        { title: t('comparison.details'), width: 130, render: (_, row) => <Button type="text" size="small" disabled={!row.stat.observed}
          onClick={() => openDetails(row.stage, row.cohort.samples, row.cohort.version)}
          aria-label={daily ? t('stages.showSamples', { stage: stageName(row.stage) }) : t('evolution.detailTitle', { stage: stageName(row.stage), version: versionName(row.cohort.version) })}>{t('comparison.details')}</Button> },
      ]} />
    <Collapse ghost className="stage-method" items={[{ key: 'quality', label: t('cohorts.sampleQuality'), children: <>
      <p>{t('cohorts.exclusions')}</p>
      {bars.map(bar => { const summary = summarizeStageExecutions(bar.rows);
        return <p key={bar.key}>{t('cohorts.executionQuality', { label: bar.label, all: bar.rows.length, complete: summary.completed.length,
          p50: duration(summary.p50), p90: duration(summary.p90), average: duration(summary.average) })}</p>;
      })}
      <Button onClick={() => openDetails()}>{t('cohorts.sampleDetails')}</Button>
    </> }]} />
    <Drawer open={!!detail} title={detail?.title} width={1100} onClose={() => setDetail(undefined)} destroyOnClose>
      {detail && <StageDurationDetails samples={detail.rows} basis={basis} total={detail.total} />}
    </Drawer>
  </section>;
}

function SnapshotChanges({ left, right, snapshots }: { left: StageDurationVersionSample[]; right: StageDurationVersionSample[]; snapshots: StageSnapshotIndex }) {
  const { t } = useTranslation('insights');
  const lastUsed = (samples: StageDurationVersionSample[]) => Math.max(...samples.map(row => Date.parse(row.createdAt)));
  const choices = (samples: StageDurationVersionSample[]) => [...new Set(samples.map(row => row.snapshotId?.toString()))]
    .map(id => {
      const rows = samples.filter(row => row.snapshotId?.toString() === id);
      const snapshot = id === undefined ? undefined : snapshots.get(id);
      return { id, snapshot: snapshot && rows.some(row => String(row.sdlcId) === String(snapshot.sdlcId)) ? snapshot : undefined, samples: rows };
    })
    .sort((a, b) => Number(!!b.snapshot) - Number(!!a.snapshot) || lastUsed(b.samples) - lastUsed(a.samples));
  const aChoices = choices(left), bChoices = choices(right);
  const [aId, setAId] = useState<string>(), [bId, setBId] = useState<string>();
  const a = aChoices.find(item => item.snapshot && String(item.snapshot.id) === aId)?.snapshot ?? aChoices[0]?.snapshot;
  const b = bChoices.find(item => item.snapshot && String(item.snapshot.id) === bId)?.snapshot ?? bChoices[0]?.snapshot;
  const name = (snapshot?: StageDurationFlowSnapshot) => snapshot ? t('cohorts.snapshot', { flowId: snapshot.sdlcId, id: snapshot.id, hash: snapshot.contentHash.slice(0, 7) }) : t('comparison.unknownSnapshot');
  return <div>
    <p className="insight-caption">{t('comparison.mixedConfigurations')}</p>
    <div className="stage-snapshot-selectors">{[aChoices, bChoices].map((options, index) => <div key={index}>
      <label htmlFor={'stage-snapshot-' + index}>{t(index === 0 ? 'comparison.candidate' : 'cohorts.baseline')}</label>
      <Select<string> id={'stage-snapshot-' + index} aria-label={t('comparison.selectConfiguration', { side: t(index === 0 ? 'comparison.candidate' : 'cohorts.baseline') })}
        value={(index === 0 ? a : b)?.id.toString()} placeholder={t('comparison.unknownSnapshot')} disabled={options.filter(item => item.snapshot).length < 2}
        onChange={index === 0 ? setAId : setBId}
        options={options.filter(item => item.snapshot).map(item => ({ value: String(item.snapshot!.id), label: name(item.snapshot) }))} />
      <div className="stage-configuration-distribution">{options.map(item => <span key={item.id ?? 'unknown'}>
        {t('comparison.distribution', { configuration: name(item.snapshot), executions: item.samples.length })}
      </span>)}</div>
    </div>)}</div>
    {!a || !b ? <Alert type="info" showIcon message={t('comparison.missingConfiguration')} /> : <SnapshotDifferenceDetails before={b} after={a} />}
  </div>;
}

function SnapshotDifferenceDetails({ before, after }: { before: StageDurationFlowSnapshot; after: StageDurationFlowSnapshot }) {
  const { t } = useTranslation('insights');
  if (String(before.sdlcId) !== String(after.sdlcId)) return <Alert type="info" showIcon message={t('comparison.differentWorkflows')} />;
  const differences = compareStageSnapshots(before, after);
  const changeName = (change: typeof differences[number]) => change.name || (change.key === 'configuration' ? t('comparison.configuration') : t('stages.stageFallback', { id: change.key }));
  return <>
      <p>{t('cohorts.configurationChangeRange', {
        before: formatDateTime(before.capturedAt, { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Shanghai' }),
        after: formatDateTime(after.capturedAt, { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Shanghai' }),
      })}</p>
      {!differences.length && <p>{t('comparison.sameConfiguration')}</p>}
      {differences.map(change => <div className="stage-config-diff" key={change.key}>
        <h5><Tag color={change.type === 'added' ? 'green' : change.type === 'removed' ? 'red' : 'blue'}>{t(`comparison.${change.type}`)}</Tag>
          {changeName(change)}</h5>
        {change.fields.map(field => <div className="stage-config-field" key={field.key}>
          <strong>{t(`comparison.fields.${field.key}`)}</strong>
          <div><span>{t('comparison.before')}</span><pre>{snapshotValue(field.before) || t('comparison.notSet')}</pre></div>
          <div><span>{t('comparison.after')}</span><pre>{snapshotValue(field.after) || t('comparison.notSet')}</pre></div>
        </div>)}
      </div>)}
  </>;
}
