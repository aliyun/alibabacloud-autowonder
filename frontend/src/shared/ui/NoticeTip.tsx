import type { ReactNode } from 'react';
import { Alert } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, InfoCircleFilled } from '@ant-design/icons';

export type NoticeTipKind = 'info' | 'success' | 'warning' | 'error';

const ICONS: Record<NoticeTipKind, ReactNode> = {
  info: <InfoCircleFilled aria-hidden="true" />,
  success: <CheckCircleFilled aria-hidden="true" />,
  warning: <ExclamationCircleFilled aria-hidden="true" />,
  error: <CloseCircleFilled aria-hidden="true" />,
};

/**
 * 公共内联提示条：与 message toast 同族的“message tip”基础组件。
 * 统一实心图标、标题/详情结构与紧凑宽度（crystal.css 的 .aw-notice-tip 契约），
 * 各页面不得再自拼 Alert 图标与双行结构，避免同类提示视觉漂移。
 */
export function NoticeTip({ kind, title, detail, action, className, style, testId }: {
  kind: NoticeTipKind;
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  testId?: string;
}) {
  return (
    <Alert
      type={kind}
      showIcon
      icon={ICONS[kind]}
      className={['aw-notice-tip', className].filter(Boolean).join(' ') || undefined}
      style={style}
      data-testid={testId}
      message={title}
      description={detail}
      action={action}
    />
  );
}
