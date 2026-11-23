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
  turnId: number;
  eventTurnId: number;
  coveredQuestionIds?: ReadonlySet<string>;
}

/** Reply text is already shown in the persisted OUT bubble. */
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
