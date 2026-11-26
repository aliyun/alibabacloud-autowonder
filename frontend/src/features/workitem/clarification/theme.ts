import type { CSSProperties } from 'react';

/** 澄清面板复用全站外观令牌，保留平铺回复与气泡尺度。 */
export const CLARIFICATION_THEME = {
  surface: 'var(--aw-panel)',
  hairline: 'var(--aw-border)',
  controlBorder: 'var(--aw-border)',
  userBubble: 'var(--aw-gray-bg)',
  codeSurface: 'var(--aw-raised)',
  codeBorder: 'var(--aw-border)',
  textPrimary: 'var(--aw-text)',
  textSecondary: 'var(--aw-text-2)',
  textMuted: 'var(--aw-text-3)',
  radiusBubble: 8,
  radiusBlock: 8,
  radiusControl: 6,
} as const;

/** 用户消息气泡：灰底、无边框、圆角 8，靠右。
 *  不设 whiteSpace——内容经 MarkdownView 渲染，其内部按 markdown 语义控制。 */
export function userBubbleStyle(): CSSProperties {
  return {
    padding: '8px 12px',
    borderRadius: CLARIFICATION_THEME.radiusBubble,
    backgroundColor: CLARIFICATION_THEME.userBubble,
    fontSize: 13,
    lineHeight: '22px',
    overflowWrap: 'anywhere',
  };
}

/** AI 回复：平铺在白底上，无底色、无边框、无内距。
 *  流式态与完成态共用本函数，保证回复过程中与完成后渲染一致。 */
export function agentBlockStyle(): CSSProperties {
  return {
    fontSize: 13,
    lineHeight: '22px',
    color: CLARIFICATION_THEME.textPrimary,
  };
}
