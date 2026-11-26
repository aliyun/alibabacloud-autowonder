import { useQuery } from '@tanstack/react-query';
import type { RealtimeDashboard, RecentTask } from '@/features/insights/realtime/api';
import { loadOfficeActivity, loadOfficeCompletion, loadOfficeDelivery } from './api';

export interface OfficeActivity {
  id: string;
  status: 'running' | RecentTask['status'];
  title: string | null;
  employee: string | null;
  employeeId?: number;
  workitemId?: number;
  occurredAt: number;
  simulationAction?: import('./scene/workflow').SimulationAction;
}

export function activitiesFromRealtime(data: Pick<RealtimeDashboard, 'generatedAt' | 'runningFeed' | 'recentFeed'>): OfficeActivity[] {
  const generatedAt = Date.parse(data.generatedAt);
  const running: OfficeActivity[] = data.runningFeed.map(task => ({
    id: `${task.dispatchId}:running`, status: 'running', title: task.workitemTitle, employee: task.agentName, employeeId: task.agentId,
    workitemId: task.workitemId, occurredAt: generatedAt - task.runningMinutes * 60_000,
  }));
  const recent: OfficeActivity[] = data.recentFeed.map(task => ({
    id: `${task.dispatchId}:${task.status}`, status: task.status, title: task.workitemTitle, employee: task.agentName,
    // The activity query returns these database timestamps in the dashboard's Shanghai timezone.
    occurredAt: Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(task.finishedAt)
      ? `${task.finishedAt.replace(' ', 'T')}+08:00` : task.finishedAt),
  }));
  return [...running, ...recent].sort((a, b) => (b.occurredAt || 0) - (a.occurredAt || 0));
}

export function useOfficeInsights(workspaceId: number) {
  const delivery = useQuery({
    queryKey: ['office', workspaceId, 'delivery'],
    queryFn: ({ signal }) => loadOfficeDelivery(workspaceId, signal),
    refetchInterval: query => {
      const status = query.state.data?.status;
      return status === 'COMPUTING' || status === 'REFRESHING' || status === 'BUSY' ? 3_000 : 60_000;
    },
    retry: false,
  });
  const completion = useQuery({
    queryKey: ['office', workspaceId, 'completion'],
    queryFn: ({ signal }) => loadOfficeCompletion(workspaceId, signal),
    refetchInterval: 60_000, retry: false,
  });
  const activity = useQuery({
    queryKey: ['office', workspaceId, 'activity'],
    queryFn: ({ signal }) => loadOfficeActivity(workspaceId, signal),
    select: activitiesFromRealtime, refetchInterval: 15_000, retry: false,
  });
  const report = delivery.data?.report;
  const week = report?.weeks.at(-1);
  return {
    metrics: {
      hours: week?.metrics.workhours,
      weekThrough: week?.displayEnd,
      skills: report?.summary.skill,
      versions: report?.summary.versions,
      averageMinutes: completion.data?.avgWorkitemDurationMinutes,
      failed: delivery.isError || delivery.data?.status === 'ERROR' || !!delivery.data?.errorCode || completion.isError,
    },
    activities: activity.data,
    activityFailed: activity.isError,
    refreshing: delivery.isFetching || completion.isFetching || activity.isFetching,
    refresh() {
      void delivery.refetch();
      void completion.refetch();
      void activity.refetch();
    },
  };
}
