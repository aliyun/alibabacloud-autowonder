import { useState } from 'react';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTurnEvents } from './hooks';
import { questionIdentity } from './answerHistory';
import type { TimelineNode } from './timeline';
import { ConversationEventView } from './ConversationEventView';
import { EventSyncStatus } from './EventSyncStatus';

interface TurnDetailToggleProps {
  workitemId: number | string;
  conversationId: number;
  /** OUT 气泡自身的轮次 id，只用于标识这个入口。 */
  turnId: number;
  /** 事件按 IN 轮次落库，按需加载必须用配对的 IN 轮次 id 去查。 */
  eventTurnId: number;
  coveredQuestionIds?: ReadonlySet<string>;
}

/**
 * 详情回放只放「过程」，不放「结论」。
 *
 * text 事件累加起来就是这一轮落库的 turn.content（见 hooks.ts 的 streamedText），
 * 而它已经由 OUT 气泡渲染。一起放进详情就会让同一段回复在屏幕上出现两遍。
 * 例外是分窗历史文本（contentWindow），它不在气泡里，必须保留。
 */
export function processNodesOf(timeline: readonly TimelineNode[]): TimelineNode[] {
  return timeline.filter(node => node.kind !== 'text' || !!node.contentWindow);
}

export function TurnDetailToggle({ workitemId, conversationId, turnId, eventTurnId,
  coveredQuestionIds }: TurnDetailToggleProps) {
  const { t } = useTranslation('workitem');
  const [open, setOpen] = useState(false);
  const feed = useTurnEvents(workitemId, conversationId, eventTurnId, open);
  const nodes = processNodesOf(feed.timeline).filter(node => !node.elicitation
    || !coveredQuestionIds?.has(questionIdentity(node.turnId, node.elicitation.requestId)));
  return <div style={{ marginTop: 4 }}>
    <Button type="link" size="small" data-testid={`turn-detail-toggle-${turnId}`}
      style={{ padding: 0, height: 'auto', fontSize: 13 }} onClick={() => setOpen(previous => !previous)}>
      {open ? t('clarification.hideDetails') : t('clarification.showDetails')}
    </Button>
    {open && <div data-testid={`turn-detail-${turnId}`} style={{ marginTop: 4 }}>
      <ConversationEventView nodes={nodes} isProcessing={false} foldScope={`clarification:${conversationId}`} />
      <EventSyncStatus preparationStatus={feed.preparationStatus} syncing={feed.syncing}
        error={feed.isError} onRetry={() => void feed.reload()} />
    </div>}
  </div>;
}
