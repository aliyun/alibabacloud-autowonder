import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Spin, Tooltip } from 'antd';
import { RobotHeadIcon } from '@/shared/ui/RobotHeadIcon';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { Participant } from '@/shared/types/workitem';

interface SquadMembersProps {
  participants: Participant[];
  loading?: boolean;
}

type MemberTab = 'agents' | 'humans';
const TABS: MemberTab[] = ['agents', 'humans'];
const TAB_LABEL_KEYS = { agents: 'members.agents', humans: 'members.humans' } as const;

export function HumanInitial({ name }: { name?: string | null }) {
  return name ? <>{Array.from(name)[0]}</> : <AwStrokeIcon name="user" size={14} />;
}

// 数字员工名常带「AW」等英文前缀，优先取首个汉字才有区分度
export function AgentInitial({ name }: { name?: string | null }) {
  if (!name) return <RobotHeadIcon aria-hidden="true" />;
  const han = name.match(/\p{Script=Han}/u);
  return <>{han ? han[0] : Array.from(name.trim())[0]?.toUpperCase()}</>;
}

export function SquadMembers({ participants, loading }: SquadMembersProps) {
  const { t } = useTranslation('workitem');
  const [tab, setTab] = useState<MemberTab>('agents');
  const tabRefs = useRef<Record<MemberTab, HTMLButtonElement | null>>({ agents: null, humans: null });
  const idPrefix = useId();

  if (loading) {
    return (
      <div className="aw-task-group">
        <Spin size="small" />
      </div>
    );
  }

  if (!participants || participants.length === 0) {
    return null;
  }

  const participantType = (item: Participant) => item.targetType === 'AGENT' || item.targetType === 'HUMAN'
    ? item.targetType : item.isAgent || item.role === 'AGENT' ? 'AGENT' : 'HUMAN';
  const identityLabel = (item: Participant) => {
    const code = item.targetType ?? (item.role || (item.isAgent ? 'AGENT' : 'HUMAN'));
    return code === 'AGENT' ? t('members.squadIdentity') : code === 'HUMAN' ? t('members.humanIdentity') : item.roleName;
  };
  const agentStatusLabels = new Map<string, string>([
    ['DRAFT', t('members.agentStatus.DRAFT')], ['PENDING_REVIEW', t('members.agentStatus.PENDING_REVIEW')],
    ['ONLINE', t('members.online')], ['OFFLINE', t('members.offline')],
  ]);
  const executorStatusLabels = new Map<string, string>([
    ['BUSY', t('members.busy')], ['ONLINE', t('members.online')], ['OFFLINE', t('members.offline')],
  ]);
  const agentParticipants = participants.filter((item) => participantType(item) === 'AGENT');
  const humanParticipants = participants.filter((item) => participantType(item) === 'HUMAN');

  const statusLabel = (p: Participant) => {
    if (p.executorStatus === 'BUSY') return { text: t('members.busy'), tone: 'active' };
    if (p.executorStatus) return { text: executorStatusLabels.get(p.executorStatus) || p.executorStatus, tone: p.executorStatus === 'ONLINE' ? 'success' : '' };
    if (p.online) return { text: t('members.online'), tone: 'success' };
    return { text: t('members.offline'), tone: '' };
  };

  const selectTab = (next: MemberTab) => {
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    selectTab(tab === 'agents' ? 'humans' : 'agents');
  };

  const renderAgentList = () => {
    if (agentParticipants.length === 0) return <p className="aw-task-empty">{t('members.noAgents')}</p>;
    return (
      <ul className="aw-task-list">
        {agentParticipants.map((p) => {
          const status = statusLabel(p);
          const runtime = p.status
            ? t('members.runtime', { agent: agentStatusLabels.get(p.status) || p.status, executor: executorStatusLabels.get(p.executorStatus ?? 'OFFLINE') || p.executorStatus })
            : undefined;
          return (
            <li key={String(p.userId)}>
              <span className="aw-task-avatar ai" role="img" aria-label={t('members.agentAvatar')}><AgentInitial name={p.name} /></span>
              <div>
                <div className="aw-task-name">{p.name}</div>
                <div className="aw-task-secondary">{t('members.identity', { id: p.displayId ?? p.userId, role: identityLabel(p) })}</div>
              </div>
              <Tooltip title={runtime} trigger={['hover', 'focus']}>
                <span className={status.tone ? `aw-task-status ${status.tone}` : 'aw-task-status'} tabIndex={runtime ? 0 : undefined}>
                  <span className="dot" />{status.text}
                </span>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    );
  };

  const renderHumanList = () => {
    if (humanParticipants.length === 0) return <p className="aw-task-empty">{t('members.noHumans')}</p>;
    return (
      <ul className="aw-task-list">
        {humanParticipants.map((p) => (
          <li key={String(p.userId)}>
            <span className="aw-task-avatar" role="img" aria-label={t('members.humanAvatar')}><HumanInitial name={p.name} /></span>
            <div>
              <div className="aw-task-name">{p.name}</div>
              <div className="aw-task-secondary">{t('members.identity', { id: p.displayId ?? p.userId, role: identityLabel(p) })}</div>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  const listRenderers: Record<MemberTab, () => JSX.Element> = { agents: renderAgentList, humans: renderHumanList };

  return (
    <div className="aw-task-group">
      <div className="aw-task-tabs" role="tablist" aria-label={t('members.title')}>
        {TABS.map((key) => (
          <button
            key={key}
            ref={(el) => { tabRefs.current[key] = el; }}
            type="button"
            role="tab"
            id={`${idPrefix}-${key}-tab`}
            aria-selected={tab === key}
            aria-controls={`${idPrefix}-${key}-panel`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
            onKeyDown={onTabKeyDown}
          >
            {t(TAB_LABEL_KEYS[key])}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${idPrefix}-${tab}-panel`} aria-labelledby={`${idPrefix}-${tab}-tab`}>
        {listRenderers[tab]()}
      </div>
    </div>
  );
}
