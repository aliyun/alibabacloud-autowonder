/** Formatting and density rules for delivery bucket labels; kept pure so they are unit-testable. */

export const PARTIAL_OPACITY = 0.55;

export interface WeekRange {
  /** 后端新增的展示区间；旧版本只返回 start/end，读不到时回退。 */
  displayStart?: string;
  displayEnd?: string;
  start?: string;
  end?: string;
}

const day = (week: WeekRange, edge: 'start' | 'end'): string => {
  const display = edge === 'start' ? week.displayStart : week.displayEnd;
  if (display) return display;
  const timestamp = edge === 'start' ? week.start : week.end;
  return timestamp ? timestamp.slice(0, 10) : '';
};

export interface LabelDensity {
  interval: number;
  fontSize: number;
  valueFontSize: number;
  showValue: boolean;
}

export type ChartPoint = number | { value: number; itemStyle: { opacity: number } } | null;

/** Two-line axis label: start date over end date, both MM/DD. */
export const axisRange = (week: WeekRange): string =>
  `${day(week, 'start').slice(5).replace('-', '/')}\n${day(week, 'end').slice(5).replace('-', '/')}`;

/** Tooltip range keeps the year so windows crossing New Year stay unambiguous. */
export const tooltipRange = (week: WeekRange): string =>
  `${day(week, 'start').replace(/-/g, '/')} – ${day(week, 'end').replace(/-/g, '/')}`;

/**
 * Labels are sized from the chart container width, not the viewport: two-line labels need
 * about 34px per bucket. Once labels have to be condensed, value labels are hidden too:
 * the measured three-column card gives ~32.5px per bucket and its value labels would collide.
 */
export function labelDensity(width: number, count: number): LabelDensity {
  const perLabel = width > 0 && count > 0 ? width / count : 34;
  return {
    interval: perLabel >= 34 ? 0 : Math.ceil(34 / perLabel) - 1,
    fontSize: perLabel >= 44 ? 10 : 9,
    valueFontSize: perLabel >= 48 ? 11 : 10,
    showValue: perLabel >= 34,
  };
}

export const bucketPoint = (value: number | null, partial: boolean): ChartPoint =>
  value == null ? null : partial ? { value, itemStyle: { opacity: PARTIAL_OPACITY } } : value;
