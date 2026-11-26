import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Collapse, DatePicker, Empty, Segmented, Select, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useAuthStore } from '@/shared/auth/store';
import { getStageWorkers, getStageDuration, getStageVersions, getStageVersionSamples } from '../api';
import { useInsightDateRange, useInsightPreference } from '../useInsightPreference';
import { stageDispatchStatusKeys as DISPATCH_KEYS, stageExecutionDate, type StageComparisonView } from '../stageVersionComparison';
import { WorkspaceStageDuration } from './WorkspaceStageDuration';
import { StageDurationComparison } from './StageDurationComparison';

const isId = (value: unknown) => typeof value === 'string' && /^[1-9]\d*$/.test(value);
function today() { return dayjs(stageExecutionDate(new Date().toISOString())); }
function lastDays(days: number): [Dayjs, Dayjs] { const end = today(); return [end.subtract(days - 1, 'day'), end]; }

export function StageDurationTab() {
  const { t } = useTranslation('insights');
  type View = StageComparisonView | 'workspace';
  const [view, setView] = useInsightPreference<View>('stages.cohorts.view', 'workspace',
    value => value === 'workspace' || value === 'daily' || value === 'versions');
  const workspace = view === 'workspace';
  const [range, setRange] = useInsightDateRange(workspace ? 'stages.dates' : 'stages.cohorts.dates', () => lastDays(30), 366, today());
  const [excludeCanceled, setExcludeCanceled] = useInsightPreference(
    workspace ? 'stages.excludeCanceled' : 'stages.cohorts.excludeCanceled', !workspace, value => typeof value === 'boolean');
  const dates = { startDate: range[0].format('YYYY-MM-DD'), endDate: range[1].format('YYYY-MM-DD') };

  return <div className="insight-member-page stage-duration-page">
    <div className="stage-page-heading">
      <Typography.Title level={4}>{t('timeline.title')}</Typography.Title>
      <div className="stage-page-filters">
        <DatePicker.RangePicker aria-label={t('stages.range')} allowClear={false} value={range}
          onChange={values => { if (values?.[0] && values[1]) setRange([values[0], values[1]]); }}
          disabledDate={(date, info) => date.isAfter(today(), 'day') || (!!info.from && Math.abs(date.diff(info.from, 'day')) >= 366)}
          presets={[7, 30, 90].map(days => ({ label: t('participation.lastDays', { count: days }), value: lastDays(days) }))} />
        <Checkbox checked={excludeCanceled} onChange={event => setExcludeCanceled(event.target.checked)}>{t('stages.excludeCanceled')}</Checkbox>
      </div>
    </div>
    <Segmented<View> aria-label={t('cohorts.view')} value={view} onChange={setView}
      options={[{ value: 'workspace', label: t('stages.workspace') }, { value: 'versions', label: t('cohorts.versions') }, { value: 'daily', label: t('cohorts.daily') }]} />
    {workspace
      ? <WorkspaceStageDuration {...dates} excludeCanceled={excludeCanceled} />
      : <EmployeeStageDuration {...dates} excludeCanceled={excludeCanceled} view={view} />}
  </div>;
}

function EmployeeStageDuration({ startDate, endDate, excludeCanceled, view }: {
  startDate: string; endDate: string; excludeCanceled: boolean; view: StageComparisonView;
}) {
  const { t } = useTranslation('insights');
  const workspaceId = useAuthStore(s => s.currentWorkspace?.id);
  const [status, setStatus] = useInsightPreference<string | undefined>('stages.status', undefined,
    value => typeof value === 'string' && Object.prototype.hasOwnProperty.call(DISPATCH_KEYS, value));
  const daily = view === 'daily';
  const [savedWorker, setWorker] = useInsightPreference<string | undefined>('stages.cohorts.worker', undefined, isId);
  const workers = useQuery({ queryKey: ['stage-duration-workers', workspaceId, excludeCanceled], queryFn: () => getStageWorkers(excludeCanceled), staleTime: 60_000 });
  const workerList = workers.isError ? [] : workers.data ?? [];
  const worker = workerList.find(row => String(row.id) === savedWorker) ?? workerList[0];
  const agentId = worker && String(worker.id);
  const versions = useQuery({ queryKey: ['stage-duration-versions', workspaceId, agentId, excludeCanceled], queryFn: () => getStageVersions(agentId!, excludeCanceled),
    enabled: !daily && !!agentId, staleTime: 30_000 });
  const versionList = versions.isError ? [] : versions.data ?? [];
  const preferenceKey = 'stages.cohorts.' + agentId;
  const [savedCandidate, setCandidate] = useInsightPreference<string | undefined>(preferenceKey + '.candidate', undefined, isId);
  const [savedBaseline, setBaseline] = useInsightPreference<string | undefined>(preferenceKey + '.baseline', undefined, isId);
  const candidate = versionList.find(row => String(row.agentVersionId) === savedCandidate) ?? versionList[0];
  const baseline = versionList.find(row => String(row.agentVersionId) === savedBaseline && row !== candidate) ?? versionList.find(row => row !== candidate);
  const versionIds = [candidate, baseline].flatMap(row => row ? [String(row.agentVersionId)] : []);
  const query = useQuery({ queryKey: ['stage-duration', workspaceId, agentId, view, startDate, endDate, excludeCanceled, ...(daily ? [status] : versionIds)],
    queryFn: () => daily ? getStageDuration({ startDate, endDate, agentId, groupBy: 'agent_version', status, excludeCanceled }) : getStageVersionSamples(agentId!, versionIds, { startDate, endDate }, excludeCanceled),
    enabled: !!agentId && (daily || !!candidate), staleTime: 30_000 });
  const scope = [workspaceId, agentId, view, startDate, endDate, excludeCanceled, ...(daily ? [status] : versionIds)].join('-');
  const error = workers.error ?? (!daily ? versions.error : undefined) ?? query.error;
  const data = error ? undefined : query.data;
  const emptySelection = workers.data?.length === 0 || (!daily && versions.data?.length === 0);
  const refresh = () => { void workers.refetch(); if (!daily && agentId) void versions.refetch(); if (agentId && (daily || candidate)) void query.refetch(); };
  const versionOptions = versionList.map(row => ({ value: String(row.agentVersionId), label: t('cohorts.versionChoice', {
    version: row.agentVersionNo == null ? t('stages.versionFallback', { id: row.agentVersionId }) : t('stages.versionNumber', { version: row.agentVersionNo }),
    current: row.currentAgentVersion ? t('cohorts.currentSuffix') : '',
  }) }));

  return <>
    <div className="stage-page-filters">
      <Select aria-label={t('stages.agent')} value={agentId} placeholder={t('stages.agent')} showSearch optionFilterProp="label"
        onChange={setWorker} loading={workers.isLoading} options={workerList.map(row => ({ value: String(row.id), label: row.name || t('stages.agentFallback', { id: row.id }) }))} />
      {daily && <Select aria-label={t('stages.dispatchStatus')} value={status} placeholder={t('stages.allStatuses')} allowClear
        onChange={setStatus} options={Object.entries(DISPATCH_KEYS).map(([value, key]) => ({ value, label: t(key) }))} />}
      <Button aria-label={t('stages.refresh')} onClick={refresh} loading={query.isFetching || workers.isFetching || versions.isFetching}>{t('stages.refresh')}</Button>
    </div>
    {!daily && <div className="stage-scope-controls">
      <label>{t('cohorts.baseline')}<Select aria-label={t('cohorts.baseline')} value={baseline && String(baseline.agentVersionId)}
        placeholder={t('cohorts.noBaseline')} disabled={versionList.length < 2} onChange={value => { if (value === String(candidate?.agentVersionId)) setCandidate(baseline && String(baseline.agentVersionId)); setBaseline(value); }} loading={versions.isLoading}
        options={versionOptions} /></label>
      <label>{t('cohorts.candidate')}<Select aria-label={t('cohorts.candidate')} value={candidate && String(candidate.agentVersionId)}
        onChange={value => { if (value === String(baseline?.agentVersionId)) setBaseline(candidate && String(candidate.agentVersionId)); setCandidate(value); }} loading={versions.isLoading} options={versionOptions} /></label>
      <span className="stage-muted">{t('cohorts.versionScope', { limit: data?.sampleLimit ?? 30 })}</span>
    </div>}
    {error && <Alert type="error" showIcon message={t('stages.loadFailure')} description={error instanceof Error ? error.message : undefined}
      action={<Button aria-label={t('stages.retry')} onClick={refresh}>{t('stages.retry')}</Button>} />}
    {!error && emptySelection ? <Empty description={t('cohorts.empty')} /> :
      <StageDurationComparison key={scope} data={data} view={view} candidate={candidate} baseline={baseline}
        loading={workers.isLoading || (!daily && versions.isLoading) || query.isLoading} />}
    <Collapse ghost className="stage-method" items={[{ key: 'method', label: t('timeline.method'), children: <>
      <p>{t(daily ? 'cohorts.dailyMethod' : 'cohorts.versionMethod')}</p><p>{t('timeline.stageMethod')}</p><p>{t('stages.waitMethod')}</p><p>{t('evolution.conditionDetailsNote')}</p>
      {daily && <p>{t('cohorts.configurationChartNote')}</p>}
      <p>{t('evolution.stageIdentityNote')}</p><p>{t('comparison.totalMethod')}</p><p>{t('cohorts.historyNote')}</p>
    </> }]} />
  </>;
}
