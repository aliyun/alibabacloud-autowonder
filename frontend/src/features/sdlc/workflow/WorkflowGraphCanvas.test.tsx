import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ComponentProps, MutableRefObject } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { i18n } from '@/shared/i18n';
import {
  edgeStroke,
  selectWorkflowElements,
  WorkflowGraphCanvas,
  type WorkflowCanvasControls,
} from './WorkflowGraphCanvas';
import type { WorkflowGraph } from './api';

const graph: WorkflowGraph = {
  schemaVersion: '1.0',
  inputHash: 'hash',
  workflow: {
    nodes: [
      { id: 'n1', kind: 'MEMBER', label: '开发', agentId: '1', responsibility: '实现', stepSummaries: [], evidenceRefs: [] },
      { id: 'n2', kind: 'HUMAN', label: '审批', agentId: null, responsibility: '审批', stepSummaries: [], evidenceRefs: [] },
      { id: 'n3', kind: 'EXTERNAL', label: '外部系统', agentId: null, responsibility: '通知', stepSummaries: [], evidenceRefs: [] },
    ],
    edges: [
      {
        id: 'e1', source: 'n1', target: 'n2', kind: 'HANDOFF',
        condition: '编码完成后提交人工审批', isMainPath: true, evidenceRefs: [],
      },
      {
        id: 'e2', source: 'n2', target: 'n1', kind: 'REWORK',
        condition: '审批驳回后返工', isMainPath: false, evidenceRefs: [],
      },
      {
        id: 'e3', source: 'n2', target: 'n3', kind: 'ESCALATION',
        condition: '长时间未响应升级通知', isMainPath: false, evidenceRefs: [],
      },
    ],
    findings: [],
  },
};

function renderCanvas(overrides: Partial<ComponentProps<typeof WorkflowGraphCanvas>> = {}) {
  return render(
    <ConfigProvider>
      <WorkflowGraphCanvas graph={graph} mode="main" onSelect={vi.fn()} {...overrides} />
    </ConfigProvider>,
  );
}

const nodeIds = () => [...document.querySelectorAll<HTMLElement>('[data-workflow-node]')]
  .map((element) => element.dataset.workflowNode);
const edgeIds = () => [...document.querySelectorAll<HTMLElement>('[data-edge-id]')]
  .map((element) => element.dataset.edgeId);

describe('selectWorkflowElements', () => {
  it('keeps only main-path edges and their endpoints in main mode', () => {
    const elements = selectWorkflowElements(graph, 'main');
    expect(elements.edges.map((edge) => edge.id)).toEqual(['e1']);
    expect(elements.nodes.map((node) => node.id)).toEqual(['n1', 'n2']);
  });

  it('keeps every node and edge in all mode', () => {
    const elements = selectWorkflowElements(graph, 'all');
    expect(elements.edges).toHaveLength(3);
    expect(elements.nodes).toHaveLength(3);
  });

  it('falls back to all nodes when no edge is on the main path', () => {
    const noMain = {
      ...graph,
      workflow: { ...graph.workflow, edges: graph.workflow.edges.map((edge) => ({ ...edge, isMainPath: false })) },
    };
    const elements = selectWorkflowElements(noMain, 'main');
    expect(elements.edges).toEqual([]);
    expect(elements.nodes).toHaveLength(3);
  });

  it('tolerates a missing graph', () => {
    expect(selectWorkflowElements(null, 'main')).toEqual({ nodes: [], edges: [] });
  });
});

describe('edgeStroke', () => {
  it('draws rework in the error color and escalation in warning', () => {
    const colors = { primary: '#primary', warning: '#warning', error: '#error' };
    expect(edgeStroke('HANDOFF', colors)).toBe('#primary');
    expect(edgeStroke('REWORK', colors)).toBe('#error');
    expect(edgeStroke('ESCALATION', colors)).toBe('#warning');
  });
});

describe('WorkflowGraphCanvas', () => {
  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await i18n.changeLanguage('zh-CN');
  });

  it('reports node and edge clicks with their original ids', async () => {
    const onSelect = vi.fn();
    renderCanvas({ onSelect });

    await userEvent.click(screen.getByRole('button', { name: '开发' }));
    expect(onSelect).toHaveBeenLastCalledWith({ type: 'node', id: 'n1' });

    await userEvent.click(document.querySelector('[data-edge-id="e1"]') as HTMLElement);
    expect(onSelect).toHaveBeenLastCalledWith({ type: 'edge', id: 'e1' });
  });

  it('renders only the main path by default and every path in all mode', async () => {
    const { rerender } = renderCanvas();
    await waitFor(() => expect(nodeIds()).toEqual(['n1', 'n2']));
    expect(edgeIds()).toEqual(['e1']);

    rerender(
      <ConfigProvider>
        <WorkflowGraphCanvas graph={graph} mode="all" onSelect={vi.fn()} />
      </ConfigProvider>,
    );
    await waitFor(() => expect(nodeIds()).toEqual(['n1', 'n2', 'n3']));
    expect(edgeIds()).toEqual(['e1', 'e2', 'e3']);
  });

  it('retains condition labels and selects their edge on click', async () => {
    const onSelect = vi.fn();
    renderCanvas({ onSelect });
    const label = screen.getByRole('button', { name: '编码完成后提交人工审批' });
    expect(label).toHaveAttribute('data-workflow-edge-label', 'e1');
    await userEvent.click(label);
    expect(onSelect).toHaveBeenLastCalledWith({ type: 'edge', id: 'e1' });
  });

  it('keeps every squad condition label clear of cards, labels and other edge segments', () => {
    const squadGraph: WorkflowGraph = {
      ...graph,
      workflow: {
        nodes: (['req', 'dev', 'cr', 'qa', 'conflict', 'deploy', 'pm', 'human', 'aone'] as const)
          .map<WorkflowGraph['workflow']['nodes'][number]>((id) => ({
            id,
            kind: id === 'human' ? 'HUMAN' : id === 'aone' ? 'EXTERNAL' : 'MEMBER',
            label: id,
            agentId: id === 'human' || id === 'aone' ? null : id,
            responsibility: id,
          })),
        edges: ([
          ['e1', 'req', 'dev', 'HANDOFF', true],
          ['e2', 'dev', 'cr', 'HANDOFF', true],
          ['e3', 'cr', 'qa', 'HANDOFF', true],
          ['e4', 'qa', 'deploy', 'HANDOFF', true],
          ['e5', 'deploy', 'human', 'ESCALATION', true],
          ['e6', 'human', 'aone', 'HANDOFF', true],
          ['e7', 'cr', 'dev', 'REWORK', false],
          ['e8', 'qa', 'dev', 'REWORK', false],
          ['e9', 'dev', 'conflict', 'ESCALATION', false],
          ['e10', 'conflict', 'dev', 'HANDOFF', false],
          ['e11', 'qa', 'pm', 'ESCALATION', false],
        ] as const).map(([id, source, target, kind, isMainPath]) => ({
          id, source, target, kind, isMainPath, condition: id,
        })),
        findings: [],
      },
    };
    const { container } = renderCanvas({ graph: squadGraph, mode: 'all' });
    const nodes = [...container.querySelectorAll<HTMLElement>('[data-workflow-node]')];
    const edges = [...container.querySelectorAll<SVGPathElement>('svg path[data-edge-id]')];
    const labels = [...container.querySelectorAll<HTMLElement>('[data-workflow-edge-label]')];
    expect(nodes).toHaveLength(9);
    expect(edges).toHaveLength(11);
    expect(labels).toHaveLength(11);
    expect(labels.map((label) => label.dataset.workflowEdgeLabel)).toEqual(squadGraph.workflow.edges.map((edge) => edge.id));

    const EPS = 0.5; // SVG path coordinates are rounded to pixels.
    const bounds = (element: HTMLElement, centered = false) => {
      const width = Number.parseFloat(element.style.width);
      const height = centered ? 18 : Number.parseFloat(element.style.height);
      const left = Number.parseFloat(element.style.left) - (centered ? width / 2 : 0);
      const top = Number.parseFloat(element.style.top) - (centered ? height / 2 : 0);
      expect([left, top, width, height].every(Number.isFinite)).toBe(true);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      return { left, top, right: left + width, bottom: top + height };
    };
    const overlaps = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) => (
      a.left < b.right - EPS && a.right > b.left + EPS
      && a.top < b.bottom - EPS && a.bottom > b.top + EPS
    );
    const cards = nodes.map((node) => ({ id: node.dataset.workflowNode, ...bounds(node) }));
    // Labels use translate(-50%, -50%) and a CSS height of 18px in world coordinates.
    const labelBounds = labels.map((label) => ({ id: label.dataset.workflowEdgeLabel, ...bounds(label, true) }));
    const segments = edges.flatMap((edge) => {
      const points = [...(edge.getAttribute('d') ?? '').matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)]
        .map(([, x, y]) => [Number(x), Number(y)] as const);
      expect(points.length).toBeGreaterThan(1);
      return points.slice(1).map(([x2, y2], index) => {
        const [x1, y1] = points[index];
        expect(Math.abs(x2 - x1) < EPS || Math.abs(y2 - y1) < EPS).toBe(true);
        return {
          id: edge.getAttribute('data-edge-id'),
          left: Math.min(x1, x2), right: Math.max(x1, x2),
          top: Math.min(y1, y2), bottom: Math.max(y1, y2),
        };
      });
    });

    labelBounds.forEach((label, index) => {
      cards.forEach((card) => {
        expect(overlaps(label, card), `${label.id} overlaps card ${card.id}`).toBe(false);
      });
      labelBounds.slice(index + 1).forEach((other) => {
        expect(overlaps(label, other), `${label.id} overlaps label ${other.id}`).toBe(false);
      });
      segments.filter((segment) => segment.id !== label.id).forEach((segment) => {
        expect(overlaps(label, segment), `${label.id} is crossed by edge ${segment.id}`).toBe(false);
      });
    });
  });

  it('marks the selected node for assistive technology', async () => {
    renderCanvas({ selection: { type: 'node', id: 'n2' } });
    const pressed = await screen.findByRole('button', { name: '审批' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders an empty state without nodes', async () => {
    renderCanvas({ graph: null });
    expect(await screen.findByText('协作图中没有可展示的节点')).toBeInTheDocument();
  });

  it('fits the graph into the canvas through the external control', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 900, height: 565, top: 0, left: 0, right: 900, bottom: 565, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const controlsRef: MutableRefObject<WorkflowCanvasControls | null> = { current: null };
    renderCanvas({ controlsRef });

    await waitFor(() => expect(controlsRef.current).not.toBeNull());
    controlsRef.current?.fit();

    await waitFor(() => {
      const world = screen.getByTestId('workflow-graph-world');
      expect(world.style.transform).toMatch(/translate\(.+\) scale\(/);
    });
  });
});
