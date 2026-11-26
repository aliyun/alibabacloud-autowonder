import { apiClient } from '@/shared/api/client';
import { useAuthStore } from '@/shared/auth/store';
import type { Agent } from '@/features/agent/api';
import type { ExecutorVO } from '@/features/executor/api';
import type { PipelineHealth, RealtimeDashboard, RunningTask } from '@/features/insights/realtime/api';
import type { DeliveryResponse } from '@/features/insights/delivery/types';
import type { PageResult } from '@/shared/types/common';
import type { Workitem } from '@/shared/types/workitem';
import {
  BUCKETS, CATEGORY_FILTERS, onlineMembers,
  type MemberState, type OfficeActivitySnapshot, type OfficeSnapshot, type OfficeTask, type TaskBucket,
} from './model';

export const COMPLETION_DAYS = 30;

function scopedReader(workspaceId: number, signal: AbortSignal) {
  function check() {
    if (signal.aborted || useAuthStore.getState().currentWorkspace?.id !== workspaceId) {
      throw new DOMException('Scope changed', 'AbortError');
    }
  }
  async function get<T>(url: string, params?: Record<string, unknown>) {
    check();
    const response = await apiClient.get<T>(url, { params, signal, backgroundActivity: true });
    check();
    return response.data;
  }
  return { check, get };
}

export function loadOfficeDelivery(workspaceId: number, signal: AbortSignal) {
  return scopedReader(workspaceId, signal).get<DeliveryResponse>('/api/insights/delivery-analysis', { days: 30 });
}

export function loadOfficeCompletion(workspaceId: number, signal: AbortSignal) {
  return scopedReader(workspaceId, signal).get<PipelineHealth>('/api/dashboard/pipeline-health', { range: `${COMPLETION_DAYS}d` });
}

export function loadOfficeActivity(workspaceId: number, signal: AbortSignal) {
  return scopedReader(workspaceId, signal).get<RealtimeDashboard>('/api/dashboard/realtime');
}

function recentWorkitems(get: ReturnType<typeof scopedReader>['get'], categories: string) {
  return get<PageResult<Workitem>>('/api/workitems', { page: 1, size: 16, statusCategories: categories, sortBy: 'UPDATED' })
    .then(result => {
      if (!Number.isSafeInteger(result.total) || result.total < 0 || !Array.isArray(result.list)) {
        throw new Error('Invalid workitem page');
      }
      return result;
    });
}

function toTask(item: Workitem, bucket: TaskBucket): OfficeTask {
  return {
    id: String(item.id), title: item.title, bucket,
    assigneeId: item.assigneeType === 'AGENT' && item.assigneeRef != null ? String(item.assigneeRef) : null,
    waiting: item.statusCategory === 'PENDING_DECISION',
  };
}

export async function loadOffice(workspaceId: number, signal: AbortSignal): Promise<OfficeSnapshot> {
  const { check, get } = scopedReader(workspaceId, signal);
  async function loadMembers() {
    const roster = async () => {
      const list: Agent[] = [];
      for (let page = 1; ; page++) {
        const batch = await get<Agent[]>('/api/agents', { status: 'ONLINE', page, size: 100 });
        list.push(...batch);
        if (batch.length < 100) return list;
      }
    };
    const [agents, executors] = await Promise.all([roster(), get<ExecutorVO[]>('/api/executors')]);
    return onlineMembers(agents, executors);
  }
  const [sources, categories] = await Promise.all([
    Promise.allSettled([loadMembers(), get<OfficeActivitySnapshot>('/api/office/activity')]),
    Promise.allSettled(BUCKETS.map(bucket => recentWorkitems(get, CATEGORY_FILTERS[bucket]))),
  ]);
  const [roster, activity] = sources;
  check();
  if (roster.status === 'rejected' && activity.status === 'rejected'
      && categories.every(result => result.status === 'rejected')) {
    throw new Error('Office snapshot unavailable');
  }
  let members = roster.status === 'fulfilled' ? roster.value : null;
  const counts: OfficeSnapshot['counts'] = { pending: null, active: null, done: null };
  const tasks: OfficeSnapshot['tasks'] = { pending: null, active: null, done: null };
  let partialFailure = roster.status === 'rejected' || activity.status === 'rejected'
    || categories.some(result => result.status === 'rejected');
  categories.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const bucket = BUCKETS[index];
    counts[bucket] = result.value.total;
    tasks[bucket] = result.value.list.map(item => toTask(item, bucket));
  });
  if (members && activity.status === 'fulfilled') {
    const stateNames: Record<OfficeActivitySnapshot['agents'][number]['state'], MemberState> = {
      WORKING: 'working', PREPARING: 'preparing', PAUSED: 'paused', IDLE: 'idle', WAITING: 'waiting', UNKNOWN: 'unknown',
    };
    const states = new Map(activity.value.agents.map(agent => [agent.agentId, agent]));
    members = members.filter(member => states.get(member.id)?.online !== false).map(member => {
      const fact = states.get(member.id);
      return fact ? { ...member, state: stateNames[fact.state], runningTasks: fact.runningTasks,
        workitemIds: fact.workitemIds.map(String) } : member;
    });
  } else {
    const awaitingDecision = new Set(tasks.active?.filter(task => task.waiting).map(task => task.assigneeId));
    for (let offset = 0; members && offset < members.length; offset += 8) {
      await Promise.all(members.slice(offset, offset + 8).map(async member => {
        try {
          const running = await get<RunningTask[]>(`/api/dashboard/agents/${member.id}/running`);
          member.workitemIds = [...new Set(running.map(task => String(task.workitemId)))];
          member.runningTasks = running.length;
          member.state = running.length ? 'working' : member.chief ? 'unknown'
            : awaitingDecision.has(String(member.id)) ? 'waiting' : 'unknown';
        } catch {
          check();
          partialFailure = true;
        }
      }));
    }
  }
  check();
  return {
    members, tasks, counts,
    events: activity.status === 'fulfilled' ? activity.value.events : null,
    updatedAt: new Date().toISOString(), partialFailure,
  };
}
