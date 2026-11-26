import { i18n } from '@/shared/i18n';
import { GROUP_COLORS, type RoleGroup, BUCKETS, type OfficeMember, type OfficeSnapshot, type OfficeTask, type TaskBucket } from './model';
import { OfficeSimulation } from './scene/simulation.mjs';
import type { OfficeActivity } from './insights';

const jobKeys = ['office:job0', 'office:job1', 'office:job2', 'office:job3', 'office:job4', 'office:job5'] as const;

const demoRoles: RoleGroup[] = ['engineering', 'product', 'product', 'testing', 'management', 'engineering', 'product'];
function demoGroup(id: number): RoleGroup {
  return id === 7 ? 'management' : demoRoles[(id < 7 ? id : id - 1) % demoRoles.length];
}

export function createDemo() {
  const demo = new OfficeSimulation();
  demo.mode = 'demo';
  for (const agent of demo.agents) agent.color = GROUP_COLORS[demoGroup(agent.id)];
  for (let i = 0; i < 95; i++) demo.advance(1);
  return demo;
}

export function demoSnapshot(demo: OfficeSimulation): OfficeSnapshot {
  const roleKeys = ['office:role0', 'office:role1', 'office:role2', 'office:role3', 'office:role4', 'office:role5', 'office:role6'] as const;
  const members = demo.agents.filter(agent => agent.state !== 'offline').map((agent): OfficeMember => ({
    id: agent.id, name: agent.name, group: demoGroup(agent.id), chief: agent.id === 7,
    role: i18n.t(agent.id === 7 ? 'office:dispatchRole' : roleKeys[(agent.id < 7 ? agent.id : agent.id - 1) % roleKeys.length]),
    state: ['decision', 'reviewing'].includes(agent.state) ? 'waiting' : agent.taskId ? 'working' : 'idle',
    runningTasks: Number(agent.taskId !== null), heartbeat: null, squads: [],
    workitemIds: agent.taskId ? [agent.taskId] : [],
  }));
  const tasks: Record<TaskBucket, OfficeTask[]> = { pending: [], active: [], done: [] };
  for (const task of demo.tasks.slice().reverse()) {
    const bucket = BUCKETS.find(value => value === task.state) ?? 'active';
    const waiting = ['decision', 'reviewing'].includes(task.state);
    tasks[bucket].push({
      id: task.id, title: i18n.t(jobKeys[task.job]), bucket, assigneeId: null,
      waiting,
    });
  }
  return {
    members, tasks, counts: demo.counts, events: [], updatedAt: '', partialFailure: false,
  };
}

export function demoActivities(events: OfficeSimulation['events'], tasks: OfficeSimulation['tasks'], epoch: number, language: string): OfficeActivity[] {
  return events.flatMap(event => {
    if (event.key !== 'allocated' && event.key !== 'archived') return [];
    const task = tasks.find(item => item.id === event.taskId);
    if (!task) return [];
    return [{
      id: `${event.taskId}:${event.key}`, status: event.key === 'allocated' ? 'running' : 'SUCCEEDED',
      title: i18n.t(jobKeys[task.job], { lng: language }), employee: event.names.join(' · '), occurredAt: epoch + event.time * 1000,
    }];
  });
}
