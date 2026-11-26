import { formatDuration } from '@/features/workitem/duration';
import { formatDateTime } from '@/shared/i18n/format';
import { Trans, useTranslation } from 'react-i18next';
import { PageBackButton } from '@/shared/ui/PageBackButton';
import { useRef } from 'react';
import { Button, Card, Alert, Popconfirm, Result, Space, Spin, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { useRealtime } from '@/shared/realtime/useRealtime';
import {
  addScheduledTaskRunComment, getScheduledTaskRun, getScheduledTaskRunArtifacts,
  getScheduledTaskRunComments, getDerivedWorkitems, transitionScheduledTaskRun,
} from './api';
import { useScheduledTaskRunParticipants, useScheduledTaskRunDeliveryProgress } from './hooks';
import { SquadMembers } from '@/features/workitem/components/SquadMembers';
import { DeliveryProgress } from '@/features/workitem/components/DeliveryProgress';
import { UnifiedTimeline } from '@/features/workitem/components/UnifiedTimeline';
import { ScrollToEdgeButton } from '@/features/workitem/components/ScrollToEdgeButton';
import { MarkdownView } from '@/shared/ui/MarkdownView';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { RunStatusTag } from './components/RunStatusTag';
import { RunCommentInput } from './components/RunCommentInput';
import { DerivedWorkitems } from './components/DerivedWorkitems';
import { reconcileScheduledRunEvent } from './realtime';
import type { ScheduledRunCommentBody } from './types';
import './ScheduledTaskRunDetailPage.css';
import type { TimelineItem } from '@/shared/types/workitem';

const { Text } = Typography;

export function ScheduledTaskRunDetailPage() {
  const { t } = useTranslation('scheduledTask');
  const sessions: Record<string, string> = { ISOLATED: t('session.isolated'), CONTINUOUS: t('session.continuous') };
  const triggers: Record<string, string> = { SCHEDULED: t('trigger.scheduled'), MANUAL: t('trigger.manual'), MISFIRE: t('trigger.misfire') };
  const { runId } = useParams<{ runId: string }>();
  const id = Number(runId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accessCommand = useAccessCommand();
  const leftScrollRef = useRef<HTMLDivElement>(null);

  const run = useQuery({ queryKey: ['scheduled-task-run', id], queryFn: () => getScheduledTaskRun(id), enabled: Number.isFinite(id) });
  const comments = useQuery({ queryKey: ['scheduled-task-run', id, 'comments'], queryFn: () => getScheduledTaskRunComments(id), enabled: Number.isFinite(id) });
  const artifacts = useQuery({ queryKey: ['scheduled-task-run', id, 'artifacts'], queryFn: () => getScheduledTaskRunArtifacts(id), enabled: Number.isFinite(id) });
  const derived = useQuery({ queryKey: ['scheduled-task-run', id, 'derived-workitems'], queryFn: () => getDerivedWorkitems(id), enabled: Number.isFinite(id) });
  const { data: participants = [], isLoading: participantsLoading } = useScheduledTaskRunParticipants(Number.isFinite(id) ? id : undefined);
  const { data: progress, isLoading: progressLoading } = useScheduledTaskRunDeliveryProgress(Number.isFinite(id) ? id : undefined);

  const comment = useMutation({ mutationFn: (body: ScheduledRunCommentBody) => addScheduledTaskRunComment(id, body), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-task-run', id, 'comments'] }) });
  const transition = useMutation({ mutationFn: ({ action, force }: { action: 'pause' | 'resume' | 'cancel'; force?: boolean }) => transitionScheduledTaskRun(id, action, run.data!.version, force), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-task-run', id] }) });

  useRealtime(Number.isFinite(id) ? `scheduled-run:${id}` : null, {
    onEvent: (event) => reconcileScheduledRunEvent(queryClient, id, event),
    onReconnect: () => reconcileScheduledRunEvent(queryClient, id, { channel: '', type: 'unknown', payload: null, timestamp: Date.now() }),
  });

  if (!Number.isFinite(id)) return <Result status="404" title={t('run.invalidId')} />;
  if (run.isLoading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (run.isError || !run.data) return <Result status="error" title={t('run.loadFailed')} extra={<Button onClick={() => navigate(-1)}>{t('actions.back')}</Button>} />;

  const data = run.data;
  const sessionMode = data.sessionMode ?? '-';
  const active = ['QUEUED', 'STARTING', 'WAITING_EXECUTOR', 'WAITING_HUMAN', 'RUNNING', 'PAUSED'].includes(data.status);
  const resultContent = data.resultSummary || data.error || data.skipReason || '';
  const isErrorResult = !data.resultSummary && !!data.error;
  const isSkipResult = !data.resultSummary && !data.error && !!data.skipReason;
  const realtimeChannel = `scheduled-run:${data.id}`;
  const paused = data.status === 'PAUSED';
  // 未结束时用省略号表示仍在计时。
  const durationValue = data.startedAt
    ? data.finishedAt
      ? formatDuration(new Date(data.finishedAt).getTime() - new Date(data.startedAt).getTime())
      : `${formatDuration(Date.now() - new Date(data.startedAt).getTime())}…`
    : null;

  const timelineItems: TimelineItem[] = (comments.data ?? []).map((c) => ({
    id: c.id,
    type: 'comment' as const,
    authorId: c.authorRef,
    authorName: participants.find((p) => p.userId === c.authorRef)?.name || `#${c.authorRef}`,
    authorType: c.authorType,
    isAgent: c.authorType === 'AGENT',
    content: c.contentMd,
    gmtCreate: c.gmtCreate,
  }));

  return (
    <div className="aw-detail-page" style={{ height: '100%' }}>
      {/* 原型 12：与工单详情同构的画布分块（头部白卡 / 汇总·结果·时间线 / 右 360 静态列） */}
      <section className="aw-detail-main aw-run-main">
        <div
          data-testid="scheduled-run-scroll-region"
          style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'visible', display: 'flex' }}
        >
          <div ref={leftScrollRef} data-testid="scheduled-run-left-scroll" className="aw-detail-canvas" style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
          <section className="aw-detail-head-card aw-run-head">
          <div className="aw-detail-title" style={{ gap: 10 }}>
            <PageBackButton to={`/scheduled-tasks/${data.scheduledTaskId}`} label={t('actions.backToTasks')} />
            {/* 原型 12 run-head 标题 16px/600；level=5 保住 heading role 供测试定位 */}
            <Typography.Title level={5} ellipsis style={{ margin: 0, fontSize: 16, lineHeight: '24px', minWidth: 0, maxWidth: '100%' }}>{data.snapshot?.task?.name || t('labels.runId', { id: data.id })}</Typography.Title>
            <span style={{ fontFamily: 'var(--aw-font-mono)', fontSize: 12, color: 'var(--aw-text-3)' }}>{t('run.rid', { id: data.id })}</span>
            <RunStatusTag status={data.status} />
          </div>
          <div className="aw-run-meta">
            <span>
              <Trans t={t} i18nKey="run.triggerSchedule" values={{ time: formatTime(data.scheduledAt) }}
                components={{ value: <b>{Object.prototype.hasOwnProperty.call(triggers, data.triggerType) ? triggers[data.triggerType] : data.triggerType}</b> }} />
            </span>
            {data.startedAt ? (
              <span>
                <Trans t={t} i18nKey="run.duration" components={{ value: <b>{durationValue}</b> }} />
              </span>
            ) : null}
            <span>
              <Trans t={t} i18nKey="run.realtimeChannel" components={{ value: <b className="aw-meta-mono">{realtimeChannel}</b> }} />
            </span>
          </div>
          </section>

          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            {/* split · col-main */}
            <div style={{ flex: 1, minWidth: 0 }}>
          <Card size="small" title={t('run.summary')} style={{ marginBottom: 12 }} extra={
            <Space>
              {active && !paused ? <Button size="small" icon={<AwStrokeIcon name="pause" size={14} />} onClick={() => accessCommand('READ_WRITE', t('actions.pause'), () => transition.mutate({ action: 'pause' }))}>{t('actions.pause')}</Button> : null}
              {paused ? <Button size="small" icon={<AwStrokeIcon name="play" size={14} />} onClick={() => accessCommand('READ_WRITE', t('actions.resume'), () => transition.mutate({ action: 'resume' }))}>{t('actions.resume')}</Button> : null}
              {active && !paused ? <Button size="small" danger onClick={() => accessCommand('READ_WRITE', t('actions.cancel'), () => transition.mutate({ action: 'cancel' }))}>{t('actions.cancel')}</Button> : null}
              {active ? (
                <Popconfirm
                  title={t('confirm.forceCancel')}
                  description={t('confirm.forceCancelDescription')}
                  okText={t('actions.confirmForceCancel')}
                  okButtonProps={{ danger: true }}
                  cancelText={t('actions.reconsider')}
                  onConfirm={() => accessCommand('READ_WRITE', t('actions.forceCancel'), () => transition.mutate({ action: 'cancel', force: true }))}
                >
                  <Button size="small" danger>{t('actions.forceCancel')}</Button>
                </Popconfirm>
              ) : null}
            </Space>
          }>
            {/* 原型 12 desc-grid：标签上、值下，两列栅格 */}
            <div className="aw-desc-grid">
              <div className="aw-desc-item"><div className="aw-dk">{t('run.startedAt')}</div><div className="aw-dv">{formatTime(data.startedAt)}</div></div>
              <div className="aw-desc-item"><div className="aw-dk">{t('run.finishedAt')}</div><div className="aw-dv">{formatTime(data.finishedAt)}</div></div>
              <div className="aw-desc-item"><div className="aw-dk">{t('run.executor')}</div><div className="aw-dv aw-desc-mono">{data.executorId ? `#${data.executorId}` : '-'}</div></div>
              <div className="aw-desc-item"><div className="aw-dk">{t('form.sessionMode')}</div><div className="aw-dv">{Object.prototype.hasOwnProperty.call(sessions, sessionMode) ? sessions[sessionMode] : sessionMode}</div></div>
              <div className="aw-desc-item"><div className="aw-dk">{t('run.resumedFrom')}</div><div className="aw-dv aw-desc-mono">{data.resumeFromRunId ? t('labels.runId', { id: data.resumeFromRunId }) : '-'}</div></div>
            </div>
            {data.degradedResume ? <Alert type="warning" showIcon style={{ marginTop: 12 }} message={t('run.degradedResume', { run: data.resumeFromRunId ? t('labels.runId', { id: data.resumeFromRunId }) : '', reason: data.degradedReason ?? '' })} /> : null}
          </Card>

          <Card size="small" title={t('run.result')} style={{ marginBottom: 12 }}>
            {resultContent
              ? isErrorResult
                ? <div style={{ border: '1px solid var(--aw-error)', background: 'var(--aw-error-bg)', color: 'var(--aw-error-deep)', borderRadius: 6, padding: 10 }}><MarkdownView content={resultContent} /></div>
                : isSkipResult
                  ? <div style={{ color: 'var(--aw-text-3)' }}><MarkdownView content={resultContent} /></div>
                  : <MarkdownView content={resultContent} />
              : <Text type="secondary">-</Text>}
          </Card>

            <UnifiedTimeline
              items={timelineItems}
              participants={participants}
              artifacts={artifacts.data ?? []}
              loading={comments.isLoading}
              scrollContainerRef={leftScrollRef}
              composer={(
                <div data-testid="scheduled-run-sticky-comment">
                  <RunCommentInput
                    runId={Number.isFinite(id) ? id : undefined}
                    loading={comment.isPending}
                    onSubmit={(payload) => accessCommand('READ_WRITE', t('comment.label'), () => comment.mutate(payload))}
                  />
                </div>
              )}
            />
            </div>
            {/* split · col-side：原型 12 右列 360 静态面板（随主栏一起滚动） */}
            <div style={{ width: 360, flexShrink: 0 }}>
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                {participantsLoading || participants.length > 0 ? (
                  <Card size="small" title={t('run.members')}>
                    <SquadMembers participants={participants} loading={participantsLoading} />
                  </Card>
                ) : null}
                <DeliveryProgress
                  steps={progress?.steps || []}
                  progress={progress}
                  terminalStatus={data.status}
                  artifacts={artifacts.data ?? []}
                  artifactsLoading={artifacts.isLoading}
                  loading={progressLoading}
                />
                <DerivedWorkitems workitems={derived.data ?? []} />
              </Space>
            </div>
          </div>
          </div>
          <ScrollToEdgeButton containerRef={leftScrollRef} />
        </div>
      </section>
    </div>
  );
}

function formatTime(value?: string | null) {
  return value ? formatDateTime(value, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }) : '-';
}
