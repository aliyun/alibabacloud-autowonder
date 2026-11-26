import type { WorkflowEdge, WorkflowNode } from './api';

export const CARD_WIDTH = 118;
export const CARD_HEIGHT = 76;
const COLUMN_GAP = 144;
const ROW_GAP = 126;
const COLUMNS = 4;
const PORT_INSET = 12;
const LANE_SPACING = 24;
const GUTTER_SPACING = 18;
const CHANNEL_MARGIN = 24;
export interface WorkflowPosition { x: number; y: number }
export interface WorkflowRoute {
  sourcePort: string;
  targetPort: string;
  /** Offset along the card edge: x for top/bottom, y for left/right. */
  sourceOffset?: number;
  targetOffset?: number;
  controlPoints: [number, number][];
}

/** Lay out the declared delivery path first, without using feedback edges as ordering constraints.
 * A bounded, deterministic cycle break also supports real configurations containing main-path cycles.
 * Both view modes use the complete graph's coordinates, so toggling never reshuffles the team. */
export function layoutWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): Record<string, WorkflowPosition> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const remaining = new Set(nodes.map(node => node.id));
  const outgoing = new Map<string, Set<string>>();
  const indegree = new Map(nodes.map(node => [node.id, 0]));
  const main = edges.filter(edge => edge.isMainPath);
  const ordering = main.length ? main : edges.filter(edge => edge.kind === 'HANDOFF');
  for (const edge of ordering) {
    if (!byId.has(edge.source) || !byId.has(edge.target) || edge.source === edge.target) continue;
    const targets = outgoing.get(edge.source) ?? new Set<string>();
    if (!targets.has(edge.target)) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    targets.add(edge.target);
    outgoing.set(edge.source, targets);
  }
  const mainIds = new Set(ordering.flatMap(edge => [edge.source, edge.target]));
  const compare = (a: string, b: string) => {
    const priority = (id: string) => mainIds.has(id) ? 0 : byId.get(id)?.kind === 'MEMBER' ? 1 : 2;
    return priority(a) - priority(b) || a.localeCompare(b);
  };
  const ordered: string[] = [];
  while (remaining.size) {
    const available = [...remaining].filter(id => indegree.get(id) === 0).sort(compare);
    const id = available[0] ?? [...remaining].sort(compare)[0];
    remaining.delete(id);
    ordered.push(id);
    for (const target of outgoing.get(id) ?? []) indegree.set(target, (indegree.get(target) ?? 0) - 1);
  }
  // Only row/column identity is needed to count channels, before assigning final coordinates.
  const provisional = Object.fromEntries(ordered.map((id, index) => [id, {
    x: (index % COLUMNS) * (CARD_WIDTH + COLUMN_GAP),
    y: Math.floor(index / COLUMNS),
  }]));
  const plan = planWorkflowRoutes(edges, provisional);
  const firstX = Math.max(122, CARD_WIDTH / 2 + CHANNEL_MARGIN
    + Math.max(0, plan.gutters.left - 1) * GUTTER_SPACING + CHANNEL_MARGIN);
  const rowYs = [Math.max(134, CARD_HEIGHT / 2 + channelDepth(plan.rows.get(0)?.top ?? 0) + CHANNEL_MARGIN)];
  for (let row = 1; row < Math.ceil(ordered.length / COLUMNS); row++) {
    // Both facing sides consume the gap, including every incident interrow edge.
    const demand = channelDepth(plan.rows.get(row - 1)?.bottom ?? 0)
      + channelDepth(plan.rows.get(row)?.top ?? 0);
    rowYs[row] = rowYs[row - 1] + CARD_HEIGHT + Math.max(ROW_GAP, demand + CHANNEL_MARGIN);
  }
  return Object.fromEntries(ordered.map((id, index) => [id, {
    x: firstX + (index % COLUMNS) * (CARD_WIDTH + COLUMN_GAP),
    y: rowYs[Math.floor(index / COLUMNS)],
  }]));
}

/** Each attachment and row-side corridor is exclusive, irrespective of edge kind.
 * Interrow routes use separate outer gutters, never a vertical leg through another card. */
export function routeWorkflowEdges(edges: WorkflowEdge[], positions: Record<string, WorkflowPosition>): Record<string, WorkflowRoute> {
  const routes: Record<string, WorkflowRoute> = Object.create(null);
  const plan = planWorkflowRoutes(edges, positions);
  if (!plan.routes.length) return routes;
  const xs = Object.values(positions).map(position => position.x);
  const left = Math.min(...xs) - CARD_WIDTH / 2;
  const right = Math.max(...xs) + CARD_WIDTH / 2;
  for (const route of plan.routes) {
    const { edge, source, target, sourcePort, targetPort, sourceOffset, targetOffset } = route;
    let controlPoints: [number, number][];
    if (route.sourceLane === undefined) {
      controlPoints = [[(source.x + target.x) / 2, source.y]];
    } else {
      const sourceY = channelY(source.y, sourcePort, route.sourceLane);
      const targetY = channelY(target.y, targetPort, route.targetLane!);
      const sourceX = source.x + sourceOffset;
      const targetX = target.x + targetOffset;
      if (route.gutterSide === undefined) {
        controlPoints = [[sourceX, sourceY], [targetX, targetY]];
      } else {
        const depth = CHANNEL_MARGIN + route.gutterLane! * GUTTER_SPACING;
        const gutterX = route.gutterSide === 'left' ? left - depth : right + depth;
        controlPoints = [[sourceX, sourceY], [gutterX, sourceY], [gutterX, targetY], [targetX, targetY]];
      }
    }
    routes[edge.id] = { sourcePort, targetPort, sourceOffset, targetOffset, controlPoints };
  }
  return routes;
}

type PortSide = 'top' | 'bottom' | 'left' | 'right';
type RowSide = 'top' | 'bottom';
interface PlannedRoute {
  edge: WorkflowEdge;
  source: WorkflowPosition;
  target: WorkflowPosition;
  sourcePort: PortSide;
  targetPort: PortSide;
  sourceOffset: number;
  targetOffset: number;
  sourceLane?: number;
  targetLane?: number;
  gutterSide?: 'left' | 'right';
  gutterLane?: number;
}

const channelDepth = (count: number) => count ? CHANNEL_MARGIN + (count - 1) * LANE_SPACING : 0;
const channelY = (y: number, side: PortSide, lane: number) =>
  y + (side === 'top' ? -1 : 1) * (CARD_HEIGHT / 2 + CHANNEL_MARGIN + lane * LANE_SPACING);

/** The same plan drives spacing and routing; sorting once makes all reservations input-order independent. */
function planWorkflowRoutes(edges: WorkflowEdge[], positions: Record<string, WorkflowPosition>) {
  const valid = [...edges].filter(edge => positions[edge.source] && positions[edge.target])
    .sort((a, b) => a.id.localeCompare(b.id));
  const pairs = new Map<string, Map<string, number>>();
  for (const edge of valid) {
    const targets = pairs.get(edge.source) ?? new Map<string, number>();
    targets.set(edge.target, (targets.get(edge.target) ?? 0) + 1);
    pairs.set(edge.source, targets);
  }
  const adjacent = (edge: WorkflowEdge) => {
    const source = positions[edge.source];
    const target = positions[edge.target];
    return source.y === target.y && target.x - source.x === CARD_WIDTH + COLUMN_GAP
      && edge.kind !== 'REWORK' && pairs.get(edge.source)?.get(edge.target) === 1;
  };
  const directSources = new Map<string, number>();
  const directTargets = new Map<string, number>();
  for (const edge of valid.filter(adjacent)) {
    directSources.set(edge.source, (directSources.get(edge.source) ?? 0) + 1);
    directTargets.set(edge.target, (directTargets.get(edge.target) ?? 0) + 1);
  }
  const rows = new Map<number, Record<RowSide, number>>();
  const gutters = { left: 0, right: 0 };
  const takeLane = (y: number, side: RowSide) => {
    const counts = rows.get(y) ?? { top: 0, bottom: 0 };
    const lane = counts[side]++;
    rows.set(y, counts);
    return lane;
  };
  type Attachment = { route: PlannedRoute; offset: 'sourceOffset' | 'targetOffset' };
  const attachments = new Map<string, Partial<Record<PortSide, Attachment[]>>>();
  const attach = (id: string, side: PortSide, route: PlannedRoute, offset: Attachment['offset']) => {
    const sides: Partial<Record<PortSide, Attachment[]>> = attachments.get(id) ?? {};
    const ports = sides[side] ?? [];
    ports.push({ route, offset });
    sides[side] = ports;
    attachments.set(id, sides);
  };
  const routes: PlannedRoute[] = [];
  for (const edge of valid) {
    const source = positions[edge.source];
    const target = positions[edge.target];
    const direct = adjacent(edge) && directSources.get(edge.source) === 1 && directTargets.get(edge.target) === 1;
    const sameRow = source.y === target.y;
    const sourcePort: PortSide = direct ? 'right' : sameRow
      ? (edge.kind === 'REWORK' || target.x <= source.x ? 'top' : 'bottom')
      : (target.y > source.y ? 'bottom' : 'top');
    const targetPort: PortSide = direct ? 'left' : sameRow ? sourcePort
      : (target.y > source.y ? 'top' : 'bottom');
    const route: PlannedRoute = { edge, source, target, sourcePort, targetPort, sourceOffset: 0, targetOffset: 0 };
    if (!direct) {
      route.sourceLane = takeLane(source.y, sourcePort as RowSide);
      route.targetLane = sameRow ? route.sourceLane : takeLane(target.y, targetPort as RowSide);
      if (!sameRow) {
        route.gutterSide = target.x < source.x ? 'left' : 'right';
        route.gutterLane = gutters[route.gutterSide]++;
      }
    }
    attach(edge.source, sourcePort, route, 'sourceOffset');
    attach(edge.target, targetPort, route, 'targetOffset');
    routes.push(route);
  }
  for (const sides of attachments.values()) {
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      const ports = sides[side] ?? [];
      const half = (side === 'top' || side === 'bottom' ? CARD_WIDTH : CARD_HEIGHT) / 2 - PORT_INSET;
      ports.forEach(({ route, offset }, index) => {
        route[offset] = ports.length === 1 ? 0 : -half + 2 * half * index / (ports.length - 1);
      });
    }
  }
  return { routes, rows, gutters };
}
