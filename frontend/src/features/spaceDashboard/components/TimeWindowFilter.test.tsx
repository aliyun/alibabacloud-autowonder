import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import { i18n } from '@/shared/i18n';
import { TimeWindowFilter, isDashboardDateDisabled, RANGE_PRESET_DAYS } from './TimeWindowFilter';

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('zh-CN');
});

describe('isDashboardDateDisabled', () => {
  it('blocks future dates and dates before the 181-day floor', () => {
    expect(isDashboardDateDisabled(dayjs().add(1, 'day'))).toBe(true);
    expect(isDashboardDateDisabled(dayjs().subtract(1, 'day').subtract(181, 'day'))).toBe(true);
  });

  it('allows yesterday and the earliest selectable day', () => {
    expect(isDashboardDateDisabled(dayjs().subtract(1, 'day'))).toBe(false);
    expect(isDashboardDateDisabled(dayjs().subtract(1, 'day').subtract(180, 'day'))).toBe(false);
  });
});

describe('TimeWindowFilter', () => {
  it.each(RANGE_PRESET_DAYS)('exposes the %i-day preset outside the calendar, ending yesterday', async (days) => {
    const onChange = vi.fn();
    const end = dayjs().subtract(1, 'day');
    const initialDays = days === 30 ? 7 : 30;
    render(<TimeWindowFilter value={[end.subtract(initialDays - 1, 'day'), end]} onChange={onChange} ariaLabel="统计日期范围" />);
    const select = screen.getByRole('combobox', { name: '统计日期范围' });
    expect(select.closest('.ant-select')).toHaveTextContent(`近${initialDays}天`);
    expect(document.querySelector('.ant-picker-dropdown')).toBeNull();
    await userEvent.click(select);
    const popup = document.getElementById(select.getAttribute('aria-controls')!)!.closest('.ant-select-dropdown')!;
    await userEvent.click(within(popup as HTMLElement).getByText(`近${days}天`));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [range] = onChange.mock.calls[0];
    expect(range[0].format('YYYY-MM-DD')).toBe(end.subtract(days - 1, 'day').format('YYYY-MM-DD'));
    expect(range[1].format('YYYY-MM-DD')).toBe(end.format('YYYY-MM-DD'));
    expect(document.querySelector('.ant-picker-dropdown')).toBeNull();
  });

  it('recognises exact presets and shows Custom for manually selected non-presets', async () => {
    const onChange = vi.fn();
    const end = dayjs().subtract(1, 'day');
    const { rerender } = render(<TimeWindowFilter value={[end.subtract(29, 'day'), end]} onChange={onChange} ariaLabel="统计日期范围" />);
    const [startInput, endInput] = screen.getAllByRole('textbox');
    await userEvent.click(startInput);
    fireEvent.change(startInput, { target: { value: end.subtract(9, 'day').format('YYYY-MM-DD') } });
    await userEvent.keyboard('{Enter}');
    await userEvent.click(endInput);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const manual = onChange.mock.calls.at(-1)![0];
    expect(manual[0].format('YYYY-MM-DD')).toBe(end.subtract(9, 'day').format('YYYY-MM-DD'));
    rerender(<TimeWindowFilter value={manual} onChange={onChange} ariaLabel="统计日期范围" />);
    expect(screen.getByRole('combobox').closest('.ant-select')).toHaveTextContent('自定义');
    rerender(<TimeWindowFilter value={[end.subtract(6, 'day'), end]} onChange={onChange} ariaLabel="统计日期范围" />);
    expect(screen.getByRole('combobox').closest('.ant-select')).toHaveTextContent('近7天');
    rerender(<TimeWindowFilter value={[end.subtract(7, 'day'), end.subtract(1, 'day')]} onChange={onChange} ariaLabel="统计日期范围" />);
    expect(screen.getByRole('combobox').closest('.ant-select')).toHaveTextContent('自定义');
  });

  it('translates the exposed preset and Custom without writing a range on language changes', async () => {
    const onChange = vi.fn();
    const end = dayjs().subtract(1, 'day');
    const { rerender } = render(<TimeWindowFilter value={[end.subtract(6, 'day'), end]} onChange={onChange} ariaLabel="统计日期范围" />);
    await act(async () => { await i18n.changeLanguage('en-US'); });
    expect(screen.getByRole('combobox').closest('.ant-select')).toHaveTextContent('Last 7 days');
    rerender(<TimeWindowFilter value={[end.subtract(9, 'day'), end]} onChange={onChange} ariaLabel="统计日期范围" />);
    expect(screen.getByRole('combobox').closest('.ant-select')).toHaveTextContent('Custom');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('applies the last-7-days preset ending yesterday', async () => {
    const onChange = vi.fn();
    render(
      <TimeWindowFilter
        value={[dayjs().subtract(30, 'day'), dayjs().subtract(1, 'day')]}
        onChange={onChange}
        ariaLabel="统计日期范围"
      />,
    );

    await userEvent.click(screen.getAllByRole('textbox')[0]);
    // 窄屏适配依赖该弹层类名（spaceDashboard.css 的 max-width/overflow-x）。
    await waitFor(() => expect(document.querySelector('.ant-picker-dropdown.space-dashboard-date-popup'))
      .not.toBeNull());
    await userEvent.click(await screen.findByText('近7天'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const [range] = onChange.mock.calls[0];
    expect(range[1].format('YYYY-MM-DD')).toBe(dayjs().subtract(1, 'day').format('YYYY-MM-DD'));
    expect(range[1].diff(range[0], 'day')).toBe(6);
  });
});
