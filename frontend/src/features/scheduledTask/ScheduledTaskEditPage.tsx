import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { useTranslation } from 'react-i18next';
import { PageBackButton } from '@/shared/ui/PageBackButton';
import { AiIdentity } from '@/shared/ui/AiIdentity';
import { Button, Form, Input, Select, Spin } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { listSquads } from '@/features/squad/api';
import { listAgents } from '@/features/agent/api';
import { getScheduledTask, updateScheduledTask } from './api';
import type { UpdateScheduledTaskBody } from './types';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import './ScheduledTaskForm.css';

export function ScheduledTaskEditPage() {
  const { t } = useTranslation('scheduledTask');
  const id = Number(useParams<{ id: string }>().id); const navigate = useNavigate(); const access = useAccessCommand(); const [form] = Form.useForm<UpdateScheduledTaskBody>();
  const task = useQuery({ queryKey: ['scheduled-tasks', id], queryFn: () => getScheduledTask(id), enabled: Number.isFinite(id) });
  const squads = useQuery({ queryKey: ['squads', 'scheduled-task-detail'], queryFn: () => listSquads({ pageNum: 1, pageSize: 100 }), enabled: Number.isFinite(id) });
  const agents = useQuery({ queryKey: ['agents', 'scheduled-task-detail'], queryFn: () => listAgents({ page: 1, size: 100 }), enabled: Number.isFinite(id) });
  useLocalizedValidation(form, !task.isLoading && Boolean(task.data));
  const save = useMutation({ mutationFn: (body: UpdateScheduledTaskBody) => updateScheduledTask(id, body), onSuccess: () => navigate(`/scheduled-tasks/${id}`) });
  if (task.isLoading) return <Spin style={{ display: 'block', margin: 80 }} />; if (!task.data) return null;
  const data = task.data;
  const squadName = squads.data?.list.find((squad) => squad.id === data.squadId)?.name;
  const agentName = agents.data?.find((agent) => agent.id === data.initialAgentId)?.name;
  const isCron = data.scheduleType === 'CRON';
  const scheduleTypeLabel = isCron ? t('schedule.recurring') : t('schedule.once');
  return <>
    <div className="aw-form-head">
      <PageBackButton to={`/scheduled-tasks/${id}`} label={t('actions.backToDetail')} />
      <span className="aw-form-title">{t('edit.title')}</span>
    </div>
    <Form form={form} className="aw-sched-form" layout="vertical" initialValues={data} onFinish={(value) => access('READ_WRITE', t('edit.title'), () => { const current = task.data!; save.mutate({ name: value.name ?? current.name, instructionMd: value.instructionMd ?? current.instructionMd, squadId: current.squadId, initialAgentId: current.initialAgentId, scheduleType: current.scheduleType, runAt: current.runAt ?? undefined, cronExpression: value.cronExpression ?? current.cronExpression ?? undefined, timezone: current.timezone, sessionMode: value.sessionMode ?? current.sessionMode, overlapPolicy: value.overlapPolicy ?? current.overlapPolicy, misfirePolicy: value.misfirePolicy ?? current.misfirePolicy, startDeadlineSeconds: current.startDeadlineSeconds ?? undefined, affinityTimeoutSeconds: current.affinityTimeoutSeconds ?? undefined, version: current.version }); })}>
      <div className="aw-sched-sec">
        <div className="aw-sched-sec-title">{t('create.sections.content')}</div>
        <Form.Item name="name" label={t('form.name')} rules={[{ required: true, message: t('validation.nameRequired') }]}><Input maxLength={200} showCount /></Form.Item>
        <Form.Item name="instructionMd" label={t('form.instruction')} rules={[{ required: true, message: t('validation.instructionRequired') }]}><Input.TextArea rows={8} /></Form.Item>
      </div>
      <div className="aw-sched-sec">
        <div className="aw-sched-sec-title">{t('create.sections.executor')}</div>
        <div className="aw-sched-ro"><span className="k">{t('form.squad')}</span><span>{squadName ?? t('labels.squadId', { id: data.squadId })}</span></div>
        <div className="aw-sched-ro"><span className="k">{t('form.initialAgent')}</span><AiIdentity name={agentName} avatar icon size="sm" fallback={t('labels.agentId', { id: data.initialAgentId })} /></div>
      </div>
      <div className="aw-sched-sec">
        <div className="aw-sched-sec-title">{t('create.sections.schedule')}</div>
        <div className="aw-sched-ro"><span className="k">{t('schedule.type')}</span><span>{t('edit.scheduleValue', { type: scheduleTypeLabel, tz: data.timezone })}</span></div>
        <div className="aw-sched-ro-note">{t('edit.readonlyNote')}</div>
        {isCron ? <Form.Item name="cronExpression" label={t('form.cron')}><Input className="aw-sched-cron" /></Form.Item> : null}
      </div>
      <div className="aw-sched-sec">
        <div className="aw-sched-sec-title">{t('create.sections.policy')}</div>
        <div className="aw-sched-grid">
          <Form.Item name="sessionMode" label={t('form.sessionMode')}><Select options={[{ value: 'ISOLATED', label: t('session.isolated') }, { value: 'CONTINUOUS', label: t('session.continuous') }]} /></Form.Item>
          <Form.Item name="overlapPolicy" label={t('form.overlapExecution')}><Select options={[{ value: 'SKIP', label: t('overlap.skip') }, { value: 'QUEUE', label: t('overlap.queue') }, { value: 'ALLOW', label: t('overlap.allow') }]} /></Form.Item>
          <Form.Item name="misfirePolicy" label={t('form.missedTrigger')}><Select options={[{ value: 'SKIP_ALL', label: t('misfire.skipAll') }, { value: 'FIRE_LATEST', label: t('misfire.fireLatest') }, { value: 'FIRE_ALL', label: t('misfire.fireAll') }]} /></Form.Item>
        </div>
      </div>
    </Form>
    <div className="aw-form-foot">
      <Button type="primary" loading={save.isPending} onClick={() => form.submit()}>{t('actions.save')}</Button>
      <Button onClick={() => navigate(`/scheduled-tasks/${id}`)}>{t('actions.cancel')}</Button>
    </div>
  </>;
}
