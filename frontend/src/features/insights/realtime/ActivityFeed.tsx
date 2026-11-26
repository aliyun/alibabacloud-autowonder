import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/i18n/format';
import { Card, Empty } from 'antd';
import type { RecentTask, RunningTask } from './api';
import { formatMinutes } from '@/shared/lib/duration';

const timeOptions: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };

interface Props { running: RunningTask[]; recent: RecentTask[] }
const STATUS_META = {
  SUCCEEDED: { cls: 'is-ok', key: 'activity.statuses.SUCCEEDED' },
  FAILED: { cls: 'is-err', key: 'activity.statuses.FAILED' },
  TIMEOUT: { cls: 'is-to', key: 'activity.statuses.TIMEOUT' },
  CANCELED: { cls: 'is-cancel', key: 'activity.statuses.CANCELED' },
} as const;

export default function ActivityFeed({ running, recent }: Props) {
  const { t } = useTranslation('insights');
  const hint = t('activity.summary', { running: running.length, recent: recent.length });
  return <Card title={<>{t('activity.title')} <span className="insight-card-hint">{hint}</span></>} style={{ minWidth: 0 }}>
    <div className="insight-activity-list">
      {running.length === 0 && recent.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('activity.empty')} />}
      {running.map(task => <div className="insight-activity-row" key={`r-${task.dispatchId}`}>
        <span className="insight-activity-status is-run">{t('activity.running')}</span>
        <div className="insight-activity-main">
          <a className="insight-activity-title" href={`/workitems/${task.workitemId}`} title={task.workitemTitle ?? ''}>{task.workitemTitle || t('activity.unnamed')}</a>
          <span className="insight-activity-meta" title={task.agentName ?? ''}>{task.agentName || '—'}</span>
        </div>
        <div className="insight-activity-side"><strong>{formatMinutes(task.runningMinutes)}</strong><span>{t('activity.elapsed')}</span></div>
      </div>)}
      {recent.map(task => {
        const meta = Object.prototype.hasOwnProperty.call(STATUS_META, task.status) ? STATUS_META[task.status] : undefined;
        return <div className="insight-activity-row" key={`c-${task.dispatchId}`}>
          <span className={`insight-activity-status${meta ? ` ${meta.cls}` : ''}`}>{meta ? t(meta.key) : task.status}</span>
          <div className="insight-activity-main">
            <span className="insight-activity-title" title={task.workitemTitle ?? ''}>{task.workitemTitle || t('activity.unnamed')}</span>
            <span className="insight-activity-meta" title={task.agentName ?? ''}>{task.agentName || '—'}</span>
          </div>
          <div className="insight-activity-side">
            <strong>{formatMinutes(task.durationMinutes)}</strong>
            <time title={task.finishedAt} dateTime={task.finishedAt}>{formatDateTime(task.finishedAt, timeOptions)}</time>
          </div>
        </div>;
      })}
    </div>
  </Card>;
}
