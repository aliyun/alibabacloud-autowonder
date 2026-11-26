import { workitemHealthReason } from '../runtimeLabels';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import { StatusTag } from '@/shared/ui/StatusTag';
import type { Workitem } from '@/shared/types/workitem';

/** Renders a warning tag when a workitem is stuck (in-progress but its delivery has failed/stalled). */
export function WorkitemHealthBadge({ item, size = 'default' }: { item: Pick<Workitem, 'health' | 'healthReason' | 'executionStatus' | 'healthStalledMinutes'>; size?: 'default' | 'sm' }) {
  const { t } = useTranslation('workitem');
  if (item.health !== 'STUCK') {
    return null;
  }
  return (
    <Tooltip title={workitemHealthReason(item) || t('health.reason')}>
      <StatusTag label={t('health.stuck')} colorKey="red" dot size={size} />
    </Tooltip>
  );
}
