import { Button, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { EventDisplayPreparationStatus } from './types';

/**
 * 三入口共用的异常反馈；正常同步不占用消息区。
 *
 * <p>失败时保留已显示的内容，只额外给出重试入口；不可用事件由服务端明确标记。
 */
export function EventSyncStatus({ preparationStatus, error, onRetry }: {
  preparationStatus: EventDisplayPreparationStatus;
  syncing: boolean;
  error: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation('workitem');
  if (error) {
    return (
      <div role="status" style={{ fontSize: 12 }}>
        <Typography.Text type="danger">{t('clarification.detailsFailed')}</Typography.Text>
        {onRetry && (
          <Button size="small" type="link" style={{ padding: '0 4px' }} onClick={onRetry}>
            {t('clarification.detailsRetry')}
          </Button>
        )}
      </div>
    );
  }
  if (preparationStatus === 'UNAVAILABLE') {
    return (
      <Typography.Text type="warning" style={{ fontSize: 12, display: 'block' }}>
        {t('clarification.eventsUnavailable')}
      </Typography.Text>
    );
  }
  return null;
}
