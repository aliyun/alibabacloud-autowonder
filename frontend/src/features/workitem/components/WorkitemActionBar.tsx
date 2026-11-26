import { useTranslation } from 'react-i18next';
import { Button, Dropdown, Spin, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { StatusTag } from '@/shared/ui/StatusTag';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import { STATUS_CATEGORY_TAG_COLOR, getPriorityMeta, workTypeMap } from '../constants';
import type { DeliveryControlAction } from './RecoveryControls';

interface WorkitemActionBarProps {
  deliveryControl?: DeliveryControlAction | null;
  workType: string;
  statusName: string | null;
  statusLabelKey?: string | null;
  statusCategory?: string | null;
  priority: number;
  hasSdlc?: boolean;
  watched?: boolean;
  onStartDelivery?: () => void;
  onAssignHuman?: () => void;
  onTransition?: () => void;
  onAddComment?: () => void;
  onSyncExternal?: () => void;
  onDelete?: () => void;
  onToggleWatch?: () => void;
  watchLoading?: boolean;
  syncExternalLoading?: boolean;
  deleteLoading?: boolean;
  deleteDisabled?: boolean;
  deleteDisabledReason?: string | null;
}

export function WorkitemActionBar({
  deliveryControl, workType, statusName, statusLabelKey, statusCategory, priority, hasSdlc, watched,
  onStartDelivery, onAssignHuman, onTransition, onAddComment, onSyncExternal,
  onDelete, onToggleWatch, watchLoading, syncExternalLoading,
  deleteLoading, deleteDisabled, deleteDisabledReason,
}: WorkitemActionBarProps) {
  const { t } = useTranslation('workitem');
  const systemLabel = useSystemLabel();
  const priorityMeta = getPriorityMeta(priority);
  const menuLabel = (label: string, pending?: boolean, reason?: string | null) => (
    reason ? <Tooltip title={reason} trigger={['hover', 'focus']}>
      {/* 提示可聚焦但不参与菜单按键激活，避免 Enter 触发禁用项。 */}
      <span tabIndex={0} aria-label={reason} onKeyDown={(event) => event.stopPropagation()}>{label}</span>
    </Tooltip> : <span>{pending ? <Spin size="small" /> : null}{label}</span>
  );
  const items: MenuProps['items'] = [
    { key: 'reassign', label: t('detail.reassign'), icon: <AwStrokeIcon name="transfer" />, onClick: onStartDelivery },
    { key: 'assign-human', label: t('assignment.title'), icon: <AwStrokeIcon name="user-plus" />, onClick: onAssignHuman },
    { key: 'reconcile', label: menuLabel(t('detail.reconcile'), syncExternalLoading), disabled: syncExternalLoading, icon: <AwStrokeIcon name="shuffle" />, onClick: onSyncExternal },
    ...(deliveryControl ? [{ key: 'delivery-control',
      label: menuLabel(deliveryControl.label, deliveryControl.pending, deliveryControl.disabled ? deliveryControl.disabledReason : null),
      disabled: deliveryControl.disabled || deliveryControl.pending, danger: deliveryControl.danger,
      onClick: deliveryControl.invoke,
    }] : []),
    { type: 'divider' },
    { key: 'delete', label: menuLabel(t('actions.delete'), deleteLoading, deleteDisabled ? deleteDisabledReason : null),
      danger: true, disabled: deleteDisabled || deleteLoading, icon: <AwStrokeIcon name="trash" />, onClick: onDelete },
  ];
  return (
    <div data-testid="workitem-action-bar" className="aw-workitem-actions">
      <div className="aw-workitem-primary-actions">
        <Button className="aw-op-solid" type="primary" icon={hasSdlc ? <AwStrokeIcon name="transfer" /> : <AwStrokeIcon name="play" />} onClick={onStartDelivery}>
          {hasSdlc ? t('detail.deliverAgain') : t('detail.startDelivery')}
        </Button>
        <Button className="aw-op-solid" icon={<AwStrokeIcon name="branch" />} onClick={onTransition}>{t('detail.transitionTitle')}</Button>
        <Button
          data-testid="workitem-watch-toggle"
          className="aw-op-ghost"
          type={watched ? 'primary' : 'default'}
          ghost={watched}
          icon={<AwStrokeIcon name="star" />}
          aria-label={watched ? t('actions.unwatchAria') : t('actions.watchAria')}
          aria-pressed={!!watched}
          onClick={onToggleWatch}
          loading={watchLoading}
        >{watched ? t('actions.watched') : t('actions.watch')}</Button>
        <Button className="aw-op-ghost" icon={<AwStrokeIcon name="msg" />} onClick={onAddComment}>{t('comment.add')}</Button>
        <Dropdown menu={{ items }} trigger={['click']}>
          <Button className="aw-op-more" aria-label={t('actions.more')} icon={<AwStrokeIcon name="more" />} />
        </Dropdown>
      </div>
      <div className="aw-workitem-action-tags" data-testid="workitem-action-tags">
        <StatusTag label={workTypeMap[workType]?.label ?? workType} colorKey="gray" />
        <StatusTag label={statusName ? systemLabel(statusLabelKey, statusName) : t('status.unknown')} colorKey={STATUS_CATEGORY_TAG_COLOR[statusCategory ?? ''] ?? 'gray'} dot />
        <StatusTag label={priorityMeta.label} colorKey="outline" />
      </div>
    </div>
  );
}
