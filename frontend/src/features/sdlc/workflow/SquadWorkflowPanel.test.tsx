import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { message } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { i18n } from '@/shared/i18n';
import { useAuthStore } from '@/shared/auth/store';
import { SquadWorkflowPanel, WORKFLOW_FAST_POLL_WINDOW_MS, WORKFLOW_POLL_INTERVAL, WORKFLOW_SLOW_POLL_INTERVAL, workflowPollInterval } from './SquadWorkflowPanel';
import type { WorkflowGraph } from './api';

const renderedNodes = () => [...document.querySelectorAll<HTMLElement>('[data-workflow-node]')]
  .map((element) => element.dataset.workflowNode);
const renderedEdges = () => [...document.querySelectorAll<HTMLElement>('[data-edge-id]')]
  .map((element) => element.dataset.edgeId);

const readyGraph: WorkflowGraph = {
  schemaVersion: '1.0',
  inputHash: 'hash-1',
  workflow: {
    nodes: [
      {
        id: 'n-dev',
        kind: 'MEMBER',
        label: '开发',
        agentId: '1',
        responsibility: '实现需求并移交评审',
        stepSummaries: [
          {
            stepId: '101',
            label: '编码',
            description: '提交代码与自测',
            evidenceRefs: [{ sourceId: 'agent:1:agent-md', fieldPath: 'responsibilities', quote: '负责实现需求' }],
          },
        ],
        evidenceRefs: [{ sourceId: 'agent:1:agent-md', fieldPath: 'responsibilities', quote: '负责实现' }],
      },
      {
        id: 'n-review',
        kind: 'MEMBER',
        label: '评审',
        agentId: '2',
        responsibility: '评审代码',
        stepSummaries: [],
        evidenceRefs: [],
      },
      {
        id: 'n-human',
        kind: 'HUMAN',
        label: '发布审批',
        agentId: null,
        responsibility: '人工审批发布',
        stepSummaries: [],
        evidenceRefs: [],
      },
    ],
    edges: [
      {
        id: 'e-dev-review',
        source: 'n-dev',
        target: 'n-review',
        kind: 'HANDOFF',
        condition: '编码完成后移交评审',
        isMainPath: true,
        evidenceRefs: [{ sourceId: 'agent:1:agent-md', fieldPath: 'responsibilities', quote: '完成后移交' }],
      },
      {
        id: 'e-review-dev',
        source: 'n-review',
        target: 'n-dev',
        kind: 'REWORK',
        condition: '评审发现阻塞缺陷',
        isMainPath: false,
        evidenceRefs: [{ sourceId: 'agent:2:agent-md', fieldPath: 'responsibilities', quote: '可退回' }],
      },
    ],
    findings: [
      {
        id: 'f-1',
        kind: 'INFORMATION',
        summary: '评审节点未配置 SDLC',
        nodeIds: ['n-review'],
        edgeIds: [],
        evidenceRefs: [],
      },
    ],
  },
  review: { status: 'PASSED', checks: {}, summary: 'ok' },
};

const escalationGraph: WorkflowGraph = {
  ...readyGraph,
  workflow: {
    ...readyGraph.workflow,
    edges: [
      ...readyGraph.workflow.edges,
      {
        id: 'e-escalate',
        source: 'n-dev',
        target: 'n-human',
        kind: 'ESCALATION',
        condition: '超时未响应升级',
        isMainPath: false,
        evidenceRefs: [],
      },
    ],
  },
};

function view(status: string, overrides: Record<string, unknown> = {}) {
  return {
    status,
    inputHash: 'hash-1',
    analysisVersion: 'squad-workflow-v1',
    generationId: 12,
    attemptId: 'attempt-1',
    generatedAt: null,
    error: null,
    graph: null,
    ...overrides,
  };
}

function useWorkflow(viewBody: unknown) {
  server.use(
    http.get('/api/squads', () => HttpResponse.json({
      success: true, code: '0', message: '', traceId: null,
      data: { list: [{ id: 40022, name: '交付小队' }], total: 1, pageNum: 1, pageSize: 100 },
    })),
    http.get('/api/squads/40022/workflow', () => HttpResponse.json({
      success: true, code: '0', message: '', traceId: null, data: viewBody,
    })),
  );
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><SquadWorkflowPanel /></MemoryRouter>
    </QueryClientProvider>,
  );
}

async function selectSquad(label = '选择小队') {
  await userEvent.click(await screen.findByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByText('交付小队', { selector: '.ant-select-item-option-content' }));
}

describe('workflowPollInterval', () => {
  it('backs off from three to ten seconds while an analysis is still running', () => {
    expect(workflowPollInterval(false, 0)).toBe(false);
    expect(workflowPollInterval(true, 0)).toBe(WORKFLOW_POLL_INTERVAL);
    expect(workflowPollInterval(true, WORKFLOW_FAST_POLL_WINDOW_MS - 1)).toBe(WORKFLOW_POLL_INTERVAL);
    expect(workflowPollInterval(true, WORKFLOW_FAST_POLL_WINDOW_MS)).toBe(WORKFLOW_SLOW_POLL_INTERVAL);
  });
});

describe('SquadWorkflowPanel', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'O', description: '' }, 'READ_WRITE');
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('zh-CN');
  });

  it('prompts for a squad before loading any workflow', async () => {
    useWorkflow(view('MISSING'));
    renderPanel();

    expect(await screen.findByText('选择一个小队，查看由成员线上配置推导出的协作图。')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '选择小队' })).toBeInTheDocument();
  });

  it('offers to generate a missing graph and posts the current input hash', async () => {
    let requestBody: Record<string, unknown> | null = null;
    useWorkflow(view('MISSING'));
    server.use(
      http.post('/api/squads/40022/workflow/generations', async ({ request }) => {
        requestBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null, data: view('GENERATING'),
        });
      }),
    );
    renderPanel();
    await selectSquad();

    await userEvent.click(await screen.findByRole('button', { name: '生成协作图' }));

    expect(await screen.findByText('正在分析小队线上配置…')).toBeInTheDocument();
    expect(requestBody).toMatchObject({ expectedInputHash: 'hash-1', retry: false });
  });

  it('renders the main path by default and reveals every path on demand', async () => {
    useWorkflow(view('READY', { graph: readyGraph, generatedAt: '2026-10-22T10:00:00Z' }));
    renderPanel();
    await selectSquad();

    await waitFor(() => expect(renderedNodes()).toEqual(['n-dev', 'n-review']));
    expect(renderedEdges()).toEqual(['e-dev-review']);
    expect(screen.getByText(/生成于.*2026/)).toBeInTheDocument();

    await userEvent.click(screen.getByText('全部路径'));

    await waitFor(() => expect(renderedNodes()).toHaveLength(3));
    expect(renderedEdges()).toEqual(['e-dev-review', 'e-review-dev']);
  });

  it('shows only one detail panel without edge details before selection', async () => {
    useWorkflow(view('READY', { graph: readyGraph }));
    renderPanel();
    await selectSquad();
    await waitFor(() => expect(renderedNodes().length).toBeGreaterThan(0));

    expect(document.querySelectorAll('.aw-workflow-detail-panel')).toHaveLength(1);
    expect(screen.getByText('点击节点或连线查看详情；下方为全部分析发现。')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '连线' })).not.toBeInTheDocument();
    expect(screen.queryByText('完成后移交')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '分析发现' })).getByText('评审节点未配置 SDLC')).toBeInTheDocument();
  });

  it('replaces node details with a selected handoff and returns to its source with fresh scroll state', async () => {
    useWorkflow(view('READY', { graph: readyGraph }));
    renderPanel();
    await selectSquad();
    await waitFor(() => expect(renderedNodes().length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole('button', { name: '开发' }));
    const nodeRegion = await screen.findByRole('region', { name: '节点' });
    expect(document.querySelectorAll('.aw-workflow-detail-panel')).toHaveLength(1);
    expect(within(nodeRegion).getByText('实现需求并移交评审')).toBeInTheDocument();
    expect(within(nodeRegion).getByText('提交代码与自测')).toBeInTheDocument();
    expect(within(nodeRegion).getByText('负责实现')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '连线' })).not.toBeInTheDocument();
    expect(screen.queryByText('完成后移交')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回节点' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-workflow-edge-label="e-dev-review"]')).toHaveAttribute('aria-pressed', 'false');
    const nodeBody = nodeRegion.querySelector<HTMLElement>('.aw-workflow-detail-body')!;
    nodeBody.scrollTop = 180;

    await userEvent.click(within(nodeRegion).getByRole('button', { name: /移交.*评审/ }));
    const edgeRegion = await screen.findByRole('region', { name: '连线' });
    expect(document.querySelectorAll('.aw-workflow-detail-panel')).toHaveLength(1);
    expect(within(edgeRegion).getByText('编码完成后移交评审')).toBeInTheDocument();
    expect(within(edgeRegion).getByText('移交', { selector: '.ant-tag' })).toBeInTheDocument();
    expect(within(edgeRegion).getByText('完成后移交')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '节点' })).not.toBeInTheDocument();
    expect(screen.queryByText('实现需求并移交评审')).not.toBeInTheDocument();
    expect(screen.queryByText('提交代码与自测')).not.toBeInTheDocument();
    expect(screen.queryByText('负责实现')).not.toBeInTheDocument();
    expect(screen.queryByText('负责实现需求')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '分析发现' })).getByText('评审节点未配置 SDLC')).toBeInTheDocument();
    const edgeBody = edgeRegion.querySelector<HTMLElement>('.aw-workflow-detail-body')!;
    expect(edgeBody).not.toBe(nodeBody);
    expect(edgeBody.scrollTop).toBe(0);
    edgeBody.scrollTop = 90;

    await userEvent.click(within(edgeRegion).getByRole('button', { name: '返回节点' }));
    const restoredNodeRegion = await screen.findByRole('region', { name: '节点' });
    expect(document.querySelectorAll('.aw-workflow-detail-panel')).toHaveLength(1);
    expect(within(restoredNodeRegion).getByText('实现需求并移交评审')).toBeInTheDocument();
    expect(within(restoredNodeRegion).getByText('提交代码与自测')).toBeInTheDocument();
    expect(within(restoredNodeRegion).getByText('负责实现')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开发' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: '连线' })).not.toBeInTheDocument();
    expect(screen.queryByText('完成后移交')).not.toBeInTheDocument();
    const restoredNodeBody = restoredNodeRegion.querySelector<HTMLElement>('.aw-workflow-detail-body')!;
    expect(restoredNodeBody).not.toBe(nodeBody);
    expect(restoredNodeBody).not.toBe(edgeBody);
    expect(restoredNodeBody.scrollTop).toBe(0);
  });

  it.each([
    ['condition label', '[data-workflow-edge-label="e-dev-review"]'],
    ['hit path', 'path.aw-workflow-edge-hit[data-edge-id="e-dev-review"]'],
  ])('opens only edge details through the graph %s', async (_entry, selector) => {
    useWorkflow(view('READY', { graph: readyGraph }));
    renderPanel();
    await selectSquad();
    await waitFor(() => expect(renderedNodes().length).toBeGreaterThan(0));

    const entry = document.querySelector(selector);
    expect(entry).toBeInTheDocument();
    await userEvent.click(entry as Element);

    const edgeRegion = await screen.findByRole('region', { name: '连线' });
    expect(document.querySelectorAll('.aw-workflow-detail-panel')).toHaveLength(1);
    expect(within(edgeRegion).getByText('编码完成后移交评审')).toBeInTheDocument();
    expect(within(edgeRegion).getByText('完成后移交')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '节点' })).not.toBeInTheDocument();
    expect(screen.queryByText('实现需求并移交评审')).not.toBeInTheDocument();
  });

  it('selects the source and target nodes through accessible endpoint buttons', async () => {
    useWorkflow(view('READY', { graph: readyGraph }));
    renderPanel();
    await selectSquad();
    await waitFor(() => expect(renderedNodes().length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole('button', { name: '编码完成后移交评审' }));
    const edgeRegion = await screen.findByRole('region', { name: '连线' });
    expect(within(edgeRegion).getByRole('button', { name: '查看节点：开发' })).toHaveTextContent('开发');
    expect(within(edgeRegion).getByRole('button', { name: '查看节点：评审' })).toHaveTextContent('评审');
    await userEvent.click(within(edgeRegion).getByRole('button', { name: '查看节点：开发' }));

    expect(within(await screen.findByRole('region', { name: '节点' })).getByText('实现需求并移交评审')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开发' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: '连线' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '编码完成后移交评审' }));
    await userEvent.click(within(await screen.findByRole('region', { name: '连线' })).getByRole('button', { name: '查看节点：评审' }));

    expect(within(await screen.findByRole('region', { name: '节点' })).getByText('评审代码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '评审' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '开发' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('region', { name: '连线' })).not.toBeInTheDocument();
    expect(screen.queryByText('完成后移交')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.aw-workflow-detail-panel')).toHaveLength(1);
  });

  it('keeps nodes without outgoing handoffs and human nodes usable', async () => {
    useWorkflow(view('READY', {
      graph: {
        ...readyGraph,
        workflow: { ...readyGraph.workflow, edges: [readyGraph.workflow.edges[0]] },
      },
    }));
    renderPanel();
    await selectSquad();
    await waitFor(() => expect(renderedNodes().length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole('button', { name: '评审' }));
    const reviewRegion = await screen.findByRole('region', { name: '节点' });
    expect(within(reviewRegion).getByText('评审代码')).toBeInTheDocument();
    expect(within(reviewRegion).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('region', { name: '连线' })).not.toBeInTheDocument();
    expect(screen.queryByText('完成后移交')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('全部路径'));
    await userEvent.click(await screen.findByRole('button', { name: '发布审批' }));
    const humanRegion = await screen.findByRole('region', { name: '节点' });
    expect(within(humanRegion).getByText('人工审批发布')).toBeInTheDocument();
    expect(within(humanRegion).getByText('人工', { selector: '.ant-tag' })).toBeInTheDocument();
    expect(within(humanRegion).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '发布审批' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: '连线' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.aw-workflow-detail-panel')).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: '分析发现' })).getByText('评审节点未配置 SDLC')).toBeInTheDocument();
  });

  it('translates handoff navigation in English without translating user-written node names or evidence', async () => {
    await i18n.changeLanguage('en-US');
    useWorkflow(view('READY', { graph: readyGraph }));
    renderPanel();
    await selectSquad('Select a squad');
    await waitFor(() => expect(renderedNodes().length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole('button', { name: '编码完成后移交评审' }));
    const edgeRegion = await screen.findByRole('region', { name: 'Edge' });
    expect(within(edgeRegion).getByRole('button', { name: 'Back to node' })).toHaveTextContent('Back to node');
    expect(within(edgeRegion).getByRole('button', { name: 'View node: 开发' })).toHaveTextContent('开发');
    expect(within(edgeRegion).getByRole('button', { name: 'View node: 评审' })).toHaveTextContent('评审');
    expect(within(edgeRegion).getByText('完成后移交')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Node' })).not.toBeInTheDocument();
    await userEvent.click(within(edgeRegion).getByRole('button', { name: 'View node: 开发' }));
    expect(within(await screen.findByRole('region', { name: 'Node' })).getByText('实现需求并移交评审')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '编码完成后移交评审' }));
    await userEvent.click(within(await screen.findByRole('region', { name: 'Edge' })).getByRole('button', { name: 'Back to node' }));
    expect(within(await screen.findByRole('region', { name: 'Node' })).getByText('负责实现')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开发' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: 'Edge' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.aw-workflow-detail-panel')).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: 'Findings' })).getByText('评审节点未配置 SDLC')).toBeInTheDocument();
  });

  it('reports an empty squad without offering generation', async () => {
    useWorkflow(view('EMPTY'));
    renderPanel();
    await selectSquad();

    expect(await screen.findByText('小队暂无可分析的线上成员配置')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成协作图' })).not.toBeInTheDocument();
  });

  it('shows repair progress while the chief fixes a rejected result', async () => {
    useWorkflow(view('REPAIRING'));
    renderPanel();
    await selectSquad();

    expect(await screen.findByText('结果校验未通过，Chief 正在自动修复…')).toBeInTheDocument();
  });

  it('warns when a ready snapshot carries no graph', async () => {
    useWorkflow(view('READY', { graph: null }));
    renderPanel();
    await selectSquad();

    expect(await screen.findByText('协作图中没有可展示的节点')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /刷\s*新/ }).length).toBeGreaterThan(0);
  });

  it('retries a timed-out generation with the retry flag', async () => {
    let requestBody: Record<string, unknown> | null = null;
    useWorkflow(view('FAILED', {
      error: { code: 'DEADLINE_EXCEEDED', message: '分析超时', retryable: true },
    }));
    server.use(
      http.post('/api/squads/40022/workflow/generations', async ({ request }) => {
        requestBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null, data: view('GENERATING'),
        });
      }),
    );
    renderPanel();
    await selectSquad();

    expect(await screen.findByText('分析超时')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));

    expect(await screen.findByText('正在分析小队线上配置…')).toBeInTheDocument();
    expect(requestBody).toMatchObject({ retry: true });
  });

  it('hides retry when the failure is not retryable', async () => {
    useWorkflow(view('FAILED', {
      error: { code: 'INPUT_TOO_LARGE', message: '配置内容过大', retryable: false },
    }));
    renderPanel();
    await selectSquad();

    expect(await screen.findByText('配置内容过大')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重\s*试/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /刷\s*新/ }).length).toBeGreaterThan(0);
  });

  it('switches to the fresh snapshot when the online configuration changed', async () => {
    const info = vi.spyOn(message, 'info').mockImplementation(
      () => undefined as unknown as ReturnType<typeof message.info>,
    );
    useWorkflow(view('MISSING'));
    server.use(
      http.post('/api/squads/40022/workflow/generations', () => HttpResponse.json({
        success: false, code: '38003', message: '小队线上配置已变化，请刷新后重试', traceId: null,
        data: view('MISSING', { inputHash: 'hash-2' }),
      })),
    );
    renderPanel();
    await selectSquad();
    await userEvent.click(await screen.findByRole('button', { name: '生成协作图' }));

    await waitFor(() => expect(info).toHaveBeenCalledWith('小队线上配置已变化，已切换到最新版本。'));
    expect(await screen.findByRole('button', { name: '生成协作图' })).toBeInTheDocument();
  });

  it('shows a retryable load error', async () => {
    server.use(
      http.get('/api/squads', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null,
        data: { list: [{ id: 40022, name: '交付小队' }], total: 1, pageNum: 1, pageSize: 100 },
      })),
      http.get('/api/squads/40022/workflow', () => HttpResponse.json({
        success: false, code: '38004', message: '当前工作空间已有进行中的生成任务', traceId: null, data: null,
      })),
    );
    renderPanel();
    await selectSquad();

    expect(await screen.findByText('当前工作空间已有进行中的生成任务')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /刷\s*新/ }).length).toBeGreaterThan(0);
  });

  it('recovers from a transient load error with the refresh button', async () => {
    let calls = 0;
    server.use(
      http.get('/api/squads', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null,
        data: { list: [{ id: 40022, name: '交付小队' }], total: 1, pageNum: 1, pageSize: 100 },
      })),
      http.get('/api/squads/40022/workflow', () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({
            success: false, code: '38004', message: '当前工作空间已有进行中的生成任务', traceId: null, data: null,
          });
        }
        return HttpResponse.json({
          success: true, code: '0', message: '', traceId: null,
          data: view('READY', { graph: readyGraph }),
        });
      }),
    );
    renderPanel();
    await selectSquad();

    expect(await screen.findByText('当前工作空间已有进行中的生成任务')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /刷\s*新/ })[0]);

    await waitFor(() => expect(renderedNodes().length).toBeGreaterThan(0));
    expect(screen.getByText('交付流程 / DELIVERY WORKFLOW')).toBeInTheDocument();
  });

  it('resets the view mode and selection when another squad is selected', async () => {
    server.use(
      http.get('/api/squads', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null,
        data: { list: [{ id: 40022, name: '交付小队' }, { id: 40023, name: '另一个小队' }], total: 2, pageNum: 1, pageSize: 100 },
      })),
      http.get('/api/squads/40022/workflow', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null, data: view('READY', { graph: readyGraph }),
      })),
      http.get('/api/squads/40023/workflow', () => HttpResponse.json({
        success: true, code: '0', message: '', traceId: null, data: view('MISSING'),
      })),
    );
    renderPanel();
    await selectSquad();
    await waitFor(() => expect(renderedNodes().length).toBeGreaterThan(0));

    await userEvent.click(screen.getByText('全部路径'));
    await waitFor(() => expect(renderedEdges()).toHaveLength(2));
    await userEvent.click(screen.getByRole('button', { name: '开发' }));
    expect(await screen.findByText('实现需求并移交评审')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: '选择小队' }));
    await userEvent.click(await screen.findByText('另一个小队', { selector: '.ant-select-item-option-content' }));
    expect(await screen.findByRole('button', { name: '生成协作图' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: '选择小队' }));
    await userEvent.click(await screen.findByText('交付小队', { selector: '.ant-select-item-option-content' }));

    await waitFor(() => expect(renderedEdges()).toEqual(['e-dev-review']));
    expect(screen.queryByText('实现需求并移交评审')).not.toBeInTheDocument();
  });

  it('marks rework red and escalation orange in the edge details', async () => {
    useWorkflow(view('READY', { graph: escalationGraph }));
    renderPanel();
    await selectSquad();
    await waitFor(() => expect(renderedNodes().length).toBeGreaterThan(0));
    await userEvent.click(screen.getByText('全部路径'));
    await waitFor(() => expect(renderedEdges()).toHaveLength(3));

    await userEvent.click(document.querySelector('[data-edge-id="e-review-dev"]') as HTMLElement);
    expect((await screen.findByText('返工', { selector: '.ant-tag' })).closest('.ant-tag')).toHaveClass('ant-tag-red');

    await userEvent.click(document.querySelector('[data-edge-id="e-escalate"]') as HTMLElement);
    expect((await screen.findByText('升级', { selector: '.ant-tag' })).closest('.ant-tag')).toHaveClass('ant-tag-orange');
  });
});
