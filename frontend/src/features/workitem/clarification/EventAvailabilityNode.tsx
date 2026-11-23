import { Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { TimelineNode } from './timeline';

/** Only unavailable events need feedback; pending content appears when it arrives. */
export function EventAvailabilityNode({ node }: { node: TimelineNode }) {
  const { t } = useTranslation('workitem');
  if (!node.display?.failed) return null;
  return <Typography.Text type="secondary" role="status" style={{ fontSize: 13, display: 'block' }}>
    {t('clarification.eventSummaryFailed')}
  </Typography.Text>;
}
