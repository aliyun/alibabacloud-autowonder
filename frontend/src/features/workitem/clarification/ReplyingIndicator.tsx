import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { useEffect, useState } from 'react';

export type ReplyingIndicatorStyle = 'dots' | 'spinner' | 'cursor';

export const REPLYING_INDICATOR_STYLES: ReplyingIndicatorStyle[] = ['dots', 'spinner', 'cursor'];

const REPLYING_TEXT_KEYS = [
  "clarification.replying.thinking",
  "clarification.replying.considering",
  "clarification.replying.analyzing",
  "clarification.replying.organizingThoughts",
  "clarification.replying.composing",
  "clarification.replying.reviewingWorkitem",
  "clarification.replying.checkingAcceptance",
  "clarification.replying.generatingQuestions",
] as const;

// Keep the exported array API while resolving labels when consumers read them.
export const CLARIFICATION_REPLYING_TEXTS: string[] = REPLYING_TEXT_KEYS.map(() => '');
REPLYING_TEXT_KEYS.forEach((key, index) => {
  Object.defineProperty(CLARIFICATION_REPLYING_TEXTS, index, { get: () => i18n.t(key, { ns: 'workitem' }) });
});

export const REPLYING_INDICATOR_ROTATE_INTERVAL_MS = 5000;

/** 从候选中随机挑一个不同于 current 的项；pick 返回 [0, n) 的整数，便于测试注入。 */
export function pickNextReplyingIndicator<T>(current: T, candidates: readonly T[],
  pick: (n: number) => number = defaultPick): T {
  if (candidates.length === 0) return current;
  if (candidates.length === 1) return candidates[0];
  const others = candidates.filter((c) => c !== current);
  return others[pick(others.length) % others.length];
}

function defaultPick(n: number): number {
  return Math.floor(Math.random() * n);
}

interface ReplyingIndicatorProps {
  agentName?: string;
}

/** 模型未结束回复期间的动态状态行：文案池每 5 秒随机轮换且不连续重复；样式值照常轮换（data-indicator-style），视觉统一为原型的三点。 */
export function ReplyingIndicator({ agentName }: ReplyingIndicatorProps) {
  const { t } = useTranslation('workitem');
  const [style, setStyle] = useState<ReplyingIndicatorStyle>('dots');
  const [textKey, setTextKey] = useState<typeof REPLYING_TEXT_KEYS[number]>(() =>
    REPLYING_TEXT_KEYS[defaultPick(REPLYING_TEXT_KEYS.length)]);

  useEffect(() => {
    const timer = setInterval(() => {
      setStyle((prev) => pickNextReplyingIndicator(prev, REPLYING_INDICATOR_STYLES));
      setTextKey((prev) => pickNextReplyingIndicator(prev, REPLYING_TEXT_KEYS));
    }, REPLYING_INDICATOR_ROTATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="aw-cl-replying aw-replying-indicator" data-testid="clarification-replying-indicator" data-indicator-style={style}>
      <span className="dots" aria-hidden><span /><span /><span /></span>
      <span>{agentName ? `${agentName} ` : ''}{t(textKey)}</span>
    </div>
  );
}
