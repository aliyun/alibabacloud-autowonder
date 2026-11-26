import { RobotHeadIcon } from './RobotHeadIcon';
import { Avatar } from 'antd';
import type { CSSProperties } from 'react';

const HUMAN_PALETTE = ['#7A8599', '#B45309', '#0E7490', '#6D28D9', '#9F1239', '#3F6212', '#9A3412', '#155E75'];

/** 真人头像底色：按名称取稳定色，成员表用户列等处复用。 */
export function humanAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return HUMAN_PALETTE[hash % HUMAN_PALETTE.length];
}

const SIZE: Record<'sm' | 'default' | 'lg', number> = { sm: 20, default: 28, lg: 40 };

interface AiIdentityProps {
  name: string | null | undefined;
  /** 渲染 violet AI 徽标（表内处理人列等紧凑场景） */
  aiBadge?: boolean;
  /** 渲染圆形头像：AI 用 --aw-ai 底色，真人按名称取稳定色，内容为首字。缺省不渲染头像。 */
  avatar?: boolean;
  /** AI 头像用 RobotHeadIcon 图标替代首字 */
  icon?: boolean;
  size?: 'sm' | 'default' | 'lg';
  fallback?: string;
  /** 悬停完整名（长名截断时的完整信息出口） */
  title?: string;
  style?: CSSProperties;
}

export function AiIdentity({
  name,
  aiBadge,
  avatar,
  icon,
  size = 'default',
  fallback = '-',
  title,
  style,
}: AiIdentityProps) {
  const displayName = name?.trim() || null;
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%', ...style }}>
      {avatar && displayName ? (
        <Avatar
          aria-hidden="true"
          size={SIZE[size]}
          icon={icon ? <RobotHeadIcon aria-hidden="true" /> : undefined}
          style={{
            backgroundColor: aiBadge || icon ? 'var(--aw-ai)' : humanAvatarColor(displayName),
            flexShrink: 0,
            fontSize: size === 'sm' ? 11 : size === 'lg' ? 14 : 12,
          }}
        >
          {!icon ? displayName.slice(0, 1) : null}
        </Avatar>
      ) : null}
      {aiBadge && displayName ? (
        <span
          aria-hidden="true"
          style={{ fontSize: 11, fontWeight: 600, color: 'var(--aw-ai)', background: 'var(--aw-ai-bg)', borderRadius: 3, padding: '0 4px', lineHeight: '16px', height: 16, flexShrink: 0 }}
        >
          AI
        </span>
      ) : null}
      <span style={{ minWidth: 0, flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName ?? fallback}</span>
    </span>
  );
}
