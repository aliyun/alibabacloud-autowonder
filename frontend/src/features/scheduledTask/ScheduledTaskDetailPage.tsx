import { formatDateTime, formatNumber } from '@/shared/i18n/format';
import { Trans, useTranslation } from 'react-i18next';
import { PageBackButton } from '@/shared/ui/PageBackButton';
import { StatusTag, type StatusColorKey } from '@/shared/ui/StatusTag';
import { AiIdentity } from '@/shared/ui/AiIdentity';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { Button, Dropdown, Modal, Popconfirm, Spin, Typography } from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { getScheduledTask, getScheduledTaskDocuments, getScheduledTaskHealth, listScheduledTaskRuns, previewScheduledTask, transitionScheduledTask } from './api';
import { useDeleteScheduledTask, useDeleteScheduledTaskDocument, useRunScheduledTaskNow } from './hooks';
import type { ScheduledTaskRun, ScheduledTaskStatus } from './types';
import { listSquads } from '@/features/squad/api';
import { listAgents } from '@/features/agent/api';
import { formatDuration } from '@/features/workitem/duration';
import { MarkdownView } from '@/shared/ui/MarkdownView';
import { OffsetPagination } from '@/shared/ui/OffsetPagination';
import { TaskDocuments } from './components/TaskDocuments';
import { RunStatusTag } from './components/RunStatusTag';
import { relativeTime } from './relativeTime';
import './components/scheduleFires.css';
import './ScheduledTaskDetailPage.css';

const FOLD_HEIGHT = 132;
const EMPTY = '-';
const NONE = '—';
const PERCENT = '%';
const WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'short' };
const ACTIVE_RUN = new Set(['QUEUED', 'STARTING', 'WAITING_EXECUTOR', 'WAITING_HUMAN', 'RUNNING', 'PAUSED']);
const FAILED_RUN = new Set(['FAILED', 'TIMED_OUT']);
const STATUS_COLOR: Record<ScheduledTaskStatus, StatusColorKey> = { ACTIVE: 'green', PAUSED: 'gray', EXHAUSTED: 'amber', ARCHIVED: 'gray' };

function requestId() { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `scheduled-task-${Date.now()}`; }
function pick(map: Record<string, string>, code: string | null | undefined) { return code && Object.prototype.hasOwnProperty.call(map, code) ? map[code] : code ?? '-'; }

export function ScheduledTaskDetailPage() {
  const { t } = useTranslation('scheduledTask');
  const misfires: Record<string, string> = { SKIP_ALL: t('misfire.skipAll'), FIRE_LATEST: t('misfire.fireLatest'), FIRE_ALL: t('misfire.fireAll') };
  const overlaps: Record<string, string> = { SKIP: t('overlap.skip'), QUEUE: t('overlap.queue'), ALLOW: t('overlap.allow') };
  const sessions: Record<string, string> = { ISOLATED: t('session.isolated'), CONTINUOUS: t('session.continuous') };
  const triggers: Record<string, string> = { SCHEDULED: t('trigger.scheduled'), MANUAL: t('trigger.manual'), MISFIRE: t('trigger.misfire') };
  const statuses: Record<string, string> = { ACTIVE: t('taskStatus.active'), PAUSED: t('taskStatus.paused'), EXHAUSTED: t('taskStatus.exhausted'), ARCHIVED: t('taskStatus.archived') };
  const skipReasons: Record<string, string> = { OVERLAP: t('skipReason.overlap'), MISFIRE_POLICY: t('skipReason.misfirePolicy'), START_DEADLINE: t('skipReason.startDeadline'), OWNER_INACTIVE: t('skipReason.ownerInactive'), SOURCE_EXECUTOR_TIMEOUT: t('skipReason.sourceExecutorTimeout') };
  const policyNotes: Record<string, string> = { ISOLATED: t('policyNote.isolated'), CONTINUOUS: t('policyNote.continuous'), SKIP: t('policyNote.skip'), QUEUE: t('policyNote.queue'), ALLOW: t('policyNote.allow'), SKIP_ALL: t('policyNote.skipAll'), FIRE_LATEST: t('policyNote.fireLatest'), FIRE_ALL: t('policyNote.fireAll') };
  const { id: raw } = useParams<{ id: string }>(); const id = Number(raw); const navigate = useNavigate(); const accessCommand = useAccessCommand(); const [confirmRun, setConfirmRun] = useState(false); const [offset, setOffset] = useState(0); const [runPageSize, setRunPageSize] = useState(10);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [foldable, setFoldable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const historyHeight = useRef(0);
  const mdRef = useRef<HTMLDivElement>(null);
  const task = useQuery({ queryKey: ['scheduled-tasks', id], queryFn: () => getScheduledTask(id), enabled: Number.isFinite(id) });
  const runs = useQuery({ queryKey: ['scheduled-task-runs', id, offset, runPageSize], queryFn: () => listScheduledTaskRuns(id, runPageSize, offset), enabled: Number.isFinite(id), placeholderData: keepPreviousData }); const healthRuns = useQuery({ queryKey: ['scheduled-task-runs', id, 'health'], queryFn: () => getScheduledTaskHealth(id), enabled: Number.isFinite(id) }); const runNow = useRunScheduledTaskNow();
  const latestRuns = useQuery({ queryKey: ['scheduled-task-runs', id, 0, 10], queryFn: () => listScheduledTaskRuns(id, 10, 0), enabled: Number.isFinite(id) });
  const removeTask = useDeleteScheduledTask();
  const removeDocument = useDeleteScheduledTaskDocument();
  const documents = useQuery({ queryKey: ['scheduled-tasks', id, 'documents'], queryFn: () => getScheduledTaskDocuments(id), enabled: Number.isFinite(id) });
  const squads = useQuery({ queryKey: ['squads', 'scheduled-task-detail'], queryFn: () => listSquads({ pageNum: 1, pageSize: 100 }), enabled: Number.isFinite(id) });
  const agents = useQuery({ queryKey: ['agents', 'scheduled-task-detail'], queryFn: () => listAgents({ page: 1, size: 100 }), enabled: Number.isFinite(id) });
  const cron = task.data?.scheduleType === 'CRON' ? task.data.cronExpression : null;
  const timezone = task.data?.timezone ?? '';
  const previewable = !!cron && !!timezone && task.data?.status !== 'EXHAUSTED' && task.data?.status !== 'ARCHIVED';
  const preview = useQuery({ queryKey: ['scheduled-tasks', id, 'preview', cron, timezone], queryFn: () => previewScheduledTask(cron!, timezone), enabled: previewable });
  const taskTransition = useMutation({ mutationFn: (action: 'pause' | 'enable') => transitionScheduledTask(id, action, task.data!.version), onSuccess: () => task.refetch() });
  useLayoutEffect(() => {
    if (!historyRef.current) return;
    historyHeight.current = Math.max(historyHeight.current, historyRef.current.offsetHeight);
    historyRef.current.style.minHeight = `${historyHeight.current}px`;
  }, [runs.data]);
  const instruction = task.data?.instructionMd;
  useLayoutEffect(() => {
    if (mdRef.current) setFoldable(mdRef.current.scrollHeight > FOLD_HEIGHT);
  }, [instruction]);
  if (!Number.isFinite(id)) return <Typography.Text>{t('detail.invalidId')}</Typography.Text>;
  if (task.isLoading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
  if (!task.data) return <Typography.Text>{t('detail.loadFailed')}</Typography.Text>;
  const data = task.data;
  const squadName = squads.data?.list.find((squad) => squad.id === data.squadId)?.name;
  const agentName = agents.data?.find((agent) => agent.id === data.initialAgentId)?.name;
  const strong = <span className="aw-sched-strong" />;
  const kw = <span className="aw-sched-kw" />;
  const runLink = (run: ScheduledTaskRun) => `/scheduled-task-runs/${run.id}`;
  const runDuration = (run: ScheduledTaskRun) => {
    if (!run.startedAt) return null;
    const started = new Date(run.startedAt).getTime();
    if (run.finishedAt) return formatDuration(new Date(run.finishedAt).getTime() - started) || null;
    return ACTIVE_RUN.has(run.status) ? `${formatDuration(Date.now() - started)}…` : null;
  };
  const runResult = (run: ScheduledTaskRun) => {
    const error = run.error || run.failureReason;
    if (error) return <span className="aw-sched-reason is-err" title={error}>{error}</span>;
    if (run.skipReason) return <span className="aw-sched-reason aw-sched-dim">{pick(skipReasons, run.skipReason)}</span>;
    const summary = run.resultSummary?.split('\n').find((line) => line.trim())?.trim();
    return summary ? <span className="aw-sched-reason" title={summary}>{summary}</span> : '-';
  };
  const columns = [
    { title: t('columns.run'), render: (_: unknown, run: ScheduledTaskRun) => <Link className="aw-sched-run" to={runLink(run)} onClick={(event) => event.stopPropagation()}>{t('labels.runId', { id: run.id })}</Link> },
    { title: t('columns.status'), dataIndex: 'status', render: (status: string) => <RunStatusTag status={status} /> },
    { title: t('columns.trigger'), dataIndex: 'triggerType', render: (code: string) => pick(triggers, code) },
    { title: t('columns.scheduledAt'), dataIndex: 'scheduledAt', render: (value: string | null) => <span className="aw-sched-tnum">{formatTime(value)}</span> },
    { title: t('columns.startedAt'), dataIndex: 'startedAt', render: (value: string | null) => <span className="aw-sched-tnum">{formatTime(value)}</span> },
    { title: t('columns.duration'), render: (_: unknown, run: ScheduledTaskRun) => <span className="aw-sched-tnum">{runDuration(run) ?? EMPTY}</span> },
    { title: t('columns.result'), render: (_: unknown, run: ScheduledTaskRun) => runResult(run) },
  ];
  const completed = healthRuns.data?.completed30d ?? 0;
  const rate = completed ? Math.round((healthRuns.data!.success30d * 100) / completed) : null;
  const rateTone = rate == null ? 'is-none' : rate === 100 ? 'is-ok' : rate >= 50 ? 'is-warn' : 'is-bad';
  const latest = latestRuns.data?.[0];
  const latestDuration = latest ? runDuration(latest) : null;
  const streakRuns: ScheduledTaskRun[] = [];
  for (const run of latestRuns.data ?? []) { if (!FAILED_RUN.has(run.status)) break; streakRuns.push(run); }
  const streakReason = streakRuns[0] ? streakRuns[0].error || streakRuns[0].failureReason : null;
  const isOnce = data.scheduleType === 'ONCE';
  const isolated = data.sessionMode === 'ISOLATED';
  const kv = (label: ReactNode, value: ReactNode, note?: ReactNode, dim?: boolean) => <div className="aw-sched-kv"><span className="k">{label}</span><span className={dim ? 'v is-dim' : 'v'}>{value}{note ? <span className="aw-sched-note">{note}</span> : null}</span></div>;
  return <section className="aw-sched-detail" data-region="task-detail">
    <div className="aw-sched-head">
      <PageBackButton to="/scheduled-tasks" label={t('actions.backToTasks')} />
      <h1 className="aw-sched-name">{data.name}</h1>
      <StatusTag dot label={pick(statuses, data.status)} colorKey={Object.prototype.hasOwnProperty.call(STATUS_COLOR, data.status) ? STATUS_COLOR[data.status] : 'gray'} />
      <span className="aw-sched-tid">{t('detail.taskId', { id: data.id })}</span>
      <span className="aw-sched-ops">
        <Button icon={<AwStrokeIcon name="edit" />} onClick={() => navigate(`/scheduled-tasks/${id}/edit`)}>{t('actions.edit')}</Button>
        {data.status === 'ACTIVE'
          ? <Button icon={<AwStrokeIcon name="pause" />} onClick={() => accessCommand('READ_WRITE', t('actions.pauseFuture'), () => taskTransition.mutate('pause'))}>{t('actions.pauseFuture')}</Button>
          : <Button icon={<AwStrokeIcon name="play" />} onClick={() => accessCommand('READ_WRITE', t('commands.enableFuture'), () => taskTransition.mutate('enable'))}>{t('actions.enable')}</Button>}
        <Button type="primary" icon={<AwStrokeIcon name="play" />} disabled={data.status !== 'ACTIVE'} onClick={() => accessCommand('READ_WRITE', t('commands.runNow'), () => setConfirmRun(true))}>{t('actions.runNow')}</Button>
        <Popconfirm open={deleteOpen} onOpenChange={(open) => { if (!open) setDeleteOpen(false); }} title={t('confirm.deleteTask')} okText={t('actions.confirmDelete')} okButtonProps={{ danger: true }} cancelText={t('actions.cancel')} onCancel={() => setDeleteOpen(false)} onConfirm={() => { setDeleteOpen(false); accessCommand('READ_WRITE', t('commands.deleteTask'), () => removeTask.mutate({ id, version: data.version }, { onSuccess: () => navigate('/scheduled-tasks') })); }}>
          <span>
            <Dropdown trigger={['click']} menu={{ items: [{ key: 'delete', danger: true, icon: <AwStrokeIcon name="trash" />, label: t('actions.deleteTask'), onClick: () => setDeleteOpen(true) }] }}>
              <Button className="aw-sched-more" aria-label={t('actions.more')} aria-haspopup="menu" icon={<AwStrokeIcon name="more" />} loading={removeTask.isPending} />
            </Dropdown>
          </span>
        </Popconfirm>
      </span>
    </div>
    <div className="aw-sched-meta">
      <span>{isOnce
        ? <Trans t={t} ns="scheduledTask" i18nKey="detail.metaOnce" values={{ time: formatTime(data.runAt), tz: data.timezone }} components={{ v: strong }} />
        : <Trans t={t} ns="scheduledTask" i18nKey="detail.metaCron" values={{ cron: data.cronExpression || '-', tz: data.timezone }} components={{ kw }} />}</span>
      <span>{data.nextFireAt
        ? <Trans t={t} ns="scheduledTask" i18nKey="detail.metaNext" values={{ time: formatTime(data.nextFireAt), rel: relativeTime(data.nextFireAt) }} components={{ v: strong }} />
        : t('detail.metaNextNone')}</span>
      {data.lastFireAt ? <span><Trans t={t} ns="scheduledTask" i18nKey="detail.metaLast" values={{ time: formatTime(data.lastFireAt) }} components={{ v: strong }} /></span> : null}
      {data.gmtModified ? <span>{t('detail.metaUpdated', { time: formatDateTime(data.gmtModified, SHORT) })}</span> : null}
    </div>

    <div className="aw-card aw-sched-health" data-region="health">
      <div className="aw-stat-card">
        <span className="aw-stat-label">{t('detail.successRate')}</span>
        {rate == null ? <span className="aw-stat-value is-none">{NONE}</span> : <span className={`aw-stat-value ${rateTone}`}>{formatNumber(rate)}<span className="aw-stat-unit">{PERCENT}</span></span>}
        <span className="aw-stat-foot">{rate == null ? t('detail.noCompletedRuns') : <span><Trans t={t} ns="scheduledTask" i18nKey="detail.healthFoot" values={{ success: formatNumber(healthRuns.data!.success30d), completed: formatNumber(completed) }} components={{ n: strong }} /></span>}</span>
      </div>
      <div className="aw-stat-card">
        <span className="aw-stat-label">{t('detail.latestRun')}</span>
        {latest ? <span className="aw-stat-value is-sm"><RunStatusTag status={latest.status} /><Link to={runLink(latest)}>{t('labels.runId', { id: latest.id })}</Link></span> : <span className="aw-stat-value is-none">{NONE}</span>}
        <span className="aw-stat-foot">{latest
          ? <span>{latestDuration
            ? <Trans t={t} ns="scheduledTask" i18nKey="detail.latestRunFoot" values={{ time: formatTime(latest.startedAt ?? latest.scheduledAt, SHORT), duration: latestDuration }} components={{ n: strong }} />
            : formatTime(latest.startedAt ?? latest.scheduledAt, SHORT)}</span>
          : t('detail.noRuns')}</span>
      </div>
      <div className="aw-stat-card">
        <span className="aw-stat-label">{t('columns.nextExecution')}</span>
        {data.nextFireAt
          ? <span className="aw-stat-value is-sm">{formatDateTime(data.nextFireAt, MONTH_DAY_TIME)}<StatusTag size="sm" colorKey="gray" label={relativeTime(data.nextFireAt)} /></span>
          : <span className="aw-stat-value is-none">{NONE}</span>}
        <span className="aw-stat-foot">{data.nextFireAt ? t('detail.nextFoot', { weekday: formatDateTime(data.nextFireAt, WEEKDAY), tz: data.timezone }) : data.timezone}</span>
      </div>
    </div>

    {streakRuns.length >= 2 ? <div className="aw-sched-alert" role="status" data-region="failure-streak">
      <AwStrokeIcon name="alert-t" />
      <span>{streakReason
        ? <Trans t={t} ns="scheduledTask" i18nKey="detail.streak" values={{ n: streakRuns.length, reason: streakReason, id: streakRuns[0].id }} components={{ kw, link: <Link to={runLink(streakRuns[0])} /> }} />
        : <Trans t={t} ns="scheduledTask" i18nKey="detail.streakNoReason" values={{ n: streakRuns.length, id: streakRuns[0].id }} components={{ link: <Link to={runLink(streakRuns[0])} /> }} />}</span>
    </div> : null}

    <div className="aw-sched-split">
      <div className="aw-sched-main">
        <div className="aw-card aw-sched-panel aw-sched-history" data-region="history">
          <div className="aw-card-head"><span className="aw-card-title">{t('detail.history')}</span><span className="aw-sched-sub">{t('detail.historySub')}</span></div>
          <div className="aw-card-body aw-card-body-flush">
            <div ref={historyRef}>
              <Table rowKey="id" dataSource={runs.data ?? []} loading={runs.isLoading} columns={columns} pagination={false} locale={{ emptyText: t('detail.historyEmpty') }} onRow={(run: ScheduledTaskRun) => ({ onClick: () => navigate(runLink(run)) })} />
              <OffsetPagination storageKey="autowonder.scheduledTaskRuns.pageSize" offset={offset} loadedCount={(runs.data ?? []).length} onOffsetChange={setOffset} onPageSizeChange={setRunPageSize} />
            </div>
          </div>
        </div>
        <div className="aw-card aw-sched-panel" data-region="instruction">
          <div className="aw-card-head"><span className="aw-card-title">{t('detail.instruction')}</span></div>
          <div className="aw-card-body">
            <div ref={mdRef} id="aw-sched-instruction" className={foldable && !expanded ? 'aw-sched-md is-folded' : 'aw-sched-md'}><MarkdownView content={data.instructionMd} /></div>
            {foldable ? <Button type="link" className="aw-sched-fold-toggle" aria-expanded={expanded} aria-controls="aw-sched-instruction" onClick={() => setExpanded((value) => !value)}>{expanded ? t('actions.collapse') : t('actions.expandAll')}</Button> : null}
          </div>
        </div>
        <TaskDocuments documents={documents.data ?? []} onDelete={(artifact) => accessCommand('READ_WRITE', t('commands.deleteDocument'), () => removeDocument.mutate({ id, artifactId: artifact.id }))} />
      </div>
      <div className="aw-sched-side">
        <div className="aw-card aw-sched-panel" data-region="schedule">
          <div className="aw-card-head"><span className="aw-card-title">{t('detail.schedule')}</span></div>
          <div className="aw-card-body">
            {kv(t('schedule.type'), isOnce ? t('schedule.once') : t('schedule.recurring'))}
            {isOnce ? <>
              {kv(t('schedule.runTime'), formatTime(data.runAt))}
              {kv(t('form.timezone'), data.timezone)}
              {kv(t('columns.nextExecution'), formatTime(data.nextFireAt))}
            </> : <>
              {kv(t('form.cron'), <span className="aw-sched-kw">{data.cronExpression || EMPTY}</span>)}
              {kv(t('form.timezone'), data.timezone)}
              {previewable ? <>
                <div className="aw-sched-sep" />
                <div className="aw-sched-cap">{t('detail.upcoming')}</div>
                {preview.isLoading ? <div className="aw-sched-cap">{t('schedule.previewLoading')}</div> : <ul className="aw-sched-fires" aria-label={t('schedule.previewAria')}>
                  {(preview.data ?? []).map((instant, index) => <li key={instant} className={index === 0 ? 'is-next' : undefined}><span className="fd" />{formatDateTime(instant, SHORT)}{index === 0 ? <span className="rel">{t('detail.nextBadge')}</span> : null}</li>)}
                </ul>}
              </> : null}
            </>}
          </div>
        </div>
        <div className="aw-card aw-sched-panel" data-region="execution">
          <div className="aw-card-head"><span className="aw-card-title">{t('detail.execution')}</span></div>
          <div className="aw-card-body">
            {kv(t('form.squad'), squadName ?? t('labels.squadId', { id: data.squadId }))}
            {kv(t('detail.initialAgent'), <AiIdentity name={agentName} avatar icon size="sm" fallback={t('labels.agentId', { id: data.initialAgentId })} />)}
            <div className="aw-sched-sep" />
            {kv(t('form.sessionMode'), pick(sessions, data.sessionMode), policyNotes[data.sessionMode])}
            {kv(t('form.overlapExecution'), pick(overlaps, data.overlapPolicy), policyNotes[data.overlapPolicy])}
            {kv(t('form.missedTrigger'), pick(misfires, data.misfirePolicy), policyNotes[data.misfirePolicy])}
            {kv(t('detail.startDeadline'), data.startDeadlineSeconds ? formatDuration(data.startDeadlineSeconds * 1000) : EMPTY, data.startDeadlineSeconds ? t('detail.deadlineNote', { seconds: formatNumber(data.startDeadlineSeconds) }) : undefined)}
            {kv(t('detail.affinityTimeout'), data.affinityTimeoutSeconds ? formatDuration(data.affinityTimeoutSeconds * 1000) : EMPTY, data.affinityTimeoutSeconds ? t('detail.affinityNote') : undefined, isolated)}
          </div>
        </div>
      </div>
    </div>
    <Modal title={t('actions.runNow')} open={confirmRun} okText={t('actions.createRun')} cancelText={t('actions.cancel')} onCancel={() => setConfirmRun(false)} onOk={() => accessCommand('READ_WRITE', t('commands.runNow'), () => runNow.mutate({ id, version: data.version, requestId: requestId() }, { onSuccess: (run) => { setConfirmRun(false); navigate(`/scheduled-task-runs/${run.id}`); } }))}>{t('confirm.createRun')}</Modal>
  </section>;
}

const SHORT: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
const MONTH_DAY_TIME: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
function formatTime(value?: string | null, options?: Intl.DateTimeFormatOptions) { return value ? formatDateTime(value, options ?? { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }) : '-'; }
