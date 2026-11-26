import { Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import { DEFAULT_RANGE_PRESET_DAYS, isTimeRangeDateDisabled, TimeRangePicker } from '@/shared/ui/TimeRangePicker';

/** 与「数据洞察 - 人机交互」页相同的预设：近 7 / 30 / 90 / 180 天。 */
export const RANGE_PRESET_DAYS = DEFAULT_RANGE_PRESET_DAYS;

/**
 * 与 insights 页一致的可选范围：不晚于今天，不早于「昨天往前 180 天」；
 * 配合 useInsightDateRange 的 maxDays=181 保证窗口最长 181 个自然日。
 */
export function isDashboardDateDisabled(current: Dayjs): boolean {
  return isTimeRangeDateDisabled(current, dayjs().subtract(1, 'day'), 181);
}

/** RangePicker 保留日期校验和弹层；外露预设截止昨天，手工非预设显示自定义。 */
export function TimeWindowFilter({ value, onChange, ariaLabel }: {
  value: [Dayjs, Dayjs];
  onChange: (value: [Dayjs, Dayjs]) => void;
  ariaLabel: string;
}) {
  const { t } = useTranslation(['insights', 'spaceDashboard']);
  const end = dayjs().subtract(1, 'day');
  const selectedPreset = RANGE_PRESET_DAYS.find((days) =>
    value[1].isSame(end, 'day') && value[0].isSame(end.subtract(days - 1, 'day'), 'day'));

  return (
    <div className="space-dashboard-time-window">
      <TimeRangePicker
        ariaLabel={ariaLabel}
        popupClassName="space-dashboard-date-popup"
        end={end}
        value={value}
        onChange={onChange}
      />
      <Select<number | 'custom'>
        className="space-dashboard-range-preset"
        aria-label={ariaLabel}
        value={selectedPreset ?? 'custom'}
        options={[
          ...RANGE_PRESET_DAYS.map((days) => ({ value: days, label: t('participation.lastDays', { count: days }) })),
          { value: 'custom', label: t('spaceDashboard:range.custom'), disabled: true },
        ]}
        onChange={(days) => {
          if (typeof days === 'number' && (RANGE_PRESET_DAYS as readonly number[]).includes(days)) {
            onChange([end.subtract(days - 1, 'day'), end]);
          }
        }}
      />
    </div>
  );
}
