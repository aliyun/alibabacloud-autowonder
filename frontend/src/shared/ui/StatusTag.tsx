import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';

export type StatusColorKey = 'blue' | 'green' | 'red' | 'amber' | 'gray' | 'violet' | 'outline' | 'plain';

export const STATUS_TAG_PALETTE: Record<StatusColorKey, HTMLAttributes<HTMLSpanElement>['style']> = {
  blue: { background: 'var(--aw-primary-weak)', color: 'var(--aw-accent-text)' },
  green: { background: 'var(--aw-success-bg)', color: 'var(--aw-success-deep)' },
  red: { background: 'var(--aw-error-bg)', color: 'var(--aw-error-deep)' },
  amber: { background: 'var(--aw-warning-bg)', color: 'var(--aw-warning-deep)' },
  gray: { background: 'var(--aw-gray-bg)', color: 'var(--aw-text-2)' },
  violet: { background: 'var(--aw-ai-bg)', color: 'var(--aw-ai)' },
  outline: { background: 'transparent', color: 'var(--aw-text-2)', borderColor: 'var(--aw-border)' },
  plain: { background: 'transparent', color: 'var(--aw-text)', borderColor: 'transparent' },
};

// 继承 HTMLAttributes：antd Tooltip/Popover 会通过 cloneElement 注入鼠标事件等
// rest props，必须透传到根 span 上弹层才会触发。
interface StatusTagProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  label: ReactNode;
  colorKey: StatusColorKey;
  dot?: boolean;
  size?: 'default' | 'sm';
}

// forwardRef：antd 弹层组件需要在子元素上挂 ref 定位。
export const StatusTag = forwardRef<HTMLSpanElement, StatusTagProps>(function StatusTag(
  { label, colorKey, dot, size = 'default', style, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      {...rest}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: size === 'sm' ? 18 : 22,
        padding: size === 'sm' ? '0 6px' : '0 8px',
        borderRadius: 4,
        fontSize: size === 'sm' ? 11 : 12,
        lineHeight: `${size === 'sm' ? 16 : 20}px`,
        whiteSpace: 'nowrap',
        border: '1px solid transparent',
        ...STATUS_TAG_PALETTE[colorKey],
        ...style,
      }}
    >
      {dot ? <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} /> : null}
      {label}
    </span>
  );
});
