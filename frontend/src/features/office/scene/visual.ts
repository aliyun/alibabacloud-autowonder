import { createActors, walkRoute } from './movement';
import type { OfficeSnapshot, OfficeMember, OfficeEvent } from '../model';
import { GROUP_COLORS } from '../model';
import type { OfficeActivity } from '../insights';
import { announce, type Speaker } from './annotations';
import { OfficeSimulation } from './workflow';
import { homes, assignLoungeSpots, waitingSeats, workSeats, workPositions, dispatch, planRoute, decisionPoint } from './navigation.mjs';

export type Point = [number, number];
export interface VisualAgent extends Speaker {
  id: number; name: string; color: string; state: string; taskId: string | null;
  position: Point; route: Point[]; walk: number; workSeatIndex: number | null;
  seatIndex: number | null; seatKind: string | null; seatBlend: number;
  memberId?: number; role?: string;
}
export interface VisualTask {
  id: string; state: string; agents: number[]; started: number | null;
  readyAt: number; travelDelay?: number; rejected: boolean;
  job: number; progress: number; history: { time: number; key: string }[];
}
export interface VisualState {
  mode?: 'live' | 'demo'; supplyTime?: number;
  previewDeposit?: { from: number; progress: number } | null;
  peerHandoff?: { from: number; to: number; progress: number } | null;
  agents: VisualAgent[]; tasks: VisualTask[]; time: number;
  counts: { pending: number | null; active: number | null; done: number | null; total: number | null };
  zoneChanges: number[]; staffDoorOpen: boolean;
  preparation: { readyAt: number } | null;
  fileInventory: { ready: number };
  advance: (dt: number) => void;
}

/** Live data stays separate from the session-local simulation ledger. */
export class LiveOfficeAnimator implements VisualState {
  readonly mode = 'live';
  get supplyTime() {
    if (this.simulation) return this.simulation.supplyTime;
    return this.visitorStartedAt === null ? 20 : Math.min(12, this.time - this.visitorStartedAt);
  }
  time = 0;
  private liveTasks: VisualTask[] = [];
  get tasks() { return this.simulation ? this.simulation.tasks : this.liveTasks; }
  zoneChanges = [0, 0, 0, 0];
  preparation = null;
  private liveCounts: VisualState['counts'] = { pending: null, active: null, done: null, total: null };
  get counts() { return this.simulation?.counts ?? this.liveCounts; }
  get simulationData() { return this.simulation; }
  private loungeSpots = new Map<number, number>();
  private slots = new Map<number, number>();
  private latest: OfficeSnapshot | null = null;
  private selected: OfficeMember[] = [];
  private initialized = false;
  private activityIds: Set<string> | null = null;
  private eventIds: Set<string> | null = null;
  private owners = new Map<string, number>();
  private targets = new Map<number, { point: Point; state: string; seatKind: string | null; seatIndex: number | null }>();
  private entering = new Set<number>();
  private arrivalCues = new Map<number, 'cueRest' | 'cueReview'>();
  private archives: { taskId: string; memberId: number }[] = [];
  private archive: { taskId: string; slot: number; started: number | null } | null = null;
  private visitorStartedAt: number | null = null;
  private liveHandoff: { from: number; to: number; startedAt: number } | null = null;
  private simulation: OfficeSimulation | null = null;
  constructor(private readonly random: () => number = Math.random) {}
  get previewDeposit() { return this.simulation?.deposit ?? null; }
  get peerHandoff() {
    if (this.simulation) return this.simulation.handoff;
    if (!this.liveHandoff) return null;
    const progress = (this.time - this.liveHandoff.startedAt) / 1.5;
    return progress <= 1 ? { from: this.liveHandoff.from, to: this.liveHandoff.to, progress } : null;
  }
  get agents() { return this.simulation?.agents ?? this.liveAgents; }
  private liveAgents = createActors();
  get fileInventory() { return { ready: 0 }; }
  get staffDoorOpen() { return !this.simulation && (this.entering.size > 0 || this.liveAgents.some(agent => agent.state === 'exiting')); }

  sync(snapshot: OfficeSnapshot, selected: OfficeMember[]) {
    this.liveCounts = { ...snapshot.counts, total: Object.values(snapshot.counts).every(n => n !== null)
      ? Object.values(snapshot.counts).reduce<number>((sum, n) => sum + (n ?? 0), 0) : null };
    if (snapshot.members === null) return;
    this.selected = selected;
    this.simulation?.sync(selected, this.time);
    const currentTasks = Object.values(snapshot.tasks).flatMap(tasks => tasks ?? []);
    const fresh = this.latest !== snapshot;
    if (fresh) {
      const owners = new Map<string, number>();
      const membersById = new Map(snapshot.members.map(member => [String(member.id), member]));
      for (const task of currentTasks) {
        const executing = snapshot.members.filter(member => member.workitemIds.includes(task.id));
        const assignee = task.assigneeId === null ? undefined : membersById.get(task.assigneeId);
        const owner = executing.length === 1 ? executing[0].id : assignee?.id ??
          (executing.length === 0 && task.waiting ? this.owners.get(task.id) : undefined);
        if (owner != null) owners.set(task.id, owner);
      }
      const reviews = currentTasks.filter(task => task.waiting);
      this.liveTasks = [...this.liveTasks.filter(task => task.state === 'stamping'), ...reviews.map(task => ({
        ...task, state: 'reviewing', agents: [], started: null, readyAt: 0, job: 0, progress: 0, history: [], rejected: false,
      }))];
      this.owners = owners;
    }
    this.latest = snapshot;
    const roster = new Set(selected.map(member => member.id));
    for (const [id, slot] of this.slots) {
      if (!roster.has(id)) {
        const agent = this.liveAgents[slot];
        if (slot === this.archive?.slot) this.clearArchive();
        this.entering.delete(slot); this.arrivalCues.delete(slot);
        agent.state = 'exiting'; agent.taskId = null;
        this.move(agent, [-12.2, -4.7]);
        this.slots.delete(id); this.targets.delete(slot);
      }
    }
    const chiefId = selected.find(member => member.chief)?.id;
    const reviewing = new Set((snapshot.tasks.active ?? []).filter(item => item.waiting).map(item => this.owners.get(item.id)));
    const resting = selected.filter(m => !m.chief && !['working', 'preparing'].includes(m.state) && !reviewing.has(m.id));
    this.loungeSpots = assignLoungeSpots(resting.map(m => m.id), this.loungeSpots);
    const usedSeats = new Set<number>();
    for (const member of selected) {
      const target = this.targets.get(this.slots.get(member.id) ?? -1);
      if (['working', 'preparing'].includes(target?.state ?? '') && target?.seatIndex != null
          && ['working', 'preparing'].includes(member.state)) usedSeats.add(target.seatIndex);
    }
    for (const member of selected) {
      let slot = this.slots.get(member.id);
      if (slot === undefined) {
        const preferred = member.id === chiefId
          ? (this.liveAgents[7].state === 'offline' ? 7 : -1)
          : this.liveAgents.findIndex(a => a.id !== 7 && a.state === 'offline');
        if (preferred < 0) continue;
        slot = preferred; this.slots.set(member.id, slot);
        if (this.initialized) {
          this.liveAgents[slot].position = [-12.2, -4.7];
          this.entering.add(slot);
          this.zoneChanges[2]++;
        }
      }
      const agent = this.liveAgents[slot];
      agent.name = member.name; agent.role = member.role; agent.color = GROUP_COLORS[member.group]; agent.memberId = member.id;
      const ownedTasks = (snapshot.tasks.active ?? []).filter(item => this.owners.get(item.id) === member.id);
      const task = ownedTasks.find(item => item.waiting) ?? ownedTasks[0];
      const waiting = slot !== 7 && (member.state === 'waiting' || !!task?.waiting);
      const working = ['working', 'preparing'].includes(member.state) && slot !== 7;
      const restSpot = this.loungeSpots.get(member.id);
      let point: Point = restSpot === undefined ? dispatch.coordinator : homes[restSpot];
      const state = slot === 7 ? 'dispatching' : waiting ? 'decision' : member.state;
      let seatKind = restSpot !== undefined && waitingSeats[restSpot] ? 'waiting' : null;
      let seatIndex: number | null = seatKind ? restSpot! : null;
      if (working) {
        const oldTarget = this.targets.get(slot);
        const seat = (['working', 'preparing'].includes(oldTarget?.state ?? '') ? oldTarget?.seatIndex : null) ??
          workPositions.findIndex((_, index) => !usedSeats.has(index));
        if (seat >= 0) {
          usedSeats.add(seat); seatIndex = seat;
          seatKind = seat < workSeats.length ? 'work' : null; point = workPositions[seat];
        } else seatKind = null;
      }
      if (waiting) point = decisionPoint;
      const previous = this.targets.get(slot);
      this.targets.set(slot, { point, state, seatKind, seatIndex });
      if (previous && previous.state !== state) {
        this.arrivalCues.delete(slot);
        if (state === 'decision') this.arrivalCues.set(slot, 'cueReview');
        if (state === 'idle') this.arrivalCues.set(slot, 'cueRest');
      }
      if (this.archive?.slot === slot) continue;
      agent.taskId = task?.id ?? null;
      agent.state = state;
      if (!previous || previous.point[0] !== point[0] || previous.point[1] !== point[1]) {
        if (this.initialized) this.move(agent, point);
        else { agent.position = [...point]; agent.seatBlend = seatKind ? 1 : 0; }
        if (this.initialized) this.zoneChanges[working ? 1 : waiting ? 3 : 2]++;
      }
      if (!agent.route.length) { agent.seatKind = seatKind; agent.seatIndex = seatIndex; }
    }
    if (fresh) {
      this.syncEvents(snapshot.events);
    }
    this.initialized = true;
  }

  private syncEvents(events: OfficeEvent[] | null) {
    if (!events) return;
    const previous = this.eventIds;
    this.eventIds = new Set(events.map(event => event.id));
    if (!previous || this.simulation) return;
    for (const event of events) {
      if (previous.has(event.id)) continue;
      if (event.type === 'WORKITEM_CREATED') {
        this.visitorStartedAt = this.time;
        this.zoneChanges[0]++;
        continue;
      }
      const sourceSlot = event.sourceAgentId == null ? undefined : this.slots.get(event.sourceAgentId);
      const targetSlot = event.targetAgentId == null ? undefined : this.slots.get(event.targetAgentId);
      if (event.type === 'AGENT_ASSIGNED' && targetSlot !== undefined) {
        announce(this.liveAgents[targetSlot], 'cueClaim', this.time);
      } else if (event.type === 'DISPATCH_STARTED' && targetSlot !== undefined) {
        announce(this.liveAgents[targetSlot], 'cueWork', this.time);
      } else if (event.type === 'HITL_REQUESTED' && sourceSlot !== undefined) {
        announce(this.liveAgents[sourceSlot], 'cueReview', this.time);
      } else if (event.type === 'HITL_RESOLVED' && sourceSlot !== undefined) {
        announce(this.liveAgents[sourceSlot], 'cueWork', this.time);
      } else if (event.type === 'AGENT_HANDOFF' && sourceSlot !== undefined && targetSlot !== undefined) {
        announce(this.liveAgents[sourceSlot], 'cuePass', this.time);
        announce(this.liveAgents[targetSlot], 'cueReceive', this.time);
        this.liveHandoff = { from: sourceSlot, to: targetSlot, startedAt: this.time };
      } else if ((event.type === 'STEP_COMPLETED' || event.type === 'WORKITEM_DELIVERED')
          && sourceSlot !== undefined) {
        const taskId = String(event.workitemId);
        if (!this.archives.some(item => item.taskId === taskId)) {
          this.archives.push({ taskId, memberId: event.sourceAgentId! });
        }
      }
    }
  }
  private move(agent: VisualAgent, destination: Point): boolean {
    const door: Point = [-10.4, -4.7];
    const entering = agent.position[0] < -10.65;
    const exiting = destination[0] < -10.65;
    try {
      const route = planRoute(entering ? door : agent.position, exiting ? door : destination);
      agent.route = [...(entering ? [door] : []), ...route, ...(exiting ? [destination] : [])];
      return true;
    } catch {
      agent.route = [];
      agent.seatBlend = 0;
      return false;
    }
  }

  private clearArchive() {
    this.liveTasks = this.liveTasks.filter(task => task.state !== 'stamping');
    this.archive = null;
  }

  syncActivities(entries: OfficeActivity[]) {
    const previous = this.activityIds;
    this.activityIds = new Set(entries.map(entry => entry.id));
    if (!previous || this.simulation) return;
    for (const entry of entries) {
      if (entry.status !== 'running' || entry.employeeId == null || previous.has(entry.id)) continue;
      const slot = this.slots.get(entry.employeeId);
      if (slot !== undefined) announce(this.liveAgents[slot], 'cueWork', this.time);
    }
  }

  setSimulating(enabled: boolean) {
    if (Boolean(this.simulation) === enabled) return;
    for (const agent of this.liveAgents) agent.messages = undefined;
    this.simulation = enabled ? new OfficeSimulation(this.random) : null;
    this.simulation?.sync(this.selected, this.time);
  }

  advance(dt: number) {
    this.time += dt;
    this.simulation?.advance(this.time, dt);
    let freedSlot = false;
    if (!this.archive && this.archives.length) {
      const next = this.archives.shift()!;
      const slot = this.slots.get(next.memberId);
      if (slot !== undefined && slot !== 7 && this.move(this.liveAgents[slot], dispatch.delivery)) {
        this.archive = { taskId: next.taskId, slot, started: null };
        this.liveAgents[slot].state = 'delivering';
        this.zoneChanges[0]++;
      }
    }
    for (const agent of this.liveAgents) {
      if (agent.state === 'offline') continue;
      if (agent.route.length) {
        walkRoute(agent, dt);
        continue;
      }
      this.entering.delete(agent.id);
      if (agent.state === 'exiting') {
        agent.state = 'offline'; agent.memberId = undefined; agent.messages = undefined; freedSlot = true;
        continue;
      }
      if (this.archive?.slot === agent.id) {
        if (this.archive.started === null) {
          this.archive.started = this.time;
          agent.state = 'stamping';
          announce(agent, 'cueDeliver', this.time);
          this.liveTasks.push({
            id: this.archive.taskId, state: 'stamping', agents: [agent.id], started: this.time - 66,
            readyAt: 0, job: 0, progress: 0, history: [], rejected: false,
          });
        }
        if (this.time - this.archive.started < 4) continue;
        this.clearArchive();
        const target = this.targets.get(agent.id);
        if (target) {
          if (target.state === 'idle') this.arrivalCues.set(agent.id, 'cueRest');
          agent.state = target.state; this.move(agent, target.point);
          continue;
        }
      }
      const target = this.targets.get(agent.id);
      if (!target) continue;
      const cue = this.arrivalCues.get(agent.id);
      if (cue) {
        this.arrivalCues.delete(agent.id);
        if (!this.simulation) announce(agent, cue, this.time);
      }
      agent.seatKind = target.seatKind; agent.seatIndex = target.seatIndex;
      if (agent.seatKind) agent.seatBlend = Math.min(1, agent.seatBlend + dt * 2.5);
    }
    if (freedSlot && this.latest) this.sync(this.latest, this.selected);
  }
}
