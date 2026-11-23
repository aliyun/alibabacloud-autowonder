import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { init } from 'echarts/core';
import { server } from '@/test/mocks/server';
import { i18n } from '@/shared/i18n';
import { DeliveryAnalysis } from './DeliveryAnalysis';

vi.mock('echarts/core', () => ({ use: vi.fn(), init: vi.fn() }));
const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };

// antd Tooltip 延迟出现，负向断言必须等过该延迟，否则回归会被漏过。
async function waitPastTooltipDelay() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
}

const metrics = (overrides: Record<string, unknown> = {}) => ({
  delivered: 21, human: 2.3, humanTotal: 9, humanStartedDeliveries: 5,
  autonomous: 4, autonomousRequirements: 3, duration: 35.4, durationSamples: 12, durationMissing: 1,
  resolution: 87.5, resolutionEligible: 8, resolutionSolved: 7, resolutionObserving: 0,
  night: 3, holiday: 1, workhours: 12.5, offhours: 3, regularhours: 9.5,
  skill: 6, versions: 8, versionTypes: { SKILL: 5, MCP: 2, HOOK: 1 },
  ...overrides,
});

const report = {
  days: 90, start: '2026-08-06T00:00:00', end: '2026-11-03T18:00:00',
  summary: metrics(),
  weeks: [
    { start: '2026-09-01T00:00:00', end: '2026-09-08T00:00:00', partial: false, displayStart: '2026-09-01', displayEnd: '2026-09-07', metrics: metrics({ duration: 30, durationSamples: 5 }) },
    { start: '2026-09-08T00:00:00', end: '2026-09-15T00:00:00', partial: false, displayStart: '2026-09-08', displayEnd: '2026-09-14', metrics: metrics({ duration: 40, durationSamples: 7 }) },
  ],
  unclosedSessions: 0, unclassifiedEvents: 0,
};

const CALIBER = /口径：统计所选周期内「开始交付」的需求轮次/;

function ok(data: unknown) {
  return { success: true, code: '0', message: '', traceId: null, data };
}

function deliveryHandler(payload: unknown = report) {
  return http.get('/api/insights/delivery-analysis', ({ request }) => {
    expect(new URL(request.url).searchParams.get('days')).toBe('90');
    return HttpResponse.json(ok({ status: 'READY', report: payload, errorCode: null }));
  });
}

function renderAnalysis() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><DeliveryAnalysis /></QueryClientProvider>);
}

async function durationCard() {
  const value = await screen.findByText('35.4小时');
  return value.closest('.delivery-card--duration') as HTMLElement;
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN');
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(init).mockImplementation(node => {
    if (!node) throw new Error('Chart host is required');
    node.appendChild(document.createElement('svg'));
    return { ...chart, dispose: () => { node.replaceChildren(); chart.dispose(); } } as unknown as ReturnType<typeof init>;
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});

afterEach(async () => { await i18n.changeLanguage('zh-CN'); });

describe('DeliveryAnalysis duration caliber', () => {
  it('renders the headline with a labelled caliber badge while other metrics stay unchanged', async () => {
    server.use(deliveryHandler());
    renderAnalysis();

    const card = await durationCard();
    expect(within(card).getByText('需求交付平均耗时')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '查看需求交付平均耗时口径' })).toBeInTheDocument();
    // Other indicators on the same page keep their values and wording.
    expect(screen.getByText('总完成需求21个')).toBeInTheDocument();
    expect(screen.getByText('2.3次')).toBeInTheDocument();
    expect(screen.getByText('共计4次交付')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
  });

  it('shows the caliber tooltip on hover and on keyboard focus', async () => {
    server.use(deliveryHandler());
    renderAnalysis();

    const card = await durationCard();
    const badge = within(card).getByRole('button', { name: '查看需求交付平均耗时口径' });
    const user = userEvent.setup();

    await user.hover(badge);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(CALIBER);

    await user.unhover(badge);
    await waitPastTooltipDelay();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => { badge.focus(); });
    expect(await screen.findByRole('tooltip')).toHaveTextContent(CALIBER);
  });

  it('keeps focus on other keys and closes the focused tooltip with Escape', async () => {
    server.use(deliveryHandler());
    renderAnalysis();

    const card = await durationCard();
    const badge = within(card).getByRole('button', { name: '查看需求交付平均耗时口径' });

    act(() => { badge.focus(); });
    expect(await screen.findByRole('tooltip')).toHaveTextContent(CALIBER);
    fireEvent.keyDown(badge, { key: 'ArrowDown' });
    expect(badge).toHaveFocus();

    fireEvent.keyDown(badge, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).not.toBe(badge));
    await waitPastTooltipDelay();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('keeps the badge and tooltip usable when the window has no duration sample', async () => {
    server.use(deliveryHandler({
      ...report,
      summary: metrics({ duration: null, durationSamples: 0 }),
      weeks: [{ start: '2026-09-01T00:00:00', end: '2026-09-08T00:00:00', partial: true, displayStart: '2026-09-01', displayEnd: '2026-09-07', metrics: metrics({ duration: null, durationSamples: 0 }) }],
    }));
    renderAnalysis();

    const heading = await screen.findByText('需求交付平均耗时');
    const card = heading.closest('.delivery-card--duration') as HTMLElement;
    expect(within(card).getByText('—小时')).toBeInTheDocument();
    const badge = within(card).getByRole('button', { name: '查看需求交付平均耗时口径' });

    const user = userEvent.setup();
    await user.hover(badge);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(CALIBER);
  });

  it('provides the paired English aria label and tooltip copy', async () => {
    await act(async () => { await i18n.changeLanguage('en-US'); });
    server.use(deliveryHandler());
    renderAnalysis();

    const value = await screen.findByText('35.4h');
    const card = value.closest('.delivery-card--duration') as HTMLElement;
    const badge = within(card).getByRole('button', { name: 'View delivery duration caliber' });

    const user = userEvent.setup();
    await user.hover(badge);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/the same caliber as the chart/);
  });
});

describe('DeliveryAnalysis natural-week presentation', () => {
  const fullWeek = {
    start: '2026-09-01T00:00:00', end: '2026-09-08T00:00:00', partial: false,
    displayStart: '2026-09-01', displayEnd: '2026-09-07',
    metrics: metrics({ delivered: 5, resolution: 60, workhours: 4, regularhours: 3, offhours: 1, duration: 30, durationSamples: 5 }),
  };
  const currentWeek = {
    start: '2026-11-09T00:00:00', end: '2026-11-17T16:00:00', partial: true,
    displayStart: '2026-11-09', displayEnd: '2026-11-17',
    metrics: metrics({ delivered: 7, resolution: null, resolutionObserving: 4, workhours: 6, regularhours: 4, offhours: 2, duration: 40, durationSamples: 7 }),
  };
  interface CapturedSeries {
    name?: string;
    data: unknown[];
    label: { show: boolean; formatter: (point: { value?: unknown }) => string };
  }
  interface CapturedOption {
    xAxis: { data: string[]; axisLabel: { rotate: number; fontSize: number; interval: number; formatter?: unknown } };
    series: CapturedSeries[];
    tooltip: { formatter: (params: unknown) => string };
  }
  const capturedOptions = () => vi.mocked(chart.setOption).mock.calls.map(call => call[0] as unknown as CapturedOption);
  const chartOption = (options: CapturedOption[], seriesName: string) => {
    const found = options.find(option => option.series[0]?.name === seriesName);
    if (!found) throw new Error(`chart ${seriesName} was not rendered`);
    return found;
  };

  it('renders all eight charts with two-line ranges, no rotation and dimmed partial buckets', async () => {
    server.use(deliveryHandler({ ...report, weeks: [fullWeek, currentWeek] }));
    renderAnalysis();

    await screen.findByText('总完成需求21个');
    await waitFor(() => expect(chart.setOption.mock.calls.length).toBeGreaterThanOrEqual(8));
    const options = capturedOptions();
    expect(new Set(options.map(option => option.series[0]?.name)).size).toBe(8);
    for (const option of options) {
      expect(option.xAxis.data).toEqual(['09/01\n09/07', '11/09\n11/17']);
      expect(option.xAxis.axisLabel.rotate).toBe(0);
      expect(option.xAxis.axisLabel.formatter).toBeUndefined();
      expect(option.xAxis.data.join(' ')).not.toContain('*');
      expect(option.xAxis.data.join(' ')).not.toContain('不足');
    }

    const delivered = chartOption(options, '需求周交付吞吐趋势');
    expect(delivered.series[0].data[0]).toBe(5);
    expect(delivered.series[0].data[1]).toEqual({ value: 7, itemStyle: { opacity: 0.55 } });
    expect(delivered.series[0].label.formatter({ value: 7 })).toBe('7');

    const current = delivered.tooltip.formatter([{ seriesName: '需求周交付吞吐趋势', dataIndex: 1, value: 7, marker: '' }]);
    expect(current).toContain('2026/11/09 – 2026/11/17');
    expect(current).toContain('本周尚未结束');
    const edge = delivered.tooltip.formatter([{ seriesName: '需求周交付吞吐趋势', dataIndex: 0, value: 5, marker: '' }]);
    expect(edge).toContain('2026/09/01 – 2026/09/07');
    expect(edge).not.toContain('不足自然周');

    const resolution = chartOption(options, '新需求7日解决率');
    const observing = resolution.tooltip.formatter([{ seriesName: '新需求7日解决率', dataIndex: 1, value: null }]);
    expect(observing).toContain('另有 4 个需求未满 7 天，未计入分母');
    expect(observing).toContain('—');
    const resolved = resolution.tooltip.formatter([{ seriesName: '新需求7日解决率', dataIndex: 0, value: 60 }]);
    expect(resolved).toContain('60%');
    expect(resolved).not.toContain('未计入分母');

    const hours = chartOption(options, '工作时间段');
    const hoursTooltip = hours.tooltip.formatter([
      { seriesName: '工作时间段', dataIndex: 1, value: 4 },
      { seriesName: '非工作时间段（含夜间和周末节假日）', dataIndex: 1, value: 2 },
    ]);
    expect(hoursTooltip).toContain('工作时间段');
    expect(hoursTooltip).toContain('非工作时间段（含夜间和周末节假日）');
    expect(hours.tooltip.formatter([{ seriesName: '工作时间段', dataIndex: 1, value: 4 }])).toContain('本周尚未结束');
    expect(delivered.tooltip.formatter([{ seriesName: '趋势拟合', dataIndex: 0, value: 1 }])).toBe('');
    expect(delivered.tooltip.formatter({ seriesName: '需求周交付吞吐趋势', value: 5 })).toContain('2026/09/01 – 2026/09/07');
  });

  it('shows a single page-level note while any bucket is partial', async () => {
    server.use(deliveryHandler({ ...report, weeks: [fullWeek, currentWeek] }));
    renderAnalysis();

    expect(await screen.findByText(/半透明柱\/点/)).toBeInTheDocument();
    expect(screen.getAllByText(/半透明柱\/点/)).toHaveLength(1);
  });

  it('hides the page-level note when every bucket is a full natural week', async () => {
    server.use(deliveryHandler({ ...report, weeks: [
      fullWeek,
      { ...fullWeek, start: '2026-09-08T00:00:00', end: '2026-09-15T00:00:00', displayStart: '2026-09-08', displayEnd: '2026-09-14' },
    ] }));
    renderAnalysis();

    await screen.findByText('总完成需求21个');
    expect(screen.queryByText(/半透明柱\/点/)).not.toBeInTheDocument();
  });

  it('condenses labels from the chart container width, not the viewport', async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 455 });
    try {
      server.use(deliveryHandler({ ...report, weeks: Array.from({ length: 14 }, () => fullWeek) }));
      renderAnalysis();

      await screen.findByText('总完成需求21个');
      await waitFor(() => expect(chart.setOption.mock.calls.length).toBeGreaterThanOrEqual(8));
      const delivered = chartOption(capturedOptions(), '需求周交付吞吐趋势');
      expect(delivered.xAxis.axisLabel.interval).toBe(1);
      expect(delivered.series[0].label.show).toBe(false);
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
      else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });

  it('redraws only when a resize crosses a label density tier', async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    let width = 455;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
      observe() {}
      disconnect() {}
    });
    try {
      server.use(deliveryHandler({ ...report, weeks: Array.from({ length: 14 }, () => fullWeek) }));
      renderAnalysis();

      await screen.findByText('总完成需求21个');
      await waitFor(() => expect(callbacks.length).toBe(8));
      const initial = chart.setOption.mock.calls.length;

      act(() => { callbacks.forEach(callback => callback([], {} as ResizeObserver)); });
      expect(chart.setOption.mock.calls.length).toBe(initial);
      expect(chart.resize).toHaveBeenCalled();

      width = 700;
      act(() => { callbacks.forEach(callback => callback([], {} as ResizeObserver)); });
      expect(chart.setOption.mock.calls.length).toBeGreaterThan(initial);
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
      else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });
});
