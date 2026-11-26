import { describe, expect, it } from 'vitest';
import { mergeStageDuration } from './stageDurationMerge';
import type { StageDurationPlan, StageDurationReport, StageDurationStage } from './types';

const plan = (overrides: Partial<StageDurationPlan> = {}): StageDurationPlan => ({
  snapshot: { maxDispatchId: 99, calculatedAt: '2026-01-07T08:00:00Z' },
  mode: 'sharded',
  executionCount: 10,
  workitemCount: 4,
  notApplicableExecutionCount: 2,
  recoverableSnapshotCount: 3,
  firstExecutionDate: '2026-01-01',
  lastExecutionDate: '2026-01-07',
  shards: [{ sdlcId: 5, sdlcName: 'Flow 5', executionCount: 6, oversized: false }],
  ...overrides,
});

const stage = (key: string, totalDurationMs: number): StageDurationStage => ({
  key, agentId: null, agentName: null, agentVersionId: null, agentVersionNo: null, currentAgentVersion: null,
  sdlcId: Number(key.split(':')[0]), sdlcName: null, stepId: 1, stepOrder: 1, name: key,
  sampleCount: 1, completedCount: 1, activeCount: 0, incompleteCount: 0, reusedCount: 0, skippedCount: 0,
  missingDurationCount: 0, totalDurationMs, averageDurationMs: totalDurationMs, medianDurationMs: totalDurationMs,
  p90DurationMs: totalDurationMs, slowest: [],
});

const report = (overrides: Partial<StageDurationReport> = {}): StageDurationReport => ({
  startDate: '2026-01-02', endDate: '2026-01-06', timezone: 'Asia/Shanghai', calculatedAt: '2026-01-06T00:00:00Z',
  executionCount: 6, workitemCount: 1, measuredExecutionCount: 5, stageExecutionCount: 6, noStageExecutionCount: 0,
  notApplicableExecutionCount: 0, missingDurationCount: 1, totalDurationMs: 100, stages: [],
  recoverableSnapshotCount: 1, ...overrides,
});

describe('mergeStageDuration', () => {
  it('sums additive counters while every overview-only field keeps the plan value', () => {
    const merged = mergeStageDuration(plan(), [
      { sdlcId: 5, report: report({ stages: [stage('5:id:1', 40)], totalDurationMs: 40, measuredExecutionCount: 2,
        stageExecutionCount: 2, noStageExecutionCount: 0, missingDurationCount: 0 }) },
      { sdlcId: 6, report: report({ stages: [stage('6:id:1', 60)], totalDurationMs: 60, measuredExecutionCount: 2,
        stageExecutionCount: 3, noStageExecutionCount: 1, missingDurationCount: 1, timezone: 'UTC' }) },
    ]);
    expect(merged.executionCount).toBe(10);
    expect(merged.workitemCount).toBe(4);
    expect(merged.notApplicableExecutionCount).toBe(2);
    expect(merged.recoverableSnapshotCount).toBe(3);
    expect(merged.startDate).toBe('2026-01-01');
    expect(merged.endDate).toBe('2026-01-07');
    expect(merged.calculatedAt).toBe('2026-01-07T08:00:00Z');
    expect(merged.totalDurationMs).toBe(100);
    expect(merged.measuredExecutionCount).toBe(4);
    expect(merged.stageExecutionCount).toBe(5);
    expect(merged.noStageExecutionCount).toBe(1);
    expect(merged.missingDurationCount).toBe(1);
    expect(merged.timezone).toBe('Asia/Shanghai');
  });

  it('concatenates stages, keeps same-named stages of different flows apart and sorts by duration then key', () => {
    const merged = mergeStageDuration(plan(), [
      { sdlcId: 5, report: report({ stages: [stage('5:id:1', 30), stage('5:id:2', 50)] }) },
      { sdlcId: 6, report: report({ stages: [stage('6:id:1', 50), stage('6:id:3', 10)] }) },
    ]);
    expect(merged.stages.map(row => row.key)).toEqual(['5:id:2', '6:id:1', '5:id:1', '6:id:3']);
    expect(new Set(merged.stages.map(row => row.key)).size).toBe(4);
  });

  it('returns the overview counts for an empty or partially loaded result set', () => {
    const empty = mergeStageDuration(plan(), []);
    expect(empty).toMatchObject({ executionCount: 10, workitemCount: 4, totalDurationMs: 0,
      measuredExecutionCount: 0, stages: [], timezone: 'Asia/Shanghai' });
    const partial = mergeStageDuration(plan(), [{ sdlcId: 5, report: report({ stages: [stage('5:id:1', 25)] }) }]);
    expect(partial.executionCount).toBe(10);
    expect(partial.totalDurationMs).toBe(100);
    expect(partial.stages).toHaveLength(1);
  });
});
