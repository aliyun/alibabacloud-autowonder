import { AnswerDeliveryStatus } from "./cards/AnswerDeliveryStatus";
import { i18n } from '@/shared/i18n';
import { formatDateTime } from '@/shared/i18n/format';
import { useTranslation } from 'react-i18next';
import { conversationNotice } from './conversationNotice';
import { AutoConversationQuestionHistory } from '@/shared/ui/AutoConversationQuestionHistory';
import { projectQuestionHistory, questionIdentity, withoutCoveredQuestions } from './answerHistory';
import { appendQuestionContext } from './continueQuestion';
import { AgentInitial } from '../components/SquadMembers';
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, message, Select, Tag } from 'antd';
import {
  StopOutlined, PaperClipOutlined,
} from '@ant-design/icons';
import { AutoConversationTurnContent, ConversationTurnCopyButton } from '@/shared/ui/AutoConversationTurnContent';
import { useConversationTurnHistory } from '@/shared/ui/useConversationTurnHistory';
import { getSquadMembers } from '@/features/squad/api';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { ResizeHandle } from '@/shared/ui/ResizeHandle';
import { ApiError, ErrorCodes } from '@/shared/types/common';
import { useAuthStore } from '@/shared/auth/store';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import {
  DOCUMENT_UPLOAD_MESSAGES,
  documentsFromDataTransfer,
  transferContainsFiles,
} from '@/shared/lib/documentUpload';
import { SquadAgentSelector, findSquadIdForAgent } from './SquadAgentSelector';
import type { SquadAgentSelection } from './SquadAgentSelector';
import { ConversationEventView } from './ConversationEventView';
import { EventSyncStatus } from './EventSyncStatus';
import { ReplyingIndicator } from './ReplyingIndicator';
import { SlashCommandPicker, slashCommandQuery } from './SlashCommandPicker';
import { MarkdownComposer } from './MarkdownComposer';
import type { MarkdownComposerHandle } from './MarkdownComposer';
import { TurnDetailToggle } from './TurnDetailToggle';
import { PendingAttachments, SentAttachments } from './Attachments';
import {
  CLARIFICATION_ATTACHMENT_MAX_FILE_BYTES,
  createPendingAttachment,
  oversizeAttachments,
  releasePendingAttachment,
} from './attachmentUpload';
import type { PendingClarificationAttachment } from './attachmentUpload';
import { ElicitationWizard } from './cards/ElicitationWizard';
import type { ElicitationReply } from './cards/ElicitationCard';
import { CopyMessageButton } from './CopyMessageButton';
import { ArtifactPreviewDrawer } from './ArtifactPreviewDrawer';
import type { Artifact } from '@/shared/types/workitem';
import { agentBlockStyle, userBubbleStyle } from './theme';
import { useClarificationBrowserNotification } from './useClarificationBrowserNotification';
import {
  useClarificationConversations,
  useClarificationConversation,
  useLatestClarificationConversation,
  useCreateClarificationConversation,
  useSubmitClarificationTurn,
  useCancelClarificationTurn,
  useClarificationEvents,
  useReplyElicitation,
  useUploadClarificationAttachment,
  useDeleteClarificationAttachment,
  hasPersistedReplyForTurn,
  isOutboundTurnDirection,
  findPairedInboundTurnId,
  isClarificationReplyingStatus,
} from './hooks';
import {
  readClarificationPrefill,
  writeClarificationPrefill,
} from './prefill';
import {
  AUTO_CLARIFICATION_AGENT_QUERY_KEY,
  loadAutoClarificationAgent,
} from './defaultClarificationAgent';
import {
  CLARIFICATION_SEND_MODE_KEY,
  CLARIFICATION_SEND_MODE_QUERY_KEY,
  DEFAULT_SEND_MODE,
  SEND_MODE_OPTIONS,
  parseSendMode,
} from './sendMode';
import type { SendMode } from './sendMode';
import { getMySetting, putMySetting } from '@/features/profile/userSettingApi';
import type { UserSetting } from '@/features/profile/userSettingApi';
import * as api from './api';
import type { ClarifyContext } from '../clarifyView';
import type { ClarificationElicitation, ClarificationTurn } from './types';
import './clarification.css';

export const CLARIFICATION_INPUT_MIN_HEIGHT = 32;
export const CLARIFICATION_INPUT_MAX_RATIO = 0.6;
/** 面板高度未知时的保底高度（与 50386 面板最小高一致） */
export const CLARIFICATION_PANEL_FALLBACK_HEIGHT = 280;
/** 自动模式默认行数：默认给 6 行高度，保证足够的输入空间（工单评论反馈） */
export const CLARIFICATION_INPUT_DEFAULT_ROWS = 6;
export function computeInputHeightMax(panelHeight: number): number {
  const safeHeight = Number.isFinite(panelHeight) && panelHeight > 0
    ? panelHeight
    : CLARIFICATION_PANEL_FALLBACK_HEIGHT;
  return Math.max(CLARIFICATION_INPUT_MIN_HEIGHT, Math.floor(safeHeight * CLARIFICATION_INPUT_MAX_RATIO));
}

/** 自动模式：默认 6 行高度（反馈：默认输入框太小）；手动模式：关闭 autoSize，由固定 height 接管 */
export function clarificationInputAutoSize(inputHeight: number | null):
  { minRows: number; maxRows: number } | false {
  if (inputHeight == null) {
    return { minRows: CLARIFICATION_INPUT_DEFAULT_ROWS, maxRows: CLARIFICATION_INPUT_DEFAULT_ROWS };
  }
  return false;
}

/** 距底部小于该阈值视为“在底部”，用于自动跟随/回到底部判断（R4） */
export const CLARIFICATION_BOTTOM_FOLLOW_THRESHOLD = 8;

/** 问题卡片结算后先播一遍淡出再卸载的保留时长（工单 56330），与卡片淡出动画同长。 */
export const CLARIFICATION_CARD_DISMISS_MS = 160;

export function isNearScrollBottom(
  el: { scrollTop: number; clientHeight: number; scrollHeight: number },
  threshold: number = CLARIFICATION_BOTTOM_FOLLOW_THRESHOLD,
): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
}

const clarificationBootstrapPrompt = (workitemId: string) =>
  i18n.t('workitem:clarification.bootstrapPrompt', { workitemId });

const TIME_HM: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const TIME_FULL_NUM: Intl.DateTimeFormatOptions = {
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
};
const TIME_FULL: Intl.DateTimeFormatOptions = {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
};

/** 历史加载失败/降级提示（工单 55411 缺陷一）：错误可见 + 显式重试入口，
 *  代替把失败渲染成「没有历史」的空白态。降级态用 warning 色区分整页失败。 */
function ClarificationLoadError({ testId, description, tone = 'danger', onRetry }: {
  testId: string;
  description: string;
  tone?: 'danger' | 'warning';
  onRetry: () => void;
}) {
  const { t } = useTranslation('workitem');
  return (
    <div data-testid={testId} role="alert" className={`aw-cl-note ${tone === 'warning' ? 'warn' : 'error'}`}>
      <span className="ic"><AwStrokeIcon name={tone === 'warning' ? 'alert-t' : 'alert-c'} /></span>
      <span className="grow">{description}</span>
      <Button size="small" onClick={onRetry}>{t('clarification.retry')}</Button>
    </div>
  );
}

interface WorkitemClarificationPanelProps {
  workitemId: string;
  artifacts?: Artifact[];
  /** 每次数字人从“未确定”变为“已确定”时触发，供外层自动进入全屏。
   *  同一次挂载内可能触发多次：URL 恢复落定、用户重新选择都会让派生值经过一次
   *  null 后重新确定，每次都是一次真实的“选定”。 */
  onAgentConfirmed?: () => void;
  /** 全屏渲染时正文、选人页与输入行横向铺满视口，只由外层内距留出小幅左右边距。 */
  fullscreen?: boolean;
  /** 从 URL 恢复的数字人：与 URL 会话成对使用，身份由会话详情或小队成员查询落定，
   *  不依赖数字人是否出现在交付进度里（工单 56281）。 */
  initialAgentId?: number | null;
  /** 从 URL 恢复的会话；会话详情落地后它的归属数字人就是权威恢复身份。 */
  initialConversationId?: number | null;
  /** 当前数字人/会话发生变化时上报，供外层写回 URL 以支持刷新恢复。
   *  只带「已经落定」的字段：恢复还没落定的字段一旦上报 null，
   *  外层就会把 URL 里的恢复源自己抹掉（CR53035-001）。 */
  onContextChange?: (context: Partial<ClarifyContext>) => void;
  /** 全屏合并头行插槽：外层（RightPanel）把「返回/标题」塞在本面板头行开头，
   *  与「切换数字人/会话/新对话」融为同一行，替代原先上下两条头行。 */
  headerPrefix?: ReactNode;
  /** 全屏合并头行插槽：「退出全屏」等尾部动作挂在头行末尾。 */
  headerSuffix?: ReactNode;
}

export function WorkitemClarificationPanel({
  workitemId,
  artifacts = [],
  onAgentConfirmed,
  fullscreen,
  initialAgentId,
  initialConversationId,
  onContextChange,
  headerPrefix,
  headerSuffix,
}: WorkitemClarificationPanelProps) {
  const { t } = useTranslation('workitem');
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);

  // 澄清数字人候选始终来自「小队 → 成员」选择器：交付进度只是执行历史，
  // 把它当候选来源会让未绑定 SDLC 的需求澄清数字人消失（工单 56281）。
  const [selection, setSelection] = useState<SquadAgentSelection | null>(
    () => readClarificationPrefill(workitemId),
  );

  // 刷新恢复：URL 里带着会话 id 时直接落在原会话上，
  // 否则维持 null，交给下面的自动选择逻辑挑最近一条。
  const [conversationId, setConversationId] = useState<number | null>(initialConversationId ?? null);
  const conversationIdRef = useRef<number | null>(conversationId);
  conversationIdRef.current = conversationId;
  // 创建回调的身份护栏：回调落地时核对发起时的数字人是否仍是当前数字人，
  // 过时的创建结果不能覆盖用户此间的切换（修复要求 2）。
  const effectiveAgentIdRef = useRef<number | null>(null);
  // 每次进入会话只初始化一次，避免用户清空输入后被重新填入。
  const initializedInputRef = useRef<number | null>(null);
  const [inputValue, setInputValue] = useState('');
  // null = 自动模式（默认 6 行高度）；数字 = 手动固定高度（像素）
  const [inputHeight, setInputHeight] = useState<number | null>(null);
  // 待发送附件：上传即落服务端（turn_id 为空），发送成功才绑定轮次。
  const [pendingAttachments, setPendingAttachments] = useState<PendingClarificationAttachment[]>([]);
  const pendingAttachmentsRef = useRef<PendingClarificationAttachment[]>(pendingAttachments);
  pendingAttachmentsRef.current = pendingAttachments;
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  // 同一次草稿的失败重试复用 clientMessageId：服务端据此去重，超时重发不会产生两条消息。
  const sendAttemptRef = useRef<{ signature: string; clientMessageId: string } | null>(null);
  const accessCommand = useAccessCommand();
  const canWrite = useAuthStore(state => state.hasAccess('READ_WRITE'));

  /** 清空待发送附件：中止在飞上传并释放本地预览 URL。 */
  const clearPendingAttachments = useCallback(() => {
    pendingAttachmentsRef.current.forEach(releasePendingAttachment);
    pendingAttachmentsRef.current = [];
    setPendingAttachments([]);
    uploadControllersRef.current.forEach((controller) => controller.abort());
    uploadControllersRef.current.clear();
    sendAttemptRef.current = null;
  }, []);

  useEffect(() => () => {
    pendingAttachmentsRef.current.forEach(releasePendingAttachment);
    uploadControllersRef.current.forEach((controller) => controller.abort());
  }, []);
  // 「提交中的会话」集合：pending 按发起提交的会话记账，而不是读 mutation 的
  // isPending——mutation 观察者是面板级单例，旧会话的 POST 未返回时会把所有
  // 会话（含新建的目标会话）一起禁用（工单 55851）。
  const [pendingSubmitConversationIds, setPendingSubmitConversationIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  // 发送方式偏好（FR-005~FR-010）。初值就是默认值：偏好请求返回前按回车必须已经有
  // 确定行为，不能出现「先按默认发、拉回来后又改口径」的抖动。
  const [sendMode, setSendMode] = useState<SendMode>(DEFAULT_SEND_MODE);
  const sendModeSetting = useQuery({
    queryKey: CLARIFICATION_SEND_MODE_QUERY_KEY,
    queryFn: () => getMySetting(CLARIFICATION_SEND_MODE_KEY),
    staleTime: 5 * 60_000,
  });
  // sendMode 的镜像：保存任务异步落定时要读「此刻界面上的值」，
  // 闭包里的 state 只是发起保存那一刻的快照，判断不了失败是否已经过时。
  const sendModeRef = useRef<SendMode>(DEFAULT_SEND_MODE);
  // 最近一次确认落库成功的值：连续切换全部失败时回滚到它，而不是回滚到
  // 同样没保存上的上一次乐观选择（工单 55511：连续切换不被旧失败覆盖）。
  const savedSendModeRef = useRef<SendMode>(DEFAULT_SEND_MODE);
  // 用户是否已动过发送方式：水合时区分「补服务端值」与「不覆盖排队落库中的本地选择」。
  const sendModeTouchedRef = useRef(false);
  // 保存任务队列：串行执行 PUT，同一时刻只有一个请求在飞，最后一个任务保存最后的选择。
  const sendModeSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  // 只在偏好首次落定（成功或失败）时水合一次。此后本地 state 是唯一事实来源，
  // 否则窗口重新聚焦触发的后台重新拉取会把用户刚改的选择盖回服务端旧值。
  const sendModeHydratedRef = useRef(false);
  useEffect(() => {
    if (sendModeHydratedRef.current || sendModeSetting.isLoading) return;
    sendModeHydratedRef.current = true;
    // 用户在水合前就切过发送方式：本地选择已在保存队列里，服务端旧值不能覆盖它。
    if (sendModeTouchedRef.current) return;
    const hydrated = parseSendMode(sendModeSetting.data?.valueJson);
    setSendMode(hydrated);
    sendModeRef.current = hydrated;
    savedSendModeRef.current = hydrated;
  }, [sendModeSetting.isLoading, sendModeSetting.data]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<MarkdownComposerHandle | null>(null);
  // R4: 用户向上滚动离开底部时暂停自动跟随；回到底部后恢复
  const [followBottom, setFollowBottom] = useState(true);
  const followBottomRef = useRef(true);
  // 程序化滚动标记：跟随/回到底部触发的 scrollTo 会派发 scroll 事件，
  // 在内容持续增长时这些事件可能短暂落在“非底部”位置，若直接参与
  // 判定会把跟随误关掉导致流式回复不再自动滚动（工单问题3）。
  const programmaticScrollPendingRef = useRef(false);
  // Guards the auto-create effect: createMutation is a new object every
  // render (react-query v5), so without this set a persistent create failure
  // would re-trigger mutate on every effect run (request storm + toast spam).
  const autoCreateAttemptedRef = useRef(new Set<number>());
  // 自动选人（工单 60314）：挂载时的本地预填快照决定是否允许标签自动选择。
  // 必须在最近会话/预填改写 selection 之前取值，否则会把“后来才有的身份”当成预填。
  const initialPrefillRef = useRef(selection);
  // 自动身份只应用一次；兜底后同样不再自动回选，避免清空选择形成循环。
  const autoAppliedRef = useRef(false);
  const autoFallbackRef = useRef(false);
  // 非唯一候选（0 个或多个）落定后不再自动选：用户留在选人页期间不会被后台重取“突然选中”。
  const autoSettledRef = useRef(false);
  const autoSelectedAgentIdRef = useRef<number | null>(null);
  const [autoTip, setAutoTip] = useState<{ agentName: string } | null>(null);
  const [autoFallbackNotice, setAutoFallbackNotice] = useState(false);

  // 刷新恢复（URL 上下文）：恢复源只认挂载当帧从 URL 读到的值——外层会把本面板上报的
  // 上下文写回 URL 再作为 prop 回流，跟着活的 prop 走会让恢复源在落定之前就被自己抹掉
  // （CR53035-001）。URL 恢复不得依赖数字人是否在交付进度里（工单 56281）。
  const restoredAgentIdRef = useRef<number | null>(initialAgentId ?? null);
  const restoredConversationIdRef = useRef<number | null>(initialConversationId ?? null);
  // 用户主动接管选人（选了成员或点了「切换数字员工」）之后，本地选择就是唯一事实来源，
  // 迟到的 URL 恢复不得再覆盖它（恢复优先级：用户选择 > URL > 本地记忆）。
  const userSelectedAgentRef = useRef(false);

  // 会话详情先于身份派生：URL 会话的主人就是最可靠的恢复身份——这条会话已经过服务端
  // 权限/归属校验，比 URL 参数更可信。只锁定一次，之后不再跟随当前会话变化。
  const conversation = useClarificationConversation(workitemId, conversationId);
  const urlConversationAgentIdRef = useRef<number | null>(null);
  if (urlConversationAgentIdRef.current == null
      && conversationId !== null
      && conversationId === restoredConversationIdRef.current
      && conversation.data != null) {
    urlConversationAgentIdRef.current = conversation.data.agentId;
  }
  const restoredAgentId = urlConversationAgentIdRef.current ?? restoredAgentIdRef.current;
  // 会话主人是渲染期锁定的 ref，派生结论必须把它读成渲染值并让其参与 memo 依赖：
  // 它在「数字人入参没变、只是主人身份落定」的一帧里 null→N，其余依赖全不变，
  // 只读 ref 的 memo 会返回缓存的「无恢复身份」把合法会话丢掉，面板退回本地记忆
  // 并自动选上别人的会话（缺陷二 A/B 竞态）。
  const urlConversationOwnerId = urlConversationAgentIdRef.current;
  const launchSquad = conversation.data?.id === restoredConversationIdRef.current
    ? conversation.data?.squadId : undefined;

  // URL 只带数字人参数（没有会话）时，靠「小队成员查询」确认它仍然可选：
  // 候选范围与选择器一致，解析不出来的数字人不恢复。查询结果同时用于恢复后
  // 同步本地选择记忆。
  const restoreSquadQuery = useQuery({
    queryKey: ['clarification', 'agent-squad', restoredAgentId],
    queryFn: () => findSquadIdForAgent(restoredAgentId as number),
    enabled: restoredAgentId != null && !launchSquad && !userSelectedAgentRef.current,
    staleTime: 5 * 60_000,
  });

  // URL 恢复身份：pending=恢复源还没落定，identity=落定结果，两者皆空=没有可恢复的 URL 身份。
  const urlRestore = useMemo((): { pending: boolean; identity: SquadAgentSelection | null } => {
    if (restoredAgentId == null || userSelectedAgentRef.current) {
      return { pending: false, identity: null };
    }
    if (urlConversationOwnerId != null) {
      // 会话本身就是恢复源：身份直接成立。小队关系只用来同步本地记忆，
      // 已不在任何可选小队中的历史数字人不编造小队归属（squadId 0 仅作占位）。
      return {
        pending: false,
        identity: { squadId: launchSquad ?? restoreSquadQuery.data ?? 0, agentId: urlConversationOwnerId },
      };
    }
    if (restoreSquadQuery.isSuccess) {
      return {
        pending: false,
        identity: restoreSquadQuery.data == null
          ? null
          : { squadId: restoreSquadQuery.data, agentId: restoredAgentId },
      };
    }
    // 查询失败不能把面板钉在「恢复中」：落回本地选择记忆，用户仍可自己选。
    if (restoreSquadQuery.isError) {
      return { pending: false, identity: null };
    }
    return { pending: true, identity: null };
  }, [restoredAgentId, urlConversationOwnerId, launchSquad, restoreSquadQuery.data, restoreSquadQuery.isError,
    restoreSquadQuery.isSuccess]);

  // 有效数字人身份：用户主动选择 > 有效 URL 上下文 > 本地选择记忆（工单 56281）。
  const selectedAgentId = selection?.agentId && selection.agentId > 0 ? selection.agentId : null;
  const effectiveAgentId = userSelectedAgentRef.current
    ? selectedAgentId
    : urlRestore.identity?.agentId ?? selectedAgentId;
  effectiveAgentIdRef.current = effectiveAgentId;

  // 恢复身份落定前，effectiveAgentId 可能仍是本地记忆里的另一个数字人（与恢复目标
  // 不同域）：这一窗口里它名下的会话列表不能代表恢复目标——拿它校验恢复的会话会把
  // 合法会话误判成「不存在」，拿它自动选择/自动创建会把预填数字人的会话钉在恢复目标
  // 身上（CR53035-002 A/B 竞态）。所有「系统代用户做决定」的动作都要等身份落定；
  // 用户手动选择不受此限。
  // URL 会话的主人还没解析出来（详情还在加载）时同样未落定：这段时间按本地记忆的
  // 列表校验会把合法会话误判成不存在。
  const urlConversationUnsettled = restoredConversationIdRef.current != null
    && urlConversationAgentIdRef.current == null
    && conversationId === restoredConversationIdRef.current
    && conversation.isLoading;
  const agentRestorePending = !userSelectedAgentRef.current
    && (urlRestore.pending || urlConversationUnsettled);

  // 默认打开「最近一次会话」（工单 57463）：依据从浏览器本地记忆升级为服务端记录，
  // 换浏览器/换成员也能直接进入。URL 上下文优先，此时不做这次查询。
  const restoredFromUrl = restoredAgentIdRef.current != null
    || restoredConversationIdRef.current != null;
  const latestQuery = useLatestClarificationConversation(workitemId, !restoredFromUrl);
  const serverResolvedRef = useRef(false);
  const serverResolvedConversationIdRef = useRef<number | null>(null);
  // 解析窗口：没有 URL 上下文、用户还没手动接管选择。期间只展示加载态、不渲染
  // 选人页，避免「先闪一下选人页再跳走」（FR-5）。命中结果要等落定 effect 把身份
  // 写进 state 之后才算结束，否则会多渲染一帧选人页。
  const latestPending = !restoredFromUrl
    && !userSelectedAgentRef.current
    && (latestQuery.isLoading
      || (latestQuery.isSuccess && latestQuery.data != null && !serverResolvedRef.current));

  // 标签自动选择（工单 60314）：只有“无 URL、无用户接管、无预填、/latest 明确为空”
  // 且尚未自动选中/兜底时才查询候选；/latest 失败保持现有降级，不自动选
  // （无法确认是否已有历史会话）。
  const autoEligible = !restoredFromUrl
    && !agentRestorePending
    && !userSelectedAgentRef.current
    && initialPrefillRef.current == null
    && !autoAppliedRef.current
    && !autoFallbackRef.current
    && !autoSettledRef.current
    && latestQuery.isSuccess
    && latestQuery.data == null;

  const autoQuery = useQuery({
    queryKey: AUTO_CLARIFICATION_AGENT_QUERY_KEY,
    queryFn: loadAutoClarificationAgent,
    enabled: autoEligible,
    // 查询失败静默回落手动选择，不做重试风暴。
    retry: false,
    staleTime: 30_000,
  });

  // 解析窗口：latest 落空的同一帧就要接管加载态，否则会先闪一帧选人页。
  // 不能用 isLoading（enabled 刚翻转时仍是 idle），用“是否已落定”判断；
  // 候选取回但还没写进 selection 的那一帧同样算未落定，否则会闪一帧选人页。
  const autoApplyPending = autoQuery.isSuccess
    && autoQuery.data != null
    && !autoAppliedRef.current
    && !autoFallbackRef.current;
  const autoPending = autoEligible && (!autoQuery.isFetched || autoApplyPending);
  const identityPending = latestPending || autoPending;

  // 命中即落定身份与会话；没有记录或查询失败都静默回落现有链路（FR-1/FR-6）。
  // 放在自动选会话之前：它先写 conversationId，自动选择就不会再抢着取列表首项。
  // 每次挂载只落定一次：/latest 之后重新取数（窗口聚焦/缓存失效）拿到新数据时，
  // 不能把用户已经从下拉改选的会话顶回最新（CR N-1）。
  useEffect(() => {
    if (serverResolvedRef.current) return;
    if (restoredFromUrl || userSelectedAgentRef.current) return;
    if (!latestQuery.isSuccess) return;
    const latest = latestQuery.data;
    if (!latest) return;
    serverResolvedRef.current = true;
    serverResolvedConversationIdRef.current = latest.id;
    // 小队归属异步补齐（见下），这里先用 0 占位，不阻塞打开会话。
    setSelection({ squadId: 0, agentId: latest.agentId });
    setConversationId(latest.id);
  }, [restoredFromUrl, latestQuery.isSuccess, latestQuery.data]);

  // 应用候选：恰好 1 个时才自动进入。查询期间用户可能已接管或 URL 恢复落定，
  // 迟到的结果一律不覆盖；0 个或多个候选落定后停留在手动选人页。
  useEffect(() => {
    if (!autoQuery.isSuccess || autoAppliedRef.current || autoFallbackRef.current) return;
    if (autoSettledRef.current) return;
    if (userSelectedAgentRef.current || restoredFromUrl || initialPrefillRef.current != null) return;
    const candidate = autoQuery.data;
    if (!candidate) {
      autoSettledRef.current = true;
      return;
    }
    autoAppliedRef.current = true;
    autoSelectedAgentIdRef.current = candidate.id;
    setAutoTip({ agentName: candidate.name });
    // 不设 userSelectedAgentRef、不写 localStorage 预填：身份来源仍是“系统推断”，
    // 会话创建后由 /latest 承接后续恢复。无小队时用 0 占位，不伪造归属。
    setSelection({ squadId: candidate.squadIds?.[0] ?? 0, agentId: candidate.id });
  }, [autoQuery.isSuccess, autoQuery.data, restoredFromUrl]);

  // 服务端会话的小队归属只用于「切换数字员工」回显与交付预填：查不到保持 0 占位，
  // 不伪造预填（与 URL 恢复口径一致）。数字人已移出所有小队时照常打开会话（FR-4）。
  const serverSquadQuery = useQuery({
    queryKey: ['clarification', 'agent-squad', 'server', latestQuery.data?.agentId],
    queryFn: () => findSquadIdForAgent(latestQuery.data!.agentId),
    enabled: serverResolvedRef.current
      && !userSelectedAgentRef.current
      && latestQuery.data != null,
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (!serverResolvedRef.current || userSelectedAgentRef.current) return;
    const agentId = latestQuery.data?.agentId;
    const squadId = serverSquadQuery.data;
    if (agentId == null || squadId == null || squadId <= 0) return;
    setSelection((current) => (
      current && current.agentId === agentId && current.squadId === squadId
        ? current
        : { squadId, agentId }
    ));
    writeClarificationPrefill(workitemId, { squadId, agentId });
  }, [latestQuery.data?.agentId, serverSquadQuery.data, workitemId]);

  // 三条选人路径（成员选择 / 「切换数字员工」后的重选 / localStorage 记忆命中）都汇聚到
  // 这个派生值上，其中记忆命中那条没有任何点击事件，所以监听跃迁而不是挂 handler。
  // 用 useLayoutEffect：记忆命中时 useEffect 会先 paint 一帧非全屏再切换，可见闪烁。
  // 未落定的身份不确认：此刻的 effectiveAgentId 可能只是本地记忆，确认它会让外层
  // 提前进全屏，随后又被恢复目标替换。
  const agentConfirmedRef = useRef(false);
  useLayoutEffect(() => {
    if (agentRestorePending || effectiveAgentId == null) {
      agentConfirmedRef.current = false;
      return;
    }
    if (agentConfirmedRef.current) return;
    agentConfirmedRef.current = true;
    onAgentConfirmed?.();
  }, [effectiveAgentId, agentRestorePending, onAgentConfirmed]);

  // 恢复落定后把有效身份写回本地选择记忆：以后重新打开不再依赖 URL。
  // 只在数字人确实归属于某个可选小队时写——没有小队归属的历史身份不伪造预填。
  const restoredPrefillWrittenRef = useRef(false);
  useEffect(() => {
    const identity = urlRestore.identity;
    if (restoredPrefillWrittenRef.current || identity == null || identity.squadId <= 0) return;
    if (userSelectedAgentRef.current) return;
    restoredPrefillWrittenRef.current = true;
    writeClarificationPrefill(workitemId, { squadId: identity.squadId, agentId: identity.agentId });
  }, [urlRestore.identity, workitemId]);

  const conversations = useClarificationConversations(workitemId, effectiveAgentId);
  const createMutation = useCreateClarificationConversation(workitemId);
  const submitMutation = useSubmitClarificationTurn(workitemId, conversationId);
  const cancelMutation = useCancelClarificationTurn(workitemId, conversationId);
  const uploadAttachmentMutation = useUploadClarificationAttachment(workitemId, conversationId);
  const deleteAttachmentMutation = useDeleteClarificationAttachment(workitemId, conversationId);
  const {
    streamedEvents, streamedText, streamedTurnTerminated, resetStreamedEvents,
    timeline, availableCommands, streamedTurnId,
    preparationStatus, syncing, detailsError, reloadDetails,
  } = useClarificationEvents(
    workitemId,
    conversationId,
    conversation.data?.processingTurnId,
  );

  const convData = conversation.data;

  const isCreatingConversation = createMutation.isPending;
  const isConversationLoading = conversationId !== null && conversation.isLoading;
  // 历史详情三态：加载中 / 成功（含确实没有消息）/ 失败。失败再细分为
  // 还没有任何内容（整页错误 + 禁止发送）与已有内容（保留原内容 + 降级提示），
  // 两者都不能被渲染成「没有历史」（工单 55411 缺陷一）。
  const conversationHistoryFailed = conversationId !== null
    && conversation.isError && convData == null;
  const conversationHistoryStale = conversationId !== null
    && conversation.isError && convData != null;
  const isProcessing = convData?.processingStatus === 'PROCESSING';
  // R1: 排队中（QUEUED）同样算“回复未结束”；与轮询兜底共用同一判定口径
  const isReplying = isClarificationReplyingStatus(convData?.processingStatus);
  // 提交中只按「当前会话自己的在飞请求」判定：切到/新建的会话必须立即可编辑，
  // 旧会话 POST 的落地只影响它自己（工单 55851）。
  const isSubmittingCurrentConversation = conversationId != null
    && pendingSubmitConversationIds.has(conversationId);
  const cancelSupported = convData?.cancelSupported === true;
  const acpInteractionSupported = convData?.acpInteractionSupported === true;
  // 逻辑表达式直接当依赖会每次渲染都变，滚动跟随的 effect 会被无谓地反复触发
  const turnHistory = useConversationTurnHistory({ base: `/api/workitems/${workitemId}/clarification-conversations/${conversationId}`, conversationId, snapshot: convData });
  const turns = turnHistory.turns;
  const { t: sharedT } = useTranslation('shared');
  const historyLatestLabel = sharedT('conversationContent.latest');

  // 输入行整体禁用口径：发送门禁、附件选择/上传/移除共用，避免某一入口在回复中仍可用。
  const composerDisabled = isSubmittingCurrentConversation || isCreatingConversation || isReplying
    || isConversationLoading || conversationHistoryFailed || agentRestorePending;
  const readyAttachments = pendingAttachments.filter((item) => !!item.attachment);
  // 上传中或上传失败的附件都不能随消息发送：宁可拦住，也不让消息静默丢附件。
  const hasBlockingAttachments = pendingAttachments.some((item) => !item.attachment);
  const canSendMessage = inputValue.trim().length > 0 || readyAttachments.length > 0;

  const addPendingFiles = useCallback((files: File[], info?: { containsDirectory?: boolean }) => {
    if (info?.containsDirectory) {
      message.error(DOCUMENT_UPLOAD_MESSAGES.directory);
      return;
    }
    if (files.length === 0) {
      message.error(DOCUMENT_UPLOAD_MESSAGES.noLocalFile);
      return;
    }
    const rejected = oversizeAttachments(files);
    if (rejected.length > 0) {
      // 单文件上限：超限文件不进入上传队列，其余合法文件照常添加。
      message.error(t('clarification.attachmentTooLarge', {
        name: rejected[0].name,
        max: Math.round(CLARIFICATION_ATTACHMENT_MAX_FILE_BYTES / (1024 * 1024)),
      }));
    }
    const accepted = files.filter((file) => file.size <= CLARIFICATION_ATTACHMENT_MAX_FILE_BYTES);
    if (accepted.length === 0 || !conversationIdRef.current) return;
    const created = accepted.map(createPendingAttachment);
    setPendingAttachments((current) => [...current, ...created]);
    // 选中即上传：发送时只带 attachmentIds，失败重试不必重传大文件。
    for (const item of created) {
      const controller = new AbortController();
      uploadControllersRef.current.set(item.key, controller);
      void uploadAttachmentMutation.mutateAsync({ file: item.file, signal: controller.signal })
        .then((attachment) => {
          uploadControllersRef.current.delete(item.key);
          setPendingAttachments((current) => current.map((pending) => (
            pending.key === item.key ? { ...pending, attachment } : pending
          )));
        })
        .catch((error) => {
          uploadControllersRef.current.delete(item.key);
          if (controller.signal.aborted) return;
          setPendingAttachments((current) => current.map((pending) => (
            pending.key === item.key
              ? {
                ...pending,
                error: error instanceof ApiError && error.message
                  ? error.message
                  : t('clarification.attachmentUploadFailed'),
              }
              : pending
          )));
        });
    }
  }, [t, uploadAttachmentMutation]);

  const selectAttachmentFiles = useCallback((
    files: File[],
    info?: { containsDirectory?: boolean },
  ) => {
    if (composerDisabled) return;
    accessCommand('READ_WRITE', t('clarification.attachFile'), () => addPendingFiles(files, info));
  }, [accessCommand, addPendingFiles, composerDisabled, t]);

  const removePendingAttachment = useCallback((key: string) => {
    const target = pendingAttachmentsRef.current.find((item) => item.key === key);
    if (!target) return;
    uploadControllersRef.current.get(key)?.abort();
    uploadControllersRef.current.delete(key);
    if (!target.attachment) {
      // 未上传成功（上传中/失败）：本地移除即可；已落库但中断的行由服务端 24h 孤儿清理兜底。
      releasePendingAttachment(target);
      setPendingAttachments((current) => current.filter((item) => item.key !== key));
      return;
    }
    const attachmentId = target.attachment.id;
    accessCommand('READ_WRITE', t('clarification.attachmentRemoveAction'), () => {
      void deleteAttachmentMutation.mutateAsync(attachmentId)
        .then(() => {
          releasePendingAttachment(target);
          setPendingAttachments((current) => current.filter((item) => item.key !== key));
        })
        .catch((error) => {
          message.error(error instanceof ApiError && error.message
            ? error.message
            : t('clarification.attachmentDeleteFailed'));
        });
    });
  }, [accessCommand, deleteAttachmentMutation, t]);

  // 切换工作项/会话时丢弃草稿附件：它们属于原会话，跨会话发送会串味。
  const attachmentScopeRef = useRef({ workitemId, conversationId });
  useEffect(() => {
    const previous = attachmentScopeRef.current;
    if (previous.workitemId === workitemId && previous.conversationId === conversationId) return;
    attachmentScopeRef.current = { workitemId, conversationId };
    clearPendingAttachments();
  }, [workitemId, conversationId, clearPendingAttachments]);

  const handleComposerDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (composerDisabled || !transferContainsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }, [composerDisabled]);

  const handleComposerDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!transferContainsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = composerDisabled ? 'none' : 'copy';
  }, [composerDisabled]);

  const handleComposerDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!transferContainsFiles(event.dataTransfer)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }, []);

  const handleComposerDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!transferContainsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (composerDisabled) return;
    const target = event.target as HTMLElement | null;
    // 编辑器内的 drop 已由 MarkdownComposer 提取并回调 onFiles，这里跳过防重复上传。
    if (target?.closest('.ProseMirror')) return;
    const { files, containsDirectory } = documentsFromDataTransfer(event.dataTransfer);
    selectAttachmentFiles(files, { containsDirectory });
  }, [composerDisabled, selectAttachmentFiles]);

  const turnCountAtSubmitRef = useRef(turns.length);
  const prevIsProcessingRef = useRef(false);

  useEffect(() => {
    if (isSubmittingCurrentConversation) {
      turnCountAtSubmitRef.current = turns.length;
    }
  }, [isSubmittingCurrentConversation, turns.length]);

  useEffect(() => {
    if (prevIsProcessingRef.current && !isProcessing) {
      // processing just ended — turn count will be checked in render
    }
    prevIsProcessingRef.current = isProcessing;
  }, [isProcessing]);

  const hasPersistedStreamedReply = hasPersistedReplyForTurn(turns, streamedTurnId);
  const awaitingAgentReply = !!streamedText
    && !hasPersistedStreamedReply
    && (streamedTurnTerminated || (!isProcessing && turns.length === turnCountAtSubmitRef.current));
  const latestTurn = turns[turns.length - 1];
  const latestTurnIsAgentReply = !!latestTurn && isOutboundTurnDirection(latestTurn.direction);
  const showProcessingEvents = isProcessing && !streamedTurnTerminated && !latestTurnIsAgentReply;
  // 流式回复一旦以相同内容落库，累积的流式事件就完成使命：立即重置，
  // 幽灵流式气泡随持久化气泡同帧消失；下一轮从干净状态重新累积
  // （工单 50720 返工：不重置会让跨轮残留事件在后续渲染中再次拼接）。
  // 用 useLayoutEffect 保证在绘制前完成，避免持久化气泡与流式气泡同屏闪烁一帧。
  useLayoutEffect(() => {
    if (hasPersistedStreamedReply && !!streamedText) {
      resetStreamedEvents();
    }
  }, [hasPersistedStreamedReply, streamedText, resetStreamedEvents]);
  // R1: 发送后立即出现（含提交中/排队中），任意终态事件后消失
  const showReplyingIndicator = !!conversationId
    && !streamedTurnTerminated
    && (isSubmittingCurrentConversation || isReplying);

  // 流已给出本轮终态、详情却还停在 PROCESSING/QUEUED：静默自动补齐详情（事件触发的
  // 失效与 3s 轮询会收敛），不额外占用消息区。不在此开放发送：服务端尚未结算就解除
  // 并发门禁会造成重复提交（工单 55851）。

  const queryClient = useQueryClient();
  const previousProcessingStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousProcessingStatusRef.current;
    const current = convData?.processingStatus ?? null;
    if (previous && isClarificationReplyingStatus(previous) && !isClarificationReplyingStatus(current)) {
      queryClient.invalidateQueries({ queryKey: ['workitem', workitemId, 'artifacts'] });
      queryClient.invalidateQueries({ queryKey: ['workitem', workitemId, 'requirement-documents'] });
    }
    previousProcessingStatusRef.current = current;
  }, [convData?.processingStatus, queryClient, workitemId]);

  const replyMutation = useReplyElicitation(workitemId, conversationId);
  const [replyingRequestId, setReplyingRequestId] = useState<string | null>(null);
  // 后端已结算（取消/过期/并发）但 resolved 事件不落库时，前端时间线仍把卡片当 pending。
  // 提交吃到 409 CONFLICT 就把该 requestId 记为已结算并据此撤下卡片，避免用户对着死卡片反复 409、对话卡死。
  const [conflictedElicitationIds, setSettledElicitationIds] = useState<ReadonlySet<string>>(() => new Set());
  const questionScope = `${workitemId}:${conversationId}`;
  const questionScopeRef = useRef(questionScope); questionScopeRef.current = questionScope;
  const turnWindowKey = turns.map(turn => turn.id).join(',');
  const questionTurnIds = useMemo(() => new Set(turns.filter(turn => turn.direction === 'IN' || turn.direction === 'INBOUND')
    .map(turn => turn.id)), [turnWindowKey]);
  const [pagedQuestionIds, setPagedQuestionIds] = useState<{ scope: string; turns: ReadonlyMap<number, readonly string[]> }>(
    () => ({ scope: questionScope, turns: new Map() }));
  useEffect(() => { setSettledElicitationIds(new Set()); }, [questionScope]);
  useEffect(() => {
    setPagedQuestionIds(previous => {
      if (previous.scope !== questionScope) return { scope: questionScope, turns: new Map() };
      const retained = new Map([...previous.turns].filter(([turnId]) => questionTurnIds.has(turnId)));
      return retained.size === previous.turns.size ? previous : { scope: questionScope, turns: retained };
    });
  }, [questionScope, questionTurnIds]);
  const recordHistoricalQuestions = useCallback((turnId: number, ids: readonly string[]) => {
    if (questionScopeRef.current !== questionScope || !questionTurnIds.has(turnId)) return;
    setPagedQuestionIds(previous => {
      const retained = new Map(previous.scope === questionScope
        ? [...previous.turns].filter(([id]) => questionTurnIds.has(id)) : []);
      const current = retained.get(turnId);
      if (current?.length === ids.length && current.every((id, index) => id === ids[index])) return previous;
      // Each callback replaces one retained page; never accumulate visited questions.
      retained.set(turnId, [...ids]);
      return { scope: questionScope, turns: retained };
    });
  }, [questionScope, questionTurnIds]);
  const pagedQuestionIdentities = useMemo(() => pagedQuestionIds.scope === questionScope
    ? [...pagedQuestionIds.turns].filter(([turnId]) => questionTurnIds.has(turnId))
      .flatMap(([turnId, ids]) => ids.map(requestId => ({ turnId, requestId }))) : [],
  [pagedQuestionIds, questionScope, questionTurnIds]);
  const settledElicitationIds = useMemo(() => new Set([...conflictedElicitationIds,
    ...pagedQuestionIdentities.map(row => row.requestId)]), [conflictedElicitationIds, pagedQuestionIdentities]);

  const handleReplyElicitation = useCallback(
    (requestId: string, reply: ElicitationReply) => {
      if (!conversationId || replyMutation.isPending) return;
      setReplyingRequestId(requestId);
      replyMutation.mutate(
        { requestId, action: reply.action, content: reply.content },
        {
          onSettled: () => setReplyingRequestId(null),
          onError: (error) => {
            if (error instanceof ApiError && error.code === ErrorCodes.CONFLICT) {
              setSettledElicitationIds((prev) => new Set(prev).add(requestId));
              queryClient.invalidateQueries({
                queryKey: ['workitem', workitemId, 'clarification-conversation', conversationId],
              });
              message.info(i18n.t('workitem:clarification.questionExpired'));
              return;
            }
            // 服务端按卡片 schema 拒收（缺必答、未知字段、类型不符）时给出可读原因，
            // 卡片保持可答，用户补完再提交即可。
            if (error instanceof ApiError && error.code === ErrorCodes.PARAM_INVALID && error.message) {
              message.error(error.message);
              return;
            }
            message.error(i18n.t('workitem:clarification.answerFailed'));
          },
        },
      );
    },
    [conversationId, replyMutation, queryClient, workitemId],
  );

  const streamedRequestIds = useMemo(
    () => new Set(
      timeline
        .filter((node) => node.kind === 'elicitation')
        .map((node) => node.elicitation!.requestId),
    ),
    [timeline],
  );

  /** 刷新后 WS 流已断，未解决卡片只能从会话详情恢复；流里已有同一 requestId
   *  时以流为准，否则会并排出现两张一样的卡片。 */
  const restoredElicitations = useMemo<ClarificationElicitation[]>(() => {
    if (!acpInteractionSupported) return [];
    return (convData?.pendingElicitations ?? [])
      .filter((card) => !streamedRequestIds.has(card.requestId));
  }, [acpInteractionSupported, convData?.pendingElicitations, streamedRequestIds]);

  /** 进行中的问题停靠在输入框位置分步作答：优先用流里的 pending 节点，否则用刷新恢复的。
   *  同一时刻只显示一个；已显示的问题仍待答时保持它，避免后台恢复的其他问题卸载当前草稿。
   *  已被后端结算（409）的 requestId 一律排除——其 resolved 事件可能没落库，时间线会一直当它 pending。 */
  const deliveredRequestIds = useMemo(() => new Set([...(convData?.answerDeliveries ?? []), ...(convData?.questionHistory ?? [])].map(card => card.requestId)), [convData?.answerDeliveries, convData?.questionHistory]);
  const questionHistories = useMemo(() => new Map(turns.filter(turn => turn.direction === 'IN' || turn.direction === 'INBOUND')
    .map(turn => [turn.id, projectQuestionHistory(turn.id, convData?.questionHistory ?? convData?.answerDeliveries, timeline)])),
  [turns, convData?.questionHistory, convData?.answerDeliveries, timeline]);
  const allQuestionHistory = useMemo(() => [...questionHistories.values()].flat(), [questionHistories]);
  const coveredQuestionIds = useMemo(() => new Set([...allQuestionHistory, ...pagedQuestionIdentities,
    ...(convData?.answerDeliveries ?? []).filter(row => questionTurnIds.has(row.turnId))]
    .map(entry => questionIdentity(entry.turnId, entry.requestId))),
  [allQuestionHistory, pagedQuestionIdentities, convData?.answerDeliveries, questionTurnIds]);
  const currentQuestionTurnId = convData?.processingTurnId ?? [...turns].reverse().find(turn => turn.direction === 'IN' || turn.direction === 'INBOUND')?.id;
  const [heldRequestId, setHeldRequestId] = useState<string | null>(null);
  const activeElicitation = useMemo(() => {
    if (!acpInteractionSupported) return null;
    const streamed = timeline.filter(
      (node) => node.kind === 'elicitation' && node.elicitation
        && !node.elicitation.resolved
        && !settledElicitationIds.has(node.elicitation.requestId)
        && !deliveredRequestIds.has(node.elicitation.requestId),
    ).map((node) => ({
      requestId: node.elicitation!.requestId,
      message: node.elicitation!.message ?? undefined,
      schema: node.elicitation!.requestedSchema,
    }));
    const restored = restoredElicitations
      .filter((card) => !settledElicitationIds.has(card.requestId) && !deliveredRequestIds.has(card.requestId))
      .map((card) => ({
        requestId: card.requestId,
        message: card.message ?? undefined,
        schema: parseSchemaJson(card.requestedSchema),
      }));
    const pending = [...streamed, ...restored];
    return pending.find((card) => card.requestId === heldRequestId) ?? pending[0] ?? null;
  }, [acpInteractionSupported, timeline, restoredElicitations, settledElicitationIds, deliveredRequestIds, heldRequestId]);

  /** 卡片结算后先淡出再卸载（工单 56330）：结算瞬间保留上一张卡片 CLARIFICATION_CARD_DISMISS_MS，
   *  期间输入行不提前出现，避免「卡片与输入框双 present」；新一组卡片到来时立即换新。
   *  渲染期直接完成承接（不放到 effect），否则会出现一帧「卡片已卸、输入框未回」的闪空。 */
  const activeElicitationId = activeElicitation?.requestId ?? null;
  const [heldElicitation, setHeldElicitation] = useState(activeElicitation);
  if (heldRequestId !== activeElicitationId) {
    setHeldRequestId(activeElicitationId);
    setHeldElicitation(activeElicitation ?? heldElicitation);
  }
  const displayedElicitation = activeElicitationId ? activeElicitation : heldElicitation;
  const dismissingElicitation = !activeElicitationId && !!heldElicitation;
  useEffect(() => {
    if (!dismissingElicitation) return undefined;
    const timer = window.setTimeout(() => setHeldElicitation(null), CLARIFICATION_CARD_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [dismissingElicitation]);

  // 只有「已打开面板里新出现」的待答问题才发浏览器提醒：刷新恢复的旧 pending、
  // 重放与已结算问题都由基线/去重集合挡掉；卡片自身的渲染次数不参与判断。
  const browserNotificationResolvedRequestIds = useMemo(
    () => Array.from(new Set([...settledElicitationIds, ...deliveredRequestIds])),
    [settledElicitationIds, deliveredRequestIds],
  );
  const notificationWorkspaceId = useAuthStore(state => state.currentWorkspace?.id ?? null);
  const notificationUserId = useAuthStore(state => state.user?.id ?? null);
  const clarificationNotificationIdentity = useMemo(() => ({
    workspaceId: notificationWorkspaceId,
    userId: notificationUserId,
    workitemId,
    conversationId,
    agentId: effectiveAgentId ?? null,
  }), [notificationWorkspaceId, notificationUserId, workitemId, conversationId, effectiveAgentId]);
  useClarificationBrowserNotification({
    identity: clarificationNotificationIdentity,
    activeRequestId: activeElicitationId,
    initialPendingRequestIds: (convData?.pendingElicitations ?? []).map(card => card.requestId),
    snapshotReady: convData != null,
    resolvedRequestIds: browserNotificationResolvedRequestIds,
    // 浏览器通知点击发生在后台标签页，直接把 URL 契约交给浏览器解析。
    navigate: (path) => { window.location.assign(path); },
  });

  /** 斜杠命令候选：实时 acp_commands（耐久态）优先，会话详情带回的快照种子兜底，
   *  这样打开会话敲 `/` 立刻有候选，不必等探针结果经 WS 回来。
   *  null = 尚未上报 → 用种子；[] = 执行器权威结论「没有命令」→ 不能再用种子盖回去。 */
  const seededCommands = convData?.availableCommands ?? [];
  const slashCommands = availableCommands ?? seededCommands;

  // 回复期间输入框是禁用的，浏览器会把焦点从禁用元素上摘掉，恢复可用后没人归还，
  // 用户必须手动点一次才能接着打字（工单 53305）。这里在「本轮回复进行中」结束时把
  // 焦点还给输入框。触发口径不含会话加载与创建：面板首次拉取会话时输入框同样会经历
  // 一次禁用→可用，算进来会让「打开一个早已回复完成的历史会话」也抢焦点。
  // 问题卡片挂起时整个输入行被 ElicitationWizard 替换、焦点归卡片，所以卡片也算
  // 「回复进行中」，等它结算、输入行重新出现后才由这次跃迁归还焦点。
  // 取消响应（R3）走的是同一条跃迁，不再需要单独的焦点归还路径。
  // 淡出中的卡片同样算「回复进行中」：焦点等它真正卸载、输入行重新出现后再归还。
  const replyInProgress = isSubmittingCurrentConversation || isReplying || !!displayedElicitation;
  const prevReplyInProgressRef = useRef(replyInProgress);
  useEffect(() => {
    const wasReplying = prevReplyInProgressRef.current;
    prevReplyInProgressRef.current = replyInProgress;
    if (wasReplying && !replyInProgress) {
      composerRef.current?.focus();
    }
  }, [replyInProgress]);

  // 输入行只有在选中会话、没有问题卡片挂起、且不在禁用态时才真正存在于 DOM 里，
  // 自动聚焦必须等这些条件同时成立（FR-004）。
  const inputRowFocusable = !!conversationId
    && !displayedElicitation
    && !isSubmittingCurrentConversation
    && !isCreatingConversation
    && !isReplying
    && !isConversationLoading;

  // 「进入面板」的计数：挂载是第 0 次，切入全屏再各算一次。RightPanel 全屏与非全屏
  // 复用同一个实例，切全屏只是 prop 变化、不会重新挂载，靠这个计数才能覆盖 FR-002。
  const [focusEpoch, setFocusEpoch] = useState(0);
  const prevFullscreenRef = useRef(fullscreen);
  useEffect(() => {
    const wasFullscreen = prevFullscreenRef.current;
    prevFullscreenRef.current = fullscreen;
    if (fullscreen && !wasFullscreen) setFocusEpoch((epoch) => epoch + 1);
  }, [fullscreen]);

  // 每个 epoch 只聚焦一次，所以切换会话（FR-003）、回复结束都不会由这里再抢焦点：
  // 输入行重新可用时 epoch 没变，effect 直接返回。回复结束的归还走上面那条 effect。
  const focusedEpochRef = useRef(-1);
  useEffect(() => {
    if (focusedEpochRef.current === focusEpoch || !inputRowFocusable) return;
    focusedEpochRef.current = focusEpoch;
    // 推到绘制之后再聚焦：输入行刚出现时布局还没稳定，此刻聚焦会带着页面滚一次。
    const frame = requestAnimationFrame(() => {
      composerRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusEpoch, inputRowFocusable]);

  const slashQuery = slashCommandQuery(inputValue);

  const handleSelectionChange = useCallback(
    (next: SquadAgentSelection | null) => {
      resetStreamedEvents();
      setInputValue('');
      userSelectedAgentRef.current = true;
      autoSelectedAgentIdRef.current = null;
      setAutoTip(null);
      setAutoFallbackNotice(false);
      setSelection(next);
      setConversationId(null);
      if (next && next.agentId > 0) {
        writeClarificationPrefill(workitemId, {
          squadId: next.squadId,
          agentId: next.agentId,
        });
      }
    },
    [workitemId, resetStreamedEvents],
  );

  // 「切换数字员工」：清空自动身份与提示并接管选择；自动兜底提示一并收起。
  const switchToManualSelection = useCallback(() => {
    userSelectedAgentRef.current = true;
    autoSelectedAgentIdRef.current = null;
    setAutoTip(null);
    setAutoFallbackNotice(false);
    setSelection(null);
  }, []);

  const handleSelectConversation = useCallback((nextConversationId: number) => {
    if (nextConversationId === conversationIdRef.current) return;
    resetStreamedEvents();
    setConversationId(nextConversationId);
    setInputValue('');
  }, [resetStreamedEvents]);

  useEffect(() => {
    if (agentRestorePending || identityPending) return;
    if (!conversations.data || conversationId !== null) return;
    if (conversations.data.length > 0) {
      setConversationId(conversations.data[0].id);
      return;
    }
    if (!effectiveAgentId || createMutation.isPending) return;
    if (autoCreateAttemptedRef.current.has(effectiveAgentId)) return;
    autoCreateAttemptedRef.current.add(effectiveAgentId);
    const mutatedAgentId = effectiveAgentId;
    createMutation.mutate(mutatedAgentId, {
      onSuccess: (conv) => {
        // 过时的创建回调不能覆盖当前选择：创建期间用户切了数字人或手动选了会话。
        if (effectiveAgentIdRef.current !== mutatedAgentId) return;
        if (conversationIdRef.current !== null) return;
        setConversationId(conv.id);
      },
      onError: () => {
        // 仅“当前身份仍来自自动选择、用户尚未接管且还没有可用会话”时静默兜底：
        // 清空自动身份、回到选人页并提示，手动选择的失败仍沿用全局 toast。
        if (autoSelectedAgentIdRef.current === mutatedAgentId
            && !userSelectedAgentRef.current
            && effectiveAgentIdRef.current === mutatedAgentId
            && conversationIdRef.current === null) {
          autoFallbackRef.current = true;
          autoSelectedAgentIdRef.current = null;
          // 允许用户重选同一数字人时再次创建会话（一次失败不得永久封禁）。
          autoCreateAttemptedRef.current.delete(mutatedAgentId);
          // 标记“用户接管选择”，同时关掉候选查询，避免清空后又被自动选中形成循环。
          userSelectedAgentRef.current = true;
          setAutoTip(null);
          setAutoFallbackNotice(true);
          setSelection(null);
          setConversationId(null);
          return;
        }
        message.error(i18n.t('workitem:clarification.autoCreateFailed'));
      },
    });
  }, [conversations.data, conversationId, effectiveAgentId, createMutation, workitemId,
    agentRestorePending, identityPending]);

  // 打开会话即补一次带外命令探针：详情里的快照只保证秒显，命令可能早已过期。
  // 每个 conversationId 只打一次（重渲染/详情重拉/StrictMode 双调用都不能重复打），
  // fire-and-forget：失败静默，结果经实时 acp_commands 事件回推，下次打开再试。
  const commandsProbedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!conversationId || commandsProbedRef.current === conversationId) return;
    if (!convData?.acpInteractionSupported) return; // 仅 ACP 执行器才探针
    commandsProbedRef.current = conversationId;
    api.refreshClarificationCommands(workitemId, conversationId).catch(() => {});
  }, [conversationId, convData?.acpInteractionSupported, workitemId]);

  // 刷新恢复（会话）：URL 可能来自书签或旧链接，会话也许已删除或已换了数字人。
  // 等会话列表落地后校验一次，不合法就清空，让上面的自动选择逻辑接手，
  // 否则刷新后会卡在一个永远拉不到内容的空会话上。
  // 只认挂载当帧从 URL 读到的那个 id：外层会随本面板的上报把新会话写回 URL，
  // 若跟着活的 prop 走，刚自动创建的会话会被一份还没刷新的旧列表判成“不存在”而清掉。
  // 校验必须绑定恢复目标的身份与它自己的列表（缺陷二）：URL 数字人还没落定时，
  // 当前列表属于 localStorage 预填数字人，用它判定「不存在」会永久清掉合法会话；
  // 列表加载失败同样不能当成「不存在」，留待成功后重试，期间不标记已校验。
  const restoredConversationCheckedRef = useRef(false);
  useEffect(() => {
    if (restoredConversationCheckedRef.current) return;
    const restoredId = restoredConversationIdRef.current;
    if (restoredId == null || conversationId !== restoredId) return;
    if (agentRestorePending) return;
    if (!conversations.data) return;
    restoredConversationCheckedRef.current = true;
    if (!conversations.data.some((item) => item.id === restoredId)) {
      setConversationId(null);
    }
  }, [conversations.data, conversationId, agentRestorePending]);

  // 服务端解析出的会话也可能在两次查询之间被并发操作：列表落地后校验一次，
  // 不在列表里就清空，交回「取列表首项/自动创建」，避免详情 404 把用户钉死在空会话。
  const serverConversationCheckedRef = useRef(false);
  useEffect(() => {
    if (serverConversationCheckedRef.current) return;
    const resolvedId = serverResolvedConversationIdRef.current;
    if (resolvedId == null || conversationId !== resolvedId) return;
    if (!conversations.data) return;
    serverConversationCheckedRef.current = true;
    if (!conversations.data.some((item) => item.id === resolvedId)) {
      setConversationId(null);
    }
  }, [conversations.data, conversationId]);

  // 把当前上下文回报给外层写回 URL。首次必须跳过「两者都还没确定」的那一帧：
  // URL 里的 agent/conversation 正是这一帧之前读出来的，回报 null 等于自己抹掉恢复源。
  const hasReportedContextRef = useRef(false);
  useEffect(() => {
    if (!hasReportedContextRef.current && effectiveAgentId == null && conversationId == null) return;
    // 最近会话/候选解析结果落地前不回报：此刻的 null 只是「还没解析出来」，写回 URL 会污染恢复源。
    if (identityPending) return;
    hasReportedContextRef.current = true;
    onContextChange?.(
      agentRestorePending ? { conversationId } : { agentId: effectiveAgentId, conversationId },
    );
  }, [effectiveAgentId, conversationId, onContextChange, agentRestorePending, identityPending]);

  const handleCreateConversation = useCallback(() => {
    const agentId = effectiveAgentId;
    if (!agentId) return;
    resetStreamedEvents();
    setInputValue('');
    createMutation.mutate(agentId, {
      onSuccess: (conv) => {
        setConversationId(conv.id);
      },
    });
  }, [effectiveAgentId, createMutation, resetStreamedEvents]);

  // inputValue 只是「当前是否为空」的读取条件，不该成为 effect 的触发源：
  // 否则用户清空输入就会被再塞一遍提示语。
  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;

  useEffect(() => {
    initializedInputRef.current = null;
  }, [workitemId, conversationId]);

  useEffect(() => {
    if (!conversationId || initializedInputRef.current === conversationId
        || isConversationLoading || agentRestorePending || latestPending
        || !conversation.isSuccess || convData?.id !== conversationId) return;
    initializedInputRef.current = conversationId;
    if (turns.length === 0 && !inputValueRef.current.trim() && !isReplying) {
      setInputValue(clarificationBootstrapPrompt(workitemId));
    }
  }, [conversationId, turns.length, isConversationLoading, isReplying, workitemId,
    conversation.isSuccess, convData, agentRestorePending, latestPending]);

  const handleSend = useCallback(() => {
    const content = inputValue.trim();
    const submittedConversationId = conversationId;
    const currentAttachments = pendingAttachmentsRef.current;
    const attachmentIds = currentAttachments
      .map((item) => item.attachment?.id)
      .filter((id): id is number => id != null);
    // 上传中/上传失败的附件不能随消息发送：拦住而不是静默丢附件。
    if (currentAttachments.some((item) => !item.attachment)) {
      message.error(t('clarification.attachmentSendBlocked'));
      return;
    }
    if (!content && attachmentIds.length === 0) return;
    // R2: 回复期间禁止发送；历史加载失败/恢复身份未落定时禁止发送：
    // 前者不能在未知历史上凭空对话（缺陷一），后者会话归属还没校验完就发消息
    // 可能把消息发进错误数字人的会话（缺陷二）。
    // 提交中只拦当前会话自己的在飞请求：旧会话的 POST 不应阻塞新会话（工单 55851）。
    if (!submittedConversationId || isSubmittingCurrentConversation || isReplying
      || isConversationLoading || conversationHistoryFailed || agentRestorePending) return;
    // 同一次草稿的失败重试复用 clientMessageId：服务端据此去重，超时重发不会产生两条消息。
    const signature = `${content}\u0000${attachmentIds.join(',')}`;
    let attempt = sendAttemptRef.current;
    if (!attempt || attempt.signature !== signature) {
      attempt = { signature, clientMessageId: api.createClientMessageId() };
      sendAttemptRef.current = attempt;
    }
    const { clientMessageId } = attempt;
    setInputValue('');
    // R4: 自己发送消息时恢复底部跟随
    turnHistory.returnLatest();
    followBottomRef.current = true;
    setFollowBottom(true);
    setPendingSubmitConversationIds((prev) => new Set(prev).add(submittedConversationId));
    // 结算走本次调用自己返回的 promise：多个会话的提交可以同时在飞，mutation
    // 观察者上的按次回调在并发下无法与单次提交一一对应；promise 与这次提交绑定。
    void submitMutation.mutateAsync({ content, attachmentIds, clientMessageId })
      .then(() => {
        // 成功才清空附件草稿：失败时输入框与附件都必须原样保留，供直接重试。
        // 提交期间切走的会话，其草稿已由作用域切换释放，不能误清新会话的附件。
        if (conversationIdRef.current === submittedConversationId) clearPendingAttachments();
      })
      .catch(() => {
        if (conversationIdRef.current === submittedConversationId) {
          setInputValue((current) => current || content);
        }
        message.error(i18n.t('workitem:clarification.sendFailed'));
      })
      .finally(() => {
        setPendingSubmitConversationIds((prev) => {
          if (!prev.has(submittedConversationId)) return prev;
          const next = new Set(prev);
          next.delete(submittedConversationId);
          return next;
        });
      });
  }, [inputValue, conversationId, submitMutation, isSubmittingCurrentConversation, isReplying,
    isConversationLoading, conversationHistoryFailed, agentRestorePending,
    clearPendingAttachments, t, turnHistory.returnLatest]);

  const handleCancelReply = useCallback(() => {
    const turnId = convData?.processingTurnId;
    if (!conversationId || turnId == null || cancelMutation.isPending) return;
    cancelMutation.mutate(turnId, {
      onError: () => {
        message.error(i18n.t('workitem:clarification.stopFailed'));
      },
    });
  }, [conversationId, convData?.processingTurnId, cancelMutation]);

  // 切换发送方式：先乐观生效（按键行为与入口文案必须立刻一致），再串行落用户级偏好。
  // 保存任务排进队列逐个执行：同一时刻只有一个 PUT 在飞，快速连切时最后一个任务
  // 保存最终选择，并发乱序完成的 PUT 不会让界面与落库值倒挂（工单 55511 验收 2/5）。
  const handleSendModeChange = useCallback((next: SendMode) => {
    const valueJson = JSON.stringify(next);
    sendModeRef.current = next;
    sendModeTouchedRef.current = true;
    setSendMode(next);
    queryClient.setQueryData<UserSetting>(
      CLARIFICATION_SEND_MODE_QUERY_KEY,
      { key: CLARIFICATION_SEND_MODE_KEY, valueJson },
    );
    sendModeSaveQueueRef.current = sendModeSaveQueueRef.current.then(async () => {
      try {
        await putMySetting(CLARIFICATION_SEND_MODE_KEY, valueJson);
        savedSendModeRef.current = next;
      } catch {
        // 失败时用户已切走：这是过时的失败，不回滚也不提示，新任务会落库新选择
        if (sendModeRef.current !== next) return;
        // 回滚到最后成功落库的值并同步缓存，否则界面标着「回车发送」而实际按回车只换行
        const rollback = savedSendModeRef.current;
        sendModeRef.current = rollback;
        setSendMode(rollback);
        queryClient.setQueryData<UserSetting>(
          CLARIFICATION_SEND_MODE_QUERY_KEY,
          { key: CLARIFICATION_SEND_MODE_KEY, valueJson: JSON.stringify(rollback) },
        );
        message.error(i18n.t('workitem:clarification.sendModeFailed'));
      }
    });
  }, [queryClient]);

  // R4: 仅在跟随底部时自动滚动；向上滚动离开底部后暂停跟随。
  // 用瞬时滚动（非 smooth）：流式内容持续增长时，平滑动画的中间态
  // 会触发“不在底部”的 scroll 判定，把跟随误关后就再也不再滚动。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof el.scrollTo !== 'function') return;
    if (!followBottomRef.current) return;
    programmaticScrollPendingRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
  }, [turns, streamedEvents]);

  const handleMessageScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    turnHistory.onScroll(el);
    const nearBottom = isNearScrollBottom(el);
    if (programmaticScrollPendingRef.current) {
      programmaticScrollPendingRef.current = false;
      // 程序化滚动到达底部：保持跟随开启，不让中间态/底部事件反复改写状态；
      // 若此时已不在底部（内容刚好又增长），落回正常判定。
      if (nearBottom) return;
    }
    followBottomRef.current = nearBottom;
    setFollowBottom(nearBottom);
  }, [turnHistory.onScroll]);

  const scrollToBottomAndFollow = useCallback(() => {
    turnHistory.returnLatest();
    followBottomRef.current = true;
    setFollowBottom(true);
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === 'function') {
      programmaticScrollPendingRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  // 头部「执行器在线」与选人页同源：同一小队成员查询（共享缓存键），不额外请求。
  const headerSquadId = userSelectedAgentRef.current
    ? selection?.squadId ?? null
    : urlRestore.identity?.squadId ?? selection?.squadId ?? null;
  const headerMembers = useQuery({
    queryKey: ['squad-members', 'clarification', headerSquadId],
    queryFn: () => getSquadMembers(headerSquadId as number),
    enabled: headerSquadId != null && headerSquadId > 0 && effectiveAgentId != null,
  });
  const executorOnline = headerMembers.data?.find(m => m.agentId === effectiveAgentId)?.executorOnline;

  const needsAgentSelection = !effectiveAgentId;

  // 全屏时正文、选人页与输入行共用同一条居中列（上限 1080px）：铺满整屏时
  // 宽屏下单行过长、短回复与输入框相距太远，阅读焦点散开；1080 比原型 800 宽，
  // 给表格和代码块留足横向空间（工单 53035 嫌的是 760 限宽在超宽屏空出大半）。
  // minWidth: 0 让 flex 子项可收缩，overflowWrap 兜住不换行的长链接。
  // 必须算在选人早返回之前：切换数字人 / 交付进度落地都会在全屏态下回到选人页，
  // 否则那一屏会与对话屏宽度不一致。
  const fullscreenColumnStyle: CSSProperties = fullscreen
    ? {
      width: '100%', maxWidth: 1080, marginLeft: 'auto', marginRight: 'auto',
      minWidth: 0, overflowWrap: 'break-word',
    }
    : {};

  if (identityPending) {
    // 最近会话/候选结果返回前的轻量加载态：只保留头行（返回/全屏仍可用），
    // 不渲染选人页，避免「先闪一下选人页再跳走」。
    return (
      <div className={fullscreen ? 'aw-clarification-panel is-fullscreen' : 'aw-clarification-panel'}>
        <div data-testid="clarification-panel-header" className="aw-cl-head">
          <div className="aw-cl-head-row">
            {headerPrefix}
            {/* 解析窗口里也留出改选入口：查询迟迟不返回时用户不必被钉在加载态，
                点击即接管选择，迟到的结果不再覆盖（AC-10）。 */}
            <Button
              type="text"
              className="aw-cl-ghost"
              icon={<AwStrokeIcon name="transfer" />}
              aria-label={t('clarification.switchAgent')}
              onClick={switchToManualSelection}
            >
              {t('clarification.switchAgent')}
            </Button>
            <span style={{ flex: '1 1 0%' }} />
            {headerSuffix}
          </div>
        </div>
        <div
          data-testid="clarification-latest-loading"
          aria-label={autoPending ? t('clarification.autoSelecting') : undefined}
        />
      </div>
    );
  }

  if (needsAgentSelection) {
    return (
      <div className={fullscreen ? 'aw-clarification-panel is-fullscreen' : 'aw-clarification-panel'}>
        {/* 选人页头部：外层已不渲染独立头行，「返回/全屏」插槽在这里接住，
            与对话页一致；否则进入选人页后没有任何返回入口。 */}
        <div data-testid="clarification-panel-header" className="aw-cl-head">
          <div className="aw-cl-head-row">
            {headerPrefix}
            <span className="aw-cl-title">{t('detail.aiClarification')}</span>
            <span className="aw-cl-head-actions">{headerSuffix}</span>
          </div>
        </div>
        <div className="aw-cl-pick">
          <div data-testid="clarification-selection-column" className="aw-cl-pick-col" style={fullscreenColumnStyle}>
            {autoFallbackNotice && (
              <div className="aw-cl-note error" role="alert" style={{ marginBottom: 12 }}>
                <span className="ic"><AwStrokeIcon name="alert-c" /></span>
                <span className="grow">{t('clarification.autoSelectFallback')}</span>
              </div>
            )}
            <p className="aw-cl-pick-intro">{t('clarification.selectSquadAgent')}</p>
            <p className="aw-cl-pick-intro">{t('clarification.pickIntro', { id: workitemId })}</p>
            <SquadAgentSelector
              value={selection}
              onChange={handleSelectionChange}
            />
          </div>
        </div>
      </div>
    );
  }

  const displayName = convData?.agentName ?? t('clarification.agent');

  // 上限在每次渲染时按面板容器实测高度动态计算：面板被 50386 拖大拖小后，
  // 父级尺寸变化会触发重渲染，下一次拖拽自动跟随新上限。
  const panelHeight = panelRef.current?.getBoundingClientRect().height || 0;
  const inputHeightMax = computeInputHeightMax(panelHeight);
  const manualInputHeight = inputHeight == null
    ? null
    : Math.min(inputHeight, inputHeightMax);

  const conversationItems = conversations.data ?? [];
  // 「最近」只认真实对话时间：新建未发言的空会话不能拿创建时间冒充最近活跃。
  const conversationSelectOptions = conversationItems.map((item) => {
    const lastActive = formatDateTime(item.lastTurnAt ?? '', TIME_FULL_NUM);
    return {
      value: item.id,
      selectedLabel: (
        <span className="aw-cl-session-label">
          <span>{t('clarification.conversationNumber', { id: item.id })}</span>
          <span className="s">{t('clarification.lastActive', { date: lastActive })}</span>
        </span>
      ),
      label: (
        <span className="aw-cl-menu-item">
          <span className="t">{t('clarification.conversationNumber', { id: item.id })}</span>
          <span className="s">{t('clarification.lastActive', { date: lastActive })}</span>
          <span className="s">{t('clarification.createdAt', { date: formatDateTime(item.gmtCreate, TIME_FULL_NUM) })}</span>
        </span>
      ),
    };
  });

  const switchAgentButton = (
    <Button
      type="text"
      className="aw-cl-ghost"
      icon={<AwStrokeIcon name="transfer" />}
      aria-label={t('clarification.switchAgent')}
      title={t('clarification.switchAgent')}
      disabled={isCreatingConversation}
      onClick={switchToManualSelection}
    >
      {t('clarification.switchShort')}
    </Button>
  );

  return (
    <div ref={panelRef} className={fullscreen ? 'aw-clarification-panel is-fullscreen' : 'aw-clarification-panel'}>
      <div data-testid="clarification-panel-header" className="aw-cl-head">
        <div className="aw-cl-head-inner">
          <div className="aw-cl-head-row">
            {headerPrefix}
            <div className="aw-cl-who">
              <span className="aw-cl-av" aria-hidden="true"><AgentInitial name={convData?.agentName} /></span>
              <span className="nm" title={displayName}>{displayName}</span>
              {executorOnline !== undefined && (
                <span
                  className={executorOnline ? 'aw-cl-online' : 'aw-cl-online off'}
                  title={executorOnline ? t('clarification.executorOnline') : t('clarification.executorOffline')}
                >
                  <span className="dot" />
                  {executorOnline ? t('clarification.executorOnline') : t('clarification.executorOffline')}
                </span>
              )}
            </div>
            {!fullscreen && headerSuffix ? <div className="aw-cl-head-actions">{headerSuffix}</div> : null}
          </div>
          <div className="aw-cl-head-row">
            {switchAgentButton}
            <div className="aw-cl-session">
              <Select
                data-testid="clarification-conversation-select"
                aria-label={t('clarification.selectClarificationConversation')}
                size="small"
                value={conversationId ?? undefined}
                placeholder={t('clarification.selectConversation')}
                loading={conversations.isLoading}
                disabled={isCreatingConversation}
                onChange={handleSelectConversation}
                options={conversationSelectOptions}
                optionLabelProp="selectedLabel"
                popupMatchSelectWidth={false}
              />
            </div>
            <Button
              type="text"
              className="aw-cl-ghost"
              icon={<AwStrokeIcon name="plus" />}
              onClick={handleCreateConversation}
              loading={isCreatingConversation}
              disabled={isCreatingConversation}
            >
              {t('clarification.newConversation')}
            </Button>
            {fullscreen ? headerSuffix : null}
          </div>
        </div>
      </div>

      <div className="aw-cl-scroll-wrap">
        <div
          ref={scrollRef}
          data-testid="clarification-message-scroll"
          className="aw-cl-body"
          onScroll={handleMessageScroll}
        >
          {/* 这层列节点必须在滚动容器内部：滚动元素仍是 scrollRef 那层，
              否则跟随底部/回到底部的滚动测量会落到不滚动的节点上。 */}
          <div data-testid="clarification-content-column" className="aw-cl-column" style={fullscreenColumnStyle}>
            {autoTip && (
              <div className="aw-cl-note info" style={{ marginBottom: 12 }}>
                <span className="ic"><AwStrokeIcon name="spark" /></span>
                <span className="grow">{t('clarification.autoSelectedTip', { name: autoTip.agentName })}</span>
                <Button size="small" type="text" onClick={() => setAutoTip(null)}>
                  {t('clarification.autoSelectedTipDismiss')}
                </Button>
              </div>
            )}
            {!conversationId ? (
              conversations.isError ? (
                <ClarificationLoadError
                  testId="clarification-list-error"
                  description={t('clarification.listFailed')}
                  onRetry={() => { conversations.refetch(); }}
                />
              ) : (
                <div className="aw-cl-state"><strong>{t('clarification.noConversations')}</strong></div>
              )
            ) : conversationHistoryFailed ? (
              <ClarificationLoadError
                testId="clarification-history-error"
                description={t('clarification.historyFailed')}
                onRetry={() => { conversation.refetch(); }}
              />
            ) : (
              <>
                {conversationHistoryStale && (
                  <ClarificationLoadError
                    testId="clarification-history-stale-notice"
                    tone="warning"
                    description={t('clarification.historyStale')}
                    onRetry={() => { conversation.refetch(); }}
                  />
                )}
                {isConversationLoading && turns.length === 0 && (
                  <div data-testid="clarification-history-loading" className="aw-cl-state">
                    {t('clarification.loadingHistory')}
                  </div>
                )}
                {turns.length === 0 && conversation.isSuccess && !isConversationLoading
                  && !showReplyingIndicator && !showProcessingEvents && !awaitingAgentReply && (
                  <div className="aw-cl-state">
                    <span className="ic"><AwStrokeIcon name="msg" size={28} /></span>
                    <strong>{t('clarification.noHistory')}</strong>
                    {t('clarification.noHistoryHint', { name: displayName })}
                  </div>
                )}
                {turns.map((turn, index) => (
                  <div key={turn.id} data-turn-id={turn.id}>
                  <TurnBubble
                    turn={turn}
                    agentName={displayName}
                    workitemId={workitemId}
                    conversationId={conversationId}
                    artifacts={artifacts}
                    onArtifactClick={setPreviewArtifact}
                    detailToggle={
                      <OutboundTurnDetailToggle
                        workitemId={workitemId}
                        conversationId={conversationId}
                        turns={turns}
                        index={index}
                        coveredQuestionIds={coveredQuestionIds}
                      />
                    }
                  />
                  <AutoConversationQuestionHistory entries={questionHistories.get(turn.id) ?? []}
                    base={`/api/workitems/${workitemId}/clarification-conversations/${conversationId}`}
                    conversationId={conversationId!} turnId={turn.id}
                    paged={!!convData?.questionHistoryPaged && (turn.direction === 'IN' || turn.direction === 'INBOUND')}
                    onSettledQuestions={recordHistoricalQuestions}
                    refreshKey={[...(convData?.pendingElicitations ?? []), ...(convData?.answerDeliveries ?? [])].filter(card => card.turnId === turn.id).map(card => `${card.requestId}:${card.status}`).join('|')}
                    deliveryStatuses={convData?.answerDeliveries}
                    canContinue={canWrite && !composerDisabled && !displayedElicitation}
                    onContinue={entry => {
                      if (!canWrite || composerDisabled || displayedElicitation) return;
                      setInputValue(draft => appendQuestionContext(draft, turn.content, entry));
                      composerRef.current?.focus();
                    }} />
                  </div>
                ))}
                {turnHistory.browsingHistory && <Button onClick={scrollToBottomAndFollow}>{historyLatestLabel}</Button>}
                {showProcessingEvents && (
                  // 「等待回复」提示由底部的 ReplyingIndicator 统一承担，避免双份动效。
                  // 流式区与完成态 TurnBubble 共用 agentBlockStyle() 与同一行身份 meta，
                  // 回复落地时字号/行高与纵向位置都不跳变（延续 f608cd4a4 的意图）。
                  <div className="aw-cl-turn">
                    <div className="aw-cl-turn-meta">
                      <span className="aw-cl-av" aria-hidden="true"><AgentInitial name={convData?.agentName} /></span>
                      <strong>{displayName}</strong>
                    </div>
                    <div
                      data-testid="clarification-streaming-bubble"
                      style={agentBlockStyle()}
                    >
                      <ConversationEventView
                        nodes={withoutCoveredQuestions(timeline, allQuestionHistory)}
                        isProcessing={false}
                        artifacts={artifacts}
                        onArtifactClick={setPreviewArtifact}
                        foldScope={`clarification:${conversationId ?? 0}`}
                      />
                    </div>
                  </div>
                )}
                {awaitingAgentReply && (
                  <TurnBubble
                    turn={{ id: -1, direction: 'OUTBOUND' as const, content: streamedText, status: '', error: null, gmtCreate: '' }}
                    agentName={displayName}
                    workitemId={workitemId}
                    conversationId={conversationId}
                    artifacts={artifacts}
                    onArtifactClick={setPreviewArtifact}
                  />
                )}
                {streamedTurnId != null && (
                  <EventSyncStatus
                    preparationStatus={preparationStatus}
                    syncing={syncing}
                    error={detailsError}
                    onRetry={() => void reloadDetails()}
                  />
                )}
                {showReplyingIndicator && <ReplyingIndicator agentName={displayName} />}
              </>
            )}
          </div>
        </div>
        {!followBottom && conversationId ? (
          <Button
            className="aw-cl-tobottom"
            size="small"
            aria-label={t('clarification.bottom')}
            icon={<AwStrokeIcon name="down" />}
            onClick={scrollToBottomAndFollow}
          >
            {t('clarification.bottom')}
          </Button>
        ) : null}
      </div>

      <AnswerDeliveryStatus cards={convData?.answerDeliveries} currentTurnId={currentQuestionTurnId} />
      {conversationId ? (
        displayedElicitation ? (
          <ElicitationWizard
            key={displayedElicitation.requestId}
            requestId={displayedElicitation.requestId}
            message={displayedElicitation.message}
            schema={displayedElicitation.schema}
            submitting={replyingRequestId === displayedElicitation.requestId}
            fullscreen={fullscreen}
            collapsible
            dismissing={dismissingElicitation}
            onReply={(reply) => handleReplyElicitation(displayedElicitation.requestId, reply)}
          />
        ) : (
        <div className="aw-cl-foot">
          <div
            data-testid="clarification-composer"
            style={{
              ...fullscreenColumnStyle,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              position: 'relative',
            }}
            onDragEnter={handleComposerDragEnter}
            onDragOver={handleComposerDragOver}
            onDragLeave={handleComposerDragLeave}
            onDrop={handleComposerDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              data-testid="clarification-file-input"
              style={{ display: 'none' }}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                // 先清空再走异步上传：同一个文件连续选两次也要各自触发 change。
                event.target.value = '';
                if (files.length > 0) selectAttachmentFiles(files);
              }}
            />
            <PendingAttachments
              attachments={pendingAttachments}
              disabled={composerDisabled}
              onRemove={removePendingAttachment}
            />
            <div className={composerDisabled ? 'aw-cl-input is-disabled' : 'aw-cl-input'}>
            <span className="aw-cl-grip" aria-hidden="true" />
            <div className="aw-cl-resize">
              <ResizeHandle
                direction="vertical"
                showIndicator={false}
                value={manualInputHeight ?? CLARIFICATION_INPUT_MIN_HEIGHT}
                measureValue={() =>
                  inputWrapRef.current?.getBoundingClientRect().height
                  || manualInputHeight
                  || CLARIFICATION_INPUT_MIN_HEIGHT}
                min={CLARIFICATION_INPUT_MIN_HEIGHT}
                max={inputHeightMax}
                measureMax={() => computeInputHeightMax(
                  panelRef.current?.getBoundingClientRect().height || 0,
                )}
                onChange={setInputHeight}
                onDoubleClick={() => setInputHeight(null)}
                aria-label={t('clarification.resizeInput')}
              />
            </div>
            <div ref={inputWrapRef} style={{ minWidth: 0, position: 'relative' }}>
              <SlashCommandPicker
                commands={slashCommands}
                query={slashQuery}
                onSelect={(command) => {
                  // ACP 没有专门的 invoke 方法，选中命令就是把 `/name ` 当普通文本发出去
                  setInputValue(`/${command.name} `);
                  composerRef.current?.focus();
                }}
              />
              <MarkdownComposer
                handleRef={composerRef}
                value={inputValue}
                onChange={setInputValue}
                onSendKey={handleSend}
                onFiles={selectAttachmentFiles}
                sendMode={sendMode}
                disabled={composerDisabled}
                placeholder={agentRestorePending ? t('clarification.restoring') : t('clarification.messagePlaceholder')}
                height={manualInputHeight}
                minHeight={72}
                maxHeight={inputHeightMax}
              />
            </div>
            {dragActive ? (
              <div className="aw-clarify-drag-overlay" data-testid="clarification-drag-overlay">
                <PaperClipOutlined style={{ marginRight: 8 }} />
                {t('clarification.attachmentDropHint')}
              </div>
            ) : null}
            <div
              data-testid="clarification-input-actions"
              className="aw-cl-input-row"
              style={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between' }}
            >
              <div style={{ display: 'flex', flex: '1 1 auto', alignItems: 'center', gap: 4, minWidth: 0 }}>
                <Button
                  type="text"
                  className="aw-cl-icon-btn"
                  icon={<AwStrokeIcon name="paperclip" />}
                  aria-label={t('clarification.attachFile')}
                  title={t('clarification.attachFile')}
                  data-testid="clarification-attach"
                  disabled={composerDisabled}
                  onClick={() => fileInputRef.current?.click()}
                />
                <Select<SendMode>
                  size="small"
                  variant="borderless"
                  className="aw-cl-mode-select"
                  popupMatchSelectWidth={false}
                  value={sendMode}
                  onChange={handleSendModeChange}
                  options={SEND_MODE_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
                  aria-label={t('clarification.sendMode')}
                  data-testid="clarification-send-mode-select"
                />
              </div>
              {showReplyingIndicator && cancelSupported && convData?.processingTurnId != null ? (
                <Button
                  size="small"
                  className="aw-cl-send"
                  danger
                  icon={<StopOutlined />}
                  onClick={handleCancelReply}
                  loading={cancelMutation.isPending}
                >
                  {t('clarification.stopResponse')}
                </Button>
              ) : (
                <Button
                  size="small"
                  className="aw-cl-send"
                  type="primary"
                  icon={<AwStrokeIcon name="send" />}
                  aria-label={t('clarification.sendMessage')}
                  onClick={handleSend}
                  loading={isSubmittingCurrentConversation}
                  disabled={composerDisabled || hasBlockingAttachments || !canSendMessage}
                >
                  {t('clarification.send')}
                </Button>
              )}
            </div>
            </div>
          </div>
        </div>
        )
      ) : null}
      {previewArtifact && (
        <ArtifactPreviewDrawer
          key={previewArtifact.id}
          artifact={previewArtifact}
          onClose={() => setPreviewArtifact(null)}
        />
      )}
    </div>
  );
}

/** 执行详情语义上属于 Agent 的这次作答（OUT 气泡），但事件按配对的 IN 轮次落库。 */
function OutboundTurnDetailToggle({ workitemId, conversationId, turns, index, coveredQuestionIds }: {
  workitemId: string;
  conversationId: number;
  turns: ClarificationTurn[];
  index: number;
  coveredQuestionIds?: ReadonlySet<string>;
}) {
  const turn = turns[index];
  if (!isOutboundTurnDirection(turn.direction)) return null;
  // 「已取消」气泡是服务端补的通知，自身没有执行事件；而配对逻辑会跳过 CANCELED
  // 的 IN 轮次，挂上去只会指到别的轮次的详情。
  if ((turn.status ?? '').toUpperCase() === 'CANCELED') return null;
  const eventTurnId = findPairedInboundTurnId(turns, index);
  if (eventTurnId == null) return null;
  return (
    <TurnDetailToggle
      workitemId={workitemId}
      conversationId={conversationId}
      turnId={turn.id}
      eventTurnId={eventTurnId}
      coveredQuestionIds={coveredQuestionIds}
    />
  );
}

function TurnBubble({
  turn, agentName, detailToggle, workitemId, conversationId, artifacts, onArtifactClick,
}: {
  turn: ClarificationTurn;
  agentName?: string;
  detailToggle?: ReactNode;
  workitemId: string;
  conversationId: number | null;
  artifacts: Artifact[];
  onArtifactClick: (artifact: Artifact) => void;
}) {
  const { t } = useTranslation('workitem');
  const isUser = turn.direction === 'IN' || turn.direction === 'INBOUND';
  const hasContent = !!turn.content && turn.content.trim().length > 0;

  const statusTag = turn.status === 'CANCELED' ? <Tag>{t('clarification.stopped')}</Tag> : null;

  const ownedContent = conversationNotice(turn.display?.content, 'content', t);
  const ownedError = conversationNotice(turn.display?.error, 'error', t);
  const errorText = turn.error ? (
    <div style={{ color: 'var(--aw-error-deep)', fontSize: 12, marginTop: 4 }}>
      {ownedError ?? turn.error}
    </div>
  ) : null;

  const timeLabel = turn.gmtCreate ? (
    <time title={formatDateTime(turn.gmtCreate, TIME_FULL)}>{formatDateTime(turn.gmtCreate, TIME_HM)}</time>
  ) : null;

  // 内容为空（AI 返回占位）时没有可复制的东西。
  // 两侧给不同的无障碍名称：一屏几十条消息全叫「复制」，读屏用户按按钮名导航时
  // 分不出哪个是哪条。
  const renderCopyAction = (label: string) => (hasContent ? (
    <span className="aw-clarify-msg-actions" style={{ flexShrink: 0 }}>
      {turn.contentHasMore ? <ConversationTurnCopyButton base={`/api/workitems/${workitemId}/clarification-conversations/${conversationId}`} conversationId={conversationId!} turn={turn} label={label} /> : <CopyMessageButton text={turn.content} label={label} />}
    </span>
  ) : null);

  if (isUser) {
    return (
      <div className="aw-clarify-msg aw-cl-turn user">
        {/* 输入框已是 Markdown 编辑器，用户消息同样走 MarkdownView 渲染
            （whiteSpace 由 MarkdownView 内部设为 normal，不继承气泡的 pre-wrap）。 */}
        <div data-testid="clarification-user-bubble" style={userBubbleStyle()}>
          {conversationId != null && turn.attachments && turn.attachments.length > 0 ? (
            <SentAttachments
              workitemId={workitemId}
              conversationId={conversationId}
              attachments={turn.attachments}
            />
          ) : null}
          {/* 纯附件消息没有文字内容：附件块就是整条消息，不渲染空 Markdown。 */}
          {hasContent ? <AutoConversationTurnContent base={`/api/workitems/${workitemId}/clarification-conversations/${conversationId}`} conversationId={conversationId!} turn={turn} className="aw-clarify-md" /> : null}
          {errorText}
        </div>
        <div className="aw-cl-turn-meta">
          {statusTag}
          {timeLabel}
          {renderCopyAction(t('clarification.copyMyMessage'))}
        </div>
      </div>
    );
  }

  return (
    <div className="aw-clarify-msg aw-cl-turn">
      <div className="aw-cl-turn-meta">
        <span className="aw-cl-av"><AgentInitial name={agentName} /></span>
        <strong>{agentName || 'AI'}</strong>
        {timeLabel}
        {statusTag}
        {renderCopyAction(t('clarification.copyReply'))}
      </div>
      <div data-testid="clarification-agent-block" style={agentBlockStyle()}>
        {ownedContent != null
          ? <div style={{ whiteSpace: 'pre-wrap' }}>{ownedContent}</div>
          : hasContent
            ? (
              <AutoConversationTurnContent
                base={`/api/workitems/${workitemId}/clarification-conversations/${conversationId}`}
                conversationId={conversationId!}
                turn={turn}
                className="aw-clarify-md"
                artifacts={artifacts}
                onArtifactClick={onArtifactClick}
              />
            )
            : <span style={{ color: 'var(--aw-text-3)' }}>{t('clarification.noResponse')}</span>}
        {errorText}
        {detailToggle}
      </div>
    </div>
  );
}

/** requestedSchema 是后端原样透传的 JSON 字符串。解析不了就把原文交给
 *  parseElicitationSchema，让它降级成 JSON 文本域，而不是白屏。 */
function parseSchemaJson(schema: string | null): unknown {
  if (!schema) return null;
  try {
    return JSON.parse(schema);
  } catch {
    return schema;
  }
}
