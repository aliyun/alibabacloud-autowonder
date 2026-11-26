import { afterEach, expect, it, vi } from 'vitest';
import { apiClient } from '@/shared/api/client';
import { useAuthStore } from '@/shared/auth/store';
import { loadOffice } from './api';
import { activitiesFromRealtime } from './insights';
import { classifyRole, GROUP_COLORS, sceneMembers, type OfficeEvent, type OfficeMember, type OfficeSnapshot, type OfficeTask } from './model';
import { decisionPoint, homes, waitingIndex, workPositions } from './scene/navigation.mjs';
import { LiveOfficeAnimator } from './scene/visual';
import { currentAction, placeLabel } from './scene/annotations';
import { supplyPose, SUPPLY_DROP_TIME } from './scene/supply.mjs';

const worker: OfficeMember = {
  id: 11, name: 'Worker', group: 'engineering', role: '', chief: false, state: 'working',
  runningTasks: 1, workitemIds: ['25'], heartbeat: null, squads: [{ id: 10, name: 'Team' }],
};
function workitem(bucket: OfficeTask['bucket'], waiting = false): OfficeTask {
  return { id: '25', title: 'Task', bucket, waiting, assigneeId: null };
}
function snapshot(task: OfficeTask, members: OfficeMember[] = [worker]): OfficeSnapshot {
  return {
    members, partialFailure: false, updatedAt: '', events: [],
    counts: { pending: Number(task.bucket === 'pending'), active: Number(task.bucket === 'active'), done: Number(task.bucket === 'done') },
    tasks: { pending: [], active: [], done: [], [task.bucket]: [task] },
  };
}
function officeEvent(id: string, type: OfficeEvent['type'], sourceAgentId: number | null = null,
  targetAgentId: number | null = null): OfficeEvent {
  return { id, type, workitemId: 25, workitemTitle: 'Task', dispatchId: 19,
    sourceAgentId, targetAgentId, actorType: sourceAgentId ? 'AGENT' : 'HUMAN',
    actorRef: sourceAgentId, status: null, occurredAt: 1 };
}

afterEach(() => {
  vi.restoreAllMocks();
});

it('reads server totals for the three buckets and keeps a failed roster separate from tasks', async () => {
  useAuthStore.setState({ currentWorkspace: { id: 1, name: 'One', description: '' } });
  const counts: Record<string, number> = { NEW: 7, 'IN_PROGRESS,PENDING_DECISION': 11, DONE: 29 };
  const get = vi.spyOn(apiClient, 'get').mockImplementation(async (url, config) => {
    if (url !== '/api/workitems') throw new Error('Offline');
    return { data: { list: [], total: counts[(config?.params as Record<string, string>).statusCategories] } };
  });
  const signal = new AbortController().signal;
  const live = await loadOffice(1, signal);
  expect(live.counts).toEqual({ pending: 7, active: 11, done: 29 });
  expect(live.members).toBeNull();
  expect(live.partialFailure).toBe(true);
  expect(get).toHaveBeenCalledWith('/api/workitems', expect.objectContaining({
    signal, params: { statusCategories: 'DONE', page: 1, size: 16, sortBy: 'UPDATED' },
  }));
});

it('discards responses from a workspace that is no longer active', async () => {
  useAuthStore.setState({ currentWorkspace: { id: 1, name: 'One', description: '' } });
  vi.spyOn(apiClient, 'get').mockImplementation(async () => {
    useAuthStore.setState({ currentWorkspace: { id: 2, name: 'Two', description: '' } });
    return { data: [] };
  });
  await expect(loadOffice(1, new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' });
});

it('uses online executors and actual running assignments to assemble the workspace roster', async () => {
  useAuthStore.setState({ currentWorkspace: { id: 1, name: 'One', description: '' } });
  const get = vi.spyOn(apiClient, 'get').mockImplementation(async (url, config) => {
    switch (url) {
      case '/api/workitems':
        return { data: { total: 0, list: [] } };
      case '/api/agents':
        return { data: [
          { id: 11, name: 'Worker', status: 'ONLINE', squadIds: [10], squadNames: ['Team'] },
          { id: 12, name: 'Disconnected', status: 'ONLINE' },
        ] };
      case '/api/executors':
        return { data: [
          { agentId: 11, status: 'ONLINE', lastHeartbeat: '2026-11-18T03:00:00Z' },
          { agentId: 11, status: 'ONLINE', lastHeartbeat: '2026-11-18T03:10:00Z' },
          { agentId: 12, status: 'OFFLINE', lastHeartbeat: '2026-11-18T03:10:00Z' },
        ] };
      case '/api/office/activity':
        return { data: { generatedAt: 1, events: [], agents: [
          { agentId: 11, state: 'WORKING', online: true, runningTasks: 1, workitemIds: [25] },
        ] } };
      default:
        throw new Error(`Unexpected request: ${url} ${(config?.params as Record<string, unknown>)?.page ?? ''}`);
    }
  });
  const live = await loadOffice(1, new AbortController().signal);
  expect(live.partialFailure).toBe(false);
  expect(live.members).toEqual([expect.objectContaining({
    id: 11, name: 'Worker', state: 'working', runningTasks: 1, workitemIds: ['25'],
    heartbeat: '2026-11-18T03:10:00Z', squads: [{ id: 10, name: 'Team' }],
  })]);
  expect(get).toHaveBeenCalledWith('/api/agents', expect.objectContaining({ params: { status: 'ONLINE', page: 1, size: 100 } }));
  expect(get).not.toHaveBeenCalledWith('/api/dashboard/agents/11/running', expect.anything());
});

it('selects fixed-size scene pages and keeps the real coordinator separate', () => {
  const roster = Array.from({ length: 31 }, (_, id) => ({ ...worker, id, chief: id === 0 }));
  expect(sceneMembers(roster, null, 1).visible.map(member => member.id)).toEqual(roster.slice(0, 16).map(member => member.id));
  expect(sceneMembers(roster, 10, 2).visible.map(member => member.id)).toEqual([0, ...roster.slice(16).map(member => member.id)]);
  expect(sceneMembers(roster, 99, 1).visible).toEqual([]);
});

it('routes an observed review and confirmed completion without advancing server state', () => {
  const visual = new LiveOfficeAnimator();
  visual.sync(snapshot(workitem('active')), [worker]);
  const idle: OfficeMember = { ...worker, state: 'idle', runningTasks: 0, workitemIds: [] };
  visual.sync(snapshot(workitem('active', true), [idle]), [idle]);
  const actor = visual.agents.find(agent => agent.memberId === idle.id)!;
  expect(actor.state).toBe('decision');
  expect(actor.route.length).toBeGreaterThan(0);
  visual.advance(0.05);
  const complete = snapshot(workitem('done'), [idle]);
  complete.events = [officeEvent('delivered', 'STEP_COMPLETED', worker.id)];
  visual.sync(complete, [idle]);
  expect(visual.counts.done).toBe(1);
  visual.advance(0.05);
  expect(actor.state).toBe('delivering');
  for (let frame = 0; frame < 500; frame++) visual.advance(0.05);
  expect(actor.state).toBe('idle');
  expect(actor.position).toEqual(homes[waitingIndex(actor.id)]);
  expect(visual.tasks).toHaveLength(0);
  expect(complete.tasks.done?.[0].bucket).toBe('done');
});

it('places a confirmed reviewer at the decision table on first load', () => {
  const visual = new LiveOfficeAnimator();
  const reviewer: OfficeMember = { ...worker, state: 'waiting', runningTasks: 0, workitemIds: [] };
  const review = { ...workitem('active', true), assigneeId: String(reviewer.id) };
  visual.sync(snapshot(review, [reviewer]), [reviewer]);
  const actor = visual.agents.find(agent => agent.memberId === reviewer.id);
  expect(actor?.state).toBe('decision');
  expect(actor?.position).toEqual(decisionPoint);
});

it('keeps every working employee in the work area when all twelve chairs are in use', () => {
  const visual = new LiveOfficeAnimator();
  const members = Array.from({ length: 15 }, (_, i) => ({ ...worker, id: i + 1 }));
  visual.sync(snapshot(workitem('active'), members), members);
  const visible = visual.agents.filter(agent => agent.memberId != null);
  expect(visible.map(agent => agent.position)).toEqual(workPositions);
  expect(visible.filter(agent => agent.seatKind === 'work')).toHaveLength(12);
});

it('does not replay completed work on first load or invent transitions from unknown data', () => {
  const visual = new LiveOfficeAnimator();
  visual.sync(snapshot(workitem('done')), [worker]);
  visual.advance(0.1);
  expect(visual.tasks).toHaveLength(0);
  expect(visual.agents.some(agent => agent.state === 'delivering')).toBe(false);
});

it('animates only newly observed durable visitor, HITL and agent handoff events', () => {
  const visual = new LiveOfficeAnimator();
  const target = { ...worker, id: 22, name: 'Target', group: 'testing' as const };
  const members = [worker, target];
  const initial = snapshot(workitem('active'), members);
  visual.sync(initial, members);

  const changed = snapshot(workitem('active'), members);
  changed.events = [
    officeEvent('created', 'WORKITEM_CREATED'),
    officeEvent('hitl', 'HITL_REQUESTED', worker.id),
    officeEvent('handoff', 'AGENT_HANDOFF', worker.id, target.id),
  ];
  visual.sync(changed, members);
  expect(supplyPose(visual.supplyTime).visible).toBe(true);
  expect(visual.peerHandoff).toMatchObject({ progress: 0 });
  expect(visual.agents.find(agent => agent.memberId === worker.id)?.messages?.map(message => message.action))
    .toEqual(['cueReview', 'cuePass']);
  expect(visual.agents.find(agent => agent.memberId === target.id)?.messages?.map(message => message.action))
    .toEqual(['cueReceive']);

  visual.sync({ ...changed }, members);
  expect(visual.agents.find(agent => agent.memberId === worker.id)?.messages).toHaveLength(2);
});

it('orders activity by occurrence and treats finishing an execution as a new event', () => {
  const running = {
    dispatchId: 19, agentId: 11, agentName: worker.name, workitemId: 25, workitemTitle: 'Task',
    stepName: null, runningMinutes: 12,
  };
  const generatedAt = '2026-11-18T03:15:00Z';
  const initial = activitiesFromRealtime({
    generatedAt, runningFeed: [running],
    recentFeed: [
      { dispatchId: 17, agentName: null, workitemTitle: 'Earlier task', status: 'FAILED',
        durationMinutes: 8, finishedAt: '2026-11-18 11:00:00' },
      { dispatchId: 18, agentName: null, workitemTitle: 'Later task', status: 'SUCCEEDED',
        durationMinutes: 2, finishedAt: '2026-11-18 11:10:00' },
    ],
  });
  expect(initial.map(entry => entry.id)).toEqual(['18:SUCCEEDED', '19:running', '17:FAILED']);
  const finished = activitiesFromRealtime({
    generatedAt, runningFeed: [],
    recentFeed: [{ dispatchId: 19, agentName: worker.name, workitemTitle: 'Task', status: 'SUCCEEDED',
      durationMinutes: 12, finishedAt: '2026-11-18 11:14:00' }],
  });
  expect(finished[0]).toMatchObject({ id: '19:SUCCEEDED', occurredAt: Date.parse('2026-11-18T03:14:00Z') });
});

it('retains seats across refreshes and moves the first waiting employee into a vacated seat', () => {
  const visual = new LiveOfficeAnimator();
  const resting = Array.from({ length: 14 }, (_, i) => ({ ...worker, id: 200 + i, state: 'idle' as const }));
  const first = snapshot(workitem('pending'), resting);
  visual.sync(first, resting);
  const occupied = () => visual.agents.filter(agent => agent.seatKind === 'waiting');
  expect(occupied()).toHaveLength(12);
  const firstSeat = occupied()[0].seatIndex;
  const stableSeat = occupied()[1].seatIndex;
  const changed: OfficeMember[] = resting.map((member, i) => i ? member : { ...member, state: 'working' });
  visual.sync(snapshot(workitem('active'), changed), changed);
  for (let i = 0; i < 600; i++) visual.advance(0.05);
  expect(occupied()).toHaveLength(12);
  expect(occupied().find(a => a.memberId === 212)?.seatIndex).toBe(firstSeat);
  expect(occupied().find(a => a.memberId === 201)?.seatIndex).toBe(stableSeat);
});

it('uses distinct workspace role colours', () => {
  const groups = ['AW_FS_DEV', 'AW_QA', 'chief_of_staff', 'AW_REQ_CLARIFIER', 'custom'].map(classifyRole);
  expect(new Set(groups.map(group => GROUP_COLORS[group])).size).toBe(5);
  expect(classifyRole('PM_PRODUCT')).toBe('product');
});

it('varies the work, decisions and handoffs while keeping real data and the rest of the team in place', () => {
  let seed = 17;
  const visual = new LiveOfficeAnimator(() => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  });
  const members = Array.from({ length: 7 }, (_, i) => ({ ...worker, id: 40 + i, state: 'idle' as const }));
  const source = snapshot(workitem('pending'), members);
  source.counts = { pending: 94, active: 115, done: 645 };
  visual.sync(source, members);
  const seats = visual.agents.filter(a => a.memberId != null).map(a => [...a.position]);
  visual.setSimulating(true);
  const present = visual.agents.filter(a => a.memberId != null);
  const walkers = new Set<number>(), activities = new Set<string>();
  let peakWalking = 0, exchanges = 0, exchanging = false;
  let worstDistance = 0;
  for (let i = 0; i < 4800; i++) {
    if (i === 150) visual.sync({ ...source, counts: { ...source.counts, done: 646 } }, members);
    visual.advance(.05);
    const moving = present.filter(agent => agent.route.length);
    peakWalking = Math.max(peakWalking, moving.length);
    for (const agent of moving) walkers.add(agent.id);
    for (const agent of present) activities.add(agent.state);
    const pass = visual.peerHandoff;
    if (pass) {
      const a = visual.agents[pass.from], b = visual.agents[pass.to];
      expect(a.route).toHaveLength(0);
      expect(b.route).toHaveLength(0);
      expect(a.memberId).not.toBe(b.memberId);
      worstDistance = Math.max(worstDistance, Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]));
      if (!exchanging) exchanges++;
    }
    exchanging = !!pass;
  }
  expect(exchanges).toBeGreaterThan(0);
  expect(worstDistance).toBeLessThan(1);
  expect(walkers.size).toBeGreaterThan(2);
  expect(peakWalking).toBe(2);
  expect([...activities]).toEqual(expect.arrayContaining(['working', 'reviewing', 'delivering']));
  expect(visual.counts.done).toBeGreaterThan(0);
  expect(visual.tasks.length).toBeGreaterThan(0);
  visual.setSimulating(false);
  expect(visual.counts).toMatchObject({ pending: 94, active: 115, done: 646 });
  for (let i = 0; i < 1200; i++) visual.advance(.05);
  expect(visual.agents.filter(a => a.memberId != null).map(agent => agent.position)).toEqual(seats);
  expect(source.tasks.pending).toEqual([workitem('pending')]);
});

it('interrupts a peer handoff when a participant leaves and continues with the remaining employee', () => {
  const visual = new LiveOfficeAnimator(() => .99);
  const members = [worker, { ...worker, id: 22, group: 'testing' as const, state: 'idle' as const }];
  const source = snapshot(workitem('pending'), members);
  visual.sync(source, members);
  visual.setSimulating(true);
  for (let i = 0; i < 1000 && !visual.peerHandoff; i++) visual.advance(.05);
  expect(visual.peerHandoff).toBeTruthy();
  visual.sync(snapshot(workitem('active'), [worker]), [worker]);
  expect(visual.peerHandoff).toBeNull();
  const states = new Set<string>();
  for (let i = 0; i < 2400; i++) {
    visual.advance(.05);
    states.add(visual.agents.find(a => a.memberId === worker.id)!.state);
    expect(visual.peerHandoff).toBeNull();
  }
  expect(states).toContain('working');
  expect(states).toContain('reviewing');
  expect(states).toContain('receiving');
  expect(visual.agents.filter(a => a.state !== 'offline')).toHaveLength(1);
  visual.setSimulating(false);
});

it('gives the real assignee time to read both claim and work without replaying a refresh or initial load', () => {
  const visual = new LiveOfficeAnimator();
  const idle = { ...worker, workitemIds: [], state: 'idle' as const };
  const initial = snapshot(workitem('pending'), [idle]);
  visual.sync(initial, [idle]);
  const agent = visual.agents.find(a => a.memberId === worker.id)!;
  expect(currentAction(agent, 0)).toBeUndefined();
  const next = snapshot({ ...workitem('active'), assigneeId: String(worker.id) }, [worker]);
  next.events = [
    officeEvent('assigned', 'AGENT_ASSIGNED', null, worker.id),
    officeEvent('started', 'DISPATCH_STARTED', null, worker.id),
  ];
  visual.sync(next, [worker]);
  expect(currentAction(agent, 0)).toBe('cueClaim');
  expect(currentAction(agent, 3.9)).toBe('cueClaim');
  expect(currentAction(agent, 4)).toBe('cueWork');
  visual.sync({ ...next }, [worker]);
  expect(agent.messages).toHaveLength(2);
  expect(currentAction(agent, 8)).toBeUndefined();
  const reopened = new LiveOfficeAnimator();
  reopened.sync(next, [worker]);
  expect(reopened.agents.every(a => !a.messages?.length)).toBe(true);
});

it('places simultaneous speech bubbles inside the viewport and clear of faces and other bubbles', () => {
  for (const width of [320, 1280, 1920]) {
    const face = { x: width - 29, y: 117, w: 20, h: 20 };
    const first = placeLabel(width - 10, 125, 123, 44, width, 330, [face])!;
    const second = placeLabel(width - 22, 127, 124, 44, width, 330, [face, first])!;
    for (const box of [first, second]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(width);
      expect(box.y + box.h <= face.y || box.x + box.w <= face.x || box.y >= face.y + face.h || box.x >= face.x + face.w).toBe(true);
    }
    expect(second.y + second.h <= first.y || second.x + second.w <= first.x ||
      first.y + first.h <= second.y || first.x + first.w <= second.x).toBe(true);
  }
});

it('starts four of five employees at desks and keeps actual roles and the coordinator with separate demo counts', () => {
  const team = Array.from({ length: 5 }, (_, i) => ({ ...worker, id: i + 1, name: 'Employee ' + i, state: 'idle' as const }));
  const chief = { ...worker, id: 6, name: 'Lead', chief: true, group: 'management' as const };
  const members = [chief, ...team];
  const source = snapshot(workitem('done'), members);
  const visual = new LiveOfficeAnimator();
  visual.setSimulating(true); // Wall displays can start before the first API response.
  visual.sync(source, members);
  const actors = visual.agents.filter(agent => agent.memberId != null);
  expect(actors.map(a => [a.memberId, a.name, a.color]).sort()).toEqual(
    members.map(m => [m.id, m.name, GROUP_COLORS[m.group]]).sort());
  expect(actors.filter(a => a.seatKind === 'work' && a.state === 'working')).toHaveLength(4);
  expect(actors.filter(a => a.seatKind === 'waiting' && a.state === 'idle')).toHaveLength(1);
  expect(actors.filter(a => a.route.length)).toHaveLength(0);
  expect(new Set(actors.map(a => String(a.position))).size).toBe(6);
  expect(visual.agents[7].state).toBe('dispatching');
  expect(visual.counts).toMatchObject({ pending: 3, active: 4, done: 0 });
});

it('stages a visitor before a lounge claim even with zero pending, swaps shifts and restores live state', () => {
  const visual = new LiveOfficeAnimator(() => .3);
  const members = Array.from({ length: 5 }, (_, i) => ({ ...worker, id: 30 + i, state: 'idle' as const, workitemIds: [] }));
  const source = snapshot(workitem('done'), members);
  visual.sync(source, members);
  visual.setSimulating(true);
  const resting = visual.agents.find(a => a.state === 'idle')!;
  let submitted = false, claimed = false, started = false, courier: number | undefined, rested = false, restCue = false;
  for (let i = 0; i < 600; i++) {
    visual.advance(.05);
    const visitor = supplyPose(visual.supplyTime);
    if (i === 0) expect(visitor.visible && visitor.carrying).toBe(true);
    if (visitor.visible && visitor.phase >= SUPPLY_DROP_TIME) submitted = true;
    if (currentAction(resting, visual.time) === 'cueClaim') {
      expect(submitted).toBe(true);
      claimed = true;
    }
    if (currentAction(resting, visual.time) === 'cueWork') {
      expect(claimed).toBe(true);
      expect(resting.seatKind).toBe('work');
      started = true;
    }
    if (visual.previewDeposit) courier = visual.previewDeposit.from;
    if (courier != null && visual.agents[courier].state === 'idle') {
      expect(visual.agents[courier].seatKind).toBe('waiting');
      rested = true;
      if (currentAction(visual.agents[courier], visual.time) === 'cueRest') restCue = true;
    }
  }
  expect([submitted, claimed, started, rested, restCue]).toEqual([true, true, true, true, true]);
  expect(courier).not.toBe(resting.id);
  expect(visual.counts.done).toBeGreaterThan(0);
  expect(visual.simulationData?.events.some(event => event.action === 'claimed')).toBe(true);
  expect(source.members?.every(m => m.state === 'idle')).toBe(true);
  visual.setSimulating(false);
  expect(visual.counts).toMatchObject(source.counts);
  expect(visual.simulationData).toBeNull();
  expect(visual.agents.filter(a => a.state === 'idle')).toHaveLength(members.length);
  expect(visual.agents.every(a => currentAction(a, visual.time) === undefined)).toBe(true);
  expect(supplyPose(visual.supplyTime).visible).toBe(false);
});

it.each([1, 2, 5, 15])('keeps simulated tasks and events consistent for a team of %i without changing real data', size => {
  const visual = new LiveOfficeAnimator(() => .3);
  const members = Array.from({ length: size }, (_, i) => ({ ...worker, id: 30 + i }));
  const source = snapshot(workitem('pending'), members);
  const original = JSON.stringify(source);
  visual.sync(source, members);
  visual.setSimulating(true);
  let claims = 0, deliveries = 0;
  const seen = new Set<string>();
  for (let i = 0; i < 9000; i++) {
    visual.advance(.1);
    const ledger = visual.simulationData!;
    expect(visual.counts.pending).toBe(visual.tasks.filter(task => task.state === 'pending').length);
    expect(visual.counts.active).toBe(visual.tasks.filter(task => !['pending', 'done'].includes(task.state)).length);
    expect(visual.counts.total).toBe(visual.counts.pending! + visual.counts.active! + visual.counts.done!);
    const active = visual.tasks.filter(task => !['pending', 'done'].includes(task.state));
    for (const task of active) expect(visual.agents.some(agent => agent.taskId === task.id)).toBe(true);
    for (const event of ledger.events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      if (event.action === 'claimed') claims++;
      if (event.action === 'delivered') deliveries++;
    }
    expect(ledger.events.length).toBeLessThanOrEqual(40);
    expect(visual.tasks.length).toBeLessThanOrEqual(80);
    if (i % 150 === 0) visual.sync(source, members);
  }
  expect(claims).toBeGreaterThan(3);
  expect(deliveries).toBeGreaterThan(3);
  expect(visual.counts.done).toBe(deliveries);
  expect(JSON.stringify(source)).toBe(original);
  visual.setSimulating(false);
  expect(visual.counts).toMatchObject(source.counts);
});

it('shows no simulated staff or visitor for an empty or coordinator-only floor', () => {
  const visual = new LiveOfficeAnimator();
  visual.setSimulating(true);
  for (const members of [[], [{ ...worker, chief: true }]]) {
    visual.sync(snapshot(workitem('pending'), members), members);
    for (let i = 0; i < 300; i++) visual.advance(.1);
    expect(visual.agents.filter(a => a.state !== 'offline')).toHaveLength(members.length);
    expect(supplyPose(visual.supplyTime).visible).toBe(false);
    expect(visual.peerHandoff).toBeNull();
  }
});

it('transfers the same simulated document and keeps seats exclusive on a full floor', () => {
  let seed = 1108;
  const visual = new LiveOfficeAnimator(() => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const team = Array.from({ length: 15 }, (_, i) => ({ ...worker, id: i + 1 }));
  visual.sync(snapshot(workitem('active'), team), team);
  visual.setSimulating(true);
  expect(visual.agents.filter(a => a.seatKind === 'work')).toHaveLength(12);
  let transfer: { from: number; to: number; file: string } | undefined;
  let passed = 0;
  for (let i = 0; i < 3600; i++) {
    visual.advance(.1);
    const pass = visual.peerHandoff;
    if (pass && !transfer) {
      const file = visual.agents[pass.from].taskId;
      expect(file).toMatch(/^simulation-/);
      transfer = { from: pass.from, to: pass.to, file: file! };
    }
    if (transfer && !pass) {
      expect(visual.agents[transfer.to].taskId).toBe(transfer.file);
      expect(visual.agents[transfer.from].taskId).not.toBe(transfer.file);
      transfer = undefined;
      passed++;
    }
    const occupied = visual.agents.filter(a => a.seatKind && a.seatBlend > 0);
    const seats = new Set(occupied.map(a => a.seatKind + '-' + a.seatIndex));
    expect(seats.size).toBe(occupied.length);
  }
  expect(passed).toBeGreaterThan(3);
});
