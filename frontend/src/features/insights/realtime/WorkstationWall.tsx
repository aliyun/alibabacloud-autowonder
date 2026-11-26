import { useTranslation } from 'react-i18next';
import { Button, Card } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Workstation } from './api';
import { useAgentRunning } from './hooks';
import { formatMinutes } from '@/shared/lib/duration';

const MISSING_VALUE = '—';
const CLOSE_GLYPH = '×';

interface Props {
  workstations: Workstation[];
}

function avatarStyle(avatarUrl: string | null) {
  return avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined;
}

function avatarText(name: string) {
  return Array.from(name || '?')[0];
}

/** 工位墙：卡片尺寸固定，点击任意员工在墙下方详情区展示执行中任务。 */
export default function WorkstationWall({ workstations }: Props) {
  const { t } = useTranslation('insights');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: runningTasks, isLoading, isError, refetch } = useAgentRunning(selectedId);
  const dockRef = useRef<HTMLDivElement>(null);
  const selectedWorker = workstations.find((worker) => worker.agentId === selectedId) ?? null;

  useEffect(() => {
    if (selectedId !== null) dockRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

  const toggle = (agentId: number) => setSelectedId((current) => (current === agentId ? null : agentId));

  return (
    <Card
      title={<>{t('workstations.title')}{' '}<span className="insight-card-hint">{t('workstations.hint')}</span></>}
      style={{ minWidth: 0 }}
    >
      {workstations.length === 0 ? (
        <div className="insight-empty-note">{t('workstations.empty')}</div>
      ) : (
        <div className="insight-workstation-grid">
          {workstations.map((worker) => {
            const selected = selectedId === worker.agentId;
            return (
              <div
                key={worker.agentId}
                className={`insight-workstation${worker.busy ? ' is-busy' : ''}${selected ? ' is-selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-expanded={selected}
                onClick={() => toggle(worker.agentId)}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle(worker.agentId);
                  }
                }}
              >
                <div className="insight-ws-av" aria-hidden="true" style={avatarStyle(worker.avatarUrl)}>
                  {!worker.avatarUrl && avatarText(worker.name)}
                </div>
                <div className="insight-ws-nm insight-truncate" title={worker.name}>{worker.name}</div>
                <div className="insight-ws-st">{worker.busy ? t('workstations.busy', { count: worker.runningTasks }) : t('workstations.idle')}</div>
              </div>
            );
          })}
        </div>
      )}
      {selectedWorker && (
        <div className="insight-ws-dock" aria-live="polite" ref={dockRef}>
          <div className="insight-ws-dock-head">
            <span className="insight-ws-dock-av" aria-hidden="true" style={avatarStyle(selectedWorker.avatarUrl)}>
              {!selectedWorker.avatarUrl && avatarText(selectedWorker.name)}
            </span>
            <div className="insight-ws-dock-id">
              <b title={selectedWorker.name}>{selectedWorker.name}</b>
              <span>
                {selectedWorker.busy
                  ? t('workstations.runningCount', { count: selectedWorker.runningTasks })
                  : t('workstations.idle')}
              </span>
            </div>
            <button
              type="button"
              className="insight-ws-dock-close"
              aria-label={t('workstations.closeDetail')}
              onClick={() => setSelectedId(null)}
            >
              {CLOSE_GLYPH}
            </button>
          </div>
          {isLoading ? (
            <div className="insight-ws-dock-note">{t('workstations.loading')}</div>
          ) : isError ? (
            <div className="insight-ws-dock-note is-error">
              <span>{t('workstations.loadFailure')}</span>
              <Button size="small" onClick={() => { void refetch(); }}>{t('participation.retry')}</Button>
            </div>
          ) : (runningTasks?.length ?? 0) === 0 ? (
            <div className="insight-ws-dock-note">
              {selectedWorker.busy ? t('workstations.emptyAfterFinish') : t('workstations.noRunning')}
            </div>
          ) : (
            <ul className="insight-ws-dock-list">
              {runningTasks?.map((task) => (
                <li className="insight-ws-dock-item" key={task.dispatchId}>
                  <div className="insight-ws-dock-main">
                    <a
                      className="insight-ws-dock-title"
                      href={`/workitems/${task.workitemId}`}
                      title={task.workitemTitle ?? ''}
                    >
                      {task.workitemTitle || t('activity.unnamed')}
                    </a>
                    <div className="insight-ws-dock-meta">
                      <span className="insight-ws-dock-step" title={task.stepName ?? ''}>{task.stepName || MISSING_VALUE}</span>
                      <a className="insight-ws-dock-open" href={`/workitems/${task.workitemId}`}>{t('workstations.viewWorkitem')}</a>
                    </div>
                  </div>
                  <div className="insight-ws-dock-side">
                    <strong>{formatMinutes(task.runningMinutes)}</strong>
                    <span>{t('activity.elapsed')}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
