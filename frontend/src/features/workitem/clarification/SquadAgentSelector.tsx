import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Select } from 'antd';
import { listAllSquads, listSquads, getSquadMembers } from '@/features/squad/api';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { AgentInitial } from '../components/SquadMembers';

export interface SquadAgentSelection {
  squadId: number;
  agentId: number;
}

/**
 * 数字人当前所属小队（URL 刷新恢复用，工单 56281）：恢复身份必须与候选范围
 * 同口径——解析不出来的数字人本来也选不出来，此时调用方不该恢复它。
 * 小队列表走全量分页，避免超过单页上限后把真实归属漏判成「不在任何小队」。
 */
export async function findSquadIdForAgent(agentId: number): Promise<number | null> {
  const squads = await listAllSquads();
  const membersBySquad = await Promise.all(squads.map((squad) => getSquadMembers(squad.id)));
  const index = membersBySquad.findIndex(
    (members) => members.some((member) => member.agentId === agentId),
  );
  return index < 0 ? null : squads[index].id;
}

interface SquadAgentSelectorProps {
  value: SquadAgentSelection | null;
  onChange: (selection: SquadAgentSelection | null) => void;
  /** When true the squad picker is disabled (e.g. locked by delivery progress). */
  locked?: boolean;
}

/**
 * Two-level selector: squad first, then agent within that squad.
 *
 * Reuses the same data sources as StartDeliveryModal. Online status is not
 * enforced here — the clarification backend resolves the executor lazily via
 * ExecutorSelector when the conversation is created.
 */
export function SquadAgentSelector({ value, onChange, locked }: SquadAgentSelectorProps) {
  const { t } = useTranslation('workitem');
  const { data: squads, isLoading: squadsLoading } = useQuery({
    queryKey: ['squads', 'clarification'],
    queryFn: () => listSquads({ pageNum: 1, pageSize: 100 }),
  });

  const squadId = value?.squadId ?? null;
  const membersQuery = useQuery({
    queryKey: ['squad-members', 'clarification', squadId],
    queryFn: () => getSquadMembers(squadId!),
    enabled: !!squadId,
  });
  const members = membersQuery.data ?? [];

  const squadOptions = useMemo(
    () => (squads?.list ?? []).map((s) => ({ value: s.id, label: s.name })),
    [squads],
  );

  let agentList: ReactNode;
  if (!squadId) {
    agentList = <p className="aw-cl-pick-intro" style={{ margin: 0 }}>{t('clarification.selectSquadFirst')}</p>;
  } else if (membersQuery.isLoading) {
    agentList = (
      <div aria-busy="true">
        <div className="aw-cl-skel" />
        <div className="aw-cl-skel" />
        <div className="aw-cl-skel" />
      </div>
    );
  } else if (membersQuery.isError) {
    agentList = (
      <div className="aw-cl-note error">
        <span className="ic"><AwStrokeIcon name="alert-c" /></span>
        <span className="grow">{t('clarification.membersFailed')}</span>
        <Button size="small" onClick={() => { membersQuery.refetch(); }}>{t('clarification.retry')}</Button>
      </div>
    );
  } else if (members.length === 0) {
    agentList = <p className="aw-cl-pick-intro" style={{ margin: 0 }}>{t('clarification.noMembers')}</p>;
  } else {
    agentList = (
      <ul className="aw-cl-agents">
        {members.map((m) => {
          const selected = value?.agentId === m.agentId;
          return (
            <li key={m.agentId}>
              <button
                type="button"
                className={selected ? 'aw-cl-agent is-selected' : 'aw-cl-agent'}
                disabled={locked}
                title={m.responsibilities || undefined}
                aria-pressed={selected}
                onClick={() => onChange({ squadId, agentId: m.agentId })}
              >
                <span className="aw-cl-av lg"><AgentInitial name={m.agentName} /></span>
                <span style={{ minWidth: 0 }}>
                  <span className="nm">{m.agentName}</span>
                  <span className="sub">{t('clarification.metaJoin', { left: m.roleName || m.roleCode, right: m.agentId })}</span>
                </span>
                {m.executorOnline === undefined ? <span /> : (
                  <span className={m.executorOnline ? 'st on' : 'st'}>
                    {m.executorOnline ? t('clarification.online') : t('clarification.offline')}
                  </span>
                )}
                <span className="go">
                  {t('clarification.startClarify')}
                  <AwStrokeIcon name="chev-r" size={12} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <>
      <div className="aw-cl-field">
        <div className="aw-cl-field-label">{t('clarification.squad')}</div>
        <Select
          placeholder={t('clarification.selectSquad')}
          loading={squadsLoading}
          options={squadOptions}
          value={squadId}
          disabled={locked}
          aria-label={t('clarification.squad')}
          onChange={(next) => {
            onChange(next == null ? null : { squadId: next, agentId: 0 });
          }}
        />
      </div>
      <div className="aw-cl-field">
        <div className="aw-cl-field-label">
          {t('clarification.agent')}
          {squadId && membersQuery.isSuccess
            ? <span className="n">{t('clarification.memberCount', { count: members.length })}</span>
            : null}
        </div>
        {agentList}
      </div>
    </>
  );
}
