import { useTranslation } from 'react-i18next';
import { Empty } from 'antd';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  description?: string;
  /** 传入 icon/title/subtext/action 任意一个即启用「图标+标题+副文+动作」布局（03b ⑤） */
  icon?: ReactNode;
  title?: string;
  subtext?: string;
  action?: ReactNode;
}

export function EmptyState({ description, icon, title, subtext, action }: EmptyStateProps) {
  const { t } = useTranslation('shared');
  if (!icon && !title && !subtext && !action) {
    return <Empty description={description ?? t('empty')} />;
  }
  return (
    <div style={{ padding: '28px 0', textAlign: 'center' }}>
      {icon ? (
        <div
          aria-hidden="true"
          style={{ width: 40, height: 40, margin: '0 auto 8px', borderRadius: 8, background: 'var(--aw-gray-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--aw-text-disabled)', fontSize: 20 }}
        >
          {icon}
        </div>
      ) : null}
      <div style={{ fontSize: 13, color: 'var(--aw-text-2)' }}>{title ?? description ?? t('empty')}</div>
      {subtext ? <div style={{ fontSize: 12, color: 'var(--aw-text-3)', marginTop: 2 }}>{subtext}</div> : null}
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  );
}
