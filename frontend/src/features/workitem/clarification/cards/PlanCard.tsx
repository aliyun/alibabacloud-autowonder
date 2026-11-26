import { useTranslation } from 'react-i18next';
import { Spin } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { ReactNode } from 'react';
import type { AcpPlanEntry, AcpPlanPriority, AcpPlanStatus } from '../types';
import { CLARIFICATION_THEME } from '../theme';

interface PlanCardProps {
  entries: AcpPlanEntry[];
}

const PRIORITY_TONE: Record<AcpPlanPriority, string> = { high: 'h', medium: 'm', low: 'l' };

const PROGRESS_SEPARATOR = '/';

const PRIORITY_LABEL = { high: 'clarification.priorityHigh', medium: 'clarification.priorityMedium', low: 'clarification.priorityLow' } as const;

const STATUS_AFFORDANCE: Record<AcpPlanStatus, ReactNode> = {
  completed: (
    <span data-testid="plan-entry-icon-completed" className="aw-cl-st-ok" style={{ display: 'inline-flex' }}>
      <AwStrokeIcon name="check-c" size={12} />
    </span>
  ),
  in_progress: (
    <Spin size="small" data-testid="plan-entry-icon-in_progress" />
  ),
  pending: (
    <span
      data-testid="plan-entry-icon-pending"
      style={{
        width: 10, height: 10, borderRadius: '50%',
        border: `1px solid ${CLARIFICATION_THEME.controlBorder}`,
        display: 'inline-block',
      }}
    />
  ),
};

export function PlanCard({ entries }: PlanCardProps) {
  const { t } = useTranslation('workitem');
  if (entries.length === 0) return null;
  const completedCount = entries.filter((entry) => entry.status === 'completed').length;

  return (
    <div className="aw-cl-plan" data-testid="acp-plan-card">
      <div className="aw-cl-plan-head">
        {t('clarification.executionPlan')}
        <span className="n">{completedCount}{PROGRESS_SEPARATOR}{entries.length}</span>
      </div>
      <ul>
        {entries.map((entry, index) => (
          <li
            key={index}
            className={entry.status === 'completed' ? 'done' : undefined}
            data-testid={`plan-entry-${entry.status}-${index}`}
          >
            <span className="ic">{STATUS_AFFORDANCE[entry.status]}</span>
            <span className="txt">{entry.content}</span>
            <span className={Object.prototype.hasOwnProperty.call(PRIORITY_TONE, entry.priority) ? `pri ${PRIORITY_TONE[entry.priority]}` : 'pri'}>
              {Object.prototype.hasOwnProperty.call(PRIORITY_LABEL, entry.priority) ? t(PRIORITY_LABEL[entry.priority]) : entry.priority}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
