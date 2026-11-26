import type { ComponentProps } from 'react';
import type { DatePicker } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import dayjs from 'dayjs';
import { TimeWindowFilter } from './TimeWindowFilter';

type PickerProps = ComponentProps<typeof DatePicker.RangePicker>;
const picker = vi.hoisted(() => ({ props: null as PickerProps | null }));
vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    DatePicker: {
      ...actual.DatePicker,
      RangePicker: (props: PickerProps) => { picker.props = props; return null; },
    },
  };
});

afterEach(cleanup);

// Exercise the callback boundary independently of Ant Design's own calendar guards.
// The companion test file uses the real RangePicker and Select.
describe('TimeWindowFilter range callback validation', () => {
  const end = dayjs().subtract(1, 'day');

  it.each([
    ['incomplete', [end, null]],
    ['cleared', null],
    ['invalid', [dayjs('invalid'), end]],
    ['reversed', [end, end.subtract(1, 'day')]],
    ['future', [end, dayjs().add(1, 'day')]],
    ['before floor / 182 days', [end.subtract(181, 'day'), end]],
    ['182 days ending today', [end.subtract(180, 'day'), dayjs()]],
    ['182 calendar days with different times', [end.subtract(180, 'day').endOf('day'), dayjs().startOf('day')]],
  ] as const)('does not publish %s selections or trigger the consumer query', (_name, dates) => {
    const onChange = vi.fn();
    render(<TimeWindowFilter value={[end.subtract(29, 'day'), end]} onChange={onChange} ariaLabel="范围" />);
    const selection: Parameters<NonNullable<PickerProps['onChange']>>[0] = dates === null ? null : [dates[0], dates[1]];
    act(() => { picker.props!.onChange!(selection, ['', '']); });
    expect(onChange).not.toHaveBeenCalled();
    expect(picker.props!.allowClear).toBe(false);
    expect(picker.props!.popupClassName).toBe('space-dashboard-date-popup');
    expect(picker.props!.value).toEqual([end.subtract(29, 'day'), end]);
  });

  it.each([1, 181])('publishes a valid %i-day range exactly once including the boundary', (days) => {
    const onChange = vi.fn();
    const range: [dayjs.Dayjs, dayjs.Dayjs] = [end.subtract(days - 1, 'day'), end];
    render(<TimeWindowFilter value={[end.subtract(29, 'day'), end]} onChange={onChange} ariaLabel="范围" />);
    act(() => { picker.props!.onChange!(range, ['', '']); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(range);
  });
});
