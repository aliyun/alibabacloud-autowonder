import type { Point, VisualAgent } from './visual';
import { GROUP_COLORS } from '../model';
import { dispatch, homes, waitingIndex } from './navigation.mjs';

export function createActors(): VisualAgent[] {
  return Array.from({ length: 16 }, (_, id) => ({
    id, name: '', color: GROUP_COLORS.unclassified, state: 'offline', taskId: null,
    position: [...(id === 7 ? dispatch.coordinator : homes[waitingIndex(id)])] as Point,
    route: [], walk: 0, workSeatIndex: null, seatIndex: null, seatKind: null, seatBlend: 0,
  }));
}

export function walkRoute(agent: VisualAgent, dt: number) {
  agent.seatBlend = Math.max(0, agent.seatBlend - dt * 2.5);
  if (agent.seatBlend > 0) return;
  const point = agent.route[0], dx = point[0] - agent.position[0], dz = point[1] - agent.position[1];
  const distance = Math.hypot(dx, dz), speed = dt * 3.2;
  if (distance <= speed) { agent.position = [...point]; agent.route.shift(); }
  else { agent.position[0] += dx / distance * speed; agent.position[1] += dz / distance * speed; }
  agent.walk += dt;
}
