import { describe, expect, it } from 'vitest';
import { stageLabelKey, stageStatusKeys, observedRange, compareStageSnapshots, previousStageConfiguration, slowestStageSamples, stageConfigurationGroups, stageDefinitions, stageDurationStatistics, stageExecutionDate, summarizeStageExecutions } from './stageVersionComparison';
import type { StageDurationFlowSnapshot, StageDurationVersionSample } from './types';

it('uses a translated fallback for labels outside the stage dictionary', () => {
  expect(stageLabelKey(stageStatusKeys, 'done')).toBe('stages.status.done');
  expect(stageLabelKey(stageStatusKeys, 'constructor')).toBeUndefined();
});

const sample = (version: number | null, durationMs: number | null, complete = true): StageDurationVersionSample => ({
  dispatchId: version ?? 0, workitemId: 1, title: '用户内容', agentId: 7, agentName: '员工', agentVersionId: version,
  agentVersionNo: version, currentAgentVersion: version === 2, status: complete ? 'SUCCEEDED' : 'RUNNING',
  createdAt: '2026-10-22T00:00:00Z', durationMs, complete, sdlcId: 5, sdlcName: '流程', snapshotId: 40, snapshotSource: 'CAPTURED', stages: [],
});
const snapshot = (id: number): StageDurationFlowSnapshot => ({ id, sdlcId: 5, contentHash: String(id), capturedAt: '2026-10-22T00:00:00Z', configuration: { steps: [] } });

describe('stage version trends', () => {
  it('compares observed instants across timestamp precision and ignores invalid dates', () => {
    const at = (createdAt: string) => ({ ...sample(1, 1), createdAt });
    expect(observedRange([at('bad'), at('2026-10-22T00:00:00.001+08:00'), at('2026-10-21T15:59:59Z')])).toEqual({ start: '2026-10-21', end: '2026-10-22' });
  });

  it('formats ISO execution dates independently of the localized display format', () => {
    const display = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'format')!;
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', { configurable: true, get: () => () => '01/02/2026' });
    try { expect(stageExecutionDate('2026-01-01T16:01:00Z')).toBe('2026-01-02'); }
    finally { Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', display); }
  });

  it('finds the previous observed configuration across reuse, unknown and foreign groups', () => {
    const at = (day: number) => ({ ...sample(day, 100), createdAt: `2026-10-${day}T00:00:00Z` });
    const current = { key: 'new', snapshot: snapshot(41), samples: [at(22)] };
    const prior = snapshot(40);
    const groups = [current, { key: 'unknown', samples: [at(21)] }, { key: 'foreign', snapshot: { ...snapshot(50), sdlcId: 6 }, samples: [at(21)] },
      { key: 'old', snapshot: prior, samples: [at(20)] }];
    expect(previousStageConfiguration(groups, current)).toBe(prior);
    expect(previousStageConfiguration(groups, groups[1])).toBeUndefined();
    expect(previousStageConfiguration(groups, groups[3])).toBeUndefined();
    groups[3].samples.push(at(23)); // A -> B -> A: the merged A group now sorts ahead of B.
    expect(previousStageConfiguration([groups[3], current], current)).toBe(prior);
    expect(previousStageConfiguration([groups[3], current], groups[3])).toBeUndefined();
  });

  it('shows only executions containing the selected stage without inventing pending detail rows', () => {
    const observed = { ...sample(2, null), stages: [{ key: 'a', stepId: 1, stepOrder: 1, name: 'A', status: 'active', durationMs: null }] };
    const result = slowestStageSamples([sample(1, 900), observed], 'a', 'total');
    expect(result.map(row => row.dispatchId)).toEqual([2]);
    expect(result[0].status).toBe('active');
    expect(result[0].durationMs).toBeNull();
    expect(slowestStageSamples([observed], 'missing', 'total')).toEqual([]);
    const renamed = { ...observed, createdAt: '2026-10-22T00:00:00.001Z',
      stages: [{ ...observed.stages[0], name: 'Renamed', stepOrder: 2 }] };
    for (const rows of [[renamed, observed], [observed, renamed]])
      expect(stageDefinitions(rows)).toEqual(renamed.stages);
  });

  it('uses completed stage samples even when the execution configuration is unknown, without counting partial stages', () => {
    const stage = { key: 'a', stepId: 1, stepOrder: 1, name: 'A', status: 'done', durationMs: 100 };
    const rows = [
      { ...sample(1, 100, false), snapshotId: null, stages: [stage] },
      { ...sample(2, 0), stages: [{ ...stage, durationMs: 0 }] },
      { ...sample(3, 500, false), stages: [{ ...stage, status: 'active', durationMs: 500 }] },
      { ...sample(4, 900, false), stages: [{ ...stage, status: 'failed', durationMs: 900 }] },
      { ...sample(5, null, false), stages: [{ ...stage, durationMs: null }] },
      { ...sample(6, 0), stages: [{ ...stage, status: 'reused', durationMs: 0 }] },
      { ...sample(7, 0), stages: [{ ...stage, status: 'skipped', durationMs: 0 }] },
    ];
    expect(stageDurationStatistics(rows, 'a')).toEqual({ count: 7, observed: 7, measured: 2, excluded: 5, coverage: 0, fullyClassified: false, average: 50, p50: 50, p90: 100 });
    expect(stageDurationStatistics(rows, 'missing').average).toBeNull();
    expect(summarizeStageExecutions([rows[0]]).average).toBeNull();
  });

  it('subtracts each completed sample before reordering quantiles, retaining legacy unknown time', () => {
    const stage = { key: 'a', stepId: 1, stepOrder: 1, name: 'A', status: 'done', durationMs: 100 };
    const timing = { instrumented: true, externalWaitMs: 85, otherWaitMs: 5, unknownMs: 10, processingMs: 0,
      afterKnownWaitMs: 10, unobservedTailMs: 0, observationDelayMs: 0, operations: [] };
    const rows = [
      { ...sample(1, 100), stages: [{ ...stage, timing }] },
      { ...sample(1, 70), stages: [{ ...stage, durationMs: 70 }] },
      { ...sample(2, 30), stages: [{ ...stage, durationMs: 30, timing: { ...timing, externalWaitMs: 0, otherWaitMs: 0, processingMs: 30, unknownMs: 0, afterKnownWaitMs: 30 } }] },
    ];
    expect(stageDurationStatistics(rows, 'a')).toMatchObject({ measured: 3, p50: 70, p90: 100 });
    expect(stageDurationStatistics(rows, 'a', 'adjusted')).toMatchObject({ measured: 3, p50: 30, p90: 70,
      coverage: 0.6, fullyClassified: false });
    expect(stageDurationStatistics(rows.slice(2), 'a', 'adjusted')).toMatchObject({ p50: 30, coverage: 1, fullyClassified: true });
    const partial = { ...stage, durationMs: 5, timing: { ...timing, unknownMs: 10 } };
    expect(stageDurationStatistics([{ ...rows[2], stages: [partial] }], 'a', 'adjusted').coverage).toBe(0);
  });

  it('keeps workflow identity and verified configuration separate, pooling identical captured content only', () => {
    const rows = [sample(1, 100), { ...sample(2, 200), snapshotId: 41 },
      { ...sample(3, 300), sdlcId: 6, snapshotId: 42 }, { ...sample(4, 400), snapshotId: 99 },
      { ...sample(5, 500), snapshotId: 42 }];
    const groups = stageConfigurationGroups(rows, [snapshot(40), { ...snapshot(41), contentHash: '40' }, { ...snapshot(42), sdlcId: 6 }]);
    expect(groups.map(group => group.samples.map(row => row.agentVersionNo))).toEqual([[1, 2], [3], [4, 5]]);
    expect(groups.map(group => group.snapshot?.id)).toEqual([40, 42, undefined]);
  });

  it('counts executions with no stage in the denominator and rejects invalid durations without treating missing as zero', () => {
    const stage = { key: 'a', stepId: 1, stepOrder: 1, name: 'A', status: 'done', durationMs: 0 };
    const rows = [sample(1, null), { ...sample(2, 0), stages: [stage, stage] },
      { ...sample(3, -1), stages: [{ ...stage, durationMs: -1 }] }];
    expect(stageDurationStatistics(rows, 'a')).toEqual({ count: 3, observed: 2, measured: 1, excluded: 2, coverage: null, fullyClassified: false, average: 0, p50: 0, p90: 0 });
    expect(stageDurationStatistics(rows, 'missing')).toMatchObject({ count: 3, observed: 0, measured: 0, excluded: 3, p50: null });
    expect(stageExecutionDate('2026-01-01T16:01:00Z')).toBe('2026-01-02');
    expect(stageExecutionDate('')).toBe('');
  });

  it('excludes stages absent from a verified configuration while retaining missing or unknown evidence', () => {
    const stage = { key: '5:id:10', stepId: 10, stepOrder: 1, name: 'A', status: 'done', durationMs: 20 };
    const rows = [{ ...sample(1, 20), stages: [stage] }, sample(2, null),
      { ...sample(3, null), snapshotId: 41 }, { ...sample(4, null), snapshotId: null }];
    const snapshots = [{ ...snapshot(40), sdlcId: '5', configuration: { steps: [{ id: '10' }] } }, { ...snapshot(41), sdlcId: '5' }];
    expect(stageDurationStatistics(rows, stage.key, 'total', snapshots)).toMatchObject({ count: 3, measured: 1, excluded: 2 });
    expect(stageDurationStatistics(rows, '5:id:99', 'total', snapshots)).toMatchObject({ count: 1, measured: 0, excluded: 1 });
    expect(stageDurationStatistics(rows, '5:id:99', 'total', snapshots.map(item => ({ ...item, sdlcId: '6' })))).toMatchObject({ count: 4 });
    expect(stageDurationStatistics(rows, '5:key:build', 'total', snapshots)).toMatchObject({ count: 4, measured: 0, excluded: 4 });
    const large = { ...stage, key: '5:id:9007199254740993', stepId: '9007199254740993' };
    expect(stageDefinitions([{ ...rows[0], stages: [large] }], {
      ...snapshot(40), configuration: { steps: [{ id: large.stepId }] },
    })).toEqual([large]);
    for (const id of ['build', '10']) {
      const legacy = { ...stage, key: `5:key:${id}`, stepId: null };
      expect(stageDefinitions([{ ...rows[0], stages: [legacy] }], {
        ...snapshot(40), configuration: { steps: [{ id }, { id: '11' }] },
      })).toEqual([legacy, expect.objectContaining({ key: '5:id:11', stepId: '11', status: 'pending', durationMs: null })]);
    }
  });

  it('orders configurations by actual use rather than snapshot insertion or recovery time', () => {
    const rows = [
      { ...sample(1, 100), snapshotId: 41, createdAt: '2026-10-27T00:00:00Z' },
      { ...sample(2, 200), snapshotId: 50 }, sample(3, 300), { ...sample(4, 400), snapshotId: null },
    ];
    const groups = stageConfigurationGroups(rows, [snapshot(40),
      { ...snapshot(41), contentHash: '40', capturedAt: '2026-10-26T00:00:00Z' },
      { ...snapshot(50), capturedAt: '2026-10-25T00:00:00Z' }]);
    expect(groups.map(group => group.snapshot?.id)).toEqual([40, 50, undefined]);
    expect(groups[0].samples).toHaveLength(2);
    expect(groups[0].snapshot?.capturedAt).toBe('2026-10-22T00:00:00Z');
  });

  it('computes total percentiles from complete executions, never from the sum of stage percentiles', () => {
    const summary = summarizeStageExecutions([sample(1, 102), sample(2, 100), sample(3, 102), sample(4, 200, false), sample(5, null, false)]);
    expect(summary.p50).toBe(102);
    expect(summary.p90).toBe(102);
    expect(summary.average).toBe(304 / 3);
    expect(summary.cumulative).toBe(504);
    expect(summary.completed).toHaveLength(3);
    expect(summary.count).toBe(5);
    expect(summarizeStageExecutions([sample(1, null, false)]).average).toBeNull();
    expect(summarizeStageExecutions([sample(1, 0)]).average).toBe(0);
  });

  it('shows added, removed, renamed, reordered and policy changes without matching by display name', () => {
    const before = snapshot(40), after = snapshot(41);
    before.configuration.steps = [{ id: '10', name: '旧名', instruction: '原始指令' }, { id: '11', name: '复核' }];
    after.configuration.steps = [{ id: '12', name: '复核' }, { id: '10', name: '新名', instruction: '原始指令', retryBudget: 2 }];
    after.configuration.outputContract = { reviewerHandoffRequired: true };
    Object.assign(after.configuration, { policyVersion: 2 });
    Object.assign(after.configuration.steps[1], { capabilities: ['document-search'] });
    const diff = compareStageSnapshots(before, after);
    expect(diff.map(row => [row.key, row.type])).toEqual([['12', 'added'], ['10', 'modified'], ['11', 'removed'], ['configuration', 'modified']]);
    expect(diff[1].fields.map(field => field.key)).toEqual(['position', 'name', 'retryBudget', 'other']);
    expect(diff[1].fields.at(-1)?.after).toEqual({ capabilities: ['document-search'] });
    expect(diff[3].fields.at(-1)?.after).toEqual({ policyVersion: 2 });
    expect(compareStageSnapshots(before, before)).toEqual([]);
  });
});
