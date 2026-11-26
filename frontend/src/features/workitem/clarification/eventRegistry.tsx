import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import type { ReactNode } from 'react';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { TimelineNode } from './timeline';
import { PlanCard } from './cards/PlanCard';
import { ToolCallNode } from './cards/ToolCallNode';
import { ElicitationCard } from './cards/ElicitationCard';
import { EventAvailabilityNode } from './EventAvailabilityNode';
import { PersistentFold } from './PersistentFold';
import { WindowedConversationText } from './WindowedConversationText';
import type { Artifact } from '@/shared/types/workitem';

export interface TimelineArtifactContext {
  artifacts: Artifact[];
  onArtifactClick: (artifact: Artifact) => void;
  /** 大事件摘要节点打开分段全文抽屉。 */
  onOpenEventContent?: (eventId: number, summary: string) => void;
}

export type TimelineNodeRenderer = (node: TimelineNode, artifactContext?: TimelineArtifactContext) => ReactNode;

function StepSummary({ icon, label }: { icon: string; label: ReactNode }) {
  return (
    <>
      <span className="ic"><AwStrokeIcon name={icon} size={13} /></span>
      <span className="t">{label}</span>
      <span className="r"><span className="chev"><AwStrokeIcon name="chev-d" size={12} /></span></span>
    </>
  );
}

export const timelineRenderers: Readonly<Record<string, TimelineNodeRenderer>> = {
  text: (node, artifactContext) => (node.text ? (
    <WindowedConversationText
      text={node.text}
      artifacts={artifactContext?.artifacts}
      onArtifactClick={artifactContext?.onArtifactClick}
    />
  ) : null),

  thinking: (node) => (node.text ? (
    <PersistentFold className="aw-cl-step" foldKey={node.id}
      summary={<StepSummary icon="bulb" label={i18n.t('workitem:clarification.thinkingProcess')} />}>
      <div className="aw-cl-step-body aw-clarify-thinking" style={{ maxHeight: 280, overflowY: 'auto' }}>
        <WindowedConversationText text={node.text} />
      </div>
    </PersistentFold>
  ) : null),

  tool: (node) => (node.tool ? <ToolCallNode tool={node.tool} foldKey={node.id} /> : null),

  displaySummary: (node) => <EventAvailabilityNode node={node} />,

  plan: (node) => (node.plan ? <PlanCard entries={node.plan.entries} /> : null),

  // 命令快照只喂斜杠补全，画到时间线上纯属噪音。
  commands: () => null,

  // 轮次状态由面板顶层的回复指示统一承担，时间线里不重复一份。
  status: () => null,

  error: (node) => (
    <div className="aw-cl-note error" style={{ marginBottom: 4 }}>
      <span className="grow">{node.text}</span>
    </div>
  ),

  log: (node) => (
    <PersistentFold className="aw-cl-step" foldKey={node.id}
      summary={<StepSummary icon="term" label={i18n.t('workitem:clarification.logs')} />}>
      <div className="aw-cl-step-body">
        <pre className="aw-cl-pre">{node.text}</pre>
      </div>
    </PersistentFold>
  ),

  // 进行中的问题交给面板里的 ElicitationWizard 停靠卡片；时间线只内联已回答的历史卡片。
  elicitation: (node) => {
    const card = node.elicitation;
    if (!card || !card.resolved) return null;
    return (
      <ElicitationCard
        requestId={card.requestId}
        message={card.message}
        schema={card.requestedSchema}
        resolved
        action={card.action}
        expired={card.status === 'EXPIRED'}
        answers={card.content}
      />
    );
  },
};

export function renderTimelineNode(node: TimelineNode, artifactContext?: TimelineArtifactContext): ReactNode {
  return <TimelineNodeView node={node} artifactContext={artifactContext} />;
}

function TimelineNodeView({ node, artifactContext }: {
  node: TimelineNode;
  artifactContext?: TimelineArtifactContext;
}) {
  useTranslation('workitem');
  const renderer = timelineRenderers[node.kind] ?? renderUnknownNode;
  return renderer(node, artifactContext);
}

function renderUnknownNode(node: TimelineNode): ReactNode {
  const eventType = node.raw?.eventType ?? node.kind;
  return (
    <PersistentFold className="aw-cl-step" foldKey={node.id}
      summary={<StepSummary icon="info" label={i18n.t('workitem:clarification.unknownEvent', { eventType })} />}>
      <div className="aw-cl-step-body">
        <pre data-testid="timeline-unknown-raw" className="aw-cl-pre">
          {JSON.stringify(node.raw ?? { kind: node.kind, eventSeq: node.eventSeq }, null, 2)}
        </pre>
      </div>
    </PersistentFold>
  );
}
