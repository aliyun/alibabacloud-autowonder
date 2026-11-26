import { DatePicker } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';

const { RangePicker } = DatePicker;

export const DEFAULT_RANGE_PRESET_DAYS = [7, 30, 90, 180] as const;

/** 窗口规则：不晚于今天，不早于锚点往前 maxSpanDays-1 天（跨度含首尾）。 */
export function isTimeRangeDateDisabled(current: Dayjs, end: Dayjs, maxSpanDays: number): boolean {
  return !current.isValid() || current > dayjs().endOf('day')
    || current.isBefore(end.subtract(maxSpanDays - 1, 'day'), 'day');
}

/**
 * 全项目统一的日期窗口选择：预设近 N 天、上限今天、最长跨度校验。
 * 数据洞察三个 Tab 与空间级看板共用；end 锚点由调用方按数据截止日传入。
 */
export function TimeRangePicker({ value, onChange, ariaLabel, presetDays = DEFAULT_RANGE_PRESET_DAYS, end, maxSpanDays = 181, presetLabel, popupClassName }: {
  value: [Dayjs, Dayjs];
  onChange: (value: [Dayjs, Dayjs]) => void;
  ariaLabel: string;
  presetDays?: readonly number[];
  /** 预设与下界锚点；默认昨天。 */
  end?: Dayjs;
  maxSpanDays?: number;
  presetLabel?: (days: number) => string;
  popupClassName?: string;
}) {
  const { t } = useTranslation('insights');
  const anchor = end ?? dayjs().subtract(1, 'day');
  const labelOf = presetLabel ?? ((days: number) => t('participation.lastDays', { count: days }));
  const presets = presetDays.map((days) => ({
    label: labelOf(days),
    value: [anchor.subtract(days - 1, 'day'), anchor] as [Dayjs, Dayjs],
  }));
  const disabled = (current: Dayjs) => isTimeRangeDateDisabled(current, anchor, maxSpanDays);
  return <RangePicker
    aria-label={ariaLabel}
    popupClassName={popupClassName}
    allowClear={false}
    value={value}
    presets={presets}
    onChange={(dates) => {
      if (dates && dates[0] && dates[1]
        && !disabled(dates[0]) && !disabled(dates[1])
        && !dates[0].isAfter(dates[1], 'day')
        && dates[1].startOf('day').diff(dates[0].startOf('day'), 'day') < maxSpanDays) {
        onChange([dates[0], dates[1]]);
      }
    }}
    disabledDate={disabled}
  />;
}
