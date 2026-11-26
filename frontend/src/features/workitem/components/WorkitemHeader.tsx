import { Trans, useTranslation } from 'react-i18next';
import { PageBackButton } from '@/shared/ui/PageBackButton';
import { Typography, Tooltip } from 'antd';
import { ScheduledExecutionBadge } from './ScheduledExecutionBadge';
import { ShareWorkitemButton } from './ShareWorkitemButton';

const { Title } = Typography;

interface WorkitemHeaderProps {
  title: string;
  /** 传了才渲染右上角分享入口：分享链接要带工单 id */
  workitemId?: number;
  origin?: { type: string; id: number; scheduledTaskId?: number | null; scheduledTaskName?: string | null } | null;
  scheduledStartAt?: string | null;
  scheduledStartTriggeredAt?: string | null;
  gmtCreate?: string | null;
}

export function WorkitemHeader({ title, workitemId, origin, scheduledStartAt, scheduledStartTriggeredAt, gmtCreate }: WorkitemHeaderProps) {
  const { t } = useTranslation('workitem');

  return (
    <div className="aw-workitem-header">
      <div className="aw-detail-title">
        <PageBackButton to="/workitems" label={t('detail.backToList')} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Tooltip title={title}>
              {/* 原型 05 page-head 标题 16px/600；level=5 保住 heading role 供测试定位 */}
              <Title level={5} ellipsis style={{ margin: 0, fontSize: 16, lineHeight: '24px', minWidth: 0, maxWidth: '100%' }}>{title}</Title>
            </Tooltip>
            <ScheduledExecutionBadge
              scheduledStartAt={scheduledStartAt}
              scheduledStartTriggeredAt={scheduledStartTriggeredAt}
              origin={origin}
              gmtCreate={gmtCreate}
            />
          </div>
        </div>
        <div className="aw-workitem-header-tools">
          {workitemId != null ? <ShareWorkitemButton workitemId={workitemId} title={title} /> : null}
        </div>
      </div>
      {origin?.type === 'SCHEDULED_TASK_RUN' && origin.id ? (
        <Typography.Link href={`/scheduled-task-runs/${origin.id}`} style={{ display: 'inline-block', marginTop: 8 }}>
          <Trans ns="workitem" i18nKey="detail.origin" values={{ id: origin.id }} components={{ name: <span>{origin.scheduledTaskName || origin.scheduledTaskId || ''}</span> }} />
        </Typography.Link>
      ) : null}
    </div>
  );
}
