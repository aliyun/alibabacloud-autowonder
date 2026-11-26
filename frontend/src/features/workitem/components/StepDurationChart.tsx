import { useState } from 'react';
import { Button, Empty, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { StepTiming } from '@/shared/types/workitem';
import { formatNumber } from '@/shared/i18n/format';
import { formatDuration } from '../duration';
import './StepDurationChart.css';

const { Text } = Typography;

interface Props {
  dispatchId: number;
  steps?: StepTiming[] | null;
}

export function StepDurationChart({ dispatchId, steps }: Props) {
  const { t } = useTranslation('workitem');
  const [sortByDuration, setSortByDuration] = useState(false);
  const rows = (steps ?? []).map(step => ({
    ...step,
    durationMs: step.durationMs != null && Number.isFinite(step.durationMs) && step.durationMs >= 0 ? step.durationMs : null,
  }));
  const total = rows.reduce((sum, step) => sum + (step.durationMs ?? 0), 0);
  const longest = Math.max(0, ...rows.map(step => step.durationMs ?? 0));
  const hasMeasurements = rows.some(step => step.durationMs != null);
  const partial = rows.some(step => step.durationMs == null && !['pending', 'reused', 'skipped'].includes(step.status));
  const percentage = (duration: number) => formatNumber(total > 0 ? duration / total * 100 : 0, { maximumFractionDigits: 1 });
  const visibleRows = sortByDuration ? [...rows].sort((a, b) => (b.durationMs ?? -1) - (a.durationMs ?? -1)) : rows;

  return <section className="step-duration-chart" aria-label={t('stepTiming.title')} data-testid="step-duration-chart">
    <div className="step-duration-heading">
      <div>
        <Text strong>{t('stepTiming.title')}</Text>
        <Text type="secondary" className="step-duration-scope">{t('stepTiming.execution', { id: dispatchId })}</Text>
      </div>
      {hasMeasurements && <Text strong>{t('stepTiming.total', { duration: formatDuration(total) })}</Text>}
    </div>
    <Text type="secondary" className="step-duration-note">{t('stepTiming.description')}</Text>
    {!rows.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('stepTiming.noData')} /> : <>
      <div className="step-duration-toolbar">
        <Text type="secondary">{t('stepTiming.shareHint')}</Text>
        <Button size="small" type="text" aria-pressed={sortByDuration} onClick={() => setSortByDuration(!sortByDuration)}>
          {t(sortByDuration ? 'stepTiming.flowOrder' : 'stepTiming.durationOrder')}
        </Button>
      </div>
      <ol className="step-duration-rows">
        {visibleRows.map(step => {
          const isLongest = longest > 0 && step.durationMs === longest;
          return <li key={step.stepId} className={`step-duration-row is-${step.status}${isLongest ? ' is-longest' : ''}`}>
            <span className="step-duration-label" title={step.name}>{step.name}</span>
            <div className="step-duration-meter" aria-hidden="true">
              <div style={{ width: `${total > 0 ? (step.durationMs ?? 0) / total * 100 : 0}%` }} />
            </div>
            <div className="step-duration-value">
              <span>{step.durationMs == null ? t('stepTiming.unmeasured') : formatDuration(step.durationMs)}</span>
              {step.durationMs != null && total > 0 && <span>{t('stepTiming.percentage', { value: percentage(step.durationMs) })}</span>}
              <span>{t(`stepTiming.status.${step.status}`)}</span>
              {isLongest && <Tag color="orange">{t('stepTiming.longest')}</Tag>}
            </div>
          </li>;
        })}
      </ol>
      {(!hasMeasurements || partial) && <Text type="secondary" className="step-duration-note">{t('stepTiming.partial')}</Text>}
    </>}
  </section>;
}
