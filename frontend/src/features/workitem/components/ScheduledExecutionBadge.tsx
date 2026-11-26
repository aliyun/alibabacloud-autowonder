import { formatDateTime } from '@/shared/i18n/format';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { WorkitemOrigin } from '../../../shared/types/workitem';

interface ScheduledExecutionBadgeProps {
  scheduledStartAt?: string | null;
  scheduledStartTriggeredAt?: string | null;
  origin?: WorkitemOrigin | null;
  gmtCreate?: string | null;
}

function formatTime(value: string): string {
  return formatDateTime(value);
}

/** 行内居中：-1.5px 补偿 13px 字号的基线偏移，图标略低于基线也不会压到字形。 */
const badgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  verticalAlign: '-1.5px',
} as const;

/**
 * 定时执行标识：只要是定时工单就持续展示，覆盖三种状态——
 * 已配置计划时间（待触发）、7×24 定时任务派生（触发时间为工单创建时间）、
 * 计划执行已触发（后端记录的实际触发时间）。
 */
export function ScheduledExecutionBadge({
  scheduledStartAt,
  scheduledStartTriggeredAt,
  origin,
  gmtCreate,
}: ScheduledExecutionBadgeProps) {
  const { t } = useTranslation('workitem');
  if (scheduledStartAt) {
    return (
      <Tooltip title={t('schedule.execution', { time: formatTime(scheduledStartAt) })}>
        <span role="img" aria-label={t('schedule.aria')} style={{ ...badgeStyle, color: 'var(--aw-accent-text)' }}><AwStrokeIcon name="clock" size={12} /></span>
      </Tooltip>
    );
  }
  if (origin?.type === 'SCHEDULED_TASK_RUN' && gmtCreate) {
    const taskName = origin.scheduledTaskName || origin.scheduledTaskId;
    return (
      <Tooltip title={t('schedule.taskExecution', { name: taskName ?? '', time: formatTime(gmtCreate) })}>
        <span role="img" aria-label={t('schedule.taskAria')} style={{ ...badgeStyle, color: 'var(--aw-success-deep)' }}><AwStrokeIcon name="clock" size={12} /></span>
      </Tooltip>
    );
  }
  if (scheduledStartTriggeredAt) {
    return (
      <Tooltip title={t('schedule.triggered', { time: formatTime(scheduledStartTriggeredAt) })}>
        <span role="img" aria-label={t('schedule.triggeredAria')} style={{ ...badgeStyle, color: 'var(--aw-muted)' }}><AwStrokeIcon name="clock" size={12} /></span>
      </Tooltip>
    );
  }
  return null;
}
