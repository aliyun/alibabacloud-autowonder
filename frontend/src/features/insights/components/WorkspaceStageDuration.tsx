import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Select, Space, Statistic, Tag, Typography } from 'antd';
import { MinusOutlined, PlusOutlined } from '@ant-design/icons';
import { Table } from '@/shared/theme/ThemedTable';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import { useAuthStore } from '@/shared/auth/store';
import { formatNumber } from '@/shared/i18n/format';
import { formatStageDateTime, formatStageDuration } from './StageDurationDetails';
import { stageLabelKey, stageStatusKeys as STATUS_KEYS } from '../stageVersionComparison';
import { listAllSquads } from '@/features/squad/api';
import { listAllSdlcTemplates } from '@/features/sdlc/api';
import { getStageDuration, getStageDurationPlan } from '../api';
import { mergeStageDuration } from '../stageDurationMerge';
import { useInsightPreference } from '../useInsightPreference';
import type { StageDurationSample, StageDurationStage } from '../types';

const positiveId = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
// Measured on the ft database: three concurrent shards already contend, more only slows every request down.
const SHARD_CONCURRENCY = 3;

export function WorkspaceStageDuration({ startDate, endDate, excludeCanceled }: {
  startDate: string; endDate: string; excludeCanceled: boolean;
}) {
  const { t } = useTranslation('insights');
  const workspaceId = useAuthStore(s => s.currentWorkspace?.id);
  const [squadId, setSquadId] = useInsightPreference<number | undefined>('stages.squad', undefined, positiveId);
  const [sdlcId, setSdlcId] = useInsightPreference<string | number | undefined>('stages.flow', undefined,
    value => positiveId(value) || (typeof value === 'string' && /^[1-9]\d*$/.test(value)));
  const squads = useQuery({ queryKey: ['stage-duration-squads', workspaceId], queryFn: () => listAllSquads(), staleTime: 60_000 });
  const flows = useQuery({ queryKey: ['stage-duration-flows', workspaceId], queryFn: () => listAllSdlcTemplates(), staleTime: 60_000 });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const filters = { startDate, endDate, squadId, sdlcId, excludeCanceled };
  const planQuery = useQuery({ queryKey: ['stage-duration-plan', workspaceId, startDate, endDate, squadId, sdlcId, excludeCanceled, refreshNonce],
    queryFn: () => getStageDurationPlan(filters), staleTime: 30_000, retry: 0 });
  const plan = planQuery.data;
  // An older backend without /plan keeps serving the aggregate directly; caching the error avoids re-probing.
  const fallback = planQuery.isError;
  const sharded = !fallback && !!plan && plan.mode === 'sharded' && plan.executionCount > 0;
  const shards = sharded && plan ? plan.shards : [];
  const maxDispatchId = plan?.snapshot.maxDispatchId ?? null;
  const shardScope = `${maxDispatchId}:${shards.map(shard => shard.sdlcId).join(',')}:${refreshNonce}`;
  const [gate, setGate] = useState({ scope: '', settled: 0 });
  const settled = gate.scope === shardScope ? gate.settled : 0;
  const shardQueries = useQueries({
    queries: shards.map((shard, index) => ({
      queryKey: ['stage-duration-shard', workspaceId, startDate, endDate, squadId, sdlcId, excludeCanceled, maxDispatchId, shard.sdlcId, refreshNonce],
      queryFn: () => getStageDuration({ ...filters, sdlcId: shard.sdlcId, maxDispatchId }),
      // Only a settled shard opens the next slot, so at most SHARD_CONCURRENCY stay in flight.
      enabled: index < SHARD_CONCURRENCY || index - SHARD_CONCURRENCY < settled,
      staleTime: 30_000,
      retry: 0,
    })),
  });
  const settledNow = shardQueries.filter(shard => shard.isFetched).length;
  useEffect(() => {
    setGate(previous => previous.scope === shardScope && previous.settled === settledNow
      ? previous : { scope: shardScope, settled: settledNow });
  }, [shardScope, settledNow]);
  const singleQuery = useQuery({ queryKey: ['stage-duration', workspaceId, 'stage', startDate, endDate, squadId, sdlcId, excludeCanceled, maxDispatchId, refreshNonce],
    queryFn: () => getStageDuration({ ...filters, maxDispatchId }),
    enabled: fallback || (!!plan && plan.mode === 'single' && plan.executionCount > 0),
    staleTime: 30_000 });
  const loaded = shardQueries.flatMap((query, index) => query.data ? [{ sdlcId: shards[index].sdlcId, report: query.data }] : []);
  const failedShards = shardQueries.flatMap((query, index) => query.isError ? [shards[index]] : []);
  const data = fallback ? singleQuery.data : sharded && plan ? mergeStageDuration(plan, loaded) : singleQuery.data;
  const error = fallback ? singleQuery.error : sharded ? undefined : singleQuery.error;
  const loading = planQuery.isLoading || (!sharded && singleQuery.isLoading);
  const duration = formatStageDuration;
  const stageName = (stage: StageDurationStage) => stage.name || t('stages.stageFallback', { id: stage.stepId ?? stage.stepOrder ?? '—' });
  const emptyText = error ? t('stages.unavailable') : t('stages.empty');
  // Every shard failing is not the same as an empty range: keep the failure alerts and drop the "no data" copy,
  // which would otherwise read as if the filters simply matched nothing.
  const allShardsFailed = sharded && shards.length > 0 && loaded.length === 0 && failedShards.length === shards.length;
  const tableLoading = loading || (sharded && loaded.length === 0 && !allShardsFailed);
  const refreshing = planQuery.isFetching || singleQuery.isFetching || shardQueries.some(shard => shard.isFetching);
  const samples = (stage: StageDurationStage) => <div>
    <p className="insight-caption">{t('stages.slowestNote')}</p>
    <Table<StageDurationSample> rowKey={sample => sample.dispatchId} pagination={false} dataSource={stage.slowest} scroll={{ x: 850 }} columns={[
      { title: t('stages.workitem'), width: 260, render: (_, sample) => <a href={`/workitems/${sample.workitemId}`}><EllipsisText>{t('stages.workitemLabel', { id: sample.workitemId, title: sample.title })}</EllipsisText></a> },
      { title: t('stages.execution'), dataIndex: 'dispatchId', width: 100, render: (id: number) => t('stages.id', { id }) },
      { title: t('stages.agent'), dataIndex: 'agentName', width: 160, render: (name: string | null) => name || '—' },
      { title: t('stages.createdAt'), dataIndex: 'createdAt', width: 160, render: formatStageDateTime },
      { title: t('stages.state'), dataIndex: 'status', width: 110, render: (status: string) => <Tag>{t(stageLabelKey(STATUS_KEYS, status) ?? 'stages.status.unknown')}</Tag> },
      { title: t('stages.duration'), dataIndex: 'durationMs', width: 130, render: (ms: number | null) => duration(ms) },
    ]} />
  </div>;

  return <>
    <div className="insight-toolbar">
      <Select aria-label={t('stages.squad')} placeholder={t('stages.allSquads')} allowClear showSearch optionFilterProp="label"
        value={squadId} onChange={setSquadId} loading={squads.isLoading} style={{ minWidth: 180 }}
        options={squads.data?.map(squad => ({ value: squad.id, label: squad.name }))} />
      <Select aria-label={t('stages.flow')} placeholder={t('stages.allFlows')} allowClear showSearch optionFilterProp="label"
        value={sdlcId == null ? undefined : String(sdlcId)} onChange={setSdlcId} loading={flows.isLoading} style={{ minWidth: 220 }}
        options={flows.data?.items.map(flow => ({ value: String(flow.id), label: flow.name }))} />
      <Button aria-label={t('stages.refresh')} onClick={() => setRefreshNonce(nonce => nonce + 1)} loading={refreshing}>{t('stages.refresh')}</Button>
    </div>
    {(squads.isError || flows.isError) && <Alert type="warning" showIcon message={t('stages.filtersFailure')}
      action={<Button aria-label={t('stages.retry')} onClick={() => { void squads.refetch(); void flows.refetch(); }}>{t('stages.retry')}</Button>} />}
    {error && <Alert type="error" showIcon message={t('stages.loadFailure')} description={error instanceof Error ? error.message : undefined}
      action={<Button aria-label={t('stages.retry')} onClick={() => setRefreshNonce(nonce => nonce + 1)}>{t('stages.retry')}</Button>} />}
    {sharded && (loaded.length < shards.length || failedShards.length > 0) && <div className="stage-shard-status" role="status">
      <span>{t('stages.progress', { loaded: loaded.length, total: shards.length })}</span>
      {failedShards.length > 0 && <span className="stage-shard-status-failed">{t('stages.partialFailure')}</span>}
    </div>}
    {sharded && shards.some(shard => shard.oversized) && <div className="stage-shard-status"><Tag color="warning">{t('stages.oversized')}</Tag></div>}
    {failedShards.map(shard => <Alert key={shard.sdlcId} type="error" showIcon
      message={t('stages.shardFailed', { name: shard.sdlcName || t('stages.flowFallback', { id: shard.sdlcId }) })}
      action={<Button aria-label={t('stages.retryShard')} onClick={() => { void shardQueries[shards.findIndex(row => row.sdlcId === shard.sdlcId)]?.refetch(); }}>{t('stages.retryShard')}</Button>} />)}
    <p className="insight-caption">{t('stages.scope')}</p>
    <div className="participation-stats">
      <Card className="participation-stat"><Statistic loading={loading} title={t('stages.executions')} value={plan ? formatNumber(plan.executionCount) : data ? formatNumber(data.executionCount) : '—'} /></Card>
      <Card className="participation-stat"><Statistic loading={loading} title={t('stages.workitems')} value={plan ? formatNumber(plan.workitemCount) : data ? formatNumber(data.workitemCount) : '—'} /></Card>
      <Card className="participation-stat"><Statistic loading={loading} title={t('stages.totalDuration')} value={duration(data?.totalDurationMs)} /></Card>
      <Card className="participation-stat"><Statistic loading={loading} title={t('stages.coverage')} value={data ? `${formatNumber(data.measuredExecutionCount)} / ${formatNumber(data.stageExecutionCount ?? data.executionCount)}` : '—'} />
        <div className="participation-stat-detail">{data ? t('stages.coverageDetail', { missing: data.missingDurationCount, noStage: data.noStageExecutionCount ?? 0, notApplicable: data.notApplicableExecutionCount ?? 0 }) : t('stages.noValue')}</div></Card>
    </div>
    <Card title={t('stages.breakdown')} extra={data ? t('stages.calculatedAt', { time: formatStageDateTime(data.calculatedAt) }) : undefined}>
      <p className="insight-caption">{t('stages.method')}</p>
      <Table<StageDurationStage> key={`${workspaceId}-${startDate}-${endDate}-${squadId}-${sdlcId}-${excludeCanceled}-${maxDispatchId}`} rowKey={stage => stage.key} dataSource={data?.stages ?? []}
        loading={tableLoading} locale={{ emptyText: allShardsFailed ? null : emptyText }} pagination={{ pageSize: 20, showSizeChanger: false }} scroll={{ x: 1320 }}
        expandable={{ expandedRowRender: samples, rowExpandable: stage => stage.slowest.length > 0,
          expandIcon: ({ expanded, onExpand, record }) => <Button size="small" type="text" aria-expanded={expanded}
            aria-label={t(expanded ? 'stages.hideSamples' : 'stages.showSamples', { stage: stageName(record) })}
            onClick={event => onExpand(record, event)} icon={expanded ? <MinusOutlined aria-hidden="true" /> : <PlusOutlined aria-hidden="true" />} /> }}
        columns={[
          { title: t('stages.flow'), dataIndex: 'sdlcName', width: 210, render: (name: string | null, stage) => <EllipsisText>{name || t('stages.flowFallback', { id: stage.sdlcId })}</EllipsisText> },
          { title: t('stages.stage'), width: 240, render: (_, stage) => <EllipsisText>{stageName(stage)}</EllipsisText> },
          { title: t('stages.totalDuration'), width: 170, sorter: (a, b) => a.totalDurationMs - b.totalDurationMs, defaultSortOrder: 'descend', render: (_, stage) => {
            const share = data?.totalDurationMs ? stage.totalDurationMs / data.totalDurationMs * 100 : 0;
            return <div className="stage-duration-bar"><span>{duration(stage.totalDurationMs)} <small>{formatNumber(share / 100, { style: 'percent', maximumFractionDigits: 1 })}</small></span><progress max={100} value={share} aria-label={t('stages.share', { stage: stageName(stage) })} /></div>;
          } },
          { title: t('stages.average'), dataIndex: 'averageDurationMs', width: 130, render: duration },
          { title: t('stages.median'), dataIndex: 'medianDurationMs', width: 130, render: duration },
          { title: t('stages.p90'), dataIndex: 'p90DurationMs', width: 130, render: duration },
          { title: t('stages.samples'), dataIndex: 'sampleCount', width: 100, render: (count: number) => formatNumber(count) },
          { title: t('stages.state'), width: 240, render: (_, stage) => <Space direction="vertical" size={0}>
            <span>{t('stages.progressDetail', { completed: stage.completedCount, active: stage.activeCount, incomplete: stage.incompleteCount })}</span>
            <Typography.Text type="secondary">{t('stages.reuseDetail', { reused: stage.reusedCount, skipped: stage.skippedCount, missing: stage.missingDurationCount })}</Typography.Text>
          </Space> },
        ]} />
    </Card>
  </>;
}
