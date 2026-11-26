import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Empty } from 'antd';
import { formatNumber } from '@/shared/i18n/format';
import { formatDuration, formatDurationCompact } from '@/shared/lib/duration';
import type { DurationSummary, TrendEntry } from '../types';

// 图表按容器实测宽度渲染 viewBox：宽度怎么变，9px 轴文字与线宽都保持原尺寸。
const DAILY_CHART_HEIGHT = 170;
const RATIO_CHART_HEIGHT = 210;
const CHART_LEFT = 38;
const CHART_FALLBACK_WIDTH = 380;
const DONUT = { center: 100, radius: 52, stroke: 16 };

/** 轴刻度候选（秒），保证 4 等分后的刻度值稳定。 */
const AXIS_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 5400, 7200, 10800,
  18000, 21600, 36000, 43200, 54000, 64800, 86400, 108000, 129600, 172800, 259200, 345600, 432000,
  604800, 1209600, 2592000];

export function humanShare(human: number, agent: number, share?: number | null): number | null {
  return share !== undefined ? share : human + agent > 0 ? human / (human + agent) : null;
}

export function cumulativeDurations(trend: TrendEntry[]) {
  let human = 0;
  let agent = 0;
  for (const row of trend) {
    const samples = sampleCount(row);
    human += row.averageHumanSeconds * samples;
    agent += row.averageAgentSeconds * samples;
  }
  return { human, agent, total: human + agent };
}

export function niceAxisMax(peakSeconds: number): number {
  if (peakSeconds <= 0) return 3600;
  const step = AXIS_STEPS.find(value => value >= peakSeconds / 4)
    ?? Math.ceil(peakSeconds / 4 / 604800) * 604800;
  return step * 4;
}

function sampleCount(row: TrendEntry): number {
  return row.sampleSize ?? (row.averageTotalSeconds > 0 ? 1 : 0);
}

function shortLabel(label: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(label) ? label.slice(5) : label;
}

function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.round(el.clientWidth));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function Panel({ title, subtitle, span, children }: { title: string; subtitle: string; span?: boolean; children: ReactNode }) {
  return (
    <section className={`participation-panel${span ? ' is-span' : ''}`}>
      <div className="participation-panel-head"><h3>{title}</h3><span>{subtitle}</span></div>
      {children}
    </section>
  );
}

interface DailyProps { trend: TrendEntry[]; startDate: string; endDate: string; span?: boolean }

export function ParticipationDailyChart({ trend, startDate, endDate, span }: DailyProps) {
  const { t } = useTranslation('insights');
  const [hover, setHover] = useState<number | null>(null);
  const measured = useMeasuredWidth();
  const points = trend.map((row, index) => ({ row, index, samples: sampleCount(row) }));
  const filled = points.filter(point => point.samples > 0);
  const title = t('participation.daily.title');
  const subtitle = t('participation.daily.subtitle');
  if (!filled.length) {
    return <Panel title={title} subtitle={subtitle} span={span}>
      <div className="participation-panel-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('participation.daily.empty')} /></div>
    </Panel>;
  }

  const width = measured.width || CHART_FALLBACK_WIDTH;
  const geometry = { width, height: DAILY_CHART_HEIGHT, left: CHART_LEFT, right: width - 6, top: 16, bottom: DAILY_CHART_HEIGHT - 34 };
  const slot = (geometry.right - geometry.left) / Math.max(points.length, 1);
  const center = (index: number) => geometry.left + slot * (index + 0.5);
  const peak = filled.reduce((best, point) => point.row.averageTotalSeconds > best.row.averageTotalSeconds ? point : best, filled[0]);
  const axisMax = niceAxisMax(Math.max(...filled.map(point => point.row.averageTotalSeconds)));
  const y = (seconds: number) => geometry.bottom - (seconds / axisMax) * (geometry.bottom - geometry.top);
  const ticks = [axisMax, axisMax * 0.75, axisMax * 0.5, axisMax * 0.25];
  const labelStep = Math.max(1, Math.ceil((points.length - 1) / 6));
  const labelIndices: number[] = [];
  for (let index = 0; index < points.length; index += labelStep) labelIndices.push(index);
  if (labelIndices[labelIndices.length - 1] !== points.length - 1) labelIndices.push(points.length - 1);
  const zeroDays = points.filter(point => point.samples === 0).map(point => shortLabel(point.row.label));
  const maxSamples = Math.max(...filled.map(point => point.samples));
  const separator = t('participation.listSeparator');
  const zeroNote = zeroDays.length === 0 ? ''
    : zeroDays.length <= 6
      ? t('participation.daily.zeroDays', { days: zeroDays.join(separator) })
      : t('participation.daily.zeroCount', { total: zeroDays.length });
  const note = [zeroNote, t('participation.daily.noteScale', { max: maxSamples })].filter(Boolean).join(' ');
  const peakX = Math.max(60, Math.min(geometry.right - 40, center(peak.index)));
  const series = [
    { stroke: 'is-total', marker: 'var(--aw-text)', diamond: false, value: (row: TrendEntry) => row.averageTotalSeconds },
    { stroke: 'is-human', marker: 'var(--aw-primary)', diamond: false, value: (row: TrendEntry) => row.averageHumanSeconds },
    { stroke: 'is-agent', marker: 'var(--insight-agent)', diamond: true, value: (row: TrendEntry) => row.averageAgentSeconds },
  ];
  const lineOf = (value: (row: TrendEntry) => number) => filled
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${center(point.index).toFixed(1)},${y(value(point.row)).toFixed(1)}`)
    .join(' ');
  const hovered = hover != null ? points[hover] : null;
  const tooltipLeft = hovered ? Math.min(84, Math.max(16, center(hovered.index) / geometry.width * 100)) : 50;
  const tooltipRows = hovered && hovered.samples > 0 ? [
    { key: 'total', color: 'var(--aw-text)', label: t('participation.daily.legendTotal'), value: hovered.row.averageTotalSeconds },
    { key: 'human', color: 'var(--aw-primary)', label: t('participation.daily.legendHuman'), value: hovered.row.averageHumanSeconds },
    { key: 'agent', color: 'var(--insight-agent)', label: t('participation.daily.legendAgent'), value: hovered.row.averageAgentSeconds },
  ] : [];

  return <Panel title={title} subtitle={subtitle} span={span}>
    <div className="participation-chart-wrap" ref={measured.ref} onMouseLeave={() => setHover(null)}>
      <svg className="participation-chart" viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="img"
        aria-label={t('participation.daily.aria', { start: startDate, end: endDate })}>
        <text className="participation-chart-axis" x={peakX} y={geometry.top - 6} textAnchor="middle">
          {t('participation.daily.peak', { total: peak.samples, date: shortLabel(peak.row.label), duration: formatDurationCompact(peak.row.averageTotalSeconds) })}
        </text>
        {ticks.map(value => <g key={value}>
          <line className="participation-chart-grid-line" x1={geometry.left} y1={y(value)} x2={geometry.right} y2={y(value)} />
          <text className="participation-chart-axis" x={4} y={y(value) + 3}>{formatDurationCompact(value)}</text>
        </g>)}
        <line className="participation-chart-baseline" x1={geometry.left} y1={geometry.bottom} x2={geometry.right} y2={geometry.bottom} />
        <text className="participation-chart-axis" x={4} y={geometry.bottom + 3}>{formatNumber(0)}</text>
        {series.map(item => <g key={item.stroke}>
          <path className={`participation-chart-line ${item.stroke}`} d={lineOf(item.value)} />
          {filled.map(point => {
            const x = center(point.index);
            const cy = y(item.value(point.row));
            return item.diamond
              ? <polygon key={point.index} points={`${x},${cy - 2.6} ${x + 2.6},${cy} ${x},${cy + 2.6} ${x - 2.6},${cy}`} fill={item.marker} />
              : <circle key={point.index} cx={x} cy={cy} r="2.4" fill={item.marker} />;
          })}
        </g>)}
        {labelIndices.map(index => {
          const last = index === points.length - 1;
          return <text key={index} className="participation-chart-axis" x={last ? center(index) + 4 : center(index)} y={geometry.bottom + 14}
            textAnchor={index === 0 ? 'start' : last ? 'end' : 'middle'}>
            {shortLabel(points[index].row.label)}
          </text>;
        })}
        {points.map(point => <rect key={point.index} x={center(point.index) - slot / 2} y={geometry.top}
          width={Math.max(slot, 1)} height={geometry.bottom - geometry.top} fill="transparent"
          onMouseEnter={() => setHover(point.index)} />)}
      </svg>
      {hovered && <div className="participation-tooltip" style={{ left: `${tooltipLeft}%` }} role="status">
        <div className="participation-tooltip-title">
          {hovered.samples > 0
            ? t('participation.daily.tooltipTitle', { date: hovered.row.label, samples: hovered.samples })
            : t('participation.daily.tooltipEmpty', { date: hovered.row.label })}
        </div>
        {tooltipRows.map(row => <div key={row.key} className="participation-tooltip-row">
          <i style={{ background: row.color }} />{row.label}<b>{formatDuration(row.value)}</b>
        </div>)}
      </div>}
    </div>
    <div className="participation-panel-legend">
      <span><i className="is-total" />{t('participation.daily.legendTotal')}</span>
      <span><i style={{ background: 'var(--aw-primary)' }} />{t('participation.daily.legendHuman')}</span>
      <span><i style={{ background: 'var(--insight-agent)' }} />{t('participation.daily.legendAgent')}</span>
    </div>
    <p className="participation-panel-note">{note}</p>
  </Panel>;
}

interface DistributionProps { average: DurationSummary | null }

export function ParticipationDistribution({ average }: DistributionProps) {
  const { t } = useTranslation('insights');
  const [hover, setHover] = useState<'human' | 'agent' | null>(null);
  const title = t('participation.distribution.title');
  const subtitle = t('participation.distribution.subtitle');
  const total = average?.totalDurationSeconds ?? 0;
  const human = average?.humanDurationSeconds ?? 0;
  const agent = average?.agentDurationSeconds ?? 0;
  const share = average ? humanShare(human, agent, average.humanShare) : null;
  if (!average || share == null || total <= 0) {
    return <Panel title={title} subtitle={subtitle}>
      <div className="participation-panel-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('participation.distribution.empty')} /></div>
    </Panel>;
  }

  const circumference = 2 * Math.PI * DONUT.radius;
  let offset = 0;
  const arcs = [
    { key: 'human' as const, color: 'var(--aw-primary)', label: t('participation.daily.legendHuman'), value: human, percent: share },
    { key: 'agent' as const, color: 'var(--insight-agent)', label: t('participation.daily.legendAgent'), value: agent, percent: 1 - share },
  ].map(row => {
    const arc = { ...row, length: Math.max(row.percent * circumference - 2, 0), dashOffset: -offset };
    offset += row.percent * circumference;
    return arc;
  });
  const active = arcs.find(row => row.key === hover);

  return <Panel title={title} subtitle={subtitle}>
    <div className="participation-donut-wrap" onMouseLeave={() => setHover(null)}>
      <svg className="participation-donut" viewBox="0 0 200 160" role="img"
        aria-label={t('participation.distribution.aria')}>
        <circle cx={DONUT.center} cy="80" r={DONUT.radius} fill="none" stroke="var(--aw-gray-bg)" strokeWidth={DONUT.stroke} />
        {arcs.map(row => row.percent <= 0 ? null : <circle key={row.key} cx={DONUT.center} cy="80" r={DONUT.radius} fill="none"
          stroke={row.color} strokeWidth={DONUT.stroke}
          strokeDasharray={`${row.length} ${circumference}`} strokeDashoffset={row.dashOffset}
          transform={`rotate(-90 ${DONUT.center} 80)`}
          onMouseEnter={() => setHover(row.key)} />)}
        <text className="participation-donut-total" x={DONUT.center} y="77" textAnchor="middle">{formatDurationCompact(total)}</text>
        <text className="participation-chart-axis" x={DONUT.center} y="94" textAnchor="middle">{t('participation.distribution.centerLabel')}</text>
      </svg>
      {active && <div className="participation-tooltip participation-tooltip--center" role="status">
        <div className="participation-tooltip-title">{active.label}</div>
        <div className="participation-tooltip-row">
          <i style={{ background: active.color }} />{formatDuration(active.value)}
          <b>{t('participation.percentValue', { value: (active.percent * 100).toFixed(1) })}</b>
        </div>
      </div>}
    </div>
    <div className="participation-dist-values">
      {arcs.map(row => <div key={row.key} className={`participation-dist-value is-${row.key}`} onMouseEnter={() => setHover(row.key)}>
        <span className="participation-dist-label"><i style={{ background: row.color }} />{row.label}</span>
        <b>{formatDuration(row.value)}</b>
        <small>{t('participation.percentValue', { value: (row.percent * 100).toFixed(1) })}</small>
      </div>)}
    </div>
    <p className="participation-panel-note">{t('participation.distribution.note')}</p>
  </Panel>;
}

interface RatioProps { trend: TrendEntry[]; startDate: string; endDate: string }

export function ParticipationRatioTrend({ trend, startDate, endDate }: RatioProps) {
  const { t } = useTranslation('insights');
  const [hover, setHover] = useState<number | null>(null);
  const measured = useMeasuredWidth();
  const title = t('participation.ratio.title');
  const subtitle = t('participation.ratio.subtitle');
  const points = trend.map((row, index) => {
    const samples = sampleCount(row);
    return { row, index, samples, share: samples > 0 ? humanShare(row.averageHumanSeconds, row.averageAgentSeconds, row.humanShare) : null };
  });
  const filled = points.filter(point => point.share != null);
  if (!filled.length) {
    return <Panel title={title} subtitle={subtitle}>
      <div className="participation-panel-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('participation.ratio.empty')} /></div>
    </Panel>;
  }

  const width = measured.width || CHART_FALLBACK_WIDTH;
  const geometry = { width, height: RATIO_CHART_HEIGHT, left: CHART_LEFT, right: width - 6, top: 12, bottom: RATIO_CHART_HEIGHT - 34 };
  const slot = (geometry.right - geometry.left) / Math.max(points.length, 1);
  const barWidth = Math.min(12, Math.max(1.5, slot * 0.62));
  const center = (index: number) => geometry.left + slot * (index + 0.5);
  const height = geometry.bottom - geometry.top;
  const y = (percent: number) => geometry.bottom - percent * height;
  const labelStep = Math.max(1, Math.ceil((points.length - 1) / 6));
  const labelIndices: number[] = [];
  for (let index = 0; index < points.length; index += labelStep) labelIndices.push(index);
  if (labelIndices[labelIndices.length - 1] !== points.length - 1) labelIndices.push(points.length - 1);
  const percentText = (value: number) => t('participation.percentValue', { value: value.toFixed(1) });
  const axisPercent = (value: number) => t('participation.percentValue', { value: formatNumber(value) });
  const hovered = hover != null ? points[hover] : null;
  const tooltipLeft = hovered ? Math.min(84, Math.max(16, center(hovered.index) / geometry.width * 100)) : 50;
  const tooltipRows = hovered && hovered.share != null ? [
    { key: 'human', color: 'var(--aw-primary)', label: t('participation.ratio.legendHuman'), share: hovered.share, duration: hovered.row.averageHumanSeconds },
    { key: 'agent', color: 'var(--insight-agent)', label: t('participation.ratio.legendAgent'), share: 1 - hovered.share, duration: hovered.row.averageAgentSeconds },
  ] : [];

  return <Panel title={title} subtitle={subtitle}>
    <div className="participation-chart-wrap" ref={measured.ref} onMouseLeave={() => setHover(null)}>
      <svg className="participation-chart" viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="img"
        aria-label={t('participation.ratio.aria', { start: startDate, end: endDate })}>
        {[100, 75, 50, 25].map(value => <g key={value}>
          <line className="participation-chart-grid-line" x1={geometry.left} y1={y(value / 100)} x2={geometry.right} y2={y(value / 100)} />
          <text className="participation-chart-axis" x={4} y={y(value / 100) + 3}>{axisPercent(value)}</text>
        </g>)}
        <line className="participation-chart-baseline" x1={geometry.left} y1={geometry.bottom} x2={geometry.right} y2={geometry.bottom} />
        <text className="participation-chart-axis" x={4} y={geometry.bottom + 3}>{axisPercent(0)}</text>
        {filled.map(point => {
          const left = center(point.index) - barWidth / 2;
          const humanHeight = (point.share ?? 0) * height;
          const agentHeight = height - humanHeight;
          return <g key={point.index}>
            {humanHeight > 0 && <rect x={left} y={geometry.bottom - humanHeight} width={barWidth} height={Math.max(humanHeight, 0.8)} rx="1" fill="var(--aw-primary)" />}
            {agentHeight > 0 && <rect x={left} y={geometry.top} width={barWidth} height={Math.max(agentHeight, 0.8)} rx="1" fill="var(--insight-agent)" />}
          </g>;
        })}
        {labelIndices.map(index => {
          const last = index === points.length - 1;
          return <text key={index} className="participation-chart-axis" x={last ? center(index) + 4 : center(index)} y={geometry.bottom + 14}
            textAnchor={index === 0 ? 'start' : last ? 'end' : 'middle'}>
            {shortLabel(points[index].row.label)}
          </text>;
        })}
        {points.map(point => <rect key={point.index} x={center(point.index) - slot / 2} y={geometry.top}
          width={Math.max(slot, 1)} height={height} fill="transparent"
          onMouseEnter={() => setHover(point.index)} />)}
      </svg>
      {hovered && <div className="participation-tooltip" style={{ left: `${tooltipLeft}%` }} role="status">
        <div className="participation-tooltip-title">
          {hovered.share != null
            ? t('participation.ratio.tooltipTitle', { date: hovered.row.label, samples: hovered.samples })
            : t('participation.ratio.tooltipEmpty', { date: hovered.row.label })}
        </div>
        {tooltipRows.map(row => <div key={row.key} className="participation-tooltip-row">
          <i style={{ background: row.color }} />{row.label}
          <b>{t('participation.ratio.tooltipRow', { share: percentText(row.share * 100), duration: formatDuration(row.duration) })}</b>
        </div>)}
      </div>}
    </div>
    <div className="participation-panel-legend">
      <span><i style={{ background: 'var(--aw-primary)' }} />{t('participation.ratio.legendHuman')}</span>
      <span><i style={{ background: 'var(--insight-agent)' }} />{t('participation.ratio.legendAgent')}</span>
    </div>
    <p className="participation-panel-note">{t('participation.ratio.note')}</p>
  </Panel>;
}
