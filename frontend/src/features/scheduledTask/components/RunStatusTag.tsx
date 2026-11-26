import { useTranslation } from 'react-i18next';
import { StatusTag, type StatusColorKey } from '@/shared/ui/StatusTag';

/** 运行状态 → StatusTag 颜色映射（原型 12 状态字典），导出供测试直测。 */
export const RUN_STATUS_TAG_COLOR: Record<string, StatusColorKey> = {
  QUEUED: 'gray',
  STARTING: 'blue',
  WAITING_EXECUTOR: 'blue',
  WAITING_HUMAN: 'amber',
  RUNNING: 'blue',
  PAUSED: 'amber',
  SUCCEEDED: 'green',
  FAILED: 'red',
  TIMED_OUT: 'red',
  CANCELED: 'gray',
  SKIPPED: 'gray',
};

export function RunStatusTag({ status }: { status: string }) {
  const { t } = useTranslation('scheduledTask');
  const RUN_STATUS_LABEL: Record<string, string> = {
    QUEUED: t('runStatus.queued'),
    STARTING: t('runStatus.starting'),
    WAITING_EXECUTOR: t('runStatus.waitingExecutor'),
    WAITING_HUMAN: t('runStatus.waitingHuman'),
    RUNNING: t('runStatus.running'),
    PAUSED: t('runStatus.paused'),
    TIMED_OUT: t('runStatus.timedOut'),
    CANCELED: t('runStatus.canceled'),
    SUCCEEDED: t('runStatus.succeeded'),
    FAILED: t('runStatus.failed'),
    SKIPPED: t('runStatus.skipped'),
  };
  const known = Object.prototype.hasOwnProperty.call(RUN_STATUS_TAG_COLOR, status);
  return <StatusTag label={known ? RUN_STATUS_LABEL[status] : status} colorKey={known ? RUN_STATUS_TAG_COLOR[status] : 'gray'} dot={known} />;
}
