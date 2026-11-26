import type { ReactNode } from 'react';
import { Avatar, Button, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { WorkflowEvidenceRef, WorkflowFinding, WorkflowGraph } from './api';
import { humanAvatarColor } from '@/shared/ui/AiIdentity';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { RobotHeadIcon } from '@/shared/ui/RobotHeadIcon';
import type { WorkflowSelection } from './WorkflowGraphCanvas';

const KIND_LABEL_KEYS = {
  MEMBER: 'workflow.kinds.MEMBER',
  HUMAN: 'workflow.kinds.HUMAN',
  EXTERNAL: 'workflow.kinds.EXTERNAL',
  UNRESOLVED: 'workflow.kinds.UNRESOLVED',
  HANDOFF: 'workflow.kinds.HANDOFF',
  REWORK: 'workflow.kinds.REWORK',
  ESCALATION: 'workflow.kinds.ESCALATION',
  MISSING_CONFIGURATION: 'workflow.kinds.MISSING_CONFIGURATION',
  AMBIGUOUS_TARGET: 'workflow.kinds.AMBIGUOUS_TARGET',
  CONFLICT: 'workflow.kinds.CONFLICT',
  INFORMATION: 'workflow.kinds.INFORMATION',
} as const;

const KIND_MEMBER = 'MEMBER';
const KIND_HUMAN = 'HUMAN';
const MISSING_VALUE = '—';

const FINDING_COLORS: Record<string, string> = {
  MISSING_CONFIGURATION: 'red',
  AMBIGUOUS_TARGET: 'orange',
  CONFLICT: 'volcano',
  INFORMATION: 'blue',
};

const EDGE_COLORS: Record<string, string> = {
  HANDOFF: 'blue',
  REWORK: 'red',
  ESCALATION: 'orange',
};

export interface WorkflowDetailsProps {
  graph: WorkflowGraph | null | undefined;
  selection: WorkflowSelection | null;
  onSelect?: (selection: WorkflowSelection) => void;
}

function EvidenceRows({ refs }: { refs: WorkflowEvidenceRef[] | undefined }) {
  if (!refs?.length) return null;
  return (
    <>
      {refs.map((ref, index) => (
        <div key={`${ref.sourceId}-${ref.fieldPath ?? ''}-${index}`} className="aw-workflow-evi">
          <div className="aw-workflow-evi-meta">
            <span className="aw-workflow-evi-source" title={ref.sourceId}>{ref.sourceId}</span>
            {ref.fieldPath && <span className="aw-workflow-evi-field" title={ref.fieldPath}>{ref.fieldPath}</span>}
          </div>
          <blockquote className="aw-workflow-evi-quote" data-testid="workflow-evidence-quote">{ref.quote}</blockquote>
        </div>
      ))}
    </>
  );
}

export function WorkflowDetails({ graph, selection, onSelect }: WorkflowDetailsProps) {
  const { t } = useTranslation('sdlc');
  const nodes = graph?.workflow?.nodes ?? [];
  const edges = graph?.workflow?.edges ?? [];
  const nodeById = (id: string) => nodes.find((item) => item.id === id);
  const labelOf = (id: string) => nodeById(id)?.label || id;
  const node = selection?.type === 'node' ? nodeById(selection.id) : undefined;
  const edge = selection?.type === 'edge' ? edges.find((item) => item.id === selection.id) : undefined;
  const outgoing = node ? edges.filter((item) => item.source === node.id) : [];

  const kindLabel = (kind: string) => (
    Object.prototype.hasOwnProperty.call(KIND_LABEL_KEYS, kind)
      ? t(KIND_LABEL_KEYS[kind as keyof typeof KIND_LABEL_KEYS])
      : kind
  );

  const field = (label: string, value: ReactNode) => (
    <div className="aw-workflow-field">
      <div className="aw-workflow-field-k">{label}</div>
      <div className="aw-workflow-field-v">{value}</div>
    </div>
  );

  return (
    <div className="aw-workflow-details">
      <section className="aw-workflow-detail-panel" aria-label={edge ? t('workflow.edge') : t('workflow.node')}>
        <div className="aw-workflow-detail-head">
          <span>{edge ? t('workflow.edgeDetail') : t('workflow.nodeDetail')}</span>
          {edge && (
            <Button
              type="text"
              size="small"
              className="aw-workflow-detail-back"
              icon={<AwStrokeIcon name="chev-l" size={12} />}
              onClick={() => onSelect?.({ type: 'node', id: edge.source })}
            >
              {t('workflow.backToNode')}
            </Button>
          )}
        </div>
        <div className="aw-workflow-detail-body" key={selection ? `${selection.type}:${selection.id}` : 'empty'}>
          {node && (
            <>
              <div className="aw-workflow-node-head">
                <span className="aw-workflow-node-identity">
                  {(node.kind === KIND_MEMBER || node.kind === KIND_HUMAN) && (
                    <Avatar
                      size={20}
                      aria-hidden="true"
                      className={node.kind === KIND_MEMBER ? 'aw-workflow-node-avatar is-agent' : 'aw-workflow-node-avatar'}
                      icon={node.kind === KIND_MEMBER ? <RobotHeadIcon aria-hidden="true" /> : undefined}
                      style={{
                        fontSize: 11,
                        ...(node.kind === KIND_HUMAN ? { backgroundColor: humanAvatarColor(node.label || node.id) } : null),
                      }}
                    >
                      {node.kind === KIND_HUMAN ? (node.label || node.id).slice(0, 1) : null}
                    </Avatar>
                  )}
                  <span className="aw-workflow-node-title">{node.label || node.id}</span>
                </span>
                <Tag className="aw-workflow-kind-tag">{kindLabel(node.kind)}</Tag>
              </div>
              <div className="aw-workflow-fields">
                {field(t('workflow.responsibility'), node.responsibility || MISSING_VALUE)}
                {field(t('workflow.sdlcBinding'), node.stepSummaries?.length
                  ? t('workflow.nodeSteps', { count: node.stepSummaries.length })
                  : MISSING_VALUE)}
              </div>
              {(node.stepSummaries?.length ?? 0) > 0 && (
                <ol className="aw-workflow-steps">
                  {node.stepSummaries?.map((step, index) => (
                    <li key={step.stepId}>
                      <span className="aw-workflow-step-idx" aria-hidden="true">{index + 1}</span>
                      <span className="aw-workflow-step-body">
                        <strong>{step.label}</strong>
                        <span>{step.description}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {outgoing.length > 0 && (
                <>
                  <div className="aw-workflow-detail-section-title">{t('workflow.handoffRules')}</div>
                  <div className="aw-workflow-routes">
                    {outgoing.map((item) => (
                      <button
                        type="button"
                        className="aw-workflow-route"
                        key={item.id}
                        onClick={() => onSelect?.({ type: 'edge', id: item.id })}
                      >
                        <span className="aw-workflow-route-head">
                          <span className="aw-workflow-route-kind" data-kind={item.kind}>{kindLabel(item.kind)}</span>
                          <AwStrokeIcon name="chev-r" size={12} />
                          <span className="aw-workflow-route-target" title={labelOf(item.target)}>{labelOf(item.target)}</span>
                        </span>
                        <small>{item.condition}</small>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {(node.evidenceRefs?.length ?? 0) > 0 && (
                <div className="aw-workflow-detail-section-title">{t('workflow.evidence')}</div>
              )}
              <EvidenceRows refs={node.evidenceRefs} />
            </>
          )}
          {edge && (
            <>
              <div className="aw-workflow-edge-head">
                <Button
                  type="link"
                  size="small"
                  aria-label={t('workflow.viewNode', { name: labelOf(edge.source) })}
                  onClick={() => onSelect?.({ type: 'node', id: edge.source })}
                >
                  {labelOf(edge.source)}
                </Button>
                <AwStrokeIcon name="chev-r" size={12} />
                <Button
                  type="link"
                  size="small"
                  aria-label={t('workflow.viewNode', { name: labelOf(edge.target) })}
                  onClick={() => onSelect?.({ type: 'node', id: edge.target })}
                >
                  {labelOf(edge.target)}
                </Button>
              </div>
              <div className="aw-workflow-fields">
                {field(t('workflow.typeLabel'), (
                  <>
                    <Tag color={Object.prototype.hasOwnProperty.call(EDGE_COLORS, edge.kind) ? EDGE_COLORS[edge.kind] : undefined}>
                      {kindLabel(edge.kind)}
                    </Tag>
                    {edge.isMainPath && <Tag color="green">{t('workflow.mainPathBadge')}</Tag>}
                  </>
                ))}
                {field(t('workflow.handoffRules'), edge.condition || MISSING_VALUE)}
              </div>
              {(edge.evidenceRefs?.length ?? 0) > 0 && (
                <div className="aw-workflow-detail-section-title">{t('workflow.evidence')}</div>
              )}
              <EvidenceRows refs={edge.evidenceRefs} />
            </>
          )}
          {!node && !edge && (
            <Typography.Text type="secondary">{t('workflow.noSelection')}</Typography.Text>
          )}
        </div>
      </section>
    </div>
  );
}

/** Findings describe the whole squad and stay visible independently of the selected member. */
export function WorkflowFindings({ graph }: Pick<WorkflowDetailsProps, 'graph'>) {
  const { t } = useTranslation('sdlc');
  const findings: WorkflowFinding[] = graph?.workflow.findings ?? [];
  const references = (finding: (typeof findings)[number]) => [
    ...(finding.nodeIds ?? []).map(id => graph?.workflow.nodes.find(node => node.id === id)?.label || id),
    ...(finding.edgeIds ?? []).map(id => graph?.workflow.edges.find(edge => edge.id === id)?.condition || id),
  ];
  return (
    <section className="aw-workflow-findings" aria-label={t('workflow.findings')}>
      <div className="aw-workflow-findings-head">
        <span className="aw-workflow-findings-icon"><AwStrokeIcon name="bulb" /></span>
        <h3>{t('workflow.findings')}</h3>
      </div>
      <div className="aw-workflow-findings-body">
        {findings.length === 0 && <Typography.Text type="secondary">{t('workflow.noFindings')}</Typography.Text>}
        {findings.map(finding => (
          <div key={finding.id} className="aw-workflow-finding">
            <div className="aw-workflow-finding-head">
              <Tag color={FINDING_COLORS[finding.kind]}>{t(KIND_LABEL_KEYS[finding.kind])}</Tag>
              <span className="aw-workflow-finding-summary">{finding.summary}</span>
            </div>
            {references(finding).length > 0 && <div className="aw-workflow-finding-source">
              {t('workflow.references')}: {references(finding).join(t('workflow.referenceSeparator'))}
            </div>}
            <EvidenceRows refs={finding.evidenceRefs} />
          </div>
        ))}
      </div>
    </section>
  );
}
