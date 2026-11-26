import { formatDuration } from '@/shared/lib/duration';
import { stageLabelKey, stageDispatchStatusKeys, stageStatusKeys, type StageTimeBasis } from '../stageVersionComparison';
import { useTranslation } from 'react-i18next';
import { Space, Tag, Tooltip } from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import { formatDateTime, formatNumber } from '@/shared/i18n/format';
import { i18n } from '@/shared/i18n';
import type { StageDurationSample, StageDurationStage } from '../types';

const STATUS_KEYS = { ...stageStatusKeys, ...stageDispatchStatusKeys };

const OPERATION_KEYS = {
  external_call: 'stages.operationKinds.externalCall', external_task: 'stages.operationKinds.externalTask',
  local: 'stages.operationKinds.local', internal: 'stages.operationKinds.internal', unknown: 'stages.operationKinds.unknown',
} as const;

export function StageSampleCount({ valid, total, coverage }: { valid: number; total: number; coverage?: number | null }) {
  const { t } = useTranslation('insights');
  return <span className="stage-sample-count">
    <span>{t('cohorts.validCount', { valid, all: total })}</span>
    {coverage !== undefined && <small>{t('stages.classification', { coverage: coverage == null ? t('stages.noValue') :
      formatNumber(coverage, { style: 'percent', maximumFractionDigits: 1 }) })}</small>}
    {valid > 0 && valid < 5 && <Tooltip trigger={['hover', 'focus']} title={t('evolution.smallSampleHint')}>
      <Tag color="gold" tabIndex={0}>{t('evolution.smallSample')}</Tag>
    </Tooltip>}
  </span>;
}

export function StageVersionLabel({ sample }: { sample: Pick<StageDurationSample | StageDurationStage, 'agentVersionId' | 'agentVersionNo' | 'currentAgentVersion'> }) {
  const { t } = useTranslation('insights');
  return <Space wrap size={4}>
    <span>{sample.agentVersionNo != null ? t('stages.versionNumber', { version: sample.agentVersionNo })
      : sample.agentVersionId != null ? t('stages.versionFallback', { id: sample.agentVersionId }) : t('stages.unknownVersion')}</span>
    {sample.currentAgentVersion && <Tag color="green">{t('stages.currentVersion')}</Tag>}
  </Space>;
}

export function formatStageDuration(ms?: number | null): string {
  if (ms == null) return i18n.t('stages.noValue', { ns: 'insights' });
  if (ms >= 3_600_000) return formatDuration(ms / 1000);
  let scaled = ms;
  if (ms >= 60_000) scaled /= 60_000;
  else if (ms >= 1000) scaled /= 1000;
  const value = formatNumber(scaled, { maximumFractionDigits: 1 });
  if (ms < 1000) return i18n.t('comparison.milliseconds', { ns: 'insights', value });
  if (ms < 60_000) return i18n.t('comparison.seconds', { ns: 'insights', value });
  return i18n.t('comparison.minutes', { ns: 'insights', value });
}

export function formatStageDateTime(value: string) {
  return formatDateTime(value, { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function StageDurationDetails({ samples, total = false, basis = 'total' }: { samples: StageDurationSample[]; total?: boolean; basis?: StageTimeBasis }) {
  const { t } = useTranslation('insights');
  const duration = formatStageDuration;
  return <div>
    <p className="insight-caption">{t(total ? 'comparison.slowestNote' : basis === 'adjusted' ? 'stages.adjustedSlowest' : 'stages.slowestNote')}</p>
    <Table<StageDurationSample> rowKey={sample => sample.dispatchId} pagination={false} dataSource={samples}
      expandable={total ? undefined : {
        rowExpandable: sample => !!sample.timing?.operations?.length || !!sample.timing?.observationDelayMs || !!sample.timing?.omittedOperationGroups,
        expandedRowRender: sample => <div>
          {!!sample.timing?.observationDelayMs && <p>{t('stages.observationDelay', { time: duration(sample.timing.observationDelayMs) })}</p>}
          <p>{t('stages.operationNote')}</p>
          {!!sample.timing?.omittedOperationGroups && <p>{t('stages.operationsOmitted', { groups: sample.timing.omittedOperationGroups })}</p>}
          <Table rowKey={op => JSON.stringify([op.target, op.operation, op.kind])} size="small" pagination={false}
            dataSource={sample.timing?.operations ?? []} columns={[
              { title: t('stages.service'), dataIndex: 'target' }, { title: t('stages.operation'), dataIndex: 'operation' },
              { title: t('stages.operationKind'), dataIndex: 'kind', render: (kind: string) => t(stageLabelKey(OPERATION_KEYS, kind) ?? 'stages.operationKinds.unknown') },
              { title: t('stages.operationCount'), dataIndex: 'count' }, { title: t('stages.operationDuration'), dataIndex: 'durationMs', render: duration },
            ]} />
        </div>,
      }} scroll={{ x: total ? 1100 : 1720 }} columns={[
      { title: t('stages.workitem'), width: 260, render: (_, sample) => <a href={`/workitems/${sample.workitemId}`}><EllipsisText>{t('stages.workitemLabel', { id: sample.workitemId, title: sample.title })}</EllipsisText></a> },
      { title: t('stages.execution'), dataIndex: 'dispatchId', width: 100, render: (id: number) => t('stages.id', { id }) },
      { title: t('stages.agent'), width: 160, render: (_, sample) => sample.agentName || (sample.agentId == null ? '—' : t('stages.agentFallback', { id: sample.agentId })) },
      { title: t('stages.agentVersion'), width: 180, render: (_, sample) => <StageVersionLabel sample={sample} /> },
      { title: t('stages.createdAt'), dataIndex: 'createdAt', width: 160, render: formatStageDateTime },
      { title: t('stages.state'), dataIndex: 'status', width: 110, render: (status: string) => <Tag>{t(stageLabelKey(STATUS_KEYS, status) ?? 'stages.status.unknown')}</Tag> },
      { title: t(total ? 'comparison.totalPerExecution' : 'stages.duration'), dataIndex: 'durationMs', width: 150,
        render: duration },
      ...(!total ? [
        { title: t('stages.externalWait'), width: 150, render: (_: unknown, sample: StageDurationSample) =>
          sample.timing?.externalWaitMs == null ? t('stages.unclassified') : duration(sample.timing.externalWaitMs) },
        { title: t('stages.otherWait'), width: 140, render: (_: unknown, sample: StageDurationSample) => duration(sample.timing?.otherWaitMs) },
        { title: t('stages.afterKnownWait'), width: 180, render: (_: unknown, sample: StageDurationSample) => duration(sample.timing?.afterKnownWaitMs ?? sample.durationMs) },
        { title: t('stages.unknown'), width: 150, render: (_: unknown, sample: StageDurationSample) => <div>{duration(sample.timing?.unknownMs ?? sample.durationMs)}
          {!!sample.timing?.unobservedTailMs && <small>{t('stages.tailValue', { time: duration(sample.timing.unobservedTailMs) })}</small>}</div> },
      ] : []),
    ]} />
  </div>;
}
