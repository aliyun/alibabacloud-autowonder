import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';
import { Button, Empty, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from './api';
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  layoutWorkflow,
  routeWorkflowEdges,
  type WorkflowPosition,
  type WorkflowRoute,
} from './workflowLayout';
import './workflow.css';

export type WorkflowViewMode = 'main' | 'all';
export type WorkflowSelection = { type: 'node' | 'edge'; id: string };

export interface WorkflowCanvasControls {
  fit: () => void;
}

const VIEW_PADDING = 28;
const MIN_SCALE = 0.3;
const MAX_SCALE = 1.6;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const ARROW_GAP = 4;
const EDGE_MARKER_KINDS = ['HANDOFF', 'REWORK', 'ESCALATION'] as const;

export interface WorkflowElements {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/**
 * The main-path view keeps only edges flagged `isMainPath` plus the nodes they connect. When no
 * edge is on the main path, every node stays visible so the canvas never looks empty.
 */
export function selectWorkflowElements(
  graph: WorkflowGraph | null | undefined,
  mode: WorkflowViewMode,
): WorkflowElements {
  const nodes = graph?.workflow?.nodes ?? [];
  const edges = graph?.workflow?.edges ?? [];
  if (mode === 'all') {
    return { nodes, edges };
  }
  const mainEdges = edges.filter((edge) => edge.isMainPath);
  if (mainEdges.length === 0) {
    return { nodes, edges: [] };
  }
  const visible = new Set<string>();
  mainEdges.forEach((edge) => {
    visible.add(edge.source);
    visible.add(edge.target);
  });
  return { nodes: nodes.filter((node) => visible.has(node.id)), edges: mainEdges };
}

export function edgeStroke(
  kind: WorkflowEdge['kind'],
  colors: Pick<GraphColors, 'primary' | 'warning' | 'error'>,
): string {
  if (kind === 'HANDOFF') return colors.primary;
  return kind === 'REWORK' ? colors.error : colors.warning;
}

interface GraphColors {
  primary: string;
  warning: string;
  error: string;
}

interface CameraView {
  scale: number;
  x: number;
  y: number;
}

interface ContentGeometry {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

function portPoint(port: string, position: WorkflowPosition, offset = 0): [number, number] {
  if (port === 'top') return [position.x + offset, position.y - CARD_HEIGHT / 2];
  if (port === 'bottom') return [position.x + offset, position.y + CARD_HEIGHT / 2];
  if (port === 'left') return [position.x - CARD_WIDTH / 2, position.y + offset];
  return [position.x + CARD_WIDTH / 2, position.y + offset];
}

/** The last leg is shortened so the arrow tip stops at the card border instead of covering it. */
function edgePoints(
  route: WorkflowRoute,
  source: WorkflowPosition,
  target: WorkflowPosition,
): Array<[number, number]> {
  const points: Array<[number, number]> = [
    portPoint(route.sourcePort, source, route.sourceOffset),
    ...route.controlPoints,
    portPoint(route.targetPort, target, route.targetOffset),
  ];
  const last = points[points.length - 1];
  const previous = points[points.length - 2];
  const dx = last[0] - previous[0];
  const dy = last[1] - previous[1];
  const length = Math.hypot(dx, dy);
  if (length > ARROW_GAP * 2) {
    points[points.length - 1] = [last[0] - (dx / length) * ARROW_GAP, last[1] - (dy / length) * ARROW_GAP];
  }
  return points;
}

function toPath(points: Array<[number, number]>, geometry: ContentGeometry): string {
  return points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${Math.round(x - geometry.offsetX)} ${Math.round(y - geometry.offsetY)}`)
    .join(' ');
}

interface EdgeLabelPosition {
  x: number;
  y: number;
  width: number;
}

interface LabelObstacle {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function placeEdgeLabel(points: Array<[number, number]>, obstacles: LabelObstacle[]): EdgeLabelPosition | null {
  const runs: Array<{ start: number; end: number; y: number }> = [];
  for (let index = 1; index < points.length; index++) {
    const [x1, y1] = points[index - 1];
    const [x2, y2] = points[index];
    if (y1 !== y2 || x1 === x2) continue;
    const previous = runs[runs.length - 1];
    if (previous && previous.y === y1 && previous.end === x1) previous.end = x2;
    else runs.push({ start: x1, end: x2, y: y1 });
  }
  let best: EdgeLabelPosition | null = null;
  for (const run of runs) {
    for (const y of [run.y - 12, run.y + 12]) {
      let spaces = [[Math.min(run.start, run.end) + 8, Math.max(run.start, run.end) - 8]];
      for (const obstacle of obstacles) {
        if (obstacle.bottom <= y - 11 || obstacle.top >= y + 11) continue;
        spaces = spaces.flatMap(([left, right]) => {
          const start = obstacle.left - 4;
          const end = obstacle.right + 4;
          if (end <= left || start >= right) return [[left, right]];
          return [[left, Math.min(right, start)], [Math.max(left, end), right]].filter(([a, b]) => b > a);
        });
      }
      for (const [left, right] of spaces) {
        const width = Math.min(156, right - left);
        if (width < 24 || (best && width <= best.width)) continue;
        const midpoint = (run.start + run.end) / 2;
        best = { x: Math.max(left + width / 2, Math.min(right - width / 2, midpoint)), y, width };
      }
    }
  }
  return best;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function fitCamera(geometry: ContentGeometry, width: number, height: number): CameraView {
  const scale = clampScale(Math.min(1, (width - VIEW_PADDING * 2) / geometry.width, (height - VIEW_PADDING * 2) / geometry.height));
  return {
    scale,
    x: (width - geometry.width * scale) / 2,
    y: (height - geometry.height * scale) / 2,
  };
}

export interface WorkflowGraphCanvasProps {
  graph: WorkflowGraph | null | undefined;
  mode: WorkflowViewMode;
  onSelect: (selection: WorkflowSelection) => void;
  selection?: WorkflowSelection | null;
  controlsRef?: MutableRefObject<WorkflowCanvasControls | null>;
}

export function WorkflowGraphCanvas({ graph, mode, onSelect, selection, controlsRef }: WorkflowGraphCanvasProps) {
  const { t } = useTranslation('sdlc');
  const markerPrefix = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<CameraView | null>(null);
  const cameraRef = useRef<CameraView | null>(null);
  cameraRef.current = camera;
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  const elements = useMemo(() => selectWorkflowElements(graph, mode), [graph, mode]);
  const positions = useMemo(() => layoutWorkflow(graph?.workflow.nodes ?? [], graph?.workflow.edges ?? []), [graph]);
  const routes = useMemo(() => routeWorkflowEdges(graph?.workflow.edges ?? [], positions), [graph, positions]);
  const edgeLabels = useMemo(() => {
    const paths = (graph?.workflow.edges ?? []).flatMap((edge) => {
      const route = routes[edge.id];
      const source = positions[edge.source];
      const target = positions[edge.target];
      return route && source && target ? [{ edge, points: edgePoints(route, source, target) }] : [];
    });
    const cards: LabelObstacle[] = Object.values(positions).map((position) => ({
      left: position.x - CARD_WIDTH / 2,
      right: position.x + CARD_WIDTH / 2,
      top: position.y - CARD_HEIGHT / 2,
      bottom: position.y + CARD_HEIGHT / 2,
    }));
    const segments = paths.flatMap(({ edge, points }) => points.slice(1).map(([x, y], index) => ({
      edgeId: edge.id,
      left: Math.min(x, points[index][0]) - 2,
      right: Math.max(x, points[index][0]) + 2,
      top: Math.min(y, points[index][1]) - 2,
      bottom: Math.max(y, points[index][1]) + 2,
    })));
    const reserved: LabelObstacle[] = [];
    const labels: Record<string, EdgeLabelPosition> = {};
    for (const { edge, points } of paths.sort((a, b) => Number(b.edge.isMainPath) - Number(a.edge.isMainPath) || a.edge.id.localeCompare(b.edge.id))) {
      if (!edge.condition) continue;
      const label = placeEdgeLabel(points, [...cards, ...reserved, ...segments.filter((segment) => segment.edgeId !== edge.id)]);
      if (!label) continue;
      labels[edge.id] = label;
      reserved.push({ left: label.x - label.width / 2, right: label.x + label.width / 2, top: label.y - 9, bottom: label.y + 9 });
    }
    return labels;
  }, [graph, positions, routes]);

  // Bounds always come from the whole graph so switching view modes never rescales the canvas.
  const geometry = useMemo<ContentGeometry | null>(() => {
    const nodes = graph?.workflow.nodes ?? [];
    if (nodes.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const include = (x: number, y: number) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };
    nodes.forEach((node) => {
      const position = positions[node.id];
      if (!position) return;
      include(position.x - CARD_WIDTH / 2, position.y - CARD_HEIGHT / 2);
      include(position.x + CARD_WIDTH / 2, position.y + CARD_HEIGHT / 2);
    });
    Object.values(routes).forEach((route) => {
      route.controlPoints.forEach(([x, y]) => include(x, y));
    });
    return { offsetX: minX - 6, offsetY: minY - 24, width: maxX - minX + 12, height: maxY - minY + 30 };
  }, [graph, positions, routes]);

  const fit = useCallback(() => {
    const container = containerRef.current;
    if (!container || !geometry) return;
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    setCamera(fitCamera(geometry, width, height));
  }, [geometry]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(container);
    return () => observer.disconnect();
  }, [fit]);

  useEffect(() => {
    if (!controlsRef) return;
    const controls: WorkflowCanvasControls = { fit };
    controlsRef.current = controls;
    return () => {
      if (controlsRef.current === controls) controlsRef.current = null;
    };
  }, [controlsRef, fit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (event: WheelEvent) => {
      const current = cameraRef.current;
      if (!current) return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const next = clampScale(current.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY));
      if (next === current.scale) return;
      const ratio = next / current.scale;
      setCamera({
        scale: next,
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio,
      });
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const container = containerRef.current;
    const current = cameraRef.current;
    if (!container || !current) return;
    const rect = container.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const next = clampScale(current.scale * factor);
    const ratio = next / current.scale;
    setCamera({
      scale: next,
      x: centerX - (centerX - current.x) * ratio,
      y: centerY - (centerY - current.y) * ratio,
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, [data-edge-id]')) return;
    if (!cameraRef.current) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const current = cameraRef.current;
    if (!drag || !current || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    setCamera({ ...current, x: current.x + dx, y: current.y + dy });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const colors: GraphColors = {
    primary: 'var(--aw-primary)',
    warning: 'var(--aw-warning)',
    error: 'var(--aw-error)',
  };

  if (elements.nodes.length === 0 || !geometry) {
    return <Empty description={t('workflow.graphEmpty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  const nodeKindLabel = (node: WorkflowNode) => t(`workflow.kinds.${node.kind}`);
  const nodeRole = (node: WorkflowNode) => (
    node.stepSummaries?.length
      ? t('workflow.nodeSteps', { count: node.stepSummaries.length })
      : nodeKindLabel(node)
  );
  const selectedEdgeId = selection?.type === 'edge' ? selection.id : null;

  return (
    <div className="aw-workflow-canvas-shell">
      <div
        ref={containerRef}
        data-testid="workflow-graph"
        className="aw-workflow-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <div
          data-testid="workflow-graph-world"
          className="aw-workflow-world"
          style={{
            width: geometry.width,
            height: geometry.height,
            opacity: camera ? 1 : 0,
            transform: camera
              ? `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`
              : 'translate(0px, 0px) scale(1)',
          }}
        >
          <svg
            className="aw-workflow-edges"
            width={geometry.width}
            height={geometry.height}
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              {EDGE_MARKER_KINDS.map((kind) => (
                <marker
                  key={kind}
                  id={`${markerPrefix}-${kind}`}
                  markerWidth={8}
                  markerHeight={8}
                  refX={7}
                  refY={4}
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M0,0 L8,4 L0,8 z" fill={edgeStroke(kind, colors)} />
                </marker>
              ))}
            </defs>
            {elements.edges.map((edge) => {
              const source = positions[edge.source];
              const target = positions[edge.target];
              const route = routes[edge.id];
              if (!source || !target || !route) return null;
              const path = toPath(edgePoints(route, source, target), geometry);
              const selected = selectedEdgeId === edge.id;
              return (
                <g key={edge.id}>
                  <path
                    className="aw-workflow-edge aw-workflow-edge-clearance"
                    d={path}
                    stroke="var(--aw-panel)"
                    strokeWidth={selected ? 6.5 : 5.5}
                  />
                  <path
                    className="aw-workflow-edge"
                    d={path}
                    stroke={edgeStroke(edge.kind, colors)}
                    strokeWidth={selected ? 2.5 : 1.5}
                    strokeDasharray={edge.kind === 'HANDOFF' ? undefined : edge.kind === 'REWORK' ? '6 5' : '4 5'}
                    markerEnd={`url(#${markerPrefix}-${edge.kind})`}
                  />
                  <path
                    className="aw-workflow-edge-hit"
                    d={path}
                    data-edge-id={edge.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect({ type: 'edge', id: edge.id });
                    }}
                  />
                </g>
              );
            })}
          </svg>
          {elements.edges.map((edge) => {
            const label = edgeLabels[edge.id];
            if (!label) return null;
            return (
              <Tooltip key={edge.id} title={edge.condition}>
                <button
                  type="button"
                  className="aw-workflow-edge-label"
                  data-workflow-edge-label={edge.id}
                  aria-label={edge.condition}
                  aria-pressed={selectedEdgeId === edge.id}
                  style={{
                    left: label.x - geometry.offsetX,
                    top: label.y - geometry.offsetY,
                    width: label.width,
                  }}
                  onClick={() => onSelect({ type: 'edge', id: edge.id })}
                >
                  {edge.condition}
                </button>
              </Tooltip>
            );
          })}
          {elements.nodes.map((node) => {
            const position = positions[node.id];
            if (!position) return null;
            return (
              <button
                key={node.id}
                type="button"
                className="aw-workflow-node"
                data-workflow-node={node.id}
                data-workflow-kind={node.kind}
                aria-label={node.label || node.id}
                aria-pressed={selection?.type === 'node' && selection.id === node.id}
                style={{
                  left: position.x - CARD_WIDTH / 2 - geometry.offsetX,
                  top: position.y - CARD_HEIGHT / 2 - geometry.offsetY,
                  width: CARD_WIDTH,
                  height: CARD_HEIGHT,
                }}
                onClick={() => onSelect({ type: 'node', id: node.id })}
              >
                <span className="aw-workflow-node-role" title={nodeRole(node)}>{nodeRole(node)}</span>
                <span className="aw-workflow-node-name" title={node.label || node.id}>{node.label || node.id}</span>
                <span className="aw-workflow-node-kinds">
                  <span className="aw-workflow-node-kind" data-kind={node.kind}>{nodeKindLabel(node)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="aw-workflow-zoom">
        <Button size="small" aria-label={t('workflow.zoomOut')} icon={<AwStrokeIcon name="zoom-out" />}
          onClick={() => zoomBy(0.8)} />
        <Button size="small" aria-label={t('workflow.zoomIn')} icon={<AwStrokeIcon name="zoom-in" />}
          onClick={() => zoomBy(1.25)} />
      </div>
    </div>
  );
}
