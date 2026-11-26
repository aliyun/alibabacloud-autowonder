import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import { PrdDesignWorkbench } from './PrdDesignWorkbench';
import type { PrdDesign, PrdDesignVersion } from './api';

// The conversation panel owns its own realtime subscription and polling; the workbench test is about
// the version/confirm/delivery wiring, so stub the panel and surface its onConfirm for driving.
const sendComment = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const addComments = vi.hoisted(() => vi.fn());
const startPreparation = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('./components/PrdConversation', () => ({
  PrdConversation: forwardRef(({ onDraftChange, onPrototype, onPreview, suggestion, element, onClearElement,
    onEmployeeOfflineChange, onProcessingChange, setupExtra, setupLocked, ready }: {
    onDraftChange?: (draft: unknown) => void;
    onPrototype?: (pages: { html: string }[]) => void;
    onPreview?: (html: string) => void;
    suggestion?: { text: string };
    element?: { selector: string } | null;
    onClearElement?: () => void;
    onEmployeeOfflineChange?: (offline: boolean) => void;
    onProcessingChange?: (processing: boolean) => void;
    setupExtra?: ReactNode;
    setupLocked?: boolean;
    ready?: boolean;
  }, ref) => {
    useImperativeHandle(ref, () => ({ sendComment, addComments, startPreparation }));
    return (
    <div data-testid="ai-session-panel" data-ready={ready} data-setup-locked={setupLocked}>
      {setupExtra}
      <button type="button" onClick={() => onEmployeeOfflineChange?.(true)}>employee-offline</button>
      <button type="button" onClick={() => onProcessingChange?.(true)}>agent-processing</button>
      {element && <button type="button" onClick={() => onClearElement?.()}>clear-element</button>}
      {element && <p data-testid="picked-element">{element.selector}</p>}
      <button type="button" onClick={() => onPreview?.('<h1>Live preview</h1>')}>live-preview</button>
      <button type="button" onClick={() => onDraftChange?.({ conversationId: 50, turnId: 60, content: '{"title":"New design"}' })}>confirm-session</button>
      <button type="button" onClick={() => {
        onDraftChange?.({ conversationId: 50, turnId: 59, createdAt: '2026-09-01T08:00:00', content: JSON.stringify({
          pages: [{ mockHtml: '<h1>Old prototype</h1>' }], openQuestions: [{ key: 'OLD', question: 'Old question', blocking: true }],
        }) });
        onPrototype?.([{ html: '<h1>Old prototype</h1>' }]);
      }}>restore-old-reply</button>
      <button type="button" onClick={() => {
        onDraftChange?.(null);
        onPrototype?.([{ html: '<h1>Streaming prototype</h1>' }]);
      }}>stream-preview</button>
      {suggestion && <p>{suggestion.text}</p>}
    </div>
    );
  }),
}));

const ok = (data: unknown) => HttpResponse.json({ success: true, code: '0', message: '', traceId: null, data });

const version = (overrides: Partial<PrdDesignVersion> = {}): PrdDesignVersion => ({
  id: 5001,
  version: 0,
  designId: 1000,
  versionNo: 1,
  status: 'DRAFT',
  sourceVersionId: null,
  designSha256: 'd'.repeat(64),
  htmlOssRef: 'bucket/key.html',
  htmlSha256: 'h'.repeat(64),
  htmlSize: 2048,
  rendererVersion: 'prd-html-renderer-v1',
  summary: null,
  changeSummary: '初稿',
  requirementCount: 1,
  openQuestionCount: 0,
  blockingQuestionCount: 0,
  aiSessionId: null,
  confirmedBy: null,
  confirmedAt: null,
  confirmedSha256: null,
  gmtCreate: '2026-10-01T08:00:00',
  designJson: JSON.stringify({
    title: '工单批量导入',
    requirements: [{ key: 'REQ-001', title: '上传 CSV', priority: 'P0', acceptanceCriteria: ['超过 10MB 拒绝'] }],
    openQuestions: [],
  }),
  ...overrides,
});

const design = (overrides: Partial<PrdDesign> = {}): PrdDesign => ({
  id: 1000,
  workitemId: 10,
  targetRepoId: 42,
  targetProfileId: 55,
  targetAppRoot: 'frontend',
  targetCommitSha: 'c'.repeat(40),
  confirmedVersionId: null,
  confirmedVersionNo: null,
  confirmedSha256: null,
  deliveryMode: 'LEGACY',
  latestVersionNo: 1,
  contentLanguage: null,
  version: 0,
  gmtModified: '2026-10-01T08:00:00',
  versions: [],
  ...overrides,
});

function renderWorkbench(initialEntry = '/workitems/10/design') {
  const router = createMemoryRouter(
    [{ path: '/workitems/:workitemId/design', element: <PrdDesignWorkbench /> }],
    { initialEntries: [initialEntry] },
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConfigProvider locale={zhCN}>
        <RouterProvider router={router} />
      </ConfigProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
  server.use(
    http.get('/api/workitems/10/prd/launch', () => ok({
      conversationId: null,
      agentId: null,
      squadId: null,
      repoId: null,
      phase: 'ACTIVE',
      managed: false,
    })),
    http.get('/api/workitems/10/prd/review/share', () => ok({ share: null, configured: true })),
    http.get('/api/workitems/10/prd/review/share/name', () => ok({ slug: null, canManage: true })),
    http.get('/api/workitems/10/prd/handoff', () => ok({ canSubmit: false, managed: false, review: null, completed: null })),
    http.get('/api/workitems/10/prd/versions/5001/markdown', () => ok({ versionId: 5001, fileName: 'prd-10.md', markdown: '# 需求说明' })),
    http.get('/api/workitems/10/prd/conversation/selection', () => ok(null)),
    http.get('/api/squads/10000/members', () => ok([
      { agentId: 10001, agentName: '码力', roleCode: 'AW_FS_DEV', executorOnline: true },
    ])),
    http.get('/api/workitems/10/prd/review/preview-status', () => ok({ status: 'READY', origin: window.location.origin, basePath: '/design-preview/binding/' })),
    http.post('/api/workitems/10/prd/review/preview-session', () => ok({ status: 'READY', origin: window.location.origin, basePath: '/design-preview/binding/', code: 'entry', expiresAt: null })),
  );
  addComments.mockClear();
  server.use(http.get('/api/workitems/10/prd/review', () => ok({ comments: [], canManage: true, viewerId: 7 })));
  sendComment.mockClear();
  startPreparation.mockClear();
  server.use(http.get('/api/workitems/10/prd/runtime', () => ok(null)));
  useAuthStore.setState({ accessLevel: 'READ_WRITE', readOnlyDomains: [] });
  // The preview iframe fetches raw HTML; stub it so the workbench render does not 404 in the test.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<h1>PRD</h1>', { status: 200 })));
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:prd-html'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});

afterEach(() => {
  useAuthStore.getState().clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PrdDesignWorkbench', () => {
  it('shows the document version and preserves the design iframe while switching previews', async () => {
    server.use(
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([version()])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(version())),
      http.get('/api/workitems/10/prd/runtime', () => ok({
        conversationId: 20, executorId: 30, turnId: 50, dispatchAttempt: 1,
        status: 'READY', port: 5174, route: '/', directory: 'design-demo/10/template',
        error: null, revision: 1,
      })),
    );
    renderWorkbench();
    expect(await screen.findByText('需求文档 v1')).toBeInTheDocument();
    expect(screen.queryByText(/^v1$/)).not.toBeInTheDocument();
    const designFrame = await screen.findByTitle('产品与交互设计');
    await userEvent.click(screen.getByText('需求文档 v1'));
    expect(await screen.findByRole('button', { name: '下载 Markdown' })).toBeInTheDocument();
    expect(designFrame).toBeInTheDocument();
    expect(designFrame).not.toBeVisible();
    await userEvent.click(screen.getByText('交互设计'));
    expect(screen.getByTitle('产品与交互设计')).toBe(designFrame);
    expect(designFrame).toBeVisible();
  });

  it('opens the saved requirements document from its link', async () => {
    server.use(
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([version()])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(version())),
    );
    renderWorkbench('/workitems/10/design?prdDocument=5001');
    expect(await screen.findByRole('heading', { name: '需求说明' })).toBeInTheDocument();
  });

  it('opens review submission from the same toolbar as the design and document tabs', async () => {
    server.use(
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([version()])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(version())),
      http.get('/api/workitems/10/prd/handoff', () => ok({
        canSubmit: true, managed: true, review: null, completed: null,
      })),
      http.get('/api/workitems/10/prd/handoff/reviewers', () => ok([])),
    );
    const view = renderWorkbench('/workitems/10/design?prdAgent=10001&prdSquad=10000');
    const button = await screen.findByRole('button', { name: '提交设计评审' });
    const header = view.container.querySelector<HTMLElement>('.prd-design-header');
    expect(header).toContainElement(button);
    const toolbar = within(header!);
    expect(toolbar.getByText('交互设计')).toBeVisible();
    expect(toolbar.getByText('需求文档 v1')).toBeVisible();
    expect(view.container.querySelector('.prd-design-notices')).toBeEmptyDOMElement();

    await userEvent.click(button);
    await waitFor(() => expect(screen.getByRole('dialog', { name: '提交设计评审' })).toBeVisible());
  });

  it('waits for the deliverables before offering requirement clarification', async () => {
    const review: import('./handoff').DesignReview = {
      id: 99, versionId: 5001, status: 'IN_REVIEW', repoId: 41, branch: 'autowonder-review/1/10/99-aaaaaaaaaaaaaaaa',
      repoUrl: 'https://example.invalid/team/design.git', reviewerIds: [7], decisionReason: null,
      commit: 'a'.repeat(40), attachmentId: null, attachmentName: null,
      canDecide: true, canWithdraw: false, canRetry: false,
    };
    const decide = vi.fn(async (request: Request) => {
      expect(await request.json()).toEqual({ action: 'APPROVE' });
      review.status = 'ATTACHING';
      review.canDecide = false;
      return ok(review);
    });
    server.use(
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([version()])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(version())),
      http.get('/api/workitems/10/prd/handoff', () => ok({
        canSubmit: false, managed: true, review, completed: review.status === 'COMPLETED' ? review : null,
      })),
      http.post('/api/workitems/10/prd/handoff/99/decision', ({ request }) => decide(request)),
    );
    const user = userEvent.setup();
    const view = renderWorkbench('/workitems/10/design?prdDocument=5001');
    const status = await screen.findByRole('button', { name: '设计评审中' });
    expect(view.container.querySelector('.prd-design-header')).toContainElement(status);
    expect(screen.queryByRole('button', { name: '通过设计评审' })).not.toBeInTheDocument();
    await user.click(status);
    const reviewDetails = await screen.findByRole('dialog', { name: '设计评审中' });
    await user.click(within(reviewDetails).getByRole('button', { name: '通过设计评审' }));
    const dialog = await screen.findByRole('dialog', { name: '通过设计评审' });
    await user.click(within(dialog).getByRole('button', { name: '通过设计评审' }));
    await user.click(await screen.findByRole('button', { name: '正在归档需求说明' }));
    expect(await screen.findByText('评审已通过，正在归档需求说明')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '进入需求澄清' })).not.toBeInTheDocument();
    expect(decide).toHaveBeenCalledTimes(1);
    review.status = 'COMPLETED';
    review.attachmentId = 123;
    review.attachmentName = 'prd-10-review-99.md';
    expect(await screen.findByRole('link', { name: '进入需求澄清' }, { timeout: 6000 }))
      .toHaveAttribute('href', '/workitems/10?panel=clarify&fullscreen=1');
  });

  it('sends the selected Agent a recovery message when the preview cannot connect', async () => {
    server.use(
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([version()])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(version())),
      http.get('/api/workitems/10/prd/runtime', () => ok({
        conversationId: 20, executorId: 30, turnId: 50, dispatchAttempt: 1,
        status: 'READY', port: 5174, route: '/', directory: 'design-demo/10/template',
        error: null, revision: 1,
      })),
      http.post('/api/workitems/10/prd/review/preview-session', () => ok({
        status: 'UNCONFIGURED', origin: null, basePath: null,
      })),
    );

    renderWorkbench('/workitems/10/design?prdAgent=10001&prdSquad=10000');
    expect(await screen.findByText('请让 Agent「码力」检查并恢复预览服务；若仍未连接，请检查平台预览入口与隧道配置。')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '让 Agent 恢复' }));

    await waitFor(() => expect(startPreparation).toHaveBeenCalledWith(
      '请检查并恢复当前需求的设计预览。优先复用现有工作目录和前端开发服务；如果服务已停止，请重新启动并重新上报 READY 或 UPDATED 状态。请勿创建重复的工作目录或预览服务。',
      expect.any(String),
      'RECOVER',
    ));
  });

  it('disables preview recovery while the selected Agent is already processing', async () => {
    server.use(
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([version()])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(version())),
      http.get('/api/workitems/10/prd/runtime', () => ok({
        conversationId: 20, executorId: 30, turnId: 50, dispatchAttempt: 1,
        status: 'READY', port: 5174, route: '/', directory: 'design-demo/10/template',
        error: null, revision: 1,
      })),
      http.post('/api/workitems/10/prd/review/preview-session', () => ok({
        status: 'UNCONFIGURED', origin: null, basePath: null,
      })),
    );

    renderWorkbench('/workitems/10/design?prdAgent=10001&prdSquad=10000');
    await screen.findByRole('button', { name: '让 Agent 恢复' });
    await userEvent.click(screen.getByRole('button', { name: 'agent-processing' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '让 Agent 恢复' })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: '预览暂未连接' })).toBeInTheDocument();
    expect(screen.queryByText('正在设计中')).not.toBeInTheDocument();
    expect(startPreparation).not.toHaveBeenCalled();
  });

  it('keeps design settings collapsed on refresh when all required values are already saved', async () => {
    server.use(
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([version()])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(version())),
      http.get('/api/workitems/10/prd/conversation/selection', () => ok({ agentId: 10001, squadId: 10000 })),
    );
    renderWorkbench();
    await waitFor(() => expect(screen.getByRole('button', { name: /设计设置/ })).toHaveAttribute('aria-expanded', 'false'));
  });

  it('opens the launch dialog before a new design has been started', async () => {
    server.use(
      http.get('/api/workitems/10/prd/launch', () => ok({
        conversationId: null, agentId: null, squadId: null, repoId: null, phase: 'NEW', managed: false,
      })),
    );
    renderWorkbench();
    expect(await screen.findByRole('dialog', { name: '原型&交互设计' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '空间仓库' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始设计' })).toBeDisabled();
    expect(screen.queryByTestId('ai-session-panel')).not.toBeInTheDocument();
  });

  it('keeps the conversation unavailable while a managed design environment is preparing', async () => {
    server.use(
      http.get('/api/workitems/10/prd/launch', () => ok({
        conversationId: 20, agentId: 10001, squadId: 10000, repoId: null, phase: 'PREPARING', managed: true,
      })),
      http.get('/api/workitems/10/prd', () => ok(design({ targetRepoId: null }))),
      http.get('/api/workitems/10/prd/versions', () => ok([])),
    );
    renderWorkbench();
    expect(await screen.findByTestId('ai-session-panel')).toHaveAttribute('data-ready', 'false');
    expect(screen.getByText('正在准备设计环境')).toBeInTheDocument();
    expect(screen.getByTestId('ai-session-panel')).toHaveAttribute('data-setup-locked', 'true');
  });

  it('retries a failed managed design preparation and becomes ready', async () => {
    let phase = 'FAILED_PREPARING';
    const retry = vi.fn(() => { phase = 'ACTIVE'; });
    server.use(
      http.get('/api/workitems/10/prd/launch', () => ok({
        conversationId: 20, agentId: 10001, squadId: 10000, repoId: null, phase, managed: true,
      })),
      http.get('/api/workitems/10/prd', () => ok(design({ targetRepoId: null }))),
      http.get('/api/workitems/10/prd/versions', () => ok([])),
      http.post('/api/workitems/10/prd/launch/retry', () => { retry(); return ok(null); }),
    );
    renderWorkbench();
    expect(await screen.findByTestId('ai-session-panel')).toHaveAttribute('data-ready', 'false');
    await userEvent.click(await screen.findByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(screen.getByTestId('ai-session-panel')).toHaveAttribute('data-ready', 'true'));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps the conversation open after refreshing an existing template design', async () => {
    server.use(
      http.get('/api/workitems/10/prd', () => ok(design({ targetRepoId: null }))),
      http.get('/api/workitems/10/prd/versions', () => ok([])),
      http.get('/api/workitems/10/prd/conversation/selection', () => ok({ agentId: 10001, squadId: 10000 })),
      http.get('/api/workitems/10/prd/runtime', () => ok({ conversationId: 50, status: 'READY', route: '/' })),
    );
    renderWorkbench();
    await waitFor(() => {
      expect(screen.getByTestId('ai-session-panel')).toHaveAttribute('data-ready', 'true');
      expect(screen.getByRole('button', { name: /设计设置/ })).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('opens design settings when the selected employee goes offline', async () => {
    server.use(
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([version()])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(version())),
      http.get('/api/workitems/10/prd/conversation/selection', () => ok({ agentId: 10001, squadId: 10000 })),
    );
    renderWorkbench();
    const settings = await screen.findByRole('button', { name: /设计设置/ });
    await waitFor(() => expect(settings).toHaveAttribute('aria-expanded', 'false'));
    await userEvent.click(screen.getByRole('button', { name: 'employee-offline' }));
    await waitFor(() => expect(settings).toHaveAttribute('aria-expanded', 'true'));
  });

  it('locks design setup after the runtime has started', async () => {
    server.use(
      http.get('/api/repos', () => ok([{ id: 42, name: 'fixture', url: 'git@example.com:group/fixture.git' }])),
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([version()])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(version())),
      http.get('/api/workitems/10/prd/runtime', () => ok({
        conversationId: 50, executorId: 9, directory: 'demo', port: 5174, route: '/', revision: 1, status: 'READY',
      })),
    );
    renderWorkbench('/workitems/10/design?prdAgent=10001&prdSquad=10000');
    await waitFor(() => expect(screen.getByTestId('ai-session-panel')).toHaveAttribute('data-setup-locked', 'true'));
    expect(screen.getByText('设计来源 · 新项目')).toBeInTheDocument();
  });

  it('keeps the local design independent from older and streaming static prototypes', async () => {
    const saved = version({ designJson: JSON.stringify({ pages: [{ mockHtml: '<h1>Saved prototype</h1>' }], openQuestions: [] }) });
    server.use(
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([saved])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(saved)),
      http.get('/api/workitems/10/prd/runtime', () => ok({ conversationId: 50, executorId: 9, directory: 'demo', port: 5174, route: '/', revision: 1, status: 'READY' })),
    );
    renderWorkbench();
    const frame = await screen.findByTitle('产品与交互设计');
    expect(frame).toHaveAttribute('src', `${window.location.origin}/design-preview/binding/`);
    await userEvent.click(screen.getByRole('button', { name: 'restore-old-reply' }));
    expect(screen.getByTitle('产品与交互设计')).toBe(frame);
    expect(screen.queryByText(/还有.*问题待澄清/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'stream-preview' }));
    expect(frame).toHaveAttribute('src', `${window.location.origin}/design-preview/binding/`);
    expect(frame).not.toHaveAttribute('srcdoc');
  });

  it('shows the repository selected when the design was launched', async () => {
    server.use(
      http.get('/api/workitems/10/prd/launch', () => ok({
        conversationId: 20, agentId: 10001, squadId: 10000, repoId: 42, phase: 'ACTIVE', managed: true,
      })),
      http.get('/api/repos/42', () => ok({
        id: 42, name: 'fixture', url: 'git@example.com:group/fixture.git', defaultBranch: 'master',
        description: null, scanStatus: null, version: 0, gmtCreate: '2026-10-01T08:00:00',
      })),
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([version()])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(version())),
    );
    renderWorkbench();
    expect(await screen.findByText('设计来源 · fixture')).toBeInTheDocument();
    expect(screen.getByTestId('ai-session-panel')).toHaveAttribute('data-ready', 'true');
  });

  it('loads the design, its versions and the requirement index', async () => {
    server.use(
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([version()])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(version())),
    );
    renderWorkbench();
    expect(screen.queryByText('上传 CSV')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /文档版本历史与本版需求项/ }));

    expect(await screen.findByText('REQ-001')).toBeInTheDocument();
    expect(screen.getByText('上传 CSV')).toBeInTheDocument();
    expect(screen.getByTestId('ai-session-panel')).toBeInTheDocument();
  });

  it('keeps historical designs readable without offering document confirmation as design review', async () => {
    const confirm = vi.fn();
    server.use(
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([version()])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(version())),
      http.post('/api/workitems/10/prd/confirm', () => confirm()),
    );
    renderWorkbench('/workitems/10/design?prdDocument=5001');
    expect(await screen.findByRole('heading', { name: '需求说明' })).toBeInTheDocument();
    expect(await screen.findByText(/尚未关联可用于交付的仓库工程/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认文档' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提交评审' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始交付' })).not.toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps start-delivery disabled until the workitem is PRD-driven with a confirmed version', async () => {
    server.use(
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([version()])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(version())),
    );
    renderWorkbench();
    expect(screen.queryByText('上传 CSV')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /文档版本历史与本版需求项/ }));

    await screen.findByText('REQ-001');
    // The button carries a rocket icon whose aria-label joins the accessible name, so match the text.
    expect(screen.queryByRole('button', { name: /开始交付/ })).not.toBeInTheDocument();
  });

  it('persists a local design comment and adds a reference without starting an agent turn', async () => {
    const saved = version({ designJson: JSON.stringify({ pages: [{ mockHtml: '<button id="save">Save</button>' }], openQuestions: [] }) });
    server.use(
      http.get('/api/workitems/10/prd', () => ok(design())),
      http.get('/api/workitems/10/prd/versions', () => ok([saved])),
      http.get('/api/workitems/10/prd/versions/5001', () => ok(saved)),
      http.get('/api/workitems/10/prd/runtime', () => ok({ conversationId: 50, executorId: 9, directory: 'demo', port: 5174, route: '/', revision: 1, status: 'READY' })),
      http.get('/api/workitems/10/prd/review', () => ok({ comments: [], canManage: true, viewerId: 7 })),
      http.post('/api/workitems/10/prd/review/comments', async ({ request }) => {
        const body = await request.json() as { commentText: string; element: { selector: string } };
        expect(body.element.selector).toBe('#save');
        return ok({ comment: { id: 81, conversationId: 50, sourceKey: 'template', selector: '#save', commentText: body.commentText } });
      }),
    );
    renderWorkbench();
    await screen.findByTitle('产品与交互设计');
    const inspect = screen.getByRole('button', { name: '圈选评论' });
    // 初次连接可能重建 iframe；只在当前画布完成就绪握手后圈选。
    await waitFor(() => {
      const current = screen.getByTitle('产品与交互设计') as HTMLIFrameElement;
      window.dispatchEvent(new MessageEvent('message', { source: current.contentWindow,
        origin: window.location.origin, data: { type: 'demo:ready' } }));
      expect(inspect).toBeEnabled();
    });
    await userEvent.click(inspect);
    await waitFor(() => expect(inspect).toHaveAttribute('aria-pressed', 'true'));
    act(() => {
      const frame = screen.getByTitle('产品与交互设计') as HTMLIFrameElement;
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: window.location.origin,
        data: { type: 'inspect:select', tagName: 'button', selector: '#save', textPreview: 'Save' } }));
    });
    await userEvent.type(screen.getByRole('textbox', { name: '针对选中元素发表评论' }), 'Make it larger');
    await userEvent.click(screen.getByRole('button', { name: '保存并加入对话' }));
    await waitFor(() => expect(addComments).toHaveBeenCalledWith([expect.objectContaining({ id: 81, commentText: 'Make it larger', selector: '#save' })]));
    expect(sendComment).not.toHaveBeenCalled();
  });

});
