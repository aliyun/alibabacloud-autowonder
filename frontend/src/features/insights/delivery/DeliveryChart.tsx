import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { init, use } from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, AriaComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { metricValue, type DeliveryReport, type Metric } from './types';
import { smoothTrend } from './trend';
import { axisRange, bucketPoint, labelDensity, tooltipRange, type LabelDensity } from './range';

use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, SVGRenderer]);
const LABEL_TOP = 'top' as const;
const AXIS_TRIGGER = 'axis' as const;
const numeric = (value: unknown): number | null => typeof value === 'number' ? value : null;
const colors: Record<Metric, string> = { delivered: '#547de5', resolution: '#24a591', human: '#8970cd',
  autonomous: '#24a591', duration: '#bd8d49', offtime: '#7883c5', workhours: '#547de5', skill: '#24a591' };

interface TooltipParam { seriesName?: string; dataIndex?: number; value?: unknown; marker?: string }

export function DeliveryChart({ report, metric }: { report: DeliveryReport; metric: Metric }) {
  const host = useRef<HTMLDivElement>(null);
  const { t, i18n } = useTranslation('deliveryInsights');
  useEffect(() => {
    if (!host.current) return;
    const node = host.current;
    const chart = init(node, undefined, { renderer: 'svg' });
    const measure = (): LabelDensity => labelDensity(node.clientWidth, report.weeks.length);
    let density = measure();
    const draw = () => {
      const css = getComputedStyle(document.documentElement);
      const text = css.getPropertyValue('--aw-muted').trim() || '#8792a2';
      const border = css.getPropertyValue('--aw-border').trim() || '#e8edf5';
      const hours = metric === 'workhours';
      const dark = document.documentElement.dataset.appearance === 'dark';
      const regularColor = dark ? '#a0b3ca' : '#73869e';
      const offColor = dark ? '#f3b46d' : '#c77624';
      const weeks = report.weeks;
      const values = weeks.map(w => metricValue(w.metrics, metric));
      const points = weeks.map((w, index) => bucketPoint(values[index], w.partial));
      const format = (value: number | null) => value == null ? '—' : new Intl.NumberFormat(i18n.language, {
        maximumFractionDigits: ['human', 'duration', 'workhours', 'resolution'].includes(metric) ? 1 : 0,
      }).format(value) + (metric === 'resolution' ? '%' : metric === 'workhours' || metric === 'duration' ? 'h' : '');
      const paddedHours = Math.max(...weeks.map(w => w.metrics.workhours), 0) * 1.2 || 1;
      const hoursStep = 10 ** (Math.floor(Math.log10(paddedHours)) - 1);
      const hoursMax = Math.ceil(paddedHours / hoursStep) * hoursStep;
      const bar = metric === 'delivered' || metric === 'workhours';
      const base = { name: t(metric), type: bar ? 'bar' as const : 'line' as const, data: points,
        barMaxWidth: hours ? 20 : 34, symbolSize: 6, connectNulls: false, itemStyle: { color: hours ? regularColor : colors[metric] },
        lineStyle: { width: 2 }, label: { show: density.showValue, position: LABEL_TOP, color: hours ? css.getPropertyValue('--aw-text').trim() : text,
          fontSize: density.valueFontSize, distance: hours ? 10 : 5,
          formatter: (p: { value?: unknown }) => format(numeric(p.value)) } };
      const series: EChartsOption['series'] = metric === 'workhours' ? [
        { ...base, name: t('regular'), stack: 'hours', data: weeks.map(w => bucketPoint(w.metrics.regularhours, w.partial)), label: { show: false } },
        { ...base, name: t('offhours'), stack: 'hours', data: weeks.map(w => bucketPoint(w.metrics.offhours, w.partial)),
          itemStyle: { color: offColor }, label: { ...base.label, formatter: (p: { dataIndex: number }) => format(values[p.dataIndex]) } },
      ] : [base, { name: t('trend'), type: 'line', data: smoothTrend(values, weeks.map(w => w.partial)),
        smooth: true, connectNulls: false, symbol: 'none', silent: true, tooltip: { show: false },
        lineStyle: { color: '#e2a15e', type: 'dashed', width: metric === 'delivered' || metric === 'resolution' ? 2 : 1.3 } }];
      const tooltipFormatter = (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as TooltipParam[];
        const visible = items.filter(item => item.seriesName !== t('trend'));
        if (!visible.length) return '';
        const index = visible[0].dataIndex ?? 0;
        const week = weeks[index];
        const reason = week.partial
          ? `<div style="color:#c77624;font-size:11px;margin:2px 0 6px">${t(index === weeks.length - 1 ? 'tooltipPartialEnd' : 'tooltipPartialStart')}</div>`
          : '';
        const rows = visible.map(item => {
          const stacked = item.seriesName === t('regular') || item.seriesName === t('offhours');
          const value = stacked ? numeric(item.value) : values[index];
          return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${item.marker ?? ''}${item.seriesName ?? ''}</span><b>${format(value)}</b></div>`;
        }).join('');
        const observing = metric === 'resolution' && week.metrics.resolution == null && week.metrics.resolutionObserving > 0
          ? `<div style="color:#8792a2;font-size:11px;margin-top:4px">${t('tooltipObserving', { value: week.metrics.resolutionObserving })}</div>`
          : '';
        return `<div style="font-size:12px"><div style="font-weight:600;margin-bottom:4px">${tooltipRange(week)}</div>${reason}${rows}${observing}</div>`;
      };
      chart.setOption({
        animation: false, aria: { enabled: true },
        grid: hours ? { top: 16, left: 40, right: 20, bottom: 38, containLabel: false }
          : { top: 28, left: 18, right: 30, bottom: 30, containLabel: true },
        legend: { show: false },
        tooltip: { trigger: AXIS_TRIGGER, confine: true, formatter: tooltipFormatter },
        xAxis: { type: 'category', boundaryGap: !hours, data: weeks.map(axisRange),
          axisLabel: { color: text, fontSize: density.fontSize, rotate: 0, lineHeight: density.fontSize + 3, interval: density.interval },
          axisLine: { lineStyle: { color: border } }, axisTick: { show: false } },
        yAxis: { type: 'value', min: 0, max: hours ? hoursMax : (v: { max: number }) => v.max > 0 ? v.max * 1.25 : 1, interval: hours ? hoursMax / 2 : undefined,
          axisLabel: { color: text, fontSize: 10, formatter: (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value) },
          splitLine: { lineStyle: { color: border, type: hours ? 'solid' : 'dashed' } } },
        series,
      } satisfies EChartsOption, true);
    };
    draw();
    const resize = new ResizeObserver(() => {
      const next = measure();
      if (next.interval !== density.interval || next.fontSize !== density.fontSize || next.showValue !== density.showValue) {
        density = next;
        draw();
      } else chart.resize();
    });
    resize.observe(node);
    const theme = new MutationObserver(() => { density = measure(); draw(); });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance', 'style'] });
    return () => { resize.disconnect(); theme.disconnect(); chart.dispose(); };
  }, [report, metric, t, i18n.language]);
  return <div className="delivery-chart" ref={host} role="img" aria-label={t(metric)} />;
}
