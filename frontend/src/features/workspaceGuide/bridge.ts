import { useSyncExternalStore } from 'react';

/**
 * 引导与 Chief 之间的桥。两者是独立组件（Chief 在 AppLayout 全局挂载一次），
 * 通过这个模块级通道传递打开/展开/预填请求和发送结果，不重复挂载 Chief，
 * 也不通过 DOM 点击模拟引导流程。
 */
export interface ChiefOpenRequest {
  seq: number;
  /** 用户入口（顶栏、浮标、智能建单）标记 user；引导自身标记 guide，引导期忽略 user 请求。 */
  source?: 'user' | 'guide';
  expanded: boolean;
  conversationId: number | null;
  clientMessageId: string | null;
  prefill: string | null;
  onPrefillResult?: (accepted: boolean) => void;
}

type OpenListener = (request: ChiefOpenRequest) => void;

let sequence = 0;
const openListeners = new Set<OpenListener>();
// Chief 在 AppLayout 里全局挂载；冷启动恢复到阶段 1 时引导 Host 的 effect 可能先于它订阅，
// 没有订阅者就先入队，等第一个订阅者注册时补发，否则面板永远打不开。
let unclaimedOpens: ChiefOpenRequest[] = [];

export function openChiefPanel(request: Partial<Omit<ChiefOpenRequest, 'seq'>> = {}): void {
  const payload: ChiefOpenRequest = {
    seq: ++sequence,
    source: request.source,
    expanded: request.expanded ?? false,
    conversationId: request.conversationId ?? null,
    clientMessageId: request.clientMessageId ?? null,
    prefill: request.prefill ?? null,
    onPrefillResult: request.onPrefillResult,
  };
  if (openListeners.size === 0) {
    unclaimedOpens.push(payload);
    return;
  }
  openListeners.forEach(listener => listener(payload));
}

export function subscribeChiefOpenPanel(listener: OpenListener): () => void {
  openListeners.add(listener);
  if (unclaimedOpens.length) {
    const queued = unclaimedOpens;
    unclaimedOpens = [];
    queued.forEach(request => listener(request));
  }
  return () => { openListeners.delete(listener); };
}

const closeListeners = new Set<() => void>();

/** 配置阶段结束进入阶段 2 时收起准备视图，只留下顶部入口作为目标。 */
export function closeChiefPanel(): void {
  closeListeners.forEach(listener => listener());
}

export function subscribeChiefClosePanel(listener: () => void): () => void {
  closeListeners.add(listener);
  return () => { closeListeners.delete(listener); };
}

const panelOpenListeners = new Set<() => void>();
let panelOpen = false;

/** 面板打开时顶栏入口回到主色弱底（原型 35 一节），关闭后恢复幽灵态。 */
export function publishChiefPanelOpen(open: boolean): void {
  if (panelOpen === open) return;
  panelOpen = open;
  panelOpenListeners.forEach(listener => listener());
}

export function useChiefPanelOpen(): boolean {
  return useSyncExternalStore(
    listener => { panelOpenListeners.add(listener); return () => { panelOpenListeners.delete(listener); }; },
    () => panelOpen,
    () => false,
  );
}

export type GuideNoticeKind = 'advance' | 'skip' | 'send' | 'reserve' | 'conflict';

export interface GuideRuntime {
  active: boolean;
  workspaceId: number | null;
  stage: number;
  substep: number;
  capabilityReady: boolean;
  /** Chief 侧的 setup.ready；阶段 1 只有它为 true 才能进入初始化阶段。 */
  ready: boolean;
  /** PENDING 时不抬升 Chief、不显示讲解条；面板也保持关闭。 */
  pending: boolean;
  notice: GuideNoticeKind | null;
  setupError: string | null;
  prefillBlocked: boolean;
}

const idleRuntime: GuideRuntime = {
  active: false,
  workspaceId: null,
  stage: 1,
  substep: 0,
  capabilityReady: false,
  ready: false,
  pending: false,
  notice: null,
  setupError: null,
  prefillBlocked: false,
};
let runtime: GuideRuntime = idleRuntime;
const runtimeListeners = new Set<() => void>();

export function publishGuideRuntime(next: Partial<GuideRuntime> | null): void {
  runtime = next === null ? idleRuntime : { ...runtime, ...next };
  runtimeListeners.forEach(listener => listener());
}

export function useGuideRuntime(): GuideRuntime {
  return useSyncExternalStore(
    listener => { runtimeListeners.add(listener); return () => { runtimeListeners.delete(listener); }; },
    () => runtime,
    () => idleRuntime,
  );
}

export type GuideEvent =
  | { type: 'setup-ready' }
  | { type: 'substep-completed' }
  | { type: 'setup-error'; substep: number; message: string | null }
  | { type: 'send-succeeded'; conversationId: number; clientMessageId: string }
  | { type: 'send-failed' };

const guideEventListeners = new Set<(event: GuideEvent) => void>();

export function emitGuideEvent(event: GuideEvent): void {
  guideEventListeners.forEach(listener => listener(event));
}

export function subscribeGuideEvents(listener: (event: GuideEvent) => void): () => void {
  guideEventListeners.add(listener);
  return () => { guideEventListeners.delete(listener); };
}

export interface PreparedSend {
  conversationId: number;
  clientMessageId: string;
}

type PrepareSend = (existingConversationId: number | null) => Promise<PreparedSend>;
let prepareSendImpl: PrepareSend | null = null;

/** Chief 注册准备发送的实现：复用/创建引导会话并生成或复用去重标识。 */
export function registerGuideSendPreparation(implementation: PrepareSend | null): void {
  prepareSendImpl = implementation;
}

export async function prepareGuideSend(existingConversationId: number | null): Promise<PreparedSend> {
  if (!prepareSendImpl) {
    throw new Error('Chief is not ready to prepare the initialization message');
  }
  return prepareSendImpl(existingConversationId);
}

/** 测试与切换空间时清空桥状态，避免上一个空间的事件或请求串到新空间。 */
export function resetWorkspaceGuideBridge(): void {
  runtime = idleRuntime;
  runtimeListeners.forEach(listener => listener());
  prepareSendImpl = null;
  guideActionProvider = null;
  unclaimedOpens = [];
  openListeners.clear();
  closeListeners.clear();
  guideEventListeners.clear();
  panelOpen = false;
  panelOpenListeners.forEach(listener => listener());
}

export type GuideActionName = 'skip' | 'retry' | 'retryPrefill' | 'disable';
export type GuideActionHandlers = Partial<Record<GuideActionName, () => void>>;

let guideActionProvider: (() => GuideActionHandlers) | null = null;

/** 讲解条在 Chief 面板内渲染，按钮动作回交给引导 Host 执行。 */
export function registerGuideActions(provider: (() => GuideActionHandlers) | null): void {
  guideActionProvider = provider;
}

export function runGuideAction(name: GuideActionName): void {
  guideActionProvider?.()[name]?.();
}
