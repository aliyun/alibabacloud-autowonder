import { externalPrincipalName } from '@/features/workitem/runtimeLabels';
import { Trans, useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { formatDateTime } from '@/shared/i18n/format';
import { Timeline, Typography, Tag } from 'antd';
import { RocketOutlined } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { TimelineEvent } from '@/shared/types/workitem';

const { Text } = Typography;

const iconMap: Record<string, React.ReactNode> = {
  CREATE: <span aria-hidden="true" style={{ color: 'var(--aw-success-deep)', display: 'inline-flex' }}><AwStrokeIcon name="plus" /></span>,
  EDIT: <span aria-hidden="true" style={{ color: 'var(--aw-accent-text)', display: 'inline-flex' }}><AwStrokeIcon name="edit" size={14} /></span>,
  STATUS_CHANGE: <span aria-hidden="true" style={{ color: 'var(--aw-warning-deep)', display: 'inline-flex' }}><AwStrokeIcon name="shuffle" size={14} /></span>,
  ASSIGN: <span aria-hidden="true" style={{ color: 'var(--aw-info)', display: 'inline-flex' }}><AwStrokeIcon name="transfer" /></span>,
  DISPATCH: <RocketOutlined aria-hidden="true" style={{ color: 'var(--aw-info)' }} />,
  RESULT: <span aria-hidden="true" style={{ color: 'var(--aw-success-deep)', display: 'inline-flex' }}><AwStrokeIcon name="check" size={14} /></span>,
  COMMENT: <span aria-hidden="true" style={{ color: 'var(--aw-muted)', display: 'inline-flex' }}><AwStrokeIcon name="msg" size={14} /></span>,
};

function renderEventContent(event: TimelineEvent): React.ReactNode {
  const actor = externalPrincipalName(event.actorDisplayName || event.actorName, event.actorNameFallback) || (event.actorType === 'AGENT' ? i18n.t('shared:timeline.agent') : i18n.t('shared:timeline.user'));

  const actorText = <Text strong>{actor}</Text>;
  const assignee = externalPrincipalName(event.toValDisplay || event.toVal, event.toValNameFallback) || '—';

  switch (event.eventType) {
    case 'CREATE':
      return <><Trans ns="shared" i18nKey="timeline.created" components={{ actor: actorText }} /></>;
    case 'EDIT':
      return <><Trans ns="shared" i18nKey="timeline.edited" components={{ actor: actorText }} /></>;
    case 'STATUS_CHANGE':
      return (
        <>
          <Trans ns="shared" i18nKey="timeline.status" components={{ actor: actorText }} />
          {event.fromVal && <Tag>{event.fromVal}</Tag>}
          {event.fromVal && event.toVal && ' → '}
          {event.toVal && <Tag color="blue">{event.toVal}</Tag>}
        </>
      );
    case 'ASSIGN':
      return <><Trans ns="shared" i18nKey="timeline.assigned" components={{ actor: actorText, assignee: <span>{assignee}</span> }} /></>;
    case 'DISPATCH':
      return <Trans ns="shared" i18nKey="timeline.dispatched" components={{ actor: actorText }} />;
    case 'RESULT':
      return <Trans ns="shared" i18nKey="timeline.result" components={{ actor: actorText }} />;
    case 'COMMENT':
      return <><Trans ns="shared" i18nKey="timeline.commented" components={{ actor: actorText }} /></>;
    default:
      return <><Text strong>{actor}</Text> {event.eventType}</>;
  }
}

interface WorkitemTimelineProps {
  events: TimelineEvent[];
  loading?: boolean;
}

export function WorkitemTimeline({ events, loading }: WorkitemTimelineProps) {
  const { t } = useTranslation('shared');
  const items = events.map((event) => ({
    key: String(event.id),
    dot: iconMap[event.eventType] || null,
    children: (
      <div>
        <div>{renderEventContent(event)}</div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {event.gmtCreate ? formatDateTime(event.gmtCreate) : ''}
        </Text>
      </div>
    ),
  }));

  return <Timeline pending={loading ? t('timeline.loading') : undefined} items={items} />;
}
