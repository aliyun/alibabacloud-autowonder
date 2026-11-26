import type { StageDurationFlowSnapshot, StageDurationStepSample, StageDurationVersionSample, StageSnapshotStep } from './types';

export function stageLabelKey<T extends string>(labels: Record<string, T>, value: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(labels, value) ? labels[value] : undefined;
}

export const stageStatusKeys = {
  done: 'stages.status.done', active: 'stages.status.active', failed: 'stages.status.failed',
  paused: 'stages.status.paused', cancelled: 'stages.status.cancelled', interrupted: 'stages.status.interrupted',
  reused: 'stages.status.reused', skipped: 'stages.status.skipped', pending: 'stages.status.pending',
} as const;

export const stageDispatchStatusKeys = {
  PENDING: 'stages.dispatchStates.pending', PACKAGING: 'stages.dispatchStates.packaging',
  DISPATCHED: 'stages.dispatchStates.dispatched', ACKED: 'stages.dispatchStates.acked', RUNNING: 'stages.dispatchStates.running',
  PAUSING: 'stages.dispatchStates.pausing', PAUSED: 'stages.dispatchStates.paused', PAUSE_FAILED: 'stages.dispatchStates.pauseFailed',
  WAITING_FOR_PAUSE: 'stages.dispatchStates.waitingForPause', SUCCEEDED: 'stages.dispatchStates.succeeded',
  FAILED: 'stages.dispatchStates.failed', TIMEOUT: 'stages.dispatchStates.timeout', CANCELED: 'stages.dispatchStates.canceled',
} as const;

export type StageComparisonView = 'daily' | 'versions';
export interface StageConfigurationGroup {
  key: string;
  samples: StageDurationVersionSample[];
  snapshot?: StageDurationFlowSnapshot;
}

export function stageDefinitions(samples: StageDurationVersionSample[], snapshot?: StageDurationFlowSnapshot) {
  const stages = new Map([...samples].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .flatMap(row => row.stages.map(stage => [stage.key, stage] as const)));
  snapshot?.configuration.steps.forEach((step, index) => {
    const numericId = /^[1-9]\d*$/.test(step.id);
    const key = `${snapshot.sdlcId}:${numericId ? 'id' : 'key'}:${step.id}`;
    const stepId = numericId ? step.id : null;
    if (!stages.has(key) && !stages.has(`${snapshot.sdlcId}:key:${step.id}`)) stages.set(key, { key, stepId, stepOrder: index + 1,
      name: step.name ?? null, status: 'pending', durationMs: null });
  });
  return [...stages.values()].sort((a, b) => (a.stepOrder ?? Infinity) - (b.stepOrder ?? Infinity) || a.key.localeCompare(b.key));
}

// Historical code/order/name fallbacks cannot identify the same stage across configurations.
export const hasRecordedStageIdentity = (stage: StageDurationStepSample) => stage.stepId != null || /^\d+:id:/.test(stage.key);

export type StageSnapshotIndex = ReadonlyMap<string, StageDurationFlowSnapshot>;
type SnapshotSource = StageDurationFlowSnapshot[] | StageSnapshotIndex;

export function indexStageSnapshots(snapshots: SnapshotSource): StageSnapshotIndex {
  return Array.isArray(snapshots) ? new Map(snapshots.map(snapshot => [String(snapshot.id), snapshot])) : snapshots;
}

export function stageConfigurationGroups(samples: StageDurationVersionSample[], snapshots: SnapshotSource): StageConfigurationGroup[] {
  const configurations = indexStageSnapshots(snapshots);
  const groups = new Map<string, StageConfigurationGroup>();
  const recordedAt = (snapshot?: StageDurationFlowSnapshot) => Date.parse(snapshot?.capturedAt ?? '');
  for (const sample of samples) {
    const found = configurations.get(String(sample.snapshotId));
    const snapshot = found && String(found.sdlcId) === String(sample.sdlcId) && found.contentHash ? found : undefined;
    const key = `${sample.sdlcId ?? 'unknown'}:${snapshot?.contentHash ?? 'unknown'}`;
    const group = groups.get(key) ?? { key, samples: [], snapshot };
    // Recapturing identical content does not make it a newer configuration.
    const time = recordedAt(snapshot), previous = recordedAt(group.snapshot);
    if (Number.isFinite(time) && (!Number.isFinite(previous) || time < previous)) group.snapshot = snapshot;
    group.samples.push(sample); groups.set(key, group);
  }
  // Snapshot insertion/recovery time is not a publication date. Sort by actual use.
  const lastUsed = (group: StageConfigurationGroup) => Math.max(...group.samples.map(row => Date.parse(row.createdAt)));
  return [...groups.values()].sort((a, b) => lastUsed(b) - lastUsed(a));
}

export function previousStageConfiguration(groups: StageConfigurationGroup[], current: StageConfigurationGroup) {
  if (!current.snapshot) return undefined;
  const firstUse = Math.min(...current.samples.map(row => Date.parse(row.createdAt)));
  if (!Number.isFinite(firstUse)) return undefined;
  let latest = -Infinity, previous: StageDurationFlowSnapshot | undefined;
  for (const group of groups) {
    if (group.key === current.key || String(group.snapshot?.sdlcId) !== String(current.snapshot.sdlcId)) continue;
    for (const row of group.samples) {
      const at = Date.parse(row.createdAt);
      if (at < firstUse && at > latest) { latest = at; previous = group.snapshot; }
    }
  }
  return previous;
}

const executionDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });

// Both daily buckets and sample boundaries use the backend's execution-date timezone.
export function stageExecutionDate(createdAt: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  const parts = executionDateFormat.formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export function observedRange(samples: StageDurationVersionSample[]) {
  let first = Infinity, last = -Infinity;
  for (const row of samples) {
    const time = Date.parse(row.createdAt);
    if (Number.isFinite(time)) { first = Math.min(first, time); last = Math.max(last, time); }
  }
  return { start: Number.isFinite(first) ? stageExecutionDate(new Date(first).toISOString()) : '',
    end: Number.isFinite(last) ? stageExecutionDate(new Date(last).toISOString()) : '' };
}

export function summarizeStageExecutions(samples: StageDurationVersionSample[]) {
  const completed = samples.filter(row => row.complete && row.durationMs != null);
  return {
    samples, completed, count: samples.length,
    cumulative: samples.reduce((total, row) => total + (row.durationMs ?? 0), 0),
    measured: samples.filter(row => row.durationMs != null).length,
    ...durationMetrics(completed.map(row => row.durationMs!)),
  };
}

function durationMetrics(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return {
    average: n ? sorted.reduce((sum, value) => sum + value, 0) / n : null,
    p50: n ? n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : null,
    p90: n ? sorted[Math.ceil(n * .9) - 1] : null,
  };
}

export type StageTimeBasis = 'total' | 'adjusted';

export function stageSampleDuration(stage: Pick<StageDurationStepSample, 'durationMs' | 'timing'>, basis: StageTimeBasis) {
  return basis === 'adjusted' ? stage.timing?.afterKnownWaitMs ?? stage.durationMs : stage.durationMs;
}

export function stageDurationStatistics(samples: StageDurationVersionSample[], key: string, basis: StageTimeBasis = 'total', snapshots: SnapshotSource = []) {
  const stageId = key.match(/^\d+:id:(.+)$/)?.[1];
  const configurations = indexStageSnapshots(snapshots);
  const applicable = samples.filter(row => {
    const snapshot = configurations.get(String(row.snapshotId));
    // Only a verified configuration can prove that a missing stage was not applicable.
    return !stageId || !snapshot?.contentHash || String(snapshot.sdlcId) !== String(row.sdlcId) || row.stages.some(stage => stage.key === key)
      || snapshot.configuration.steps.some(step => String(step.id) === stageId);
  });
  const stages = applicable.flatMap(row => {
    const stage = row.stages.find(item => item.key === key);
    return stage ? [stage] : [];
  });
  const completed = stages.filter(stage => stage.status === 'done' && stage.durationMs != null && Number.isFinite(stage.durationMs) && stage.durationMs >= 0);
  let classified = 0, elapsed = 0, fullyClassified = 0;
  for (const stage of completed) {
    const duration = stage.durationMs!, timing = stage.timing;
    elapsed += duration + (timing?.unobservedTailMs ?? 0);
    classified += Math.max(0, duration - (timing?.unknownMs ?? duration));
    if (timing?.instrumented && timing.unknownMs === 0 && timing.unobservedTailMs === 0) fullyClassified++;
  }
  return { count: applicable.length, observed: stages.length, measured: completed.length, excluded: applicable.length - completed.length,
    coverage: elapsed ? classified / elapsed : null, fullyClassified: completed.length > 0 && fullyClassified === completed.length,
    ...durationMetrics(completed.map(stage => stageSampleDuration(stage, basis)!)) };
}

export function canCompareStageTiming(basis: StageTimeBasis, before: ReturnType<typeof stageDurationStatistics>, after: ReturnType<typeof stageDurationStatistics>) {
  return basis === 'total' || (before.fullyClassified && after.fullyClassified);
}

export function slowestStageSamples(samples: StageDurationVersionSample[], key: string, basis: StageTimeBasis) {
  return samples.flatMap(sample => {
    const stage = sample.stages.find(item => item.key === key);
    return stage ? [{ ...sample, status: stage.status, durationMs: stage.durationMs, timing: stage.timing }] : [];
  }).sort((a, b) => (stageSampleDuration(b, basis) ?? -1) - (stageSampleDuration(a, basis) ?? -1)
    || a.dispatchId - b.dispatchId).slice(0, 10);
}

const STEP_FIELDS = ['name', 'kind', 'required', 'instruction', 'checklist', 'gatePolicy', 'timeoutSeconds', 'retryBudget'] as const;
export type SnapshotDiffField = typeof STEP_FIELDS[number] | 'position' | 'workflow' | 'outputContract' | 'other';
export interface SnapshotDifference {
  key: string;
  type: 'added' | 'removed' | 'modified';
  name: string | undefined;
  before?: StageSnapshotStep;
  after?: StageSnapshotStep;
  fields: { key: SnapshotDiffField; before: unknown; after: unknown }[];
}

export function snapshotValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(canonical(value), null, 2);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value != null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function compareStageSnapshots(before: StageDurationFlowSnapshot, after: StageDurationFlowSnapshot): SnapshotDifference[] {
  const remaining = (value: object | undefined, known: readonly string[]) => Object.fromEntries(
    Object.entries(value ?? {}).filter(([key]) => !known.includes(key)));
  const older = before.configuration.steps, newer = after.configuration.steps;
  const keys = [...new Set([...newer.map(step => step.id), ...older.map(step => step.id)])];
  const changes: SnapshotDifference[] = [];
  for (const id of keys) {
    const a = older.find(step => step.id === id), b = newer.find(step => step.id === id);
    const fields: SnapshotDifference['fields'] = STEP_FIELDS.filter(key => !same(a?.[key], b?.[key]))
      .map(key => ({ key, before: a?.[key], after: b?.[key] }));
    const extraBefore = remaining(a, ['id', ...STEP_FIELDS]), extraAfter = remaining(b, ['id', ...STEP_FIELDS]);
    if (!same(extraBefore, extraAfter)) fields.push({ key: 'other', before: extraBefore, after: extraAfter });
    if (a && b && older.indexOf(a) !== newer.indexOf(b)) fields.unshift({ key: 'position', before: older.indexOf(a) + 1, after: newer.indexOf(b) + 1 });
    if (!a || !b || fields.length) changes.push({ key: id, type: !a ? 'added' : !b ? 'removed' : 'modified', name: b?.name ?? a?.name, before: a, after: b, fields });
  }
  const fields: SnapshotDifference['fields'] = (['workflow', 'outputContract'] as const)
    .filter(key => !same(before.configuration[key], after.configuration[key]))
    .map(key => ({ key, before: before.configuration[key], after: after.configuration[key] }));
  const extraBefore = remaining(before.configuration, ['steps', 'workflow', 'outputContract']);
  const extraAfter = remaining(after.configuration, ['steps', 'workflow', 'outputContract']);
  if (!same(extraBefore, extraAfter)) fields.push({ key: 'other', before: extraBefore, after: extraAfter });
  if (fields.length) changes.push({ key: 'configuration', type: 'modified', name: undefined, fields });
  return changes;
}
