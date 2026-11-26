import { formatDateTime } from '@/shared/i18n/format';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Button, DatePicker, Modal, Space, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useUpdateScheduledStart } from '../hooks';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';

interface ScheduledStartControlProps {
  workitemId: number | string;
  assigneeType: string;
  scheduledStartAt: string | null | undefined;
}

/** 详情页计划执行条：仅对已指派数字员工且存在计划时间的工单展示。 */
export function ScheduledStartControl({ workitemId, assigneeType, scheduledStartAt }: ScheduledStartControlProps) {
  const { t } = useTranslation('workitem');
  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState<Dayjs | null>(null);
  const mutation = useUpdateScheduledStart(workitemId);
  const accessCommand = useAccessCommand();

  if (assigneeType !== 'AGENT' || !scheduledStartAt) {
    return null;
  }

  const overdue = dayjs(scheduledStartAt).isBefore(dayjs());

  const run = (action: string, call: () => Promise<unknown>) =>
    accessCommand('READ_WRITE', action, async () => {
      try {
        await call();
      } catch {
        // ApiError already surfaced by interceptor
      }
    });

  const handleEditOk = () => {
    if (!editValue || editValue.isBefore(dayjs(), 'minute')) {
      message.warning(t('schedule.futureRequired'));
      return;
    }
    run(t('schedule.editCommand'), () =>
      mutation.mutateAsync({ scheduledStartAt: editValue.toISOString() }).then(() => setEditOpen(false)),
    );
  };

  return (
    <div className={`aw-schedule-bar${overdue ? ' is-overdue' : ''}`} data-testid="schedule-start-control">
      <AwStrokeIcon name="clock" size={13} className="aw-schedule-bar-icon" />
      <b>{overdue ? t('schedule.overdue') : t('schedule.planned')}</b>
      <span className="aw-schedule-sep" aria-hidden="true" />
      <span>{formatDateTime(scheduledStartAt)}</span>
      <span className="aw-schedule-sep" aria-hidden="true" />
      <span>{overdue ? t('schedule.notStarted') : t('schedule.autoStart')}</span>
      <span className="aw-schedule-spacer" />
      <Space size={4}>
        <Button type="text" size="small" className="aw-schedule-action is-primary" onClick={() => run(t('schedule.executeCommand'), () => mutation.mutateAsync({ executeNow: true }))}>
          {t('schedule.executeNow')}
        </Button>
        <Button
          type="text"
          size="small"
          className="aw-schedule-action"
          onClick={() => {
            setEditValue(dayjs(scheduledStartAt));
            setEditOpen(true);
          }}
        >
          {t('schedule.edit')}
        </Button>
        <Button type="text" size="small" className="aw-schedule-action is-danger" onClick={() => run(t('schedule.cancelCommand'), () => mutation.mutateAsync({ scheduledStartAt: null }))}>
          {t('schedule.cancel')}
        </Button>
      </Space>
      <Modal
        title={t('schedule.editTitle')}
        open={editOpen}
        onOk={handleEditOk}
        onCancel={() => setEditOpen(false)}
        confirmLoading={mutation.isPending}
        okText={t('schedule.save')}
        cancelText={t('schedule.cancelEdit')}
        destroyOnHidden
      >
        <DatePicker
          showTime
          style={{ width: '100%' }}
          value={editValue}
          onChange={(value) => setEditValue(value)}
          disabledDate={(current) => !!current && current.isBefore(dayjs(), 'minute')}
        />
      </Modal>
    </div>
  );
}
