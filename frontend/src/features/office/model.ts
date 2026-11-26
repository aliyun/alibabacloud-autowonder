import type { Agent } from '@/features/agent/api';
import type { ExecutorVO } from '@/features/executor/api';

export type TaskBucket = 'pending' | 'active' | 'done';
export type MemberState = 'working' | 'preparing' | 'paused' | 'idle' | 'waiting' | 'unknown';
export type RoleGroup = 'engineering' | 'testing' | 'management' | 'product' | 'unclassified';
export type OfficeEventType = 'WORKITEM_CREATED' | 'AGENT_ASSIGNED' | 'AGENT_HANDOFF'
  | 'DISPATCH_STARTED' | 'HITL_REQUESTED' | 'HITL_RESOLVED'
  | 'STEP_COMPLETED' | 'WORKITEM_DELIVERED';
export interface OfficeEvent {
  id: string;
  type: OfficeEventType;
  workitemId: number;
  workitemTitle: string;
  dispatchId: number | null;
  sourceAgentId: number | null;
  targetAgentId: number | null;
  actorType: string | null;
  actorRef: number | null;
  status: string | null;
  occurredAt: number;
}
export interface OfficeAgentState {
  agentId: number;
  state: 'WORKING' | 'PREPARING' | 'PAUSED' | 'IDLE' | 'WAITING' | 'UNKNOWN';
  online: boolean;
  runningTasks: number;
  workitemIds: number[];
}
export interface OfficeActivitySnapshot {
  generatedAt: number;
  events: OfficeEvent[];
  agents: OfficeAgentState[];
}
export interface OfficeMember {
  group: RoleGroup;
  id: number;
  name: string;
  role: string;
  chief: boolean;
  state: MemberState;
  runningTasks: number | null;
  heartbeat: string | null;
  squads: { id: number; name: string }[];
  workitemIds: string[];
}
export interface OfficeTask {
  id: string;
  title: string;
  bucket: TaskBucket;
  assigneeId: string | null;
  waiting: boolean;
}
export interface OfficeSnapshot {
  members: OfficeMember[] | null;
  tasks: Record<TaskBucket, OfficeTask[] | null>;
  counts: Record<TaskBucket, number | null>;
  events: OfficeEvent[] | null;
  updatedAt: string;
  partialFailure: boolean;
}
export const BUCKETS: TaskBucket[] = ['pending', 'active', 'done'];
export const CATEGORY_FILTERS: Record<TaskBucket, string> = {
  pending: 'NEW', active: 'IN_PROGRESS,PENDING_DECISION', done: 'DONE',
};
export const GROUP_COLORS: Record<RoleGroup, string> = {
  engineering: '#668CAE', testing: '#5C998F', management: '#B88A4A', product: '#B67B72', unclassified: '#858890',
};

// Presentation taxonomy, never a replacement for the platform's authored role.
export function classifyRole(code: string | null | undefined): RoleGroup {
  if (code === 'chief_of_staff' || code === 'AW_PROJECT_MANAGER') return 'management';
  if (['QA', 'AW_QA', 'AW_E2E_MAINTAINER'].includes(code ?? '')) return 'testing';
  if (['PM_PRODUCT', 'AW_REQ_CLARIFIER', 'FEATURE_DELTA_ANALYST'].includes(code ?? '')) return 'product';
  if (['FS_DEV', 'AW_FS_DEV', 'CR', 'AW_CR', 'AW_CONFLICT_RESOLVER', 'AW_DBA', 'FAST_DBA', 'AW_MERGE_RELEASE_DEPLOY', 'NPM_RELEASE_ENGINEER', 'COMMUNITY_RELEASE_ENGINEER'].includes(code ?? '')) return 'engineering';
  return 'unclassified';
}
export const SCENE_PAGE_SIZE = 15;

export function sceneMembers(members: OfficeMember[], squad: number | null, page: number) {
  const scoped = members.filter(member => squad === null || member.squads.some(group => group.id === squad));
  const chief = scoped.find(member => member.chief);
  const employees = scoped.filter(member => member !== chief);
  const pages = Math.max(1, Math.ceil(employees.length / SCENE_PAGE_SIZE));
  const offset = (Math.min(Math.max(page, 1), pages) - 1) * SCENE_PAGE_SIZE;
  return { pages, visible: [...(chief ? [chief] : []), ...employees.slice(offset, offset + SCENE_PAGE_SIZE)] };
}

// Presence requires both the employee and at least one of its executors to be online.
export function onlineMembers(agents: Agent[], executors: ExecutorVO[]): OfficeMember[] {
  const heartbeats = new Map<number, string | null>();
  for (const executor of executors) {
    if (executor.status !== 'ONLINE') continue;
    const previous = heartbeats.get(executor.agentId);
    if (!previous || (executor.lastHeartbeat && executor.lastHeartbeat > previous)) {
      heartbeats.set(executor.agentId, executor.lastHeartbeat);
    }
  }
  return agents.filter(a => a.status === 'ONLINE' && heartbeats.has(a.id))
    .map(a => ({ id: a.id, name: a.name, group: classifyRole(a.roleCode), role: a.roleName ?? '', chief: a.roleCode === 'chief_of_staff',
      state: 'unknown' as MemberState, runningTasks: null, workitemIds: [],
      squads: (a.squadIds ?? []).map((id, index) => ({ id, name: a.squadNames?.[index] ?? String(id) })),
      heartbeat: heartbeats.get(a.id) ?? null,
    })).sort((a, b) => Number(b.chief) - Number(a.chief) || a.id - b.id);
}
