import { useTranslation } from 'react-i18next';
import { formatMinutes } from '@/shared/lib/duration';
import { Alert, Button, Empty, Modal, Spin } from 'antd';
import type { KpiKey } from './KpiRow';
import type { CompletedWorkitem, RunningWorkitem, TodayCreatedWorkitem } from './api';
import { useRunningWorkitems, useTodayCompleted, useTodayCreatedWorkitems, useWeekCompleted } from './hooks';

interface Props {
  kpiKey: KpiKey | null;
  onClose: () => void;
}

const TITLES = {
  todayCreatedWorkitems: 'kpi.todayCreatedWorkitems',
  runningWorkitems: 'kpi.runningWorkitems',
  todayCompletedTasks: 'kpi.todayCompletedTasks',
  weekCompletedTasks: 'kpi.weekCompletedTasks',
} as const satisfies Record<KpiKey, string>;

const SCOPES = {
  todayCreatedWorkitems: 'kpi.scope.todayCreatedWorkitems',
  runningWorkitems: 'kpi.scope.runningWorkitems',
  todayCompletedTasks: 'kpi.scope.todayCompletedTasks',
  weekCompletedTasks: 'kpi.scope.weekCompletedTasks',
} as const satisfies Record<KpiKey, string>;

export default function KpiDetailModal({ kpiKey, onClose }: Props) {
  const { t } = useTranslation('insights');
  const open = kpiKey != null;
  const showCreatedToday = kpiKey === 'todayCreatedWorkitems';
  const createdToday = useTodayCreatedWorkitems(showCreatedToday);
  const completedToday = useTodayCompleted(kpiKey === 'todayCompletedTasks');
  const completedWeek = useWeekCompleted(kpiKey === 'weekCompletedTasks');
  const showRunning = kpiKey === 'runningWorkitems';
  const running = useRunningWorkitems(showRunning);

  const query = showRunning ? running : showCreatedToday ? createdToday : kpiKey === 'todayCompletedTasks' ? completedToday : completedWeek;
  const isLoading =
    (showCreatedToday && createdToday.isLoading) ||
    (kpiKey === 'todayCompletedTasks' && completedToday.isLoading) ||
    (kpiKey === 'weekCompletedTasks' && completedWeek.isLoading) ||
    (showRunning && running.isLoading);

  const completedList: CompletedWorkitem[] =
    kpiKey === 'todayCompletedTasks'
      ? (completedToday.data ?? [])
      : kpiKey === 'weekCompletedTasks'
        ? (completedWeek.data ?? [])
        : [];

  const runningList: RunningWorkitem[] = showRunning ? (running.data ?? []) : [];

  const workitemList: (TodayCreatedWorkitem | CompletedWorkitem)[] = showCreatedToday
    ? (createdToday.data ?? [])
    : completedList;

  const renderWorkitemRow = (item: TodayCreatedWorkitem | CompletedWorkitem) => (
    <a
      key={item.workitemId}
      className="insight-kpi-modal-row"
      href={`/workitems/${item.workitemId}`}
      title={item.title ?? undefined}
    >
      <span className="insight-kpi-modal-row-title">#{item.workitemId} {item.title ?? ''}</span>
    </a>
  );

  return (
    <Modal
      className="insight-kpi-modal"
      title={kpiKey ? t(TITLES[kpiKey]) : ''}
      open={open}
      onCancel={onClose}
      footer={null}
      width={600}
      centered
      destroyOnHidden
      focusTriggerAfterClose={false}
    >
      <div className="insight-kpi-modal-summary">
        {!isLoading && !query.isError && (
          <span className="insight-kpi-modal-total">{t('kpi.total', { count: showRunning ? runningList.length : workitemList.length })}</span>
        )}
        <span className="insight-kpi-modal-scope">{kpiKey ? t(SCOPES[kpiKey]) : ''}</span>
      </div>
      {query.isError ? <Alert type="error" showIcon message={t('kpi.loadFailure')} action={<Button onClick={() => { void query.refetch(); }}>{t('kpi.retry')}</Button>} /> : isLoading ? (
        <div className="insight-kpi-modal-state">
          <Spin tip={t('kpi.loading')}><div style={{ minHeight: 40 }} /></Spin>
        </div>
      ) : showRunning ? (
        runningList.length === 0 ? (
          <div className="insight-kpi-modal-state">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('kpi.emptyRunning')} />
          </div>
        ) : (
          <div className="insight-kpi-modal-list">
            {runningList.map((item) => (
              <a
                key={item.workitemId}
                className="insight-kpi-modal-row is-running"
                href={`/workitems/${item.workitemId}`}
                title={item.title ?? undefined}
              >
                <span className="insight-kpi-modal-row-title">#{item.workitemId} {item.title ?? ''}</span>
                <span className="insight-kpi-modal-row-meta">
                  {item.runningDispatchCount > 1 ? t('kpi.multiRunning', { count: item.runningDispatchCount }) : null}
                  {t('kpi.runningMeta', { agent: item.agentName ?? t('kpi.noValue'), step: item.stepName ?? t('kpi.noValue') })} · <span className="insight-kpi-modal-duration">{formatMinutes(item.runningMinutes)}</span>
                </span>
              </a>
            ))}
          </div>
        )
      ) : workitemList.length === 0 ? (
        <div className="insight-kpi-modal-state">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={showCreatedToday ? t('kpi.emptyTodayCreated') : t('kpi.emptyCompleted')}
          />
        </div>
      ) : (
        <div className="insight-kpi-modal-list">{workitemList.map(renderWorkitemRow)}</div>
      )}
    </Modal>
  );
}
