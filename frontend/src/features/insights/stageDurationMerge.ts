import type { StageDurationPlan, StageDurationReport } from './types';

export interface StageDurationShardResult {
  sdlcId: number;
  report: StageDurationReport;
}

/**
 * Shard responses are workflow-filtered, so executions without a workflow appear in none of them and the
 * additive counters would come up short. Every field that cannot be summed therefore comes from the overview;
 * only the counters that partition cleanly across flows are added.
 */
export function mergeStageDuration(plan: StageDurationPlan, results: StageDurationShardResult[]): StageDurationReport {
  const sum = (pick: (report: StageDurationReport) => number | undefined | null) =>
    results.reduce((total, result) => total + (pick(result.report) ?? 0), 0);
  const stages = results.flatMap(result => result.report.stages)
    .sort((left, right) => right.totalDurationMs - left.totalDurationMs || left.key.localeCompare(right.key));
  return {
    startDate: plan.firstExecutionDate,
    endDate: plan.lastExecutionDate,
    timezone: results[0]?.report.timezone ?? 'Asia/Shanghai',
    calculatedAt: plan.snapshot.calculatedAt,
    executionCount: plan.executionCount,
    workitemCount: plan.workitemCount,
    notApplicableExecutionCount: plan.notApplicableExecutionCount,
    recoverableSnapshotCount: plan.recoverableSnapshotCount,
    measuredExecutionCount: sum(report => report.measuredExecutionCount),
    stageExecutionCount: sum(report => report.stageExecutionCount),
    noStageExecutionCount: sum(report => report.noStageExecutionCount),
    missingDurationCount: sum(report => report.missingDurationCount),
    totalDurationMs: sum(report => report.totalDurationMs),
    stages,
    versionSamples: [],
    flowSnapshots: [],
  };
}
