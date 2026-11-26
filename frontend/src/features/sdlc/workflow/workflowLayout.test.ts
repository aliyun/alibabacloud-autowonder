import { describe, expect, it } from 'vitest';
import type { WorkflowEdge, WorkflowNode } from './api';
import {
  layoutWorkflow, routeWorkflowEdges, CARD_WIDTH, CARD_HEIGHT,
  type WorkflowPosition, type WorkflowRoute,
} from './workflowLayout';

const node = (id: string): WorkflowNode => ({ id, label: id, kind: 'MEMBER', agentId: id, responsibility: id });
const edge = (id: string, source: string, target: string, kind: WorkflowEdge['kind'] = 'HANDOFF'): WorkflowEdge => ({
  id, source, target, kind, condition: id, isMainPath: kind === 'HANDOFF',
});
type Point = [number, number];
const EPSILON = 1e-7;
const intervalOverlap = (a: number, b: number, c: number, d: number) =>
  Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d));

function portPoint(position: WorkflowPosition, side: string, offset = 0): Point {
  switch (side) {
    case 'top': return [position.x + offset, position.y - CARD_HEIGHT / 2];
    case 'bottom': return [position.x + offset, position.y + CARD_HEIGHT / 2];
    case 'left': return [position.x - CARD_WIDTH / 2, position.y + offset];
    case 'right': return [position.x + CARD_WIDTH / 2, position.y + offset];
    default: throw new Error(`Unexpected port: ${side}`);
  }
}

/** Include the renderer's port-to-control-point legs, not just the horizontal corridors. */
function assertClearRoutes(
  edges: WorkflowEdge[],
  positions: Record<string, WorkflowPosition>,
  routes: Record<string, WorkflowRoute>,
) {
  const segments: { edgeId: string; from: Point; to: Point }[] = [];
  const attachments = new Map<string, { half: number; offsets: number[] }>();
  const attach = (id: string, side: string, offset = 0) => {
    const key = `${id}:${side}`;
    const ports: { half: number; offsets: number[] } = attachments.get(key) ?? {
      half: (side === 'top' || side === 'bottom' ? CARD_WIDTH : CARD_HEIGHT) / 2 - 12,
      offsets: [],
    };
    ports.offsets.push(offset);
    attachments.set(key, ports);
  };
  for (const e of edges) {
    const route = routes[e.id];
    expect(route, e.id).toBeDefined();
    attach(e.source, route.sourcePort, route.sourceOffset);
    attach(e.target, route.targetPort, route.targetOffset);
    const points = [
      portPoint(positions[e.source], route.sourcePort, route.sourceOffset),
      ...route.controlPoints,
      portPoint(positions[e.target], route.targetPort, route.targetOffset),
    ];
    for (const point of points) {
      expect(point.every(Number.isFinite), e.id).toBe(true);
      expect(Math.min(...point), `${e.id} has negative bounds`).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1];
      const to = points[i];
      const horizontal = Math.abs(from[1] - to[1]) < EPSILON;
      const vertical = Math.abs(from[0] - to[0]) < EPSILON;
      expect(horizontal || vertical, `${e.id} must be orthogonal`).toBe(true);
      if (horizontal && vertical) continue;
      segments.push({ edgeId: e.id, from, to });
      for (const [id, position] of Object.entries(positions)) {
        const intersects = horizontal
          ? from[1] > position.y - CARD_HEIGHT / 2 + EPSILON
            && from[1] < position.y + CARD_HEIGHT / 2 - EPSILON
            && intervalOverlap(from[0], to[0], position.x - CARD_WIDTH / 2, position.x + CARD_WIDTH / 2) > EPSILON
          : from[0] > position.x - CARD_WIDTH / 2 + EPSILON
            && from[0] < position.x + CARD_WIDTH / 2 - EPSILON
            && intervalOverlap(from[1], to[1], position.y - CARD_HEIGHT / 2, position.y + CARD_HEIGHT / 2) > EPSILON;
        expect(intersects, `${e.id} crosses card ${id}`).toBe(false);
      }
    }
  }
  // Perpendicular crossings and endpoint touches are permitted, positive-length sharing is not.
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];
      const horizontal = Math.abs(a.from[1] - a.to[1]) < EPSILON
        && Math.abs(b.from[1] - b.to[1]) < EPSILON;
      const vertical = Math.abs(a.from[0] - a.to[0]) < EPSILON
        && Math.abs(b.from[0] - b.to[0]) < EPSILON;
      const overlaps = (horizontal && Math.abs(a.from[1] - b.from[1]) < EPSILON
        && intervalOverlap(a.from[0], a.to[0], b.from[0], b.to[0]) > EPSILON)
        || (vertical && Math.abs(a.from[0] - b.from[0]) < EPSILON
          && intervalOverlap(a.from[1], a.to[1], b.from[1], b.to[1]) > EPSILON);
      expect(overlaps, `${a.edgeId} and ${b.edgeId} share a collinear segment`).toBe(false);
    }
  }
  for (const [key, { half, offsets }] of attachments) {
    expect(new Set(offsets).size, `${key} must have distinct attachments`).toBe(offsets.length);
    const sorted = [...offsets].sort((a, b) => a - b);
    expect(sorted.every(offset => Math.abs(offset) <= half + EPSILON), key).toBe(true);
    if (sorted.length === 1) {
      expect(sorted[0], key).toBe(0);
    } else {
      expect(sorted[0], key).toBeCloseTo(-half);
      expect(sorted[sorted.length - 1], key).toBeCloseTo(half);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i] - sorted[i - 1], key).toBeCloseTo(2 * half / (sorted.length - 1));
      }
    }
  }
}

describe('workflow presentation layout', () => {
  it('keeps a long delivery chain in readable rows rather than shrinking a single line', () => {
    const nodes = Array.from({ length: 18 }, (_, i) => node(String(i).padStart(2, '0')));
    const edges = nodes.slice(1).map((n, i) => edge(String(i), nodes[i].id, n.id));
    const positions = layoutWorkflow(nodes, edges);
    expect(new Set(Object.values(positions).map(p => p.x)).size).toBeLessThanOrEqual(4);
    expect(new Set(Object.values(positions).map(p => `${p.x},${p.y}`)).size).toBe(nodes.length);
    expect(positions['01'].x - positions['00'].x - CARD_WIDTH).toBe(144);
    for (const p of Object.values(positions)) expect(Number.isFinite(p.x + p.y)).toBe(true);
    assertClearRoutes(edges, positions, routeWorkflowEdges(edges, positions));
  });

  it('is stable across input ordering, including cycles and parallel branches', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(node);
    const edges = [edge('ab', 'a', 'b'), edge('ba', 'b', 'a'), edge('bc', 'b', 'c'), edge('bd', 'b', 'd')];
    const layout = layoutWorkflow(nodes, edges);
    expect(layout).toEqual(layoutWorkflow([...nodes].reverse(), [...edges].reverse()));
    const positions = Object.values(layout);
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
      expect(Math.abs(positions[i].x - positions[j].x) >= CARD_WIDTH
        || Math.abs(positions[i].y - positions[j].y) >= CARD_HEIGHT).toBe(true);
    }
    const routes = routeWorkflowEdges(edges, layout);
    expect(routes).toEqual(routeWorkflowEdges([...edges].reverse(), layout));
    assertClearRoutes(edges, layout, routes);
  });

  it('routes rework outside the member row and separates parallel transitions', () => {
    const nodes = ['a', 'b', 'c'].map(node);
    const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('back', 'c', 'a', 'REWORK'), edge('ab2', 'a', 'b')];
    const positions = layoutWorkflow(nodes, edges);
    const routes = routeWorkflowEdges(edges, positions);
    expect(routes.back.sourcePort).toBe('top');
    expect(routes.back.controlPoints.some(p => p[1] < positions.a.y - CARD_HEIGHT / 2)).toBe(true);
    expect(routes.ab.sourcePort).toBe('bottom');
    expect(routes.ab.controlPoints).not.toEqual(routes.ab2.controlPoints);
    assertClearRoutes(edges, positions, routes);
  });

  it('keeps dense feedback lanes clear of the preceding row of cards', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => node(String(i)));
    const edges = nodes.slice(1).map((n, i) => edge('chain-' + i, nodes[i].id, n.id));
    const feedback = Array.from({ length: 20 }, (_, i) => edge('feedback-' + String(i).padStart(2, '0'), '5', '4', 'REWORK'));
    edges.push(...feedback);
    const positions = layoutWorkflow(nodes, edges);
    const routes = routeWorkflowEdges(edges, positions);
    const ys = feedback.map(e => routes[e.id].controlPoints[0][1]).sort((a, b) => a - b);
    expect(new Set(ys).size).toBe(feedback.length);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBe(24);
    for (const routeY of ys) {
      for (const n of nodes.slice(0, 4)) expect(Math.abs(routeY - positions[n.id].y)).toBeGreaterThan(CARD_HEIGHT / 2);
    }
    expect(positions).toEqual(layoutWorkflow([...nodes].reverse(), [...edges].reverse()));
    expect(routes).toEqual(routeWorkflowEdges([...edges].reverse(), positions));
    assertClearRoutes(edges, positions, routes);
  });

  it('separates mixed-kind same-row corridors without a five-lane cap', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(node);
    const kinds: WorkflowEdge['kind'][] = ['REWORK', 'ESCALATION', 'HANDOFF'];
    const extra = Array.from({ length: 10 }, (_, i) => ({
      ...edge('mixed-' + i, i % 2 ? 'd' : 'c', i % 3 ? 'b' : 'a', kinds[i % kinds.length]),
      isMainPath: false,
    }));
    const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('cd', 'c', 'd'), ...extra];
    const positions = layoutWorkflow(nodes, edges);
    const routes = routeWorkflowEdges(edges, positions);
    const ys = extra.map(e => routes[e.id].controlPoints[0][1]).sort((a, b) => a - b);
    expect(new Set(ys).size).toBe(extra.length);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBe(24);
    assertClearRoutes(edges, positions, routes);
  });

  it('sizes facing row gaps from distinct incident channels rather than only parallel pairs', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => node(String(i)));
    const chain = nodes.slice(1).map((n, i) => edge('chain-' + i, nodes[i].id, n.id));
    const extra = nodes.slice(0, 4).flatMap(source => nodes.slice(4).map(target =>
      edge(`cross-${source.id}-${target.id}`, source.id, target.id, 'REWORK')));
    const sparse = layoutWorkflow(nodes, chain);
    const edges = [...chain, ...extra];
    const positions = layoutWorkflow(nodes, edges);
    const routes = routeWorkflowEdges(edges, positions);
    expect(positions['4'].y - positions['0'].y).toBeGreaterThan(sparse['4'].y - sparse['0'].y);
    const interrow = edges.filter(e => positions[e.source].y !== positions[e.target].y);
    const sourceYs = interrow.map(e => routes[e.id].controlPoints[0][1]);
    const targetYs = interrow.map(e => routes[e.id].controlPoints[3][1]);
    expect(Math.min(...targetYs) - Math.max(...sourceYs)).toBe(24);
    for (const side of ['left', 'right']) {
      const xs = interrow.filter(e => (positions[e.target].x < positions[e.source].x ? 'left' : 'right') === side)
        .map(e => routes[e.id].controlPoints[1][0]).sort((a, b) => a - b);
      expect(xs.length).toBeGreaterThan(1);
      expect(new Set(xs).size).toBe(xs.length);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBe(18);
    }
    assertClearRoutes(edges, positions, routes);
  });

  it('uses distinct inset ports and legs for multiple self loops', () => {
    const nodes = ['a', 'b', 'c'].map(node);
    const loops = [
      edge('loop-a1', 'a', 'a', 'REWORK'),
      { ...edge('loop-a2', 'a', 'a'), isMainPath: false },
      edge('loop-b', 'b', 'b', 'ESCALATION'),
      edge('loop-c', 'c', 'c', 'REWORK'),
    ];
    const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('back', 'c', 'a', 'REWORK'), ...loops];
    const positions = layoutWorkflow(nodes, edges);
    const routes = routeWorkflowEdges(edges, positions);
    for (const loop of loops) {
      const route = routes[loop.id];
      expect(route.sourceOffset).not.toBe(route.targetOffset);
      expect(route.controlPoints[0][0]).not.toBe(route.controlPoints[1][0]);
    }
    expect(positions).toEqual(layoutWorkflow([...nodes].reverse(), [...edges].reverse()));
    expect(routes).toEqual(routeWorkflowEdges([...edges].reverse(), positions));
    assertClearRoutes(edges, positions, routes);
  });

  it('keeps exclusive adjacent handoffs direct and routes an additional transition separately', () => {
    const nodes = ['a', 'b'].map(node);
    const handoff = edge('ab', 'a', 'b');
    const positions = layoutWorkflow(nodes, [handoff]);
    const direct = routeWorkflowEdges([handoff], positions);
    expect(direct.ab.sourcePort).toBe('right');
    expect(direct.ab.targetPort).toBe('left');
    expect(direct.ab.sourceOffset).toBe(0);
    expect(direct.ab.targetOffset).toBe(0);
    assertClearRoutes([handoff], positions, direct);
    const edges = [handoff, edge('feedback', 'a', 'b', 'REWORK')];
    const parallelPositions = layoutWorkflow(nodes, edges);
    const parallel = routeWorkflowEdges(edges, parallelPositions);
    expect(parallel.ab.sourcePort).toBe('bottom');
    expect(parallel.feedback.sourcePort).toBe('top');
    assertClearRoutes(edges, parallelPositions, parallel);
  });

  it('keeps the nine-node seeded all-path topology free of shared legs and card intersections', () => {
    // Topology from target/local-dev/squad-workflow-seed-20261120.sql, without private labels/content.
    const nodes: WorkflowNode[] = [
      ...['req', 'dev', 'cr', 'qa', 'conflict', 'deploy', 'pm'].map(node),
      { ...node('human'), kind: 'HUMAN', agentId: null },
      { ...node('aone'), kind: 'EXTERNAL', agentId: null },
    ];
    const edges = [
      edge('e1', 'req', 'dev'),
      edge('e2', 'dev', 'cr'),
      edge('e3', 'cr', 'qa'),
      edge('e4', 'qa', 'deploy'),
      { ...edge('e5', 'deploy', 'human', 'ESCALATION'), isMainPath: true },
      edge('e6', 'human', 'aone'),
      edge('e7', 'cr', 'dev', 'REWORK'),
      edge('e8', 'qa', 'dev', 'REWORK'),
      edge('e9', 'dev', 'conflict', 'ESCALATION'),
      { ...edge('e10', 'conflict', 'dev'), isMainPath: false },
      edge('e11', 'qa', 'pm', 'ESCALATION'),
    ];
    const positions = layoutWorkflow(nodes, edges);
    const routes = routeWorkflowEdges(edges, positions);
    const order = Object.entries(positions).sort(([, a], [, b]) => a.y - b.y || a.x - b.x).map(([id]) => id);
    expect(order).toEqual(['req', 'dev', 'cr', 'qa', 'deploy', 'human', 'aone', 'conflict', 'pm']);
    expect(routes.e4.sourceOffset).not.toBe(routes.e11.sourceOffset);
    expect(routes.e4.controlPoints[1][0]).not.toBe(routes.e11.controlPoints[1][0]);
    expect(routes.e7.targetOffset).not.toBe(routes.e8.targetOffset);
    expect(routes.e7.controlPoints[0][1]).not.toBe(routes.e8.controlPoints[0][1]);
    expect(positions).toEqual(layoutWorkflow([...nodes].reverse(), [...edges].reverse()));
    expect(routes).toEqual(routeWorkflowEdges([...edges].reverse(), positions));
    assertClearRoutes(edges, positions, routes);
  });
});
