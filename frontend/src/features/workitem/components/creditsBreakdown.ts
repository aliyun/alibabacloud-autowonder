import { i18n } from '@/shared/i18n';
import type { WorkitemUsageRun, WorkitemUsageSummary } from '@/shared/types/workitem';

export interface CreditRunRowData {
  run: WorkitemUsageRun;
  sourceIndex: number;
}

export function displayRunName(run: WorkitemUsageRun): string {
  // Match Java isBlank/trim used by the owned producer; authored whitespace stays raw in the DTO.
  // eslint-disable-next-line no-control-regex -- Match Java's whitespace definition.
  const nonblank = run.agentName != null && /[^\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]/.test(run.agentName);
  // eslint-disable-next-line no-control-regex -- Java trim removes U+0000 through U+0020.
  if (nonblank) return run.agentName!.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
  return run.agentId != null ? i18n.t('workitem:usage.agentFallback', { id: run.agentId }) : i18n.t('workitem:delivery.unknown');
}

export function creditRunLabel(run: WorkitemUsageRun, index: number): string {
  // 需求澄清按数字员工合并成一行，不占用 run-N 编号。
  if (run.labelKind === 'CLARIFICATION') {
    return i18n.t('workitem:usage.clarificationLabel', { name: displayRunName(run) });
  }
  if (run.labelKind === 'AGENT_RUN') {
    return i18n.t('workitem:usage.runLabel', { name: displayRunName(run), number: run.runIndex ?? index + 1 });
  }
  if (run.label) return run.label;
  const name = run.agentName || (run.agentId != null ? i18n.t('workitem:usage.agentFallback', { id: run.agentId }) : i18n.t('workitem:delivery.unknown'));
  return i18n.t('workitem:usage.runLabel', { name, number: run.runIndex ?? index + 1 });
}

export function creditRuns(usage: WorkitemUsageSummary): CreditRunRowData[] {
  return (usage.runs ?? [])
    .map((run, sourceIndex) => ({ run, sourceIndex }))
    .filter(({ run }) => (run.credits ?? 0) > 0)
    .sort((a, b) => (a.run.runIndex ?? Number.POSITIVE_INFINITY) - (b.run.runIndex ?? Number.POSITIVE_INFINITY) || a.sourceIndex - b.sourceIndex);
}
