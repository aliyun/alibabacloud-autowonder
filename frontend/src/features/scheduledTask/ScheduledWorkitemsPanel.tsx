import { i18n } from '@/shared/i18n';
import { formatNumber } from '@/shared/i18n/format';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import { useTranslation } from 'react-i18next';
import { Toolbar } from '@/shared/ui/Toolbar';
import { TableCard, TableFooter } from '@/shared/ui/TableCard';
import { StatusTag, type StatusColorKey } from '@/shared/ui/StatusTag';
import { TimeCell } from '@/shared/ui/TimeCell';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useState, type ReactNode } from 'react';
import { Button, DatePicker, Input, Modal, Segmented, Space, Tooltip, message } from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import { CloseCircleFilled } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { usePageSizePreference } from '@/shared/lib/usePageSizePreference';
import { useUpdateScheduledStart, useWorkitemList } from '@/features/workitem/hooks';
import type { Workitem, WorkitemScheduledPhase } from '@/shared/types/workitem';

type Scope = 'ALL' | 'CREATED';

/** 已触发的工单定时字段已被清空，三个操作都失去意义，因此按钮常驻但置灰并说明原因。 */
function disabledReason(phase?: WorkitemScheduledPhase | null): string {
  return phase === 'DONE' ? i18n.t('scheduledTask:workitems.doneReason') : i18n.t('scheduledTask:workitems.triggeredReason');
}

function ScheduledWorkitemActions({ workitem }: { workitem: Workitem }) {
  const { t } = useTranslation(['scheduledTask', 'workitem']);
  const navigate = useNavigate();
  const accessCommand = useAccessCommand();
  const mutation = useUpdateScheduledStart(workitem.id);
  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState<Dayjs | null>(null);
  const actionable = workitem.scheduledPhase === 'PENDING';
  const reason = actionable ? '' : disabledReason(workitem.scheduledPhase);

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
      message.warning(t('workitem:schedule.futureRequired'));
      return;
    }
    run(t('workitem:schedule.editCommand'), () =>
      mutation.mutateAsync({ scheduledStartAt: editValue.toISOString() }).then(() => setEditOpen(false)),
    );
  };

  const button = (label: string, icon: ReactNode, onClick: () => void, danger?: boolean) => (
    <Tooltip title={actionable ? label : reason}>
      <span style={{ display: 'inline-flex' }}>
        <Button
          size="small"
          type="text"
          className={danger ? 'aw-op-btn aw-op-btn--del' : 'aw-op-btn'}
          icon={icon}
          aria-label={t('workitems.actionAria', { action: label, id: workitem.id })}
          disabled={!actionable}
          loading={mutation.isPending}
          onClick={onClick}
        />
      </span>
    </Tooltip>
  );

  return (
    <Space size={6}>
      {button(t('workitems.editTime'), <AwStrokeIcon name="clock" />, () => {
        setEditValue(workitem.scheduledStartAt ? dayjs(workitem.scheduledStartAt) : dayjs());
        setEditOpen(true);
      })}
      {button(t('workitems.executeNow'), <AwStrokeIcon name="play" />, () => run(t('workitem:schedule.executeCommand'), () => mutation.mutateAsync({ executeNow: true })))}
      <Tooltip title={t('actions.view')}>
        <Button size="small" type="text" className="aw-op-btn" icon={<AwStrokeIcon name="eye" />} aria-label={t('workitems.actionAria', { action: t('actions.view'), id: workitem.id })} onClick={() => navigate(`/workitems/${workitem.id}`)} />
      </Tooltip>
      {button(t('workitem:schedule.cancel'), <AwStrokeIcon name="x" />, () => run(t('workitem:schedule.cancelCommand'), () => mutation.mutateAsync({ scheduledStartAt: null })), true)}
      <Modal
        title={t('workitem:schedule.editTitle')}
        open={editOpen}
        onOk={handleEditOk}
        onCancel={() => setEditOpen(false)}
        confirmLoading={mutation.isPending}
        okText={t('actions.save')}
        cancelText={t('actions.cancel')}
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
    </Space>
  );
}

/** 定时任务页 Tab2：聚合展示设置了定时启动的工单，操作全部复用 /api/workitems/{id}/scheduled-start。 */
export function ScheduledWorkitemsPanel() {
  const { t } = useTranslation('scheduledTask');
  const systemLabel = useSystemLabel();
  const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
    { value: 'ALL', label: t('scope.all') },
    { value: 'CREATED', label: t('scope.created') },
  ];
  const PHASE_META: Record<WorkitemScheduledPhase, { label: string; colorKey: StatusColorKey }> = {
    PENDING: { label: t('phase.pending'), colorKey: 'blue' },
    READY: { label: t('phase.ready'), colorKey: 'amber' },
    RUNNING: { label: t('phase.running'), colorKey: 'green' },
    DONE: { label: t('phase.done'), colorKey: 'gray' },
  };
  const navigate = useNavigate();
  const [scope, setScope] = useState<Scope>('ALL');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSizePreference('autowonder.scheduledWorkitems.pageSize', [10, 20, 50], 10);
  const { data, isLoading } = useWorkitemList({
    page,
    size: pageSize,
    scheduledStart: 'ALL',
    ...(scope === 'CREATED' ? { mineScope: 'CREATED' } : {}),
    ...(keyword ? { keyword } : {}),
  });
  const items = data?.list ?? [];

  const columns: ColumnsType<Workitem> = [
    {
      title: t('columns.workitem'), align: 'left',
      dataIndex: 'title',
      width: 240,
      render: (title: string, record) => <a onClick={() => navigate(`/workitems/${record.id}`)}>{title}</a>,
    },
    {
      title: t('columns.phase'),
      dataIndex: 'scheduledPhase',
      width: 120,
      render: (value: WorkitemScheduledPhase | null | undefined) =>
        value && Object.prototype.hasOwnProperty.call(PHASE_META, value) ? <StatusTag dot label={PHASE_META[value].label} colorKey={PHASE_META[value].colorKey} /> : value || '-',
    },
    { title: t('columns.workitemStatus'), dataIndex: 'statusName', width: 120, render: (value: string | null, record: Workitem) => (value ? systemLabel(record.statusLabelKey, value) : '-') },
    { title: t('columns.plannedAt'), width: 130, render: (_, record) => <TimeCell value={record.scheduledStartAt ?? record.scheduledStartTriggeredAt} /> },
    { title: t('columns.actions'), width: 140, render: (_, record) => <ScheduledWorkitemActions workitem={record} /> },
  ];

  const totalCount = data?.total ?? items.length;

  return (
    <>
      <Toolbar
        left={<>
          <Segmented
            aria-label={t('workitems.scopeAria')}
            options={SCOPE_OPTIONS}
            value={scope}
            onChange={(value) => { setScope(value as Scope); setPage(1); }}
          />
          <Input
            aria-label={t('workitems.keywordAria')}
            placeholder={t('workitems.searchPlaceholder')}
            prefix={<AwStrokeIcon name="search" />}
            allowClear={{ clearIcon: <CloseCircleFilled aria-label={t('actions.clearWorkitemSearch')} /> }}
            style={{ width: 220 }}
            onPressEnter={(event) => { setKeyword((event.target as HTMLInputElement).value); setPage(1); }}
            onChange={(event) => { if (!event.target.value) { setKeyword(''); setPage(1); } }}
          />
        </>}
      />
      <TableCard
        flush
        className="aw-scheduled-list"
        footer={
          <TableFooter
            total={totalCount}
            page={page}
            pageSize={pageSize}
            totalText={t('list.totalRows', { count: totalCount, total: formatNumber(totalCount) })}
            onPageChange={(nextPage, nextSize) => {
              setPage(nextPage);
              if (nextSize !== pageSize) { setPageSize(nextSize); setPage(1); }
            }}
            onPageSizeChange={setPageSize}
          />
        }
      >
        <Table
          scroll={{ x: 800 }}
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={isLoading}
          locale={{ emptyText: t('workitems.empty') }}
          pagination={false}
        />
      </TableCard>
    </>
  );
}
