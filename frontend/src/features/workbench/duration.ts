import type { Workitem } from '@/shared/types/workitem';

export type Translate = (key: string, options?: Record<string, unknown>) => string;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 可读时长：分钟 / 小时 / 天；不足一分钟单独提示，避免显示 0 分钟。 */
export function formatElapsed(elapsedMs: number, translate: Translate): string {
  if (elapsedMs < MINUTE) {
    return translate('duration.lessThanMinute');
  }
  if (elapsedMs < HOUR) {
    return translate('duration.minutes', { value: Math.floor(elapsedMs / MINUTE) });
  }
  if (elapsedMs < DAY) {
    return translate('duration.hours', { value: Math.floor(elapsedMs / HOUR) });
  }
  return translate('duration.days', { value: Math.floor(elapsedMs / DAY) });
}

/**
 * 工作台耗时单元格：数字员工取本轮派发起止，真人取最近一次指派后的等待时长。
 * 缺失可靠起点时如实显示「—」；终态不再继续计时。
 */
export function durationText(
  item: Pick<Workitem, 'roundStartedAt' | 'roundEndedAt' | 'statusCategory'>,
  now: number,
  translate: Translate,
): string {
  const terminal = item.statusCategory === 'DONE' || item.statusCategory === 'CANCELED';
  const startedAt = item.roundStartedAt ? Date.parse(item.roundStartedAt) : null;
  const endedAt = item.roundEndedAt ? Date.parse(item.roundEndedAt) : null;
  if (startedAt == null || Number.isNaN(startedAt)) {
    return terminal
      ? `${translate('duration.none')} / ${translate('duration.ended')}`
      : `${translate('duration.none')} / ${translate('duration.notStarted')}`;
  }
  if (terminal) {
    if (endedAt == null || Number.isNaN(endedAt)) {
      return `${translate('duration.none')} / ${translate('duration.ended')}`;
    }
    return formatElapsed(Math.max(0, endedAt - startedAt), translate);
  }
  const effectiveEnd = endedAt != null && !Number.isNaN(endedAt) ? endedAt : now;
  return formatElapsed(Math.max(0, effectiveEnd - startedAt), translate);
}
