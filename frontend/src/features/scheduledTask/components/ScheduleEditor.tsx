import { formatDateTime } from '@/shared/i18n/format';
import { useTranslation } from 'react-i18next';
import { DatePicker, Form, Input, Segmented, TimePicker } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { ScheduleType } from '../types';
import { previewScheduledTask } from '../api';
import { relativeTime } from '../relativeTime';
import './scheduleFires.css';

const FIRE_DATE: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
const FIRE_WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'short' };
const FIRE_TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
const CRON = 'CRON';

export type SchedulePreset = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';
export const PRESET_CRON: Record<Exclude<SchedulePreset, 'custom'>, string> = {
  hourly: '0 0 * * * *', daily: '0 0 2 * * *', weekly: '0 0 2 * * 2', monthly: '0 0 2 1 * *',
};

export function isSixFieldCron(value?: string): boolean {
  if (!value || value.trim().split(/\s+/).length !== 6) return false;
  return value.trim().split(/\s+/).every((part) => /^[0-9*?,/\-LW#]+$/.test(part));
}

export function ScheduleEditor({ timezone = 'Asia/Shanghai' }: { timezone?: string }) {
  const { t } = useTranslation('scheduledTask');
  const form = Form.useFormInstance();
  const scheduleType = (Form.useWatch('scheduleType', form) as ScheduleType | undefined) ?? CRON;
  const cronExpression = (Form.useWatch('cronExpression', form) as string | undefined) ?? '0 0 2 * * *';
  const preset: SchedulePreset = (Form.useWatch('schedulePreset', form) as SchedulePreset | undefined) ?? 'daily';
  const recurring = scheduleType === CRON;
  const validCron = isSixFieldCron(cronExpression);
  const preview = useQuery({
    queryKey: ['scheduled-tasks', 'preview', cronExpression, timezone],
    queryFn: () => previewScheduledTask(cronExpression!, timezone),
    enabled: recurring && validCron,
  });
  const changePreset = (next: SchedulePreset) => {
    form.setFieldValue('schedulePreset', next);
    if (next !== 'custom') form.setFieldValue('cronExpression', PRESET_CRON[next]);
  };
  const fireTime = (instant: string) => t('schedule.fireTime', { date: formatDateTime(instant, FIRE_DATE), weekday: formatDateTime(instant, FIRE_WEEKDAY), time: formatDateTime(instant, FIRE_TIME) });

  return <>
    <Form.Item name="scheduleType" label={t('schedule.type')} rules={[{ required: true, message: t('validation.required', { field: t('schedule.type') }) }]}>
      <Segmented options={[{ value: CRON, label: t('schedule.recurring') }, { value: 'ONCE', label: t('schedule.once') }]} />
    </Form.Item>
    {recurring ? <>
      <Form.Item name="schedulePreset" label={t('schedule.frequency')}>
        <Segmented value={preset} onChange={(value) => changePreset(value as SchedulePreset)} options={[
          { value: 'hourly', label: t('schedule.hourly') }, { value: 'daily', label: t('schedule.daily') }, { value: 'weekly', label: t('schedule.weekly') }, { value: 'monthly', label: t('schedule.monthly') }, { value: 'custom', label: t('schedule.custom') },
        ]} />
      </Form.Item>
      <Form.Item name="cronExpression" label={t('form.cron')} extra={t('schedule.cronHelp', { tz: timezone })} rules={[{ required: true, validator: (_, value) => isSixFieldCron(value) ? Promise.resolve() : Promise.reject(new Error(t('validation.cron'))) }]}>
        <Input className="aw-sched-cron" disabled={preset !== 'custom'} onChange={() => form.setFieldValue('schedulePreset', 'custom')} placeholder={t('schedule.cronPlaceholder')} />
      </Form.Item>
      <Form.Item label={<>{t('schedule.upcoming')}<span className="aw-sched-opt">{t('schedule.serverComputed')}</span></>}>
        {!validCron ? <div className="aw-sched-hint">{t('schedule.previewInvalid')}</div>
          : preview.isLoading ? <div className="aw-sched-hint">{t('schedule.previewLoading')}</div>
          : <ul className="aw-sched-fires" aria-label={t('schedule.previewAria')}>
            {(preview.data ?? []).map((instant, index) => <li key={instant} className={index === 0 ? 'is-next' : undefined}><span className="fd" />{fireTime(instant)}<span className="rel">{relativeTime(instant)}</span></li>)}
          </ul>}
      </Form.Item>
    </> : <div className="aw-sched-grid">
      <Form.Item name="runAtDate" label={t('schedule.runDate')} rules={[{ required: true, message: t('validation.runDate') }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
      <Form.Item name="runAtTime" label={t('schedule.runTime')} rules={[{ required: true, message: t('validation.runTime') }]}><TimePicker format="HH:mm" style={{ width: '100%' }} /></Form.Item>
    </div>}
  </>;
}
