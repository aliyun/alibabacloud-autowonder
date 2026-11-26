import { Button, Dropdown, Modal, Space, Tooltip } from 'antd';
import { StopOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { DispatchAttempt } from '@/shared/types/workitem';
import type { ExecutionActionKind } from '../hooks';
import { executionActionLabel, resolveExecutionActions } from '../executionControl';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';

interface ExecutionActionBarProps {
  attempt: DispatchAttempt;
  pending?: { dispatchId: number; action: ExecutionActionKind } | null;
  onAction: (action: ExecutionActionKind) => void;
  // 侧栏轨道空间有限，主操作需要实心按钮建立唯一视觉焦点；工作台保持默认样式。
  emphasis?: boolean;
}

function actionIcon(action: ExecutionActionKind) {
  if (action === 'pause') return <AwStrokeIcon name="pause" />;
  if (action === 'resume' || action === 'restartLatest') return <AwStrokeIcon name="play" />;
  if (action === 'forceEnd') return <AwStrokeIcon name="alert-t" />;
  return <StopOutlined aria-hidden="true" />;
}

export function ExecutionActionBar({ attempt, pending, onAction, emphasis = false }: ExecutionActionBarProps) {
  const { t } = useTranslation('workitem');
  const resolved = resolveExecutionActions(attempt);
  if (!resolved.primary && resolved.overflow.length === 0 && resolved.disabled.length === 0) return null;

  const isPending = (action: ExecutionActionKind) =>
    pending?.dispatchId === attempt.dispatchId && pending.action === action;

  const request = (action: ExecutionActionKind) => {
    if (action === 'restartLatest') {
      Modal.confirm({
        title: t('delivery.restartLatest'),
        content: t('delivery.restartLatestBody'),
        okText: t('delivery.restartLatest'),
        cancelText: t('delivery.cancelAction'),
        onOk: () => onAction(action),
      });
      return;
    }
    if (action === 'resume') {
      const resume = attempt.control?.resume;
      const target = resume?.targetDispatchId ?? attempt.dispatchId;
      if (resume?.targetStopPending) {
        const timeout = resume.targetStatus === 'TIMEOUT';
        Modal.confirm({
          title: t(timeout ? 'delivery.resumeTimeoutTitle' : 'delivery.resumeStopPendingTitle', { id: target }),
          content: t(timeout ? 'delivery.resumeTimeoutBody' : 'delivery.resumeStopPendingBody', { id: target }),
          okText: t('delivery.retry'),
          okButtonProps: { danger: true },
          cancelText: t('delivery.cancelAction'),
          onOk: () => onAction(action),
        });
        return;
      }
    }
    if (action === 'end') {
      Modal.confirm({
        title: t('delivery.endConfirmTitle', { id: attempt.dispatchId }),
        content: t('delivery.endConfirmBody', {
          id: attempt.dispatchId,
          agent: attempt.agentName || '—',
        }),
        okText: t('delivery.endExecution'),
        okButtonProps: { danger: true },
        cancelText: t('delivery.cancelAction'),
        onOk: () => onAction(action),
      });
      return;
    }
    if (action === 'forceEnd') {
      Modal.confirm({
        title: t('delivery.forceConfirmTitle', { id: attempt.dispatchId }),
        content: t('delivery.forceConfirmBody'),
        okText: t('delivery.forceEnd'),
        okButtonProps: { danger: true },
        cancelText: t('delivery.cancelAction'),
        onOk: () => onAction(action),
      });
      return;
    }
    onAction(action);
  };

  const reasonText = (reasonKey: string, reasonArgs?: string[]) => {
    const values = Object.fromEntries((reasonArgs ?? []).map((value, index) => [String(index), value]));
    return String(t(reasonKey as never, values as never));
  };

  const renderDisabled = (action: ExecutionActionKind, reasonKey: string, reasonArgs?: string[]) => {
    const label = executionActionLabel(attempt, action, t);
    return (
      <Tooltip key={`disabled-${action}`} title={reasonText(reasonKey, reasonArgs)}>
        <Button size="small" disabled aria-label={label} icon={actionIcon(action)}>{label}</Button>
      </Tooltip>
    );
  };

  const renderButton = (action: ExecutionActionKind) => {
    const label = executionActionLabel(attempt, action, t);
    const danger = action === 'end' || action === 'forceEnd';
    const primary = danger ? resolved.primary === action : emphasis && resolved.primary === action;
    return (
      <Tooltip key={action} title={danger ? label : undefined}>
        <Button
          size="small"
          type={primary ? 'primary' : 'default'}
          danger={danger}
          aria-label={label}
          icon={actionIcon(action)}
          loading={isPending(action)}
          onClick={() => request(action)}
        >
          {label}
        </Button>
      </Tooltip>
    );
  };

  return (
    <Space size={4} wrap>
      {resolved.primary && renderButton(resolved.primary)}
      {resolved.disabled.map((item) => renderDisabled(item.action, item.reasonKey, item.reasonArgs))}
      {resolved.overflow.length > 0 && (
        <Dropdown
          trigger={['click']}
          menu={{
            items: resolved.overflow.map((action) => ({
              key: action,
              danger: action === 'end' || action === 'forceEnd',
              icon: actionIcon(action),
              label: executionActionLabel(attempt, action, t),
              disabled: isPending(action),
              onClick: () => request(action),
            })),
          }}
        >
          <Button
            size="small"
            aria-label={t('delivery.moreActions')}
            icon={<AwStrokeIcon name="more" />}
            loading={resolved.overflow.some(isPending)}
          />
        </Dropdown>
      )}
    </Space>
  );
}
