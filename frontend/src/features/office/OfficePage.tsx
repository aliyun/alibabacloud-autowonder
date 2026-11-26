import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeftOutlined, ArrowRightOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseOutlined,
  DeploymentUnitOutlined, FileTextOutlined, FullscreenExitOutlined, FullscreenOutlined,
  LoadingOutlined, ReloadOutlined, TeamOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/shared/auth/store';
import { formatDateTime, formatNumber } from '@/shared/i18n/format';
import { useRealtime } from '@/shared/realtime/useRealtime';
import { loadOffice } from './api';
import { BUCKETS, GROUP_COLORS, sceneMembers, type OfficeMember, type OfficeSnapshot } from './model';
import { createDemo, demoActivities, demoSnapshot } from './demo';
import { useOfficeInsights, type OfficeActivity } from './insights';
import { OfficeActivityPanel, OfficeMetricValues, type OfficeMetrics } from './OfficeInsights';
import { RollingNumber } from './RollingNumber';
import { OfficeScene } from './OfficeScene';
import { LiveOfficeAnimator, type VisualState } from './scene/visual';
import './OfficePage.css';

type FloorState = OfficeMember['state'] | 'dispatchRole' | 'offFloor';
const emptyMembers: OfficeMember[] = [];
const bucketIcons = { pending: <ClockCircleOutlined />, active: <DeploymentUnitOutlined />, done: <CheckCircleOutlined /> };
const emptyValue = '—';
const count = (value?: number | null) => value == null ? emptyValue : formatNumber(value);
const shortTime: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const simulationJobs = ['job0', 'job1', 'job2', 'job3', 'job4', 'job5'] as const;

export function OfficePage({ preview = false }: { preview?: boolean }) {
  const workspace = useAuthStore(state => state.currentWorkspace);
  const [search] = useSearchParams();
  const mode = search.get('officeDisplay');
  const display = mode === 'live' || mode === 'simulation' ? mode : null;
  if (import.meta.env.DEV && preview) return <DemoOffice />;
  if (!workspace) return null;
  return <LiveOffice key={`${workspace.id}-${display}`} workspaceId={workspace.id} display={display} />;
}

function LiveOffice({ workspaceId, display }: { workspaceId: number; display: 'live' | 'simulation' | null }) {
  const [simulating, setSimulating] = useState(display === 'simulation');
  const query = useQuery({
    queryKey: ['office', workspaceId], queryFn: ({ signal }) => loadOffice(workspaceId, signal),
    refetchInterval: 5_000, retry: false, gcTime: 0,
  });
  useRealtime(`office:${workspaceId}`, {
    onEvent: event => { if (event.type === 'office-activity-changed') void query.refetch(); },
    onReconnect: () => { void query.refetch(); },
  });
  const insights = useOfficeInsights(workspaceId);
  return <OfficeDashboard wall={display !== null} simulation={simulating} onToggleSimulation={() => setSimulating(value => !value)}
    snapshot={query.data} failed={query.isError}
    metrics={insights.metrics} activities={insights.activities} activityFailed={insights.activityFailed}
    refreshing={query.isFetching || insights.refreshing}
    onRefresh={() => { void query.refetch(); insights.refresh(); }} />;
}

function DemoOffice() {
  const [search] = useSearchParams();
  const [simulating, setSimulating] = useState(search.get('officeDisplay') === 'simulation');
  const { i18n } = useTranslation('office');
  const [visual] = useState(createDemo);
  const [epoch] = useState(() => Date.now() - visual.time * 1000);
  const [, setFrame] = useState(0);
  const { events, tasks } = visual;
  const language = i18n.language;
  const activities = useMemo(() => demoActivities(events, tasks, epoch, language), [events, tasks, epoch, language]);
  return (
    <div className="awo-preview">
      <OfficeDashboard snapshot={demoSnapshot(visual)} demo={simulating ? undefined : visual}
        simulation={simulating} onToggleSimulation={() => setSimulating(value => !value)}
        metrics={{ hours: 64.5, skills: 28, versions: 76, averageMinutes: 142 }}
        activities={activities}
        onTick={() => setFrame(frame => frame + 1)} />
    </div>
  );
}

function OfficeDashboard({ wall = false, onToggleSimulation, simulation = false, snapshot, demo, failed = false, refreshing = false, onRefresh, onTick, metrics, activities, activityFailed }: {
  wall?: boolean;
  simulation?: boolean;
  onToggleSimulation?: () => void;
  snapshot?: OfficeSnapshot;
  demo?: VisualState;
  failed?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onTick?: () => void;
  metrics: OfficeMetrics;
  activities?: OfficeActivity[];
  activityFailed?: boolean;
}) {
  const { t } = useTranslation('office');
  const root = useRef<HTMLDivElement>(null);
  const [squad, setSquad] = useState<number | null>(null);
  const [scenePage, setScenePage] = useState(1);
  const [memberId, setMemberId] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const [expanded, setExpanded] = useState(wall);
  const isFullscreen = full || expanded;
  const [peopleExpanded, setPeopleExpanded] = useState(false);
  const members = snapshot?.members ?? emptyMembers;
  const [rosterOffset, setRosterOffset] = useState(0);
  const rotateRoster = isFullscreen && !peopleExpanded && memberId === null && members.length > 3;
  useEffect(() => {
    if (!rotateRoster) return;
    const timer = window.setInterval(() => setRosterOffset(index => (index + 3) % members.length), 8000);
    return () => window.clearInterval(timer);
  }, [rotateRoster, members.length]);
  const shownMembers = peopleExpanded ? members : rotateRoster
    ? [0, 1, 2].map(offset => members[(rosterOffset + offset) % members.length]) : members.slice(0, 3);
  const squads = useMemo(() => [...new Map(members.flatMap(member => member.squads)
    .map(group => [group.id, group.name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [members]);
  const effectiveSquad = squads.some(([id]) => id === squad) ? squad : null;
  const { visible, pages } = useMemo(() => sceneMembers(members, effectiveSquad, scenePage), [members, effectiveSquad, scenePage]);
  const currentScenePage = Math.min(scenePage, pages);
  const visual = useMemo(() => demo ?? new LiveOfficeAnimator(), [demo]);
  const [simStates, setSimStates] = useState<Record<number, FloorState>>({});
  const [, setSimulationFrame] = useState(0);
  const simulationClock = useRef({ active: false, epoch: Date.now() });
  const syncSimRoster = useCallback(() => {
    setSimulationFrame(frame => frame + 1);
    const next: Record<number, FloorState> = {};
    for (const agent of visual.agents) {
      if (agent.memberId == null) continue;
      next[agent.memberId] = agent.state === 'dispatching' ? 'dispatchRole' :
        ['idle', 'returning'].includes(agent.state) ? 'idle' : 'working';
    }
    setSimStates(previous => Object.keys(previous).length === Object.keys(next).length &&
      Object.entries(next).every(([id, state]) => previous[Number(id)] === state) ? previous : next);
  }, [visual]);
  const member = members.find(item => item.id === memberId);
  const loadedTasks = Object.values(snapshot?.tasks ?? {}).flatMap(tasks => tasks ?? []);
  useEffect(() => {
    if (!(visual instanceof LiveOfficeAnimator)) return;
    if (snapshot) visual.sync(snapshot, visible);
    visual.setSimulating(simulation);
    if (simulation && !simulationClock.current.active) {
      simulationClock.current = { active: true, epoch: Date.now() - visual.time * 1000 };
    }
    if (!simulation) simulationClock.current.active = false;
    if (simulation) syncSimRoster();
  }, [visual, snapshot, visible, simulation, syncSimRoster]);
  useEffect(() => {
    if (visual instanceof LiveOfficeAnimator && activities) visual.syncActivities(activities);
  }, [visual, activities]);
  useEffect(() => {
    function onFullscreen() { setFull(document.fullscreenElement === root.current); }
    function exitExpanded(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented && !root.current?.querySelector('dialog[open]')) setExpanded(false);
    }
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('keydown', exitExpanded);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('keydown', exitExpanded);
    };
  }, []);
  useEffect(() => {
    if (isFullscreen && root.current) root.current.scrollTop = 0;
  }, [isFullscreen]);
  const busy = snapshot?.members ? simulation ? Object.values(simStates).filter(state => state !== 'idle').length :
    members.filter(item => ['working', 'preparing', 'waiting'].includes(item.state)).length : null;
  const rosterState = (person: OfficeMember) => simulation ? simStates[person.id] ?? 'offFloor' : person.state;
  const displayed = snapshot?.members ? visible.length : null;
  const simulated = simulation && visual instanceof LiveOfficeAnimator ? visual.simulationData : null;
  const displayCounts = simulated?.counts ?? snapshot?.counts;
  const displayActivities: OfficeActivity[] | undefined = simulated ? simulated.events.map(event => {
    const task = simulated.tasks.find(item => item.id === event.taskId);
    return { id: event.id, status: event.action === 'delivered' ? 'SUCCEEDED' : 'running',
      title: t(simulationJobs[task?.job ?? 0] ?? 'job0'), employee: event.employee,
      employeeId: event.employeeId, simulationAction: event.action,
      occurredAt: simulationClock.current.epoch + event.time * 1000 };
  }) : activities;
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      else if (expanded) setExpanded(false);
      else await root.current?.requestFullscreen();
    } catch {
      setExpanded(true);
    }
  }
  return (
    <div className={`awo${expanded ? ' awo--expanded' : ''}${wall && isFullscreen ? ' awo--wall' : ''}`} ref={root}>
      <div className="awo-grid">
        <section className="awo-stage" aria-label={t('space')}>
          <header className="awo-header">
            <div className="awo-title">
              <img src="/office/autowonder-icon.svg" alt="" />
              <h1>{t('brandedTitle')}</h1>
            </div>
            <div className="awo-header-tools">
              <span className={`awo-source${demo || simulation ? ' awo-source--demo' : ''}`}><i />
                {t(demo ? 'demo' : simulation ? 'simulationMode' : 'workspaceData')}
              </span>
              {onToggleSimulation && <button type="button" className="awo-simulate" disabled={!simulation && !snapshot?.members?.length} onClick={onToggleSimulation}>{t(simulation ? 'stopSimulation' : 'simulate')}</button>}
              {onRefresh && <button type="button" className="awo-icon" onClick={onRefresh} disabled={refreshing} aria-label={t('refresh')}>
                {refreshing ? <LoadingOutlined /> : <ReloadOutlined />}
              </button>}
              <button type="button" className="awo-icon" onClick={() => void toggleFullscreen()} aria-label={t(isFullscreen ? 'exitFullscreen' : 'fullscreen')}>
                {isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              </button>
            </div>
          </header>
          <OfficeScene visual={visual} onMember={setMemberId} onTick={simulation ? syncSimRoster : onTick} />
        </section>
        <aside className="awo-sidebar">
          {(failed || snapshot?.partialFailure) && <p className="awo-notice" role="status">
            {t(failed ? snapshot ? 'stale' : 'loadError' : 'partialError')}
          </p>}
          <section className="awo-panel" aria-labelledby="awo-tasks">
            <header className="awo-panel-title">
              <h2 id="awo-tasks"><FileTextOutlined aria-hidden="true" />{t('overview')}</h2>
              {snapshot?.updatedAt && <time dateTime={snapshot.updatedAt}>
                {t('updated', { time: formatDateTime(snapshot.updatedAt, shortTime) })}
              </time>}
            </header>
            <div className="awo-metrics">
              {BUCKETS.map(key => (
                <div className="awo-metric" data-bucket={key} key={key}>
                  <span>{bucketIcons[key]}{t(key)}</span>
                  <strong><RollingNumber value={count(displayCounts?.[key])} /></strong>
                </div>
              ))}
            </div>
            <OfficeMetricValues metrics={metrics} />
          </section>
          <section className="awo-panel" aria-labelledby="awo-people">
            <header className="awo-panel-title">
              <h2 id="awo-people"><TeamOutlined />{t('digital')}</h2>
              <span className="awo-online"><i />{t('onlineCount', { total: count(snapshot?.members?.length) })}</span>
            </header>
            <p className="awo-roster-summary">{t(simulation ? 'simulationSummary' : 'rosterSummary', { busy: count(busy), visible: count(displayed) })}</p>
            {squads.length > 0 && <div className="awo-team-filter">
              <label htmlFor="awo-squad">{t('squad')}</label>
              <select id="awo-squad" value={effectiveSquad ?? ''} onChange={event => {
                setSquad(event.target.value ? Number(event.target.value) : null); setScenePage(1); setMemberId(null);
              }}>
                <option value="">{t('allSquads')}</option>
                {squads.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>}
            <div className="awo-people-list">
              {!members.length && <p className="awo-empty">{t(snapshot?.members ? 'noMembers' : failed || snapshot ? 'unavailable' : 'loading')}</p>}
              {shownMembers.map(item => (
                <button className="awo-row" type="button" key={item.id} onClick={() => setMemberId(item.id)}>
                  <MemberAvatar member={item} />
                  <span className="awo-row-text"><strong>{item.chief ? t('chiefName') : item.name}</strong><small>{item.chief ? t('chiefName') : item.role || t('roleUnknown')}</small></span>
                  <span className="awo-member-state" data-state={rosterState(item)}>{t(rosterState(item))}</span>
                </button>
              ))}
            </div>
            {members.length > 3 && <button className="awo-roster-toggle" type="button" aria-expanded={peopleExpanded}
              onClick={() => setPeopleExpanded(value => !value)}>{t(peopleExpanded ? 'collapseMembers' : 'allMembers')}</button>}
            {pages > 1 && <Pager page={currentScenePage} pages={pages} onChange={setScenePage} label={t('scenePage')} />}
          </section>
          <OfficeActivityPanel key={simulation ? 'simulation' : 'live'} chief={members.find(item => item.chief)} entries={displayActivities} failed={!simulation && activityFailed} />
        </aside>
      </div>
      {member && <OfficeDialog title={member.chief ? t('chiefName') : member.name} onClose={() => setMemberId(null)}>
        <div className="awo-person-detail"><MemberAvatar member={member} /><div>{member.chief ? t('chiefName') : member.role || t('roleUnknown')}<p>{simulation ? t('actualState', { state: t(member.state) }) : t(member.state)}</p></div></div>
        <dl><dt>{t('runningTasks')}</dt><dd>{count(member.runningTasks)}</dd>
          {!demo && <><dt>{t('heartbeat')}</dt><dd>{member.heartbeat ? formatDateTime(member.heartbeat) : emptyValue}</dd></>}</dl>
        {member.workitemIds.length > 0 && <ul className="awo-person-tasks" aria-label={t('current')}>
          {member.workitemIds.map(id => {
            const title = loadedTasks.find(task => task.id === id)?.title ?? id;
            return <li key={id}>{demo ? title : <Link to={`/workitems/${encodeURIComponent(id)}`}>{title}</Link>}</li>;
          })}
        </ul>}
        {!demo && <Link className="awo-detail-link" to={`/agents/${member.id}`}>{t('memberDetails')} <ArrowRightOutlined /></Link>}
      </OfficeDialog>}
    </div>
  );
}

function MemberAvatar({ member }: { member: OfficeMember }) {
  return <span className="awo-avatar" style={{ color: GROUP_COLORS[member.group] }} aria-hidden="true"><i /></span>;
}

function Pager({ page, pages, onChange, label }: { page: number; pages: number; onChange: (page: number) => void; label?: string }) {
  const { t } = useTranslation('office');
  return (
    <div className="awo-pager">
      <span>{label}</span>
      <button type="button" className="awo-icon" onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label={t('previousPage')}><ArrowLeftOutlined /></button>
      <span>{t('page', { page, pages })}</span>
      <button type="button" className="awo-icon" onClick={() => onChange(page + 1)} disabled={page >= pages} aria-label={t('nextPage')}><ArrowRightOutlined /></button>
    </div>
  );
}

function OfficeDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation('office');
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} className="awo-dialog" aria-labelledby="awo-dialog-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section>
        <header><h2 id="awo-dialog-title">{title}</h2><button type="button" className="awo-icon" onClick={onClose} aria-label={t('close')}><CloseOutlined /></button></header>
        {children}
      </section>
    </dialog>
  );
}
