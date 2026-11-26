import { useEffect, useRef, useState } from 'react';
import { Alert, Button, message } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/shared/auth/store';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { ApiError } from '@/shared/types/common';
import { putMySetting } from '@/features/profile/userSettingApi';
import {
  GUIDE_DISABLED_SETTING_KEY,
  GUIDE_PREFERENCE_UNAVAILABLE_CODE,
  advanceWorkspaceGuide,
  getWorkspaceGuide,
  skipWorkspaceGuide,
  workspaceGuideQueryKey,
  type UpdateWorkspaceGuideBody,
  type WorkspaceGuide,
} from './api';
import {
  closeChiefPanel,
  openChiefPanel,
  prepareGuideSend,
  publishGuideRuntime,
  registerGuideActions,
  subscribeGuideEvents,
  useChiefPanelOpen,
  type GuideActionHandlers,
  type GuideNoticeKind,
} from './bridge';
import { GuideStepper } from './GuideStepper';
import './workspaceGuide.css';

function visibleGuide(guide: WorkspaceGuide | undefined): guide is WorkspaceGuide {
  // 阶段 4 只是完成后端收尾点：历史数据若停在 IN_PROGRESS/4，由自动补全 effect 收敛成 COMPLETED，
  // 期间不再渲染任何引导 UI。
  return !!guide && guide.eligible && !guide.globallyDisabled
    && guide.status !== 'SKIPPED' && guide.status !== 'COMPLETED'
    && normalizeStage(guide.stage ?? 1) !== 4;
}

/** 旧数据可能停在阶段 2（点入口）；三阶段流程把它当作初始化阶段的恢复入口。 */
function normalizeStage(stage: number): number {
  return stage === 2 ? 3 : Math.min(Math.max(stage, 1), 4);
}

/**
 * 新空间创建者首次进入时的新手引导：接入执行器（选客户端与系统、生成并复制、等待上线）
 * → 初始化 Chief（自动全屏并预填，用户点发送）。发送受理即完成，用一次性提示收尾。
 * PENDING 用一张居中卡起步；进入 IN_PROGRESS 后不再另开浮层，讲解条与操作都在 Chief 面板内。
 */
export function WorkspaceGuideHost() {
  const { t } = useTranslation('workspaceGuide');
  const workspaceId = useAuthStore(state => state.currentWorkspace?.id);
  const userId = useAuthStore(state => state.user?.id);
  const queryClient = useQueryClient();
  const guideQuery = useQuery({
    queryKey: workspaceGuideQueryKey(workspaceId, userId),
    queryFn: getWorkspaceGuide,
    enabled: workspaceId != null && userId != null,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const guide = guideQuery.data;
  const visible = visibleGuide(guide);
  const chiefPanelOpen = useChiefPanelOpen();
  const stage = normalizeStage(guide?.stage ?? 1);
  const substep = stage === 1 ? Math.min(guide?.substep ?? 0, 1) : 0;
  const pending = guide?.status === 'PENDING';
  const [notice, setNotice] = useState<GuideNoticeKind | null>(null);
  const [setupError, setSetupError] = useState<{ substep: number; message: string } | null>(null);
  const [blockedPrefill, setBlockedPrefill] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [disableSaving, setDisableSaving] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const guideRef = useRef<WorkspaceGuide | undefined>(guide);
  guideRef.current = guide;
  const tRef = useRef(t);
  tRef.current = t;
  const autoOpenedRef = useRef<number | null>(null);
  const stage3OpenedRef = useRef<number | null>(null);
  // 历史数据可能停在 IN_PROGRESS/4；按空间去重，只自动补全一次。
  const legacyFinishRef = useRef<number | null>(null);
  // setup-ready 与阶段 3 恢复 effect 可能同时触发；in-flight 守卫保证只预填一次。
  const stage3EnteringRef = useRef(false);
  const pendingSendRef = useRef<{ conversationId: number; clientMessageId: string } | null>(null);
  const failedAdvanceRef = useRef<UpdateWorkspaceGuideBody | null>(null);
  const workspaceRef = useRef(workspaceId);
  workspaceRef.current = workspaceId;
  const userRef = useRef(userId);
  userRef.current = userId;

  useEffect(() => {
    autoOpenedRef.current = null;
    stage3OpenedRef.current = null;
    legacyFinishRef.current = null;
    stage3EnteringRef.current = false;
    pendingSendRef.current = null;
    failedAdvanceRef.current = null;
    setNotice(null);
    setSetupError(null);
    setBlockedPrefill(false);
    setDialogOpen(false);
    setDialogError(null);
  }, [workspaceId, userId]);

  useEffect(() => {
    publishGuideRuntime({
      active: visible,
      workspaceId: workspaceId ?? null,
      stage,
      substep,
      capabilityReady: guide?.capabilityReady ?? false,
      pending,
      notice,
      setupError: setupError?.substep === substep ? setupError.message : null,
      prefillBlocked: blockedPrefill,
    });
  }, [visible, workspaceId, stage, substep, guide?.capabilityReady, pending, notice, setupError, blockedPrefill]);

  useEffect(() => () => { publishGuideRuntime(null); }, []);

  // 蒙版期间锁背景滚动；离开或被跳过时恢复。
  useEffect(() => {
    if (!visible) {
      return;
    }
    document.body.classList.add('aw-guide-lock');
    return () => document.body.classList.remove('aw-guide-lock');
  }, [visible]);

  // PENDING 阶段只有居中卡，Chief 面板必须保持关闭；进入 IN_PROGRESS 后再由流程打开。
  useEffect(() => {
    if (visible && pending) {
      closeChiefPanel();
    }
  }, [visible, pending]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    if (pending) {
      cardRef.current?.focus();
      return;
    }
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLElement>('[data-guide-strip]')?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [visible, pending, stage, substep]);

  useEffect(() => {
    if (!dialogOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      setDialogOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen]);

  function activeIdentity(): boolean {
    const state = useAuthStore.getState();
    return state.currentWorkspace?.id === workspaceRef.current && state.user?.id === userRef.current;
  }

  function applyGuide(data: WorkspaceGuide): boolean {
    if (!activeIdentity()) {
      return false;
    }
    guideRef.current = data;
    queryClient.setQueryData(workspaceGuideQueryKey(workspaceRef.current, userRef.current), data);
    return true;
  }

  // 同一帧里子步完成与上线就绪会先后推进；串行写入并始终取最新版本号，
  // 避免两次 PUT 拿同一个旧版本互相顶成 40002。
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  function persist(body: UpdateWorkspaceGuideBody): Promise<WorkspaceGuide | null> {
    const run = async (): Promise<WorkspaceGuide | null> => {
      const version = guideRef.current?.version ?? body.version;
      try {
        const data = await advanceWorkspaceGuide({ ...body, version });
        return applyGuide(data) ? data : null;
      } catch (error) {
        if (!activeIdentity()) {
          return null;
        }
        if (error instanceof ApiError && error.code === '40002') {
          setNotice('conflict');
          void guideQuery.refetch();
        } else {
          failedAdvanceRef.current = body;
          setNotice('advance');
        }
        return null;
      }
    };
    const next = persistQueueRef.current.then(run, run);
    persistQueueRef.current = next.then(() => undefined, () => undefined);
    return next;
  }
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // 发送受理即完成：阶段 4 只是后端允许写 COMPLETED 的最小落点，前端不渲染收尾界面，
  // 成功后用一次性提示告知。返回是否写入成功，供重试路径判断。
  async function completeGuideAfterSend(
    conversationId?: number | null,
    clientMessageId?: string | null,
  ): Promise<boolean> {
    const current = guideRef.current;
    if (!current) {
      return false;
    }
    const saved = await persistRef.current({
      status: 'COMPLETED',
      stage: 4,
      substep: 0,
      version: current.version ?? 0,
      conversationId,
      clientMessageId,
    });
    if (saved) {
      const completedToast = tRef.current('completedToast');
      message.success(completedToast);
    }
    return saved !== null;
  }

  async function enterStage3(current: WorkspaceGuide): Promise<void> {
    if (stage3EnteringRef.current) {
      return;
    }
    stage3EnteringRef.current = true;
    // 先落标记再写库：阶段 3 数据回来会立刻触发恢复 effect，必须在它之前对同一空间去重，
    // 否则正常入口会二次预填并被判成“已有草稿”。
    stage3OpenedRef.current = workspaceRef.current ?? null;
    try {
      setBlockedPrefill(false);
      const prepared = current.conversationId !== null && current.clientMessageId !== null
        ? { conversationId: current.conversationId, clientMessageId: current.clientMessageId }
        : await prepareGuideSend(current.conversationId ?? null);
      // 后端只允许阶段逐级推进（最多 +1）。单面板把旧的阶段 2 合并掉了，
      // 这里先补落阶段 2 再写阶段 3，否则 1→3 会被判成「引导进度不合法」(40003)。
      let latest = current;
      if ((latest.stage ?? 1) < 2) {
        const bridged = await persist({
          status: 'IN_PROGRESS',
          stage: 2,
          substep: 0,
          version: latest.version ?? 0,
        });
        if (!bridged) {
          return;
        }
        latest = bridged;
      }
      const changed = (latest.stage ?? 1) !== 3
        || latest.conversationId !== prepared.conversationId
        || latest.clientMessageId !== prepared.clientMessageId;
      if (changed) {
        const saved = await persist({
          status: 'IN_PROGRESS',
          stage: 3,
          substep: 0,
          version: latest.version ?? 0,
          conversationId: prepared.conversationId,
          clientMessageId: prepared.clientMessageId,
        });
        if (!saved) {
          return;
        }
      }
      openChiefPanel({
        source: 'guide',
        conversationId: prepared.conversationId,
        clientMessageId: prepared.clientMessageId,
        prefill: tRef.current('prompt.initial'),
        onPrefillResult: accepted => setBlockedPrefill(!accepted),
      });
    } catch {
      if (activeIdentity()) {
        setNotice('reserve');
      }
    } finally {
      stage3EnteringRef.current = false;
    }
  }
  const enterStage3Ref = useRef(enterStage3);
  enterStage3Ref.current = enterStage3;

  useEffect(() => {
    return subscribeGuideEvents(event => {
      const current = guideRef.current;
      if (!current || !visibleGuide(current)) {
        return;
      }
      const currentStage = normalizeStage(current.stage ?? 1);
      const currentSubstep = currentStage === 1 ? Math.min(current.substep ?? 0, 1) : 0;
      if (event.type === 'setup-error') {
        setSetupError(event.message ? { substep: event.substep, message: event.message } : null);
        return;
      }
      if (event.type === 'substep-completed') {
        if (currentStage !== 1 || currentSubstep !== 0) {
          return;
        }
        void persistRef.current({ status: 'IN_PROGRESS', stage: 1, substep: 1, version: current.version ?? 0 });
        return;
      }
      if (event.type === 'setup-ready') {
        if (currentStage !== 1) {
          return;
        }
        void enterStage3Ref.current(current);
        return;
      }
      if (event.type === 'send-succeeded') {
        if (currentStage !== 3) {
          return;
        }
        // 能力未就绪时不能宣称已能接力：停在初始化阶段，保留警告与重试入口。
        if (!current.capabilityReady) {
          return;
        }
        pendingSendRef.current = { conversationId: event.conversationId, clientMessageId: event.clientMessageId };
        void completeGuideAfterSend(event.conversationId, event.clientMessageId)
          .then(completed => { if (completed) pendingSendRef.current = null; });
        return;
      }
      setNotice('send');
    });
  }, []);

  // 刷新或换回同一空间时恢复阶段 1：重新打开同一 Chief 实例继续配置。
  useEffect(() => {
    if (!visible || !guide || guide.status !== 'IN_PROGRESS' || normalizeStage(guide.stage ?? 1) !== 1) {
      return;
    }
    if (autoOpenedRef.current === workspaceId) {
      return;
    }
    autoOpenedRef.current = workspaceId ?? null;
    openChiefPanel({ source: 'guide', conversationId: guide.conversationId });
  }, [visible, guide, workspaceId]);

  // 刷新恢复初始化阶段：复用已保存的会话与去重标识，不会新建会话或重复发送。
  useEffect(() => {
    if (!visible || !guide || guide.status !== 'IN_PROGRESS' || normalizeStage(guide.stage ?? 1) !== 3) {
      return;
    }
    if (stage3OpenedRef.current === workspaceId) {
      return;
    }
    stage3OpenedRef.current = workspaceId ?? null;
    void enterStage3Ref.current(guide);
  }, [visible, guide, workspaceId]);

  // 历史数据可能停在 IN_PROGRESS/4（旧版「收尾阶段」）。该阶段已不再渲染，
  // 这里直接补成 COMPLETED，否则这些空间会永远卡在一个看不见的引导里。
  useEffect(() => {
    if (!guide || guide.status !== 'IN_PROGRESS' || normalizeStage(guide.stage ?? 1) !== 4) {
      return;
    }
    if (legacyFinishRef.current === workspaceId) {
      return;
    }
    legacyFinishRef.current = workspaceId ?? null;
    void completeGuideAfterSend(guide.conversationId, guide.clientMessageId)
      .then(completed => { if (!completed) legacyFinishRef.current = null; });
  }, [guide, workspaceId]);

  async function startGuide(): Promise<void> {
    const current = guideRef.current;
    if (!current) {
      return;
    }
    const saved = await persist({ status: 'IN_PROGRESS', stage: 1, substep: 0, version: current.version ?? 0 });
    if (saved) {
      openChiefPanel({ source: 'guide', conversationId: saved.conversationId });
    }
  }

  async function retrySaveSendProgress(): Promise<void> {
    const pending = pendingSendRef.current;
    if (!pending) {
      return;
    }
    const completed = await completeGuideAfterSend(pending.conversationId, pending.clientMessageId);
    if (completed) {
      pendingSendRef.current = null;
      setNotice(null);
    }
  }

  async function skipNow(): Promise<void> {
    const current = guideRef.current;
    if (!current || current.version === null) {
      return;
    }
    try {
      const data = await skipWorkspaceGuide(current.version);
      applyGuide(data);
      setNotice(null);
    } catch {
      if (activeIdentity()) {
        setNotice('skip');
      }
    }
  }

  async function confirmDisable(): Promise<void> {
    setDisableSaving(true);
    setDialogError(null);
    try {
      await putMySetting(GUIDE_DISABLED_SETTING_KEY, 'true');
      const current = guideRef.current;
      if (current && activeIdentity()) {
        queryClient.setQueryData(workspaceGuideQueryKey(workspaceRef.current, userRef.current), { ...current, globallyDisabled: true });
      }
      setDialogOpen(false);
    } catch {
      setDialogError(tRef.current('disableFailed'));
    } finally {
      setDisableSaving(false);
    }
  }

  function retryNotice(): void {
    const current = guideRef.current;
    const kind = notice;
    if (!current || !kind) {
      return;
    }
    setNotice(null);
    if (kind === 'skip') {
      void skipNow();
    } else if (kind === 'send' || kind === 'reserve') {
      void enterStage3Ref.current(current);
    } else if (kind === 'conflict') {
      void guideQuery.refetch();
    } else if (pendingSendRef.current) {
      void retrySaveSendProgress();
    } else if (failedAdvanceRef.current) {
      const body = failedAdvanceRef.current;
      failedAdvanceRef.current = null;
      // 阶段 3 的入口保存失败时，重试要重新走进入流程，否则只补写库、始终打不开面板。
      if (body.stage === 3) {
        void enterStage3Ref.current(current);
        return;
      }
      void persist(body).then(saved => { if (!saved) failedAdvanceRef.current = body; });
    }
  }

  // 讲解条在 Chief 面板内渲染，按钮动作通过桥回交给这里执行。
  const actionHandlers = useRef<GuideActionHandlers>({});
  actionHandlers.current = {
    skip: () => { void skipNow(); },
    retry: retryNotice,
    retryPrefill: () => {
      const current = guideRef.current;
      if (current) {
        void enterStage3Ref.current(current);
      }
    },
    disable: () => { setDialogError(null); setDialogOpen(true); },
  };
  useEffect(() => {
    registerGuideActions(() => actionHandlers.current);
    return () => registerGuideActions(null);
  }, []);

  if (guideQuery.isError) {
    // 只有账号偏好读取失败才说成偏好问题；引导表、鉴权、网络等失败用中性文案，避免误导排查。
    const preferenceUnavailable = guideQuery.error instanceof ApiError
      && guideQuery.error.code === GUIDE_PREFERENCE_UNAVAILABLE_CODE;
    return <div className="aw-guide-notice" role="status">
      <AwStrokeIcon name="alert-c" />
      <span>{t(preferenceUnavailable ? 'prefReadFailed' : 'loadFailed')}</span>
      <Button size="small" onClick={() => { void guideQuery.refetch(); }}>{t('retry')}</Button>
    </div>;
  }
  if (!visible || !guide) {
    return null;
  }

  const awaitingStart = guide.status === 'PENDING';
  // 面板没打开（PENDING 起步失败、初始化对话准备失败）时，错误仍需可见，退回独立 notice。
  const fallbackNotice = notice && (awaitingStart || !chiefPanelOpen)
    ? t(notice === 'conflict' ? 'conflict' : `${notice}Failed`)
    : null;

  return <>
    <div className="aw-guide-mask" aria-hidden="true" />
    {awaitingStart && <section ref={cardRef} tabIndex={-1} className="aw-guide-card" data-stage="1" data-phase="1"
      role="dialog" aria-label={t('stageAccess.title')}>
      <div className="guide-eyebrow">{t('eyebrow', { phase: 1 })}</div>
      <GuideStepper phase={1} />
      <h2><span className="aw-guide-title-icon"><AwStrokeIcon name="term" /></span>{t('stageAccess.title')}</h2>
      <p>{t('stageAccess.description')}</p>
      <div className="aw-guide-tip">
        <AwStrokeIcon name="info" />
        <span>{t('tipAccess')}</span>
      </div>
      <div className="aw-guide-actions">
        <Button type="primary" block onClick={() => { void startGuide(); }}>{t('start')}</Button>
      </div>
      <div className="aw-guide-foot">
        <Button type="text" className="aw-guide-skip" onClick={() => { void skipNow(); }}>{t('skip')}</Button>
        <span className="spacer" />
        <button type="button" className="aw-guide-never" onClick={() => { setDialogError(null); setDialogOpen(true); }}>{t('never')}</button>
      </div>
    </section>}
    {fallbackNotice && <div className="aw-guide-notice" role="status">
      <AwStrokeIcon name="alert-c" />
      <span>{fallbackNotice}</span>
      <Button size="small" onClick={retryNotice}>{t('retry')}</Button>
    </div>}
    {dialogOpen && <div className="aw-guide-dialog-mask">
      <section className="aw-guide-dialog" role="dialog" aria-modal="true" aria-label={t('dialog.title')}>
        <h2>{t('dialog.title')}</h2>
        <p>{t('dialog.body')}</p>
        {dialogError && <Alert type="error" message={dialogError} />}
        <div className="aw-guide-dialog-actions">
          <Button disabled={disableSaving} onClick={() => { setDialogOpen(false); }}>
            {t('dialog.cancel')}
          </Button>
          <Button danger type="primary" loading={disableSaving} onClick={() => { void confirmDisable(); }}>
            {t('dialog.confirm')}
          </Button>
        </div>
      </section>
    </div>}
  </>;
}
