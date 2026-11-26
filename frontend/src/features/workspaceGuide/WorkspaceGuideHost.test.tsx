import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import { WorkspaceGuideHost } from './WorkspaceGuideHost';
import { GuideStrip } from './GuideStrip';
import type { WorkspaceGuide, UpdateWorkspaceGuideBody } from './api';
import {
  emitGuideEvent,
  publishChiefPanelOpen,
  registerGuideSendPreparation,
  resetWorkspaceGuideBridge,
  subscribeChiefClosePanel,
  subscribeChiefOpenPanel,
  type ChiefOpenRequest,
} from './bridge';

const PROMPT = '请初始化当前工作空间，并引导我完成软件研发交付所需的配置。';

function envelope<T>(data: T) {
  return { success: true, code: '0', message: '', data, traceId: null };
}

function guide(overrides: Partial<WorkspaceGuide> = {}): WorkspaceGuide {
  return {
    eligible: true,
    status: 'IN_PROGRESS',
    stage: 1,
    substep: 0,
    conversationId: null,
    clientMessageId: null,
    version: 1,
    globallyDisabled: false,
    capabilityReady: true,
    ...overrides,
  };
}

let putBodies: UpdateWorkspaceGuideBody[] = [];
let skipCalls: number[] = [];
let currentGuide: WorkspaceGuide = guide();
let advanceFailure: { status: number; body: { success: boolean; code: string; message: string; traceId: string | null } } | null = null;
let opens: ChiefOpenRequest[] = [];
let clients: QueryClient[] = [];

function serveGuide(initial: WorkspaceGuide) {
  currentGuide = initial;
  server.use(http.get('/api/workspace-guide', () => HttpResponse.json(envelope(currentGuide))));
}

function serveAdvance() {
  server.use(http.put('/api/workspace-guide', async ({ request }) => {
    const body = await request.json() as UpdateWorkspaceGuideBody;
    putBodies.push(body);
    if (advanceFailure) {
      return HttpResponse.json(advanceFailure.body, { status: advanceFailure.status });
    }
    currentGuide = {
      ...currentGuide,
      status: body.status,
      stage: body.stage,
      substep: body.substep,
      conversationId: body.conversationId ?? currentGuide.conversationId,
      clientMessageId: body.clientMessageId ?? currentGuide.clientMessageId,
      version: body.version + 1,
    };
    return HttpResponse.json(envelope(currentGuide));
  }));
}

function serveSkip(result: 'ok' | 'fail' = 'ok') {
  server.use(http.post('/api/workspace-guide/skip', async ({ request }) => {
    const body = await request.json() as { version: number };
    skipCalls.push(body.version);
    if (result === 'fail') {
      return HttpResponse.json({ success: false, code: '50000', message: 'bad', traceId: null }, { status: 500 });
    }
    currentGuide = { ...currentGuide, status: 'SKIPPED', version: body.version + 1 };
    return HttpResponse.json(envelope(currentGuide));
  }));
}

/** 模拟真实 Chief 面板的打开门控：讲解条只存在于已打开的面板里。 */
function GuideSurface() {
  const [open, setOpen] = useState(false);
  useEffect(() => subscribeChiefOpenPanel(() => setOpen(true)), []);
  useEffect(() => subscribeChiefClosePanel(() => setOpen(false)), []);
  useEffect(() => publishChiefPanelOpen(open), [open]);
  return open ? <div role="dialog" aria-label="Chief"><GuideStrip /></div> : null;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><WorkspaceGuideHost /><GuideSurface /></QueryClientProvider>);
}

const stageSend = (overrides: Partial<WorkspaceGuide> = {}) => guide({
  stage: 3, conversationId: 88, clientMessageId: 'message-1', version: 6, ...overrides,
});

beforeEach(() => {
  resetWorkspaceGuideBridge();
  opens = [];
  putBodies = [];
  skipCalls = [];
  advanceFailure = null;
  subscribeChiefOpenPanel(request => opens.push(request));
  useAuthStore.getState().clear();
  useAuthStore.getState().setUser({ id: 7, username: 'owner', nickname: 'Owner', email: '' });
  useAuthStore.getState().setCurrentWorkspace({ id: 1, name: '新空间', description: '' }, 'ADMIN');
  serveAdvance();
});

afterEach(() => {
  cleanup();
  clients.forEach(client => client.clear());
  clients = [];
});

describe('WorkspaceGuideHost', () => {
  it('starts the access phase only after clicking the setup button', async () => {
    serveGuide(guide({ status: 'PENDING', stage: 1, substep: 0, version: 0 }));
    mount();
    const start = await screen.findByRole('button', { name: '开始配置 Chief' });
    expect(screen.getByText('新空间初始化 · 1/3')).toBeInTheDocument();
    expect(opens).toHaveLength(0);

    fireEvent.click(start);

    await waitFor(() => expect(putBodies).toEqual([expect.objectContaining({
      status: 'IN_PROGRESS', stage: 1, substep: 0, version: 0,
    })]));
    expect(opens[opens.length - 1]).toMatchObject({ expanded: false, conversationId: null });
  });

  it('persists the access substep and enters initialization on executor readiness', async () => {
    serveGuide(guide({ status: 'IN_PROGRESS', stage: 1, substep: 0, version: 3 }));
    registerGuideSendPreparation(vi.fn().mockResolvedValue({ conversationId: 88, clientMessageId: 'message-1' }));
    mount();
    await screen.findByText('接入执行器');

    act(() => emitGuideEvent({ type: 'substep-completed' }));
    await waitFor(() => expect(putBodies[0]).toMatchObject({ stage: 1, substep: 1, version: 3 }));
    expect(await screen.findByText(/等待执行器上线/)).toBeInTheDocument();

    act(() => emitGuideEvent({ type: 'setup-ready' }));
    await waitFor(() => expect(putBodies[1]).toMatchObject({ stage: 2, substep: 0 }));
    await waitFor(() => expect(putBodies[2]).toMatchObject({
      stage: 3, conversationId: 88, clientMessageId: 'message-1',
    }));
    await waitFor(() => expect(opens[opens.length - 1]).toMatchObject({
      source: 'guide', expanded: false, conversationId: 88, clientMessageId: 'message-1', prefill: PROMPT,
    }));
    expect(await screen.findByText(/初始化请求已预填到输入框/)).toBeInTheDocument();
  });

  it('restores a legacy stage 2 as the initialization phase and prefills once', async () => {
    serveGuide(guide({ stage: 2, version: 5 }));
    registerGuideSendPreparation(vi.fn().mockResolvedValue({ conversationId: 88, clientMessageId: 'message-1' }));
    mount();
    await screen.findByText(/初始化请求已预填到输入框/);

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toMatchObject({ stage: 3, conversationId: 88, clientMessageId: 'message-1', version: 5 });
    expect(opens.filter(request => request.prefill !== null)).toHaveLength(1);
    expect(screen.getByText('初始化').closest('.aw-guide-stepper-step')).toHaveClass('is-on');
  });

  it('never overwrites an existing draft and offers retry', async () => {
    serveGuide(stageSend());
    registerGuideSendPreparation(vi.fn().mockResolvedValue({ conversationId: 88, clientMessageId: 'message-1' }));
    mount();
    await screen.findByText(/初始化请求已预填到输入框/);
    const opened = opens[opens.length - 1];
    act(() => opened.onPrefillResult?.(false));
    expect(await screen.findByText('已有草稿，未覆盖。请先发送或清理草稿后点击重试。')).toBeInTheDocument();

    const before = opens.length;
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(opens.length).toBeGreaterThan(before));
    expect(screen.queryByText('已有草稿，未覆盖。请先发送或清理草稿后点击重试。')).not.toBeInTheDocument();
  });

  it('blocks the handoff when the initialization capability is missing', async () => {
    serveGuide(stageSend({ capabilityReady: false }));
    registerGuideSendPreparation(vi.fn());
    mount();
    expect(await screen.findByText('空间初始化能力尚未就绪，暂不能交接。请稍后重试。')).toBeInTheDocument();
    expect(opens[opens.length - 1]).toMatchObject({ expanded: false, conversationId: 88, prefill: PROMPT });

    act(() => emitGuideEvent({ type: 'send-succeeded', conversationId: 88, clientMessageId: 'message-1' }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(putBodies).toHaveLength(0);
    expect(screen.getByText(/初始化请求已预填到输入框/)).toBeInTheDocument();
  });

  it('completes the guide as soon as the send is accepted', async () => {
    serveGuide(stageSend());
    registerGuideSendPreparation(vi.fn());
    mount();
    await screen.findByText(/初始化请求已预填到输入框/);
    act(() => emitGuideEvent({ type: 'send-succeeded', conversationId: 88, clientMessageId: 'message-1' }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toMatchObject({
      status: 'COMPLETED', stage: 4, conversationId: 88, clientMessageId: 'message-1',
    });
    await waitFor(() => expect(screen.queryByTestId('guide-strip')).not.toBeInTheDocument());
    expect(await screen.findByText('引导已完成，Chief 已接手初始化，交付见工作台。')).toBeInTheDocument();
  });

  it('keeps a retry path when saving the accepted send fails', async () => {
    serveGuide(stageSend());
    registerGuideSendPreparation(vi.fn());
    advanceFailure = { status: 500, body: { success: false, code: '50000', message: 'down', traceId: null } };
    mount();
    await screen.findByText(/初始化请求已预填到输入框/);
    act(() => emitGuideEvent({ type: 'send-succeeded', conversationId: 88, clientMessageId: 'message-1' }));
    expect(await screen.findByText('引导进度保存失败，请刷新后重试。')).toBeInTheDocument();
    advanceFailure = null;
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(putBodies[putBodies.length - 1]).toMatchObject({
      status: 'COMPLETED', stage: 4, conversationId: 88, clientMessageId: 'message-1',
    }));
    await waitFor(() => expect(screen.queryByTestId('guide-strip')).not.toBeInTheDocument());
  });

  it('completes a legacy stage 4 guide without rendering it', async () => {
    serveGuide(guide({ stage: 4, version: 9, conversationId: 88, clientMessageId: 'message-1' }));
    mount();
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toMatchObject({
      status: 'COMPLETED', stage: 4, version: 9, conversationId: 88, clientMessageId: 'message-1',
    });
    expect(document.querySelector('.aw-guide-mask')).toBeNull();
    expect(screen.queryByTestId('guide-strip')).not.toBeInTheDocument();
  });

  it('skips only the current workspace and reports a failed save', async () => {
    serveGuide(guide({ stage: 1, version: 4 }));
    serveSkip('fail');
    mount();
    fireEvent.click(await screen.findByTestId('guide-strip').then(strip => strip.querySelector('.aw-guide-skip') as HTMLElement));
    expect(await screen.findByText('保存跳过状态失败，请重试。')).toBeInTheDocument();
    expect(screen.getByTestId('guide-strip')).toBeInTheDocument();

    serveSkip('ok');
    fireEvent.click(screen.getByTestId('guide-strip').querySelector('.aw-guide-skip') as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId('guide-strip')).not.toBeInTheDocument());
    expect(skipCalls).toEqual([4, 4]);
  });

  it('does not skip when the stored progress has no version', async () => {
    serveGuide(guide({ stage: 1, version: null }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '跳过' }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(skipCalls).toHaveLength(0);
  });

  it('confirms the account-level disable only after the preference is saved', async () => {
    serveGuide(guide({ stage: 1, version: 4 }));
    mount();
    await screen.findByTestId('guide-strip');
    fireEvent.click(screen.getByRole('button', { name: '不再提示' }));
    const dialog = screen.getByRole('dialog', { name: '不再显示新空间引导？' });
    expect(dialog).toHaveTextContent('确认后，当前及今后新建空间都不再显示此引导');
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(screen.queryByRole('dialog', { name: '不再显示新空间引导？' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '不再提示' }));
    fireEvent.click(screen.getByRole('button', { name: '确认并关闭' }));
    await waitFor(() => expect(screen.queryByTestId('guide-strip')).not.toBeInTheDocument());
  });

  it('keeps the dialog open with a retry message when saving the disable preference fails', async () => {
    serveGuide(guide({ stage: 1, version: 4 }));
    server.use(http.put('/api/users/me/settings/:key', () =>
      HttpResponse.json({ success: false, code: '50000', message: 'down', traceId: null }, { status: 500 })));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '不再提示' }));
    fireEvent.click(screen.getByRole('button', { name: '确认并关闭' }));
    expect(await screen.findByText('偏好保存失败，请重试。引导未关闭。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认并关闭' })).toBeInTheDocument();
  });

  it('never forces the overlay when the preference read fails', async () => {
    server.use(http.get('/api/workspace-guide', () =>
      HttpResponse.json({ success: false, code: '40005', message: 'preference down', traceId: null }, { status: 200 })));
    mount();
    expect(await screen.findByText('无法读取新空间引导偏好，引导未展示。')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    serveGuide(guide({ stage: 1, version: 4 }));
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByText('接入执行器')).toBeInTheDocument();
  });

  it('does not blame the preference when the guide read fails for another reason', async () => {
    server.use(http.get('/api/workspace-guide', () =>
      HttpResponse.json({ success: false, code: '50000', message: 'guide table missing', traceId: 'trace-1' }, { status: 500 })));
    mount();
    expect(await screen.findByText('无法加载新空间引导。')).toBeInTheDocument();
    expect(screen.queryByText('无法读取新空间引导偏好，引导未展示。')).not.toBeInTheDocument();
  });

  it('does not blame the preference when the request cannot reach the server', async () => {
    server.use(http.get('/api/workspace-guide', () => HttpResponse.error()));
    mount();
    expect(await screen.findByText('无法加载新空间引导。')).toBeInTheDocument();
    expect(screen.queryByText('无法读取新空间引导偏好，引导未展示。')).not.toBeInTheDocument();
  });

  it('does not blame the preference when workspace access is denied', async () => {
    server.use(http.get('/api/workspace-guide', () =>
      HttpResponse.json({ success: false, code: '12008', message: 'denied', traceId: null }, { status: 403 })));
    mount();
    expect(await screen.findByText('无法加载新空间引导。')).toBeInTheDocument();
    expect(screen.queryByText('无法读取新空间引导偏好，引导未展示。')).not.toBeInTheDocument();
  });

  it('clears a failed guide read after switching workspaces', async () => {
    let calls = 0;
    server.use(http.get('/api/workspace-guide', () => {
      calls += 1;
      if (calls === 1) {
        return HttpResponse.json({ success: false, code: '50000', message: 'down', traceId: null }, { status: 500 });
      }
      return HttpResponse.json(envelope(guide({ stage: 1, version: 4 })));
    }));
    mount();
    expect(await screen.findByText('无法加载新空间引导。')).toBeInTheDocument();

    act(() => useAuthStore.getState().setCurrentWorkspace({ id: 2, name: '另一个空间', description: '' }, 'ADMIN'));

    expect(await screen.findByText('接入执行器')).toBeInTheDocument();
    expect(screen.queryByText('无法加载新空间引导。')).not.toBeInTheDocument();
  });

  it('keeps the guide on the current step when a version conflict is reported', async () => {
    serveGuide(guide({ stage: 1, version: 4 }));
    advanceFailure = { status: 400, body: { success: false, code: '40002', message: 'conflict', traceId: null } };
    mount();
    await screen.findByTestId('guide-strip');
    act(() => emitGuideEvent({ type: 'substep-completed' }));
    expect(await screen.findByText('引导进度已更新，已按最新状态继续。')).toBeInTheDocument();
    expect(screen.getByText('接入执行器')).toBeInTheDocument();
  });

  it('ignores a late response for the workspace that was left', async () => {
    let calls = 0;
    let releaseFirst: (() => void) | null = null;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    server.use(http.get('/api/workspace-guide', async () => {
      calls += 1;
      if (calls === 1) {
        await firstGate;
        return HttpResponse.json(envelope(guide({ stage: 1, version: 9 })));
      }
      return HttpResponse.json(envelope(guide({ eligible: false, status: null, stage: null, substep: null, version: null })));
    }));
    mount();
    await waitFor(() => expect(calls).toBe(1));
    act(() => useAuthStore.getState().setCurrentWorkspace({ id: 2, name: '另一个空间', description: '' }, 'ADMIN'));
    await waitFor(() => expect(calls).toBe(2));
    await waitFor(() => expect(screen.queryByTestId('guide-strip')).not.toBeInTheDocument());
    act(() => { releaseFirst?.(); });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.queryByTestId('guide-strip')).not.toBeInTheDocument();
  });

  it('reports a failed conversation preparation and stays on the initialization phase', async () => {
    // 只有还没拿到会话与去重标识时才需要现场准备；带标识的阶段 3 会直接复用。
    serveGuide(stageSend({ conversationId: null, clientMessageId: null }));
    registerGuideSendPreparation(vi.fn().mockRejectedValue(new Error('offline')));
    mount();
    expect(await screen.findByText('无法准备初始化对话，请重试。')).toBeInTheDocument();
    expect(putBodies).toHaveLength(0);
    expect(screen.queryByTestId('guide-strip')).not.toBeInTheDocument();
  });

  it('reports a failed guided send without advancing', async () => {
    serveGuide(stageSend());
    registerGuideSendPreparation(vi.fn());
    mount();
    await screen.findByText(/初始化请求已预填到输入框/);

    act(() => emitGuideEvent({ type: 'send-failed' }));

    expect(await screen.findByText('发送失败，草稿已保留，请重试。')).toBeInTheDocument();
    expect(putBodies).toHaveLength(0);
  });

  it('offers retry when initialization progress cannot be saved', async () => {
    serveGuide(stageSend({ version: 6, conversationId: null, clientMessageId: null }));
    registerGuideSendPreparation(vi.fn().mockResolvedValue({ conversationId: 88, clientMessageId: 'message-1' }));
    advanceFailure = { status: 500, body: { success: false, code: '50000', message: 'down', traceId: null } };
    mount();
    expect(await screen.findByText('引导进度保存失败，请刷新后重试。')).toBeInTheDocument();

    advanceFailure = null;
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(putBodies[putBodies.length - 1]).toMatchObject({
      stage: 3, conversationId: 88, clientMessageId: 'message-1',
    }));
    await waitFor(() => expect(opens[opens.length - 1]).toMatchObject({
      source: 'guide', expanded: false, conversationId: 88,
    }));
    expect(await screen.findByText(/初始化请求已预填到输入框/)).toBeInTheDocument();
  });

  it('drops a progress response that arrives after the workspace changed', async () => {
    serveGuide(guide({ stage: 1, substep: 0, version: 2 }));
    const gateHolder: { release?: () => void } = {};
    const putGate = new Promise<void>(resolve => { gateHolder.release = resolve; });
    server.use(http.put('/api/workspace-guide', async ({ request }) => {
      const body = await request.json() as UpdateWorkspaceGuideBody;
      putBodies.push(body);
      await putGate;
      return HttpResponse.json(envelope({ ...currentGuide, stage: 1, substep: 1, version: 3 }));
    }));
    mount();
    await screen.findByTestId('guide-strip');
    act(() => emitGuideEvent({ type: 'substep-completed' }));
    await waitFor(() => expect(putBodies).toHaveLength(1));

    act(() => useAuthStore.getState().setCurrentWorkspace({ id: 2, name: '另一个空间', description: '' }, 'ADMIN'));
    serveGuide(guide({ eligible: false, status: null, stage: null, substep: null, version: null }));
    act(() => { gateHolder.release?.(); });
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(screen.queryByText('引导进度保存失败，请刷新后重试。')).not.toBeInTheDocument();
    expect(screen.queryByTestId('guide-strip')).not.toBeInTheDocument();
  });

  it('clamps a legacy substep and ignores events for another stage', async () => {
    serveGuide(guide({ stage: 1, substep: 5, version: 3 }));
    registerGuideSendPreparation(vi.fn().mockResolvedValue({ conversationId: 88, clientMessageId: 'message-1' }));
    mount();
    expect(await screen.findByText(/等待执行器上线/)).toBeInTheDocument();

    act(() => {
      emitGuideEvent({ type: 'substep-completed' });
      emitGuideEvent({ type: 'send-succeeded', conversationId: 88, clientMessageId: 'message-1' });
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(putBodies).toHaveLength(0);

    act(() => {
      emitGuideEvent({ type: 'setup-ready' });
      emitGuideEvent({ type: 'setup-ready' });
    });
    await waitFor(() => expect(putBodies.map(body => [body.stage, body.substep])).toEqual([[2, 0], [3, 0]]));
  });

  it('keeps the guide open when starting it cannot be saved', async () => {
    serveGuide(guide({ status: 'PENDING', stage: 1, substep: 0, version: 0 }));
    advanceFailure = { status: 500, body: { success: false, code: '50000', message: 'down', traceId: null } };
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '开始配置 Chief' }));

    expect(await screen.findByText('引导进度保存失败，请刷新后重试。')).toBeInTheDocument();
    expect(opens).toHaveLength(0);
    expect(screen.getByRole('button', { name: '开始配置 Chief' })).toBeInTheDocument();
  });
});
