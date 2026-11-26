import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/shared/api/client';
import { PrdDesignBrowser } from './PrdDesignBrowser';
import type { PrdDesignRuntime } from '../designBrowser';
import type { ReviewCommentView } from '../review';

vi.mock('@/shared/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
const runtime: PrdDesignRuntime = { conversationId: 20, executorId: 30, turnId: 50, dispatchAttempt: 1,
  status: 'READY', port: 5174, route: '/', directory: 'design-demo/10/template', error: null, revision: 1 };
const queryKey = ['prd-design-runtime', '10', 40];
function setup(onComment = vi.fn().mockResolvedValue(undefined)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?prdAgent=40']}>
    <PrdDesignBrowser workitemId="10" onComment={onComment} />
  </MemoryRouter></QueryClientProvider>);
  return { ...result, client, onComment };
}
function emit(frame: HTMLIFrameElement, data: object, origin = window.location.origin) {
  act(() => window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow, origin })));
}
beforeEach(() => {
  vi.mocked(apiClient.get).mockImplementation(async url => ({ data: String(url).endsWith('/preview-status') ? { status: 'READY', origin: window.location.origin, basePath: '/design-preview/binding/' } : runtime }) as never);
  vi.mocked(apiClient.post).mockResolvedValue({ data: { status: 'READY', origin: window.location.origin, basePath: '/design-preview/binding/', code: 'member-entry', expiresAt: null } } as never);
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('')));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('PrdDesignBrowser', () => {
  it('explains nested previews without mounting a frame or requesting authorization', async () => {
    const original = window.location.href;
    window.history.replaceState({}, '', '/design-preview/binding/workitems/10/design');
    const view = setup();
    try {
      expect(screen.getByRole('heading', { name: '请在独立页面中查看设计' })).toBeInTheDocument();
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      fireEvent.click(screen.getByRole('button', { name: '在新标签页打开设计' }));
      expect(open).toHaveBeenCalledWith(`${window.location.origin}/workitems/10/design?prdAgent=40`, '_blank', 'noopener,noreferrer');
      expect(screen.queryByTitle('产品与交互设计')).not.toBeInTheDocument();
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(apiClient.get).not.toHaveBeenCalled();
      expect(apiClient.post).not.toHaveBeenCalled();
      expect(HTMLFormElement.prototype.submit).not.toHaveBeenCalled();
    } finally {
      view.unmount(); view.client.clear(); window.history.replaceState({}, '', original);
    }
  });
  it('connects a loaded plain HTML preview with no embedded provider instead of waiting forever', async () => {
    const view = setup();
    try {
      const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
      frame.contentDocument!.open();
      frame.contentDocument!.write('<html><head></head><body><main><h1>Preview content</h1></main></body></html>');
      frame.contentDocument!.close();
      Object.defineProperty(frame.contentDocument!, 'readyState', { configurable: true, value: 'complete' });
      Object.defineProperty(frame.contentWindow!.performance, 'getEntriesByType', { configurable: true,
        value: (type: string) => type === 'navigation' ? [{ responseStatus: 200 }] : [] });
      fireEvent.load(frame);
      await waitFor(() => expect(frame.contentDocument!.querySelector('script[data-autowonder-preview-inspector]')?.getAttribute('src'))
        .toBe(new URL('/preview-inspector/bridge-v1.js', window.location.origin).href));
      emit(frame, { type: 'demo:ready' });
      expect(screen.queryByText('正在加载预览，请稍候')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '圈选评论' })).toBeEnabled();
    } finally { view.unmount(); view.client.clear(); }
  });
  it('connects a rendered Vite app when an optional classic runtime config is missing', async () => {
    const view = setup();
    try {
      const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
      frame.contentDocument!.open();
      frame.contentDocument!.write('<html><head><script src="/config.js"></script><script type="module" src="/demo/main.tsx"></script></head><body><div id="root"><main>CRM</main></div></body></html>');
      frame.contentDocument!.close();
      Object.defineProperty(frame.contentDocument!, 'readyState', { configurable: true, value: 'complete' });
      Object.defineProperty(frame.contentWindow!.performance, 'getEntriesByType', { configurable: true,
        value: (type: string) => type === 'navigation' ? [{ responseStatus: 200 }]
          : type === 'resource' ? [
            { name: `${window.location.origin}/config.js`, initiatorType: 'script', responseStatus: 404 },
            { name: `${window.location.origin}/demo/main.tsx`, initiatorType: 'script', responseStatus: 200 },
          ] : [] });
      fireEvent.load(frame);
      await waitFor(() => expect(frame.contentDocument!.querySelector('script[data-autowonder-preview-inspector]')).not.toBeNull());
      emit(frame, { type: 'demo:ready' });
      expect(screen.queryByText('正在加载预览，请稍候')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '圈选评论' })).toBeEnabled();
    } finally { view.unmount(); view.client.clear(); }
  });
  it('does not install a preview bridge into a gateway error document', async () => {
    const view = setup();
    try {
      const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
      frame.contentDocument!.open();
      frame.contentDocument!.write('<html><head></head><body><main>Service unavailable</main></body></html>');
      frame.contentDocument!.close();
      Object.defineProperty(frame.contentDocument!, 'readyState', { configurable: true, value: 'complete' });
      Object.defineProperty(frame.contentWindow!.performance, 'getEntriesByType', { configurable: true,
        value: (type: string) => type === 'navigation' ? [{ responseStatus: 503 }] : [] });
      fireEvent.load(frame);
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(frame.contentDocument!.querySelector('script[data-autowonder-preview-inspector]')).toBeNull();
      expect(screen.getByRole('button', { name: '圈选评论' })).toBeDisabled();
    } finally { view.unmount(); view.client.clear(); }
  });
  function failedScript(frame: HTMLIFrameElement) {
    Object.defineProperty(frame.contentWindow!.performance, 'getEntriesByType', { configurable: true,
      value: (type: string) => type === 'resource' ? [{ initiatorType: 'script', responseStatus: 503 }] : [],
    });
  }
  it('requests fresh entry codes and bounds automatic recovery when a required script fails before startup', async () => {
    let entry = 0;
    vi.mocked(apiClient.post).mockImplementation(async () => ({ data: { status: 'READY', origin: window.location.origin,
      basePath: '/design-preview/binding/', code: `entry-${++entry}`, expiresAt: null } }) as never);
    const view = setup();
    try {
      const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
      failedScript(frame);
      for (let attempt = 0; attempt < 3; attempt++) {
        fireEvent.load(frame);
        await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(attempt + 2), { timeout: 5500 });
      }
      fireEvent.load(frame);
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(apiClient.post).toHaveBeenCalledTimes(4);
      expect(HTMLFormElement.prototype.submit).toHaveBeenCalledTimes(4);
    } finally { view.unmount(); view.client.clear(); }
  }, 20000);
  it('reconnects when the browser reports a failed module preload as other', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { status: 'READY', origin: window.location.origin,
      basePath: '/design-preview/binding/', code: 'initial-entry', expiresAt: null } } as never);
    const view = setup();
    try {
      const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
      const module = frame.contentDocument!.createElement('link');
      module.rel = 'modulepreload';
      module.href = `${window.location.origin}/design-preview/binding/src/main.tsx`;
      frame.contentDocument!.appendChild(module);
      Object.defineProperty(frame.contentWindow!.performance, 'getEntriesByType', { configurable: true,
        value: (type: string) => type === 'resource' ? [{ name: module.href, initiatorType: 'other', responseStatus: 503 }] : [],
      });
      fireEvent.load(frame);
      await waitFor(() => expect(HTMLFormElement.prototype.submit).toHaveBeenCalledTimes(2), { timeout: 3000 });
      emit(frame, { type: 'demo:ready' });
      expect(screen.getByRole('button', { name: '圈选评论' })).toBeEnabled();
    } finally { view.unmount(); view.client.clear(); }
  });
  it('does not reload an initialized application or replay its requests because a script failed', async () => {
    const view = setup();
    try {
      const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
      failedScript(frame);
      const html = frame.contentDocument!.createElement('html');
      html.appendChild(frame.contentDocument!.createElement('body'));
      frame.contentDocument!.replaceChildren(html);
      frame.contentDocument!.body.innerHTML = '<div id="root"><main>Mounted application</main></div>';
      fireEvent.load(frame);
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(apiClient.post).toHaveBeenCalledTimes(1);
      emit(frame, { type: 'demo:ready' });
      frame.contentDocument!.body.replaceChildren();
      fireEvent.load(frame);
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(apiClient.post).toHaveBeenCalledTimes(1);
    } finally { view.unmount(); view.client.clear(); }
  });
  it.each([
    ['LOCAL_SERVICE_UNAVAILABLE', '登记的 Vite 服务不可用'],
    ['DISCONNECTED', '预览连接尚未注册或已断开'],
    ['RUNTIME_NOT_READY', '尚无就绪的运行记录'],
  ])('explains why the saved design cannot reconnect: %s', async (reason, message) => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { status: 'OFFLINE', reason } } as never);
    setup();
    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(HTMLFormElement.prototype.submit).not.toHaveBeenCalled();
  });
  it('shows only the automatic recovery state while preview restoration is already running', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { status: 'OFFLINE', reason: 'RECOVERING' } } as never);
    const recover = vi.fn().mockResolvedValue(undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?prdAgent=40']}>
      <PrdDesignBrowser workitemId="10" agentName="码力" onRecoverPreview={recover} />
    </MemoryRouter></QueryClientProvider>);

    expect(await screen.findByRole('heading', { name: '正在恢复预览' })).toBeInTheDocument();
    expect(screen.queryByText(/请让 Agent/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '让 Agent 恢复' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重\s*试/ })).not.toBeInTheDocument();
  });
  it.each([
    ['EXECUTOR_OFFLINE', '当前执行器离线'],
    ['RECOVERY_TIMEOUT', '预览恢复超时'],
  ])('requests recovery for a prepared design and shows %s', async (reason, message) => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { ...runtime, status: 'PREPARED', port: null } } as never);
    vi.mocked(apiClient.post).mockImplementation(async url => ({ data: { status: 'OFFLINE',
      reason: String(url).endsWith('/preview-session') ? 'RECOVERY_REQUIRED' : reason } }) as never);
    setup();
    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith('/api/workitems/10/prd/review/preview-recovery', null,
      expect.objectContaining({ params: { agentId: 40 } }));
    expect(screen.queryByTitle('产品与交互设计')).not.toBeInTheDocument();
  });
  it('restores an existing design without asking for another design task', async () => {
    let online = false;
    vi.mocked(apiClient.post).mockImplementation(async () => ({ data: online
      ? { status: 'READY', origin: window.location.origin, basePath: '/design-preview/binding/', code: null }
      : { status: 'OFFLINE' } }) as never);
    setup();
    expect(await screen.findByText('已有设计已保存，连接恢复后会自动显示，无需重新发起设计。')).toBeInTheDocument();
    expect(screen.queryByText(/请在左侧发起设计/)).not.toBeInTheDocument();
    expect(screen.queryByTitle('产品与交互设计')).not.toBeInTheDocument();
    expect(HTMLFormElement.prototype.submit).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '预览暂未连接' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    online = true;
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByTitle('产品与交互设计')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '预览暂未连接' })).not.toBeInTheDocument();
  });
  it('asks the selected Agent to recover an unavailable member preview', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { status: 'UNCONFIGURED', origin: null, basePath: null } } as never);
    const recover = vi.fn().mockResolvedValue(undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?prdAgent=40']}>
      <PrdDesignBrowser workitemId="10" agentName="码力" onRecoverPreview={recover} />
    </MemoryRouter></QueryClientProvider>);

    expect(await screen.findByText('请让 Agent「码力」检查并恢复预览服务；若仍未连接，请检查平台预览入口与隧道配置。')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '让 Agent 恢复' }));
    await waitFor(() => expect(recover).toHaveBeenCalledOnce());
  });
  it('does not allow another recovery request while the Agent is already processing', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { status: 'UNCONFIGURED', origin: null, basePath: null } } as never);
    const recover = vi.fn().mockResolvedValue(undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?prdAgent=40']}>
      <PrdDesignBrowser workitemId="10" agentName="码力" onRecoverPreview={recover} recoveryDisabled />
    </MemoryRouter></QueryClientProvider>);

    const button = await screen.findByRole('button', { name: '让 Agent 恢复' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(recover).not.toHaveBeenCalled();
  });
  it('loads the platform subpath and retains the route when the preview switches to a new port', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { status: 'READY', origin: window.location.origin,
      basePath: '/design-preview/binding/', code: null, expiresAt: null } } as never);
    const { client } = setup();
    const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
    expect(frame.src).toBe(`${window.location.origin}/design-preview/binding/`);
    expect(apiClient.post).toHaveBeenCalledWith('/api/workitems/10/prd/review/preview-session', null,
      { params: { agentId: 40, direct: true } });
    expect(vi.mocked(apiClient.get).mock.calls.some(([url]) => String(url).endsWith('/preview-status'))).toBe(false);
    expect(HTMLFormElement.prototype.submit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '圈选评论' })).toBeDisabled();
    emit(frame, { type: 'demo:ready' });
    expect(screen.getByRole('button', { name: '圈选评论' })).toBeEnabled();
    emit(frame, { type: 'route:changed', url: `${window.location.origin}/design-preview/binding/settings?q=1#save`, action: 'push' });
    expect(screen.getByRole('textbox', { name: '设计服务地址' })).toHaveValue('/settings?q=1#save');
    emit(frame, { type: 'route:changed', url: `${window.location.origin}/design-preview/binding`, action: 'push' });
    expect(screen.getByRole('textbox', { name: '设计服务地址' })).toHaveValue('/');
    emit(frame, { type: 'route:changed', url: `${window.location.origin}/design-preview/binding/settings?q=1#save`, action: 'push' });
    act(() => client.setQueryData(queryKey, { ...runtime, revision: 2, port: 5175 }));
    await waitFor(() => expect(screen.getByTitle('产品与交互设计')).toHaveAttribute('src', `${window.location.origin}/design-preview/binding/settings?q=1#save`));
    const updated = screen.getByTitle('产品与交互设计');
    act(() => client.setQueryData(queryKey, { ...runtime, revision: 2, port: 5175 }));
    expect(screen.getByTitle('产品与交互设计')).toBe(updated);
  });

  it.each([
    [null, /尚无可预览设计/],
    [{ ...runtime, status: 'STARTING', port: null }, '正在加载预览，请稍候'],
  ])('uses the preview state before an iframe exists even during an active turn', async (currentRuntime, statusText) => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: currentRuntime } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/?prdAgent=40']}>
      <PrdDesignBrowser workitemId="10" processing />
    </MemoryRouter></QueryClientProvider>);
    try {
      expect(await screen.findByText(statusText)).toBeInTheDocument();
      expect(screen.queryByTitle('产品与交互设计')).not.toBeInTheDocument();
      expect(screen.queryByText(/正在设计中/)).not.toBeInTheDocument();
    } finally { view.unmount(); client.clear(); }
  });

  it('covers initial loading and masks Vite errors only while a design turn is active', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onReferences = vi.fn();
    const browser = (processing: boolean) => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/?prdAgent=40']}>
      <PrdDesignBrowser workitemId="10" processing={processing} onReferences={onReferences} />
    </MemoryRouter></QueryClientProvider>;
    const view = render(browser(false));
    const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
    const previewDocument = document.implementation.createHTMLDocument('Vite preview');
    const root = previewDocument.createElement('div');
    root.id = 'root';
    root.append(previewDocument.createElement('main'));
    previewDocument.body.append(root);
    Object.defineProperty(frame, 'contentDocument', { configurable: true, value: previewDocument });
    expect(screen.getByText('正在加载预览，请稍候')).toBeInTheDocument();
    fireEvent.load(frame);
    expect(screen.getByText('正在加载预览，请稍候')).toBeInTheDocument();
    emit(frame, { type: 'demo:ready' });
    expect(screen.queryByText('正在加载预览，请稍候')).toBeNull();
    expect(screen.getByRole('button', { name: '设计评审意见' })).toBeInTheDocument();
    view.rerender(browser(true));
    expect(screen.queryByText('正在设计中，请稍候')).toBeNull();
    act(() => root.replaceChildren());
    expect(screen.queryByText('正在设计中，请稍候')).toBeNull();
    expect(screen.getByRole('button', { name: '设计评审意见' })).toBeInTheDocument();
    act(() => root.append(previewDocument.createElement('main')));
    const viteOverlay = previewDocument.createElement('vite-error-overlay');
    act(() => previewDocument.body.append(viteOverlay));
    expect(await screen.findByText('正在设计中，请稍候')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '设计评审意见' })).toBeNull();
    view.rerender(browser(false));
    expect(screen.queryByText('正在设计中，请稍候')).toBeNull();
    expect(screen.queryByText('正在加载预览，请稍候')).toBeNull();
    expect(screen.getByTitle('产品与交互设计')).toBe(frame);
    view.rerender(browser(true));
    expect(screen.getByText('正在设计中，请稍候')).toBeInTheDocument();
    act(() => viteOverlay.remove());
    await waitFor(() => expect(screen.queryByText('正在设计中，请稍候')).toBeNull());
    expect(screen.getByRole('button', { name: '设计评审意见' })).toBeInTheDocument();
    view.unmount(); client.clear();
  });

  it('locks the outline to the first selected element until the comment is canceled', async () => {
    const { container } = setup();
    const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    const previewDocument = frame.contentDocument!;
    const html = previewDocument.createElement('html');
    const body = previewDocument.createElement('body');
    const target = previewDocument.createElement('button');
    target.id = 'save';
    body.append(target);
    html.append(body);
    previewDocument.replaceChildren(html);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 5, 50, 20));

    emit(frame, { type: 'demo:ready' });
    await userEvent.click(screen.getByRole('button', { name: '圈选评论' }));
    expect(post).toHaveBeenLastCalledWith({ type: 'inspect:enter' }, window.location.origin);
    emit(frame, { type: 'inspect:select', selector: '#save', tagName: 'button', textPreview: 'Save', rect: { x: 10, y: 20, width: 50, height: 20 } });
    expect(post).toHaveBeenLastCalledWith({ type: 'inspect:exit' }, window.location.origin);
    const outline = container.querySelector('.prd-browser-selection-outline');
    expect(outline).toHaveStyle({ left: '10px', top: '20px', width: '50px', height: '20px' });

    await userEvent.type(screen.getByRole('textbox', { name: '针对选中元素发表评论' }), 'Draft');
    emit(frame, { type: 'inspect:hover', selector: '#other', rect: { x: 30, y: 40, width: 80, height: 60 } });
    emit(frame, { type: 'inspect:select', selector: '#other', tagName: 'div', textPreview: 'Other element' });
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '针对选中元素发表评论' })).toHaveValue('Draft');
    expect(outline).toHaveStyle({ left: '10px', top: '20px' });

    fireEvent.scroll(frame.contentWindow!);
    expect(outline).toHaveStyle({ left: '10px', top: '5px' });
    await userEvent.click(screen.getByText(/^取\s*消$/));
    expect(outline).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '圈选评论' }));
    expect(post).toHaveBeenLastCalledWith({ type: 'inspect:enter' }, window.location.origin);
  });

  it('sends selected element feedback and preserves text and id when retrying', async () => {
    const sender = vi.fn().mockRejectedValueOnce(new Error('retry-comment')).mockResolvedValue(undefined);
    setup(sender);
    const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
    emit(frame, { type: 'demo:ready' });
    await userEvent.click(screen.getByRole('button', { name: '圈选评论' }));
    emit(frame, { type: 'inspect:select', selector: '#save', tagName: 'button', textPreview: 'Save', rect: { x: 1, y: 2, width: 50, height: 20 } });
    await userEvent.type(screen.getByRole('textbox', { name: '针对选中元素发表评论' }), 'Make this larger');
    await userEvent.click(screen.getByRole('button', { name: '发送到设计对话' }));
    expect(await screen.findByText('retry-comment')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '发送到设计对话' }));
    await waitFor(() => expect(sender).toHaveBeenCalledTimes(2));
    expect(sender.mock.calls[0]).toEqual(sender.mock.calls[1]);
    expect(sender.mock.calls[0][1]).toMatchObject({ selector: '#save', page: '/', tag: 'button' });
  });

  it('ignores messages from another origin and reports failed or absent runtimes', async () => {
    const { client } = setup();
    const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
    emit(frame, { type: 'demo:ready' }, 'https://evil.example');
    expect(screen.getByRole('button', { name: '圈选评论' })).toBeDisabled();
    act(() => client.setQueryData(queryKey, { ...runtime, status: 'FAILED', error: 'vite-start-failed' }));
    expect(await screen.findByText('vite-start-failed')).toBeInTheDocument();
    act(() => client.setQueryData(queryKey, null));
    expect(await screen.findByText(/在左侧发起设计/)).toBeInTheDocument();
    expect(screen.queryByTitle('产品与交互设计')).not.toBeInTheDocument();
  });

  it('restores the displayed route with Escape and cancels the anchored comment without sending', async () => {
    const { onComment } = setup();
    const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
    emit(frame, { type: 'demo:ready' });
    emit(frame, { type: 'route:changed', url: `${window.location.origin}/design-preview/binding/details?q=1#save` });
    const address = screen.getByRole('textbox', { name: '设计服务地址' });
    await userEvent.clear(address);
    await userEvent.type(address, '/unfinished{Escape}');
    expect(address).toHaveValue('/details?q=1#save');
    await userEvent.click(screen.getByRole('button', { name: '圈选评论' }));
    emit(frame, { type: 'inspect:select', selector: '#save', tagName: 'button', textPreview: 'Save', rect: { x: 1, y: 2, width: 50, height: 20 } });
    expect(screen.getByRole('dialog', { name: '针对选中元素发表评论' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: '针对选中元素发表评论' }), 'Draft{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '圈选评论' })).toHaveAttribute('aria-pressed', 'false');
    expect(onComment).not.toHaveBeenCalled();
  });
  it('bootstraps a late remote preview once and preserves the live route during renewal', async () => {
    const submitted: Record<string, string>[] = [];
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
      submitted.push(Object.fromEntries(Array.from(this.querySelectorAll('input')).map(input => [input.name, input.value])));
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const context = { title: 'Review', workitemId: 10, viewerId: 1, runtime: { ...runtime, port: null }, sourceKey: 'source', canManage: false, comments: [] };
    const draw = (entry: { status: 'READY'; origin: string; basePath: string; code: string; expiresAt: null } | null) => <QueryClientProvider client={client}><MemoryRouter>
      <PrdDesignBrowser workitemId="10" remote={{ token: 'share', context, entry, initialRoute: '/settings?q=1#save', refreshSession: vi.fn() }} />
    </MemoryRouter></QueryClientProvider>;
    const view = render(draw(null));
    expect(screen.queryByTitle('产品与交互设计')).not.toBeInTheDocument();
    view.rerender(draw({ status: 'READY', origin: window.location.origin, basePath: '/design-preview/binding/', code: 'entry-1', expiresAt: null }));
    const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
    await waitFor(() => expect(submitted).toEqual([{ code: 'entry-1', route: '/settings?q=1#save' }]));
    emit(frame, { type: 'demo:ready' }, window.location.origin);
    emit(frame, { type: 'route:changed', url: `${window.location.origin}/design-preview/binding/details?q=2#next` }, window.location.origin);
    await userEvent.click(screen.getByRole('button', { name: '刷新页面' }));
    expect(submitted).toHaveLength(1);
    view.rerender(draw({ status: 'READY', origin: window.location.origin, basePath: '/design-preview/binding/', code: 'entry-2', expiresAt: null }));
    await waitFor(() => expect(submitted[1]).toEqual({ code: 'entry-2', route: '/details?q=2#next' }));
    view.unmount(); client.clear(); submit.mockRestore();
  });

  it('renews an active preview without replacing its iframe or resetting component state', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const context = { title: 'Review', workitemId: 10, viewerId: 1, runtime, sourceKey: 'source', canManage: false, comments: [] };
    const draw = (code: string) => <QueryClientProvider client={client}><MemoryRouter>
      <PrdDesignBrowser workitemId="10" remote={{ token: 'share', context,
        entry: { status: 'READY', origin: window.location.origin, basePath: '/design-preview/binding/', code, expiresAt: null }, initialRoute: '/', refreshSession: vi.fn() }} />
    </MemoryRouter></QueryClientProvider>;
    const view = render(draw('first'));
    const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
    emit(frame, { type: 'demo:ready' });
    const windowBefore = frame.contentWindow;
    expect(submit).toHaveBeenCalledTimes(1);
    view.rerender(draw('renewed'));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`${window.location.origin}/design-preview/binding/_autowonder/renew`, expect.objectContaining({ method: 'POST', credentials: 'include' })));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle('产品与交互设计')).toBe(frame);
    expect(frame.contentWindow).toBe(windowBefore);
    view.unmount(); client.clear();
  });

  it('obtains a fresh entry and reenters when the old preview cookie has expired', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 403 }));
    const refreshSession = vi.fn();
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const context = { title: 'Review', workitemId: 10, viewerId: 1, runtime, sourceKey: 'source', canManage: false, comments: [] };
    const draw = (code: string) => <QueryClientProvider client={client}><MemoryRouter>
      <PrdDesignBrowser workitemId="10" remote={{ token: 'share', context,
        entry: { status: 'READY', origin: window.location.origin, basePath: '/design-preview/binding/', code, expiresAt: null }, initialRoute: '/', refreshSession }} />
    </MemoryRouter></QueryClientProvider>;
    const view = render(draw('first'));
    const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
    emit(frame, { type: 'demo:ready' });
    view.rerender(draw('renewal-with-expired-cookie'));
    await waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    view.rerender(draw('new-recovery-entry'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenCalledTimes(1);
    view.unmount(); client.clear();
  });

  it('keeps shared review controls available offline and retries from the empty state', async () => {
    const reconnect = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const context = { title: 'Review', workitemId: 10, viewerId: 1, runtime, sourceKey: 'source', canManage: false, comments: [] };
    const view = render(<QueryClientProvider client={client}><MemoryRouter>
      <PrdDesignBrowser immersive workitemId="10" remote={{ token: 'share', context,
        entry: { status: 'OFFLINE', origin: null, basePath: null, code: null, expiresAt: null },
        initialRoute: '/', refreshSession: vi.fn(), reconnect }} />
    </MemoryRouter></QueryClientProvider>);
    expect(screen.getByText(/已有评论仍可查阅/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(reconnect).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '设计评审意见' }));
    expect(view.container.querySelector('.prd-review-panel')).not.toBeNull();
    expect(screen.getByRole('button', { name: '圈选评论' })).toBeDisabled();
    view.unmount(); client.clear();
  });

  it('shows shared content without browser chrome and opens comments as an overlay on request', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const context = { title: 'Review', workitemId: 10, viewerId: 1, runtime, sourceKey: 'source', canManage: false, comments: [] };
    const view = render(<QueryClientProvider client={client}><MemoryRouter>
      <PrdDesignBrowser immersive workitemId="10" remote={{ token: 'share', context,
        entry: { status: 'READY', origin: window.location.origin, basePath: '/design-preview/binding/', code: 'immersive-entry', expiresAt: null },
        initialRoute: '/settings?q=1#save', refreshSession: vi.fn() }} />
    </MemoryRouter></QueryClientProvider>);
    const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
    expect(frame).toHaveAttribute('src', `${window.location.origin}/design-preview/binding/settings?q=1#save`);
    expect(screen.queryByRole('textbox', { name: '设计服务地址' })).not.toBeInTheDocument();
    expect(view.container.querySelector('.prd-review-panel')).toBeNull();
    emit(frame, { type: 'demo:ready' });
    await userEvent.click(screen.getByRole('button', { name: '设计评审意见' }));
    expect(view.container.querySelector('.prd-review-panel')).not.toBeNull();
    expect(frame).toBe(screen.getByTitle('产品与交互设计'));
    expect(screen.getByRole('button', { name: '圈选评论' })).toBeEnabled();
    view.unmount(); client.clear();
  });

  it.each(['open', 'resolved'] as const)('pulses only the located %s marker on every successful request', async status => {
    const comment = (id: number, selector: string, state: ReviewCommentView['comment']['status']): ReviewCommentView => ({
      comment: { id, conversationId: 20, sourceKey: 'source', runtimeRevision: 1, routePath: '/', selector,
        elementJson: '{}', commentText: `Comment ${id}`, status: state, creatorId: 1, version: 1,
        gmtCreate: '2026-11-20T10:00:00', gmtModified: '2026-11-20T10:00:00' },
      authorName: 'Reviewer', canEdit: false, canDelete: false, canUpdateStatus: false, earlierSource: false,
    });
    const context = { title: 'Review', workitemId: 10, viewerId: 1, runtime, sourceKey: 'source', canManage: false,
      comments: [comment(1, '#target', status), comment(2, '#other', 'open')] };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><MemoryRouter>
      <PrdDesignBrowser workitemId="10" remote={{ token: 'share', context,
        entry: { status: 'READY', origin: window.location.origin, basePath: '/design-preview/binding/', code: null, expiresAt: null },
        initialRoute: '/', refreshSession: vi.fn() }} />
    </MemoryRouter></QueryClientProvider>);
    try {
      const frame = await screen.findByTitle('产品与交互设计') as HTMLIFrameElement;
      const post = vi.spyOn(frame.contentWindow!, 'postMessage');
      const latestLocate = () => post.mock.calls.map(([payload]) => payload)
        .filter(payload => payload.type === 'review-marker:locate').at(-1);
      const pulse = (marker: HTMLElement) => marker.querySelector('.prd-review-marker-pulse');
      emit(frame, { type: 'demo:ready' });
      await userEvent.click(screen.getByText('全部', { exact: true }));
      const locate = screen.getByTitle('#target');
      await userEvent.click(locate);
      const first = latestLocate();
      expect(first).toMatchObject({ id: '1', selector: '#target' });
      expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'review-markers:sync',
        markers: expect.arrayContaining([expect.objectContaining({ id: '1' })]) }), window.location.origin);
      emit(frame, { type: 'review-markers:positions', positions: [
        { id: '1', rect: { x: 20, y: 30, width: 50, height: 60 } },
        { id: '2', rect: { x: 100, y: 110, width: 50, height: 60 } },
      ] });
      const target = screen.getByRole('button', { name: '定位评论 1' });
      const other = screen.getByRole('button', { name: '定位评论 2' });
      const reply = { ...first, type: 'review-marker:located', found: true };
      emit(frame, { ...reply, requestId: 'expired' });
      expect(pulse(target)).toBeNull();
      emit(frame, reply);
      const firstPulse = pulse(target);
      expect(firstPulse).toBeInTheDocument();
      expect(pulse(other)).toBeNull();

      await userEvent.click(locate);
      expect(pulse(target)).toBeNull();
      expect(latestLocate().requestId).not.toBe(first.requestId);
      emit(frame, { ...latestLocate(), type: 'review-marker:located', found: true });
      expect(pulse(target)).toBeInTheDocument();
      expect(pulse(target)).not.toBe(firstPulse);
      await waitFor(() => expect(view.container.querySelector('.prd-review-marker-pulse')).toBeNull(), { timeout: 2000 });
      expect(target.isConnected).toBe(status === 'open');
    } finally { view.unmount(); client.clear(); }
  });

});
