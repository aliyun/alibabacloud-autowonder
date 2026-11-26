import { useTranslation } from 'react-i18next';
import { statusCategoryOf } from '@/features/workitem/constants';
import type { Workitem } from '@/shared/types/workitem';

interface AgentStatCardsProps {
  workitems: Workitem[];
  memoryCount: number;
}

export function AgentStatCards({ workitems, memoryCount }: AgentStatCardsProps) {
  const { t } = useTranslation('agent');
  const inProgress = workitems.filter(w => statusCategoryOf(w) === 'IN_PROGRESS').length;
  const pending = workitems.filter(w => statusCategoryOf(w) === 'PENDING_DECISION').length;
  const done = workitems.filter(w => statusCategoryOf(w) === 'DONE').length;
  const stats = [
    { key: 'inProgress', label: t('display.inProgress'), value: inProgress },
    { key: 'pending', label: t('display.pendingDecision'), value: pending, warn: true },
    { key: 'done', label: t('display.done'), value: done },
    { key: 'memory', label: t('display.memoryCount'), value: memoryCount },
  ];

  return (
    // 原型 13 stat-strip：浅灰无框指标条，标签在上、数值在下（同小队详情）。
    <div className="aw-agent-stats">
      {stats.map(stat => (
        <div key={stat.key} className="aw-agent-stat">
          <div className="aw-agent-stat-k">{stat.label}</div>
          <div className={stat.warn ? 'aw-agent-stat-v aw-agent-stat-v--warn' : 'aw-agent-stat-v'}>{stat.value}</div>
        </div>
      ))}
    </div>
  );
}
