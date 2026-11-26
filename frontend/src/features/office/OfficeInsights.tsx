import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThunderboltOutlined } from '@ant-design/icons';
import { formatDateTime, formatNumber } from '@/shared/i18n/format';
import { formatMinutes } from '@/shared/lib/duration';
import { COMPLETION_DAYS } from './api';
import type { OfficeActivity } from './insights';
import { RollingNumber } from './RollingNumber';

const activityLimit = 4;
const runningStatus = 'running';
const empty = '—';
const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const dateOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' };

export interface OfficeMetrics {
  hours?: number;
  weekThrough?: string;
  skills?: number;
  versions?: number;
  averageMinutes?: number | null;
  failed?: boolean;
}

export function OfficeMetricValues({ metrics }: { metrics: OfficeMetrics }) {
  const { t } = useTranslation(['office', 'insights', 'deliveryInsights']);
  const display = (value: number | null | undefined, format: (number: number) => string = formatNumber) =>
    value == null || !Number.isFinite(value) ? empty : format(value);
  return (
    <>
      <dl className="awo-insight-metrics">
        <div><dt>{t('deliveryInsights:workhours')}</dt>
          <dd><RollingNumber value={display(metrics.hours, n => t('deliveryInsights:hours', { value: formatNumber(n, { maximumFractionDigits: 1 }) }))} /></dd>
          {metrics.weekThrough && <small>{t('office:weekThrough', { date: formatDateTime(metrics.weekThrough, dateOptions) })}</small>}
        </div>
        <div><dt>{t('insights:participation.average')}</dt>
          <dd><RollingNumber value={display(metrics.averageMinutes, formatMinutes)} /></dd>
          <small>{t('insights:participation.lastDays', { count: COMPLETION_DAYS })}</small>
        </div>
        <div><dt title={t('deliveryInsights:skill')}>{t('office:skillStock')}</dt><dd><RollingNumber value={display(metrics.skills)} /></dd></div>
        <div><dt title={t('deliveryInsights:versionNote')}>{t('office:skillVersions')}</dt>
          <dd><RollingNumber value={display(metrics.versions, n => t('deliveryInsights:times', { value: formatNumber(n) }))} /></dd>
        </div>
      </dl>
      {metrics.failed && <p className="awo-insight-note" role="status">{t('office:partialError')}</p>}
    </>
  );
}

export function OfficeActivityPanel({ entries, failed, chief }: { chief?: { id: number; name: string }; entries?: OfficeActivity[]; failed?: boolean }) {
  const { t } = useTranslation(['office', 'insights']);
  const list = useRef<HTMLOListElement>(null);
  const positions = useRef<Map<string, number> | null>(null);
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const row of list.current?.querySelectorAll<HTMLElement>('[data-event-id]') ?? []) {
      const id = row.dataset.eventId!;
      const top = row.offsetTop;
      next.set(id, top);
      if (!positions.current || !row.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) continue;
      const previous = positions.current.get(id);
      if (previous === undefined) row.animate([
        { opacity: 0, transform: 'translateY(-38px) rotateX(-35deg)', background: '#335268' },
        { opacity: 1, transform: 'translateY(0) rotateX(0)', background: 'transparent' },
      ], { duration: 850, easing: 'cubic-bezier(.22,1,.36,1)' });
      else if (previous !== top) row.animate([
        { transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' },
      ], { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
    positions.current = next;
  }, [entries]);
  return (
    <section className="awo-panel" aria-labelledby="awo-activity">
      <header className="awo-panel-title">
        <h2 id="awo-activity"><ThunderboltOutlined aria-hidden="true" />{t('insights:activity.title')}</h2>
      </header>
      {entries?.length ? <ol ref={list} className="awo-activity-list" aria-live="polite" aria-relevant="additions">
        {entries.slice(0, activityLimit).map(entry => {
          const title = entry.title || t('insights:activity.unnamed');
          const when = Number.isFinite(entry.occurredAt) ? new Date(entry.occurredAt) : null;
          return <li className="awo-activity-row" key={entry.id} data-event-id={entry.id}>
            <i data-status={entry.status} aria-hidden="true" />
            <span className="awo-row-text">
              <strong title={title}>{entry.workitemId == null ? title : <Link to={`/workitems/${encodeURIComponent(entry.workitemId)}`}>{title}</Link>}</strong>
              <small>{chief && (entry.employeeId === chief.id || (entry.employeeId == null && entry.employee === chief.name)) ? t('office:chiefName') : entry.employee || empty}</small>
            </span>
            <span className="awo-activity-meta">
              <strong data-status={entry.status}>{entry.simulationAction ? t(`office:simulationActions.${entry.simulationAction}`) : entry.status === runningStatus ? t('insights:activity.running') : t(`insights:activity.statuses.${entry.status}`)}</strong>
              {when && <time dateTime={when.toISOString()}>{formatDateTime(when, timeOptions)}</time>}
            </span>
          </li>;
        })}
      </ol> : <p className="awo-empty">{t(failed ? 'office:unavailable' : entries ? 'insights:activity.empty' : 'office:loading')}</p>}
      {failed && !!entries?.length && <p className="awo-insight-note" role="status">{t('office:stale')}</p>}
    </section>
  );
}
