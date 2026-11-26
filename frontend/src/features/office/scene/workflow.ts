import { GROUP_COLORS, type OfficeMember } from '../model';
import { announce, type Action } from './annotations';
import { createActors, walkRoute } from './movement';
import { decisionPoint, dispatch, homes, planRoute, workSeats } from './navigation.mjs';
import { SUPPLY_DROP_TIME, EXIT_SECONDS, DOOR_CLOSE_DELAY } from './supply.mjs';
import type { Point, VisualAgent, VisualTask } from './visual';

export type SimulationAction = 'submitted' | 'claimed' | 'delivered' | 'progress' | 'review';
export interface SimulationEvent { id: string; taskId: string; action: SimulationAction; employeeId?: number; employee: string; time: number }

type Seat = { kind: 'work' | 'waiting'; index: number };
interface Stop {
  point: Point;
  walking: string;
  activity: string;
  duration: number;
  seat?: Seat;
  cue?: Action;
  exchange?: boolean;
}
interface Track {
  stops: Stop[];
  readyAt: number;
  walking: boolean;
  arrivedAt: number | null;
}

function seated(seat: Seat): Stop {
  const work = seat.kind === 'work';
  return { point: (work ? workSeats : homes)[seat.index], seat, walking: work ? 'resuming' : 'returning',
    activity: work ? 'working' : 'idle', duration: 0, cue: work ? 'cueWork' : 'cueRest' };
}

// A session-local demonstration ledger; never writes to a backend client.
export class OfficeSimulation {
  agents = createActors();
  readonly tasks: VisualTask[] = [];
  readonly events: SimulationEvent[] = [];
  private delivered = 0;
  private submitted = false;
  private nextProgress = 0;
  get counts() {
    const pending = this.tasks.filter(task => task.state === 'pending').length;
    const active = this.tasks.filter(task => task.state !== 'pending' && task.state !== 'done').length;
    return { pending, active, done: this.delivered, total: pending + active + this.delivered };
  }
  private record(task: VisualTask, action: SimulationAction, agent?: VisualAgent) {
    this.events.unshift({ id: `${task.id}:${action}:${this.time}`, taskId: task.id, action,
      employeeId: agent?.memberId, employee: agent?.name ?? '', time: this.time });
    this.events.splice(40);
  }
  private createTask(state = 'pending', agent?: VisualAgent) {
    const task: VisualTask = { id: this.newDocument(), state, agents: agent ? [agent.id] : [],
      started: state === 'pending' ? null : this.time, readyAt: this.time, rejected: false,
      job: (this.documentNumber - 1) % 6, progress: 0, history: [] };
    this.tasks.push(task);
    if (agent) agent.taskId = task.id;
    return task;
  }
  private seats = new Map<number, Seat>();
  private tracks = new Map<number, Track>();
  private exchange: { from: number; to: number; startedAt: number | null } | null = null;
  private time = 0;
  private visitAt: number | null = null;
  private nextVisit = 0;
  private nextCollaboration = 0;
  private nextIsReview = true;
  private lastParticipant = -1;
  private documentNumber = 0;

  constructor(private readonly random: () => number) {}

  sync(members: OfficeMember[], now: number) {
    const present = this.agents.filter(agent => agent.memberId !== undefined);
    const sameRoster = members.length === present.length && members.every(member =>
      present.some(agent => agent.memberId === member.id && (agent.id === 7) === member.chief));
    if (sameRoster) {
      for (const member of members) {
        const agent = present.find(actor => actor.memberId === member.id)!;
        agent.name = member.name; agent.role = member.role;
        agent.color = GROUP_COLORS[member.group];
      }
      return;
    }
    this.agents = createActors();
    this.tasks.length = 0;
    this.events.length = 0;
    this.delivered = 0;
    this.seats.clear();
    this.tracks.clear();
    this.exchange = null;
    this.visitAt = null;
    this.time = this.nextVisit = now;
    this.nextCollaboration = now + 3 + this.random() * 4;
    this.nextIsReview = this.random() < .5;
    const employees = members.filter(member => !member.chief);
    const atWork = employees.length <= 1 ? employees.length :
      Math.min(workSeats.length, employees.length - 1, Math.round(employees.length * .8));
    // Start with actual working staff, varying assignments among equally available colleagues.
    const ranked = employees.map(member => ({ member, draw: this.random() }))
      .sort((a, b) => Number(b.member.state === 'working') - Number(a.member.state === 'working') || a.draw - b.draw);
    const atDesks = new Set(ranked.slice(0, atWork).map(({ member }) => member.id));
    let work = 0, rest = 0, slot = 0;
    for (const member of members) {
      if (slot === 7) slot++;
      const agent = this.agents[member.chief ? 7 : slot++];
      agent.memberId = member.id;
      agent.name = member.name; agent.role = member.role;
      agent.color = GROUP_COLORS[member.group];
      if (member.chief) { agent.state = 'dispatching'; continue; }
      const seat: Seat = atDesks.has(member.id) ? { kind: 'work', index: work++ } : { kind: 'waiting', index: rest++ };
      this.seats.set(agent.id, seat);
      const start = seated(seat);
      agent.position = [...start.point];
      agent.state = start.activity;
      if (seat.kind === 'work') this.createTask('working', agent);
      agent.seatKind = seat.kind;
      agent.seatIndex = seat.index;
      agent.seatBlend = 1;
    }
    if (employees.length) for (let i = 0; i < 3; i++) this.createTask();
    this.nextProgress = now + 3;
  }

  get supplyTime() {
    if (this.visitAt === null) return 20;
    return Math.min(this.time - this.visitAt, SUPPLY_DROP_TIME + EXIT_SECONDS + DOOR_CLOSE_DELAY + 1);
  }
  get deposit() {
    for (const [from, track] of this.tracks) {
      const stop = track.stops[0];
      if (stop.activity === 'delivering' && !stop.exchange && track.arrivedAt !== null)
        return { from, progress: Math.min(1, (this.time - track.arrivedAt) / stop.duration) };
    }
    return null;
  }
  get handoff() {
    if (!this.exchange || this.exchange.startedAt === null) return null;
    const progress = (this.time - this.exchange.startedAt) / 1.5;
    return progress <= 1 ? { from: this.exchange.from, to: this.exchange.to, progress } : null;
  }

  private newDocument() { return 'simulation-' + ++this.documentNumber; }

  private available(kind: Seat['kind']) {
    return this.agents.filter(agent => this.seats.get(agent.id)?.kind === kind && !this.tracks.has(agent.id));
  }
  private choose(candidates: VisualAgent[]): VisualAgent | undefined {
    if (!candidates.length) return;
    const other = candidates.filter(person => person.id !== this.lastParticipant);
    const pool = other.length ? other : candidates;
    return pool[Math.floor(this.random() * pool.length)];
  }
  private schedule(agent: VisualAgent, stops: Stop[], delay = 0) {
    this.tracks.set(agent.id, { stops, readyAt: this.time + delay, walking: false, arrivedAt: null });
  }

  private scheduleVisit() {
    const incoming = this.choose(this.available('waiting'));
    const outgoing = this.choose(this.available('work'));
    this.nextVisit = this.time + 1;
    if (this.seats.size === 0 || (this.seats.size > 1 && (!incoming || !outgoing))) return;
    if (!incoming && !outgoing) return;
    const desk = outgoing ? this.seats.get(outgoing.id)! : { kind: 'work' as const, index: 0 };
    const lounge = incoming ? this.seats.get(incoming.id)! : { kind: 'waiting' as const, index: 0 };
    if (outgoing) {
      this.seats.set(outgoing.id, lounge);
      this.schedule(outgoing, [
        { point: dispatch.delivery, walking: 'delivering', activity: 'delivering', duration: 2.4, cue: 'cueDeliver' },
        seated(lounge),
      ], incoming ? 1 + this.random() * 3 : 4);
    }
    if (incoming) {
      this.visitAt = this.time;
      this.submitted = false;
      this.seats.set(incoming.id, desk);
      const point = dispatch.pickups[Math.floor(this.random() * dispatch.pickups.length)];
      this.schedule(incoming, [
        { point, walking: 'receiving', activity: 'receiving', duration: 1.4 },
        seated(desk),
      ], SUPPLY_DROP_TIME + .4 + this.random() * 1.8);
    }
    this.nextVisit = this.time + (incoming ? 27 + this.random() * 16 : 11);
  }

  private scheduleCollaboration() {
    const workers = this.available('work');
    const lead = this.choose(workers);
    this.nextCollaboration = this.time + 1;
    if (!lead || this.exchange) return;
    const desk = this.seats.get(lead.id)!;
    const others = workers.filter(agent => agent !== lead);
    // A two-person team can exchange a shift at the sender's desk.
    const peer = this.choose(others.length ? others : this.seats.size === 2 ? this.available('waiting') : []);
    if (!this.nextIsReview && !peer && this.seats.size >= 2) return;
    if (this.nextIsReview || !peer) {
      if ([...this.tracks.values()].some(track => track.stops.some(stop => stop.activity === 'reviewing'))) return;
      this.schedule(lead, [
        { point: decisionPoint, walking: 'decision', activity: 'reviewing', duration: 4 + this.random() * 5, cue: 'cueReview' },
        seated(desk),
      ]);
      this.nextIsReview = false;
    } else {
      const peerSeat = this.seats.get(peer.id)!;
      const shiftChange = peerSeat.kind === 'waiting';
      const meetingDesk = shiftChange ? desk : peerSeat;
      const [x, z] = workSeats[meetingDesk.index];
      const standing: Stop = { point: [x, z + .62], walking: 'resuming', activity: 'exchanging', duration: 0, exchange: true };
      const sitting: Stop = { ...seated(meetingDesk), activity: 'exchanging', cue: undefined, exchange: true };
      this.exchange = { from: lead.id, to: peer.id, startedAt: null };
      this.schedule(lead, [shiftChange ? sitting : standing, seated(shiftChange ? peerSeat : desk)]);
      this.schedule(peer, [shiftChange ? standing : sitting, seated(meetingDesk)]);
      if (shiftChange) { this.seats.set(lead.id, peerSeat); this.seats.set(peer.id, desk); }
      this.nextIsReview = true;
    }
    this.lastParticipant = lead.id;
    this.nextCollaboration = this.time + 15 + this.random() * 11;
  }

  advance(now: number, dt: number) {
    this.time = now;
    if (now >= this.nextVisit) this.scheduleVisit();
    if (this.visitAt !== null && !this.submitted && now - this.visitAt >= SUPPLY_DROP_TIME) {
      this.submitted = true;
      // Replenish only as needed, so long-running displays keep a bounded queue.
      if (this.counts.pending < 4) this.record(this.createTask(), 'submitted');
    }
    if (now >= this.nextProgress) {
      this.nextProgress = now + 5;
      const agent = this.choose(this.agents.filter(actor => actor.state === 'working' && actor.taskId));
      const task = this.tasks.find(item => item.id === agent?.taskId);
      if (task && agent) this.record(task, 'progress', agent);
    }
    if (now >= this.nextCollaboration) this.scheduleCollaboration();
    for (const [slot, track] of this.tracks) {
      const agent = this.agents[slot];
      if (now < track.readyAt) continue;
      if (agent.route.length) { walkRoute(agent, dt); continue; }
      const stop = track.stops[0];
      if (!track.walking) {
        const moving = agent.position[0] !== stop.point[0] || agent.position[1] !== stop.point[1];
        if (moving && this.agents.filter(actor => actor.route.length).length >= 2) continue;
        if (moving) agent.route = planRoute(agent.position, stop.point);
        track.walking = true;
        agent.state = stop.walking;
        if (stop.walking === 'receiving') announce(agent, 'cueClaim', now);
        if (moving) continue;
      }
      if (track.arrivedAt === null) {
        track.arrivedAt = now;
        agent.state = stop.activity;
        agent.seatKind = stop.seat?.kind ?? null;
        agent.seatIndex = stop.seat?.index ?? null;
        agent.seatBlend = stop.seat ? 1 : 0;
        if (stop.activity === 'receiving' || (stop.activity === 'working' && !agent.taskId)) {
          const task = this.tasks.find(item => item.state === 'pending') ?? this.createTask();
          agent.taskId = task.id; task.state = 'working'; task.agents = [agent.id]; task.started = now;
          this.record(task, 'claimed', agent);
        }
        if (stop.activity === 'reviewing') {
          const task = this.tasks.find(item => item.id === agent.taskId);
          if (task) this.record(task, 'review', agent);
        }
        if (stop.cue) announce(agent, stop.cue, now);
      }
      if (stop.exchange && this.exchange) {
        const pair = this.exchange;
        if (pair.startedAt === null) {
          if (![pair.from, pair.to].every(id => this.tracks.get(id)?.arrivedAt != null)) continue;
          pair.startedAt = now;
          announce(this.agents[pair.from], 'cuePass', now);
          announce(this.agents[pair.to], 'cueReceive', now);
        }
        if (now - pair.startedAt < 1.5) continue;
        const other = slot === pair.from ? pair.to : pair.from;
        if (this.tracks.get(other)?.stops[0].exchange) {
          const previous = this.agents[pair.to].taskId;
          this.agents[pair.to].taskId = this.agents[pair.from].taskId;
          const task = this.tasks.find(item => item.id === this.agents[pair.from].taskId);
          if (task) task.agents = [pair.to];
          this.agents[pair.from].taskId = previous;
          const otherTask = this.tasks.find(item => item.id === previous);
          if (otherTask) otherTask.agents = [pair.from];
        } else this.exchange = null;
      }
      if (now - track.arrivedAt < stop.duration) continue;
      if (stop.activity === 'delivering') {
        const task = this.tasks.find(item => item.id === agent.taskId);
        if (task) { task.state = 'done'; task.progress = 100; this.delivered++; this.record(task, 'delivered', agent); }
        agent.taskId = null;
        while (this.tasks.length > 80) {
          const index = this.tasks.findIndex(item => item.state === 'done');
          if (index < 0) break;
          this.tasks.splice(index, 1);
        }
      }
      track.stops.shift();
      if (!track.stops.length) this.tracks.delete(slot);
      else { track.walking = false; track.arrivedAt = null; }
    }
  }
}
