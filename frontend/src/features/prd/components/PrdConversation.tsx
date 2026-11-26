import '@/features/workitem/clarification/clarification.css';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Input, Space, Spin, Upload, Tag, Tooltip, message } from 'antd';
import { ClockCircleOutlined, PaperClipOutlined, RobotOutlined, StopOutlined, UserOutlined } from '@ant-design/icons';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/shared/api/client';
import { i18n } from '@/shared/i18n';
import { formatDateTime } from '@/shared/i18n/format';
import { getSquadMembers } from '@/features/squad/api';
import { SquadAgentSelector } from '@/features/workitem/clarification/SquadAgentSelector';
import type { SquadAgentSelection } from '@/features/workitem/clarification/SquadAgentSelector';
import { createClientMessageId } from '@/features/workitem/clarification/api';
import type { ClarificationElicitation } from '@/features/workitem/clarification/types';
import { ElicitationWizard } from '@/features/workitem/clarification/cards/ElicitationWizard';
import { AutoConversationTurnContent, ConversationTurnCopyButton } from '@/shared/ui/AutoConversationTurnContent';
import { useConversationTurnHistory } from '@/shared/ui/useConversationTurnHistory';
import { ChiefTurnEvents } from '@/features/chiefOfStaff/ChiefTurnEvents';
import { AnswerDeliveryStatus } from '@/features/workitem/clarification/cards/AnswerDeliveryStatus';
import { useRealtime } from '@/shared/realtime/useRealtime';
import type { PrototypeElement } from './PrdPrototypePreview';
import { PrdScreenshot } from './PrdScreenshot';
import type { CommentReference } from '../review';
import type { PrdDesignRuntime } from '../designBrowser';

const CODE_ONLY_BROWSER = { codeOnly: true } as const;
const REPLY_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};
const LEGACY_CANCELED_CONTENT = new Set(['zh-CN', 'en-US'].flatMap(language => [
  i18n.getResource(language, 'workitem', 'clarification.ownedNotice.canceled'),
  i18n.getResource(language, 'prd', 'conversation.stopped'),
  i18n.getResource(language, 'shared', 'conversation.status.CANCELED'),
]).filter((value): value is string => typeof value === 'string'));

interface Turn { id: number; direction: string; content: string; contentHasMore?: boolean; status: string; error?: string; submittedUserId?: number; sourceContext?: string; gmtCreate?: string | number }
interface History {
  id: number | null;
  turns: Turn[];
  processingTurnId?: number | null;
  processingStatus?: string | null;
  turnsHasMore?: boolean;
  nextBeforeTurnId?: number | null;
  participants?: Record<string, string>;
  attachments?: Record<string, {id: number; name: string; previewable: boolean}[]>;
  pendingElicitations?: ClarificationElicitation[] | null;
  questionHistory?: ClarificationElicitation[] | null;
  questionHistoryPaged?: boolean;
  answerDeliveries?: ClarificationElicitation[] | null;
  executorOnline?: boolean;
  cancelSupported?: boolean;
  acpInteractionSupported?: boolean;
}
const isReply = (turn: Turn) => turn.direction === 'OUT';
const active = (turn: Turn) => ['QUEUED', 'PROCESSING', 'RUNNING'].includes(turn.status);
const queued = (turn: Turn) => turn.status === 'QUEUED';
const canceled = (turn: Turn) => turn.status?.toUpperCase() === 'CANCELED';
function canceledPlaceholder(turn: Turn): boolean {
  if (!isReply(turn) || !canceled(turn)) return false;
  try {
    const code = JSON.parse(turn.sourceContext || '{}')?.conversationDisplay?.content?.code;
    if (code === 'CANCELED') return true;
  } catch { /* Fall back to the finite legacy placeholders below. */ }
  return LEGACY_CANCELED_CONTENT.has(turn.content?.trim() ?? '');
}
function elementLabel(element: PrototypeElement): string {
  return element.text?.trim() || element.selector;
}
function turnElement(turn: Turn): PrototypeElement | null {
  try {
    const element = JSON.parse(turn.sourceContext || '{}').element;
    return element && typeof element.selector === 'string' ? element : null;
  } catch { return null; }
}
function turnReviewComments(turn: Turn): { id: number; commentText: string; routePath: string }[] {
  try {
    const comments = JSON.parse(turn.sourceContext || '{}').reviewComments;
    return Array.isArray(comments) ? comments.filter(comment => typeof comment?.commentText === 'string' && typeof comment.routePath === 'string') : [];
  } catch { return []; }
}
export interface PrdConversationHandle {
  sendComment: (content: string, element: PrototypeElement, clientMessageId: string) => Promise<void>;
  startPreparation: (content: string, clientMessageId: string, runtimeAction: 'PREPARE' | 'RECOVER') => Promise<void>;
  addComments: (comments: CommentReference[]) => void;
}
interface PrdConversationProps {
  workitemId: string;
  ready?: boolean;
  onStarted?: () => void;
  onEmployeeOfflineChange?: (offline: boolean) => void;
  onProcessingChange?: (processing: boolean) => void;
  setupExtra?: ReactNode;
  documentLink?: ReactNode;
  setupLocked?: boolean;
  launchSelection?: SquadAgentSelection;
  settingsOpen?: boolean;
  element?: PrototypeElement | null;
  onClearElement?: () => void;
}
export const PrdConversation = forwardRef<PrdConversationHandle, PrdConversationProps>(function PrdConversation(
  {
    workitemId, ready = true, onStarted, onEmployeeOfflineChange, onProcessingChange, setupExtra,
    setupLocked = true, settingsOpen = true, element, onClearElement, launchSelection, documentLink,
  }, ref,
) {
  const { t } = useTranslation('prd');
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const agentId = launchSelection?.agentId ?? Number(params.get('prdAgent'));
  const squadId = launchSelection?.squadId ?? Number(params.get('prdSquad'));
  const selection: SquadAgentSelection | null = squadId > 0 ? { agentId, squadId } : null;
  const setSelection = (next: SquadAgentSelection | null) => {
    setParams(current => {
      const updated = new URLSearchParams(current);
      if (next) { updated.set('prdAgent', String(next.agentId)); updated.set('prdSquad', String(next.squadId)); }
      else { updated.delete('prdAgent'); updated.delete('prdSquad'); }
      return updated;
    }, { replace: true });
  };
  const [input, setInput] = useState('');
  const [commentReferences, setCommentReferences] = useState<CommentReference[]>([]);
  useEffect(() => { setCommentReferences([]); }, [workitemId, agentId]);
  const [sending, setSending] = useState(false);
  const [replyingQuestion, setReplyingQuestion] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [requestId, setRequestId] = useState(createClientMessageId);
  const feedRef = useRef<HTMLDivElement>(null);
  const followFeed = useRef(true);
  const scrollFrame = useRef<number | null>(null);
  const inputRef = useRef<TextAreaRef>(null);
  const base = `/api/workitems/${workitemId}/prd/conversation`;
  const rememberedSelection = useQuery({
    queryKey: ['prd-selection', workitemId],
    queryFn: async () => (await apiClient.get<SquadAgentSelection | null>(`${base}/selection`)).data,
    enabled: !launchSelection && !params.has('prdSquad'),
  });
  useEffect(() => {
    if (!launchSelection && !params.has('prdSquad') && rememberedSelection.data) setSelection(rememberedSelection.data);
  }, [launchSelection, rememberedSelection.data, params]);
  const historyKey = ['prd-conversation', workitemId, selection?.agentId] as const;
  const history = useQuery({
    queryKey: historyKey,
    queryFn: async () => (await apiClient.get<History>(base, { params: { agentId: selection!.agentId } })).data,
    enabled: !!selection?.agentId,
    refetchInterval: 3000,
  });
  const conversationId = history.data?.id;
  const selectedAgentStatus = useQuery({
    queryKey: ['squad-members', 'clarification', squadId],
    queryFn: () => getSquadMembers(squadId),
    enabled: agentId > 0 && squadId > 0,
    refetchInterval: 3000,
  });
  const selectedAgentOffline = selectedAgentStatus.isSuccess
    && selectedAgentStatus.data.find(member => member.agentId === agentId)?.executorOnline === false;
  const selectedAgentName = selectedAgentStatus.data?.find(member => member.agentId === agentId)?.agentName
    || t('conversation.employee');
  useEffect(() => {
    onEmployeeOfflineChange?.(selectedAgentOffline);
  }, [onEmployeeOfflineChange, selectedAgentOffline]);
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: historyKey });
  }, [queryClient, workitemId, selection?.agentId]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = setTimeout(() => { refreshTimer.current = null; refresh(); }, 300);
  }, [refresh]);
  useEffect(() => () => { if (refreshTimer.current !== null) clearTimeout(refreshTimer.current); }, []);
  useRealtime(conversationId ? `conversation:${conversationId}` : null, {
    enabled: conversationId != null,
    onEvent: scheduleRefresh,
    onReconnect: refresh,
  });
  const referenceRuntime = useQuery({
    queryKey: ['prd-design-runtime', workitemId, agentId || undefined],
    queryFn: async () => (await apiClient.get<PrdDesignRuntime | null>(`/api/workitems/${workitemId}/prd/runtime`, { params: { agentId }, backgroundActivity: true })).data,
    enabled: commentReferences.length > 0 && !!agentId,
    refetchInterval: 2000,
  });
  useEffect(() => {
    const runtime = referenceRuntime.data;
    if (!runtime?.sourceKey) return;
    setCommentReferences(previous => previous.filter(comment => comment.sourceKey === runtime.sourceKey && String(comment.conversationId) === String(runtime.conversationId)));
  }, [referenceRuntime.data?.sourceKey, referenceRuntime.data?.conversationId]);
  const turnHistory = useConversationTurnHistory({ base: `${base}/${conversationId}`, conversationId, snapshot: history.data });
  const { t: sharedT } = useTranslation('shared');
  const historyLatestLabel = sharedT('conversationContent.latest');
  const processing = history.data?.processingStatus != null
    ? ['QUEUED', 'PROCESSING', 'RUNNING'].includes(history.data.processingStatus)
    : history.data?.turns.some(active) ?? false;
  const queuedTurns = useMemo(() => history.data?.turns.filter(turn => !isReply(turn) && queued(turn)) ?? [], [history.data?.turns]);
  const queuedTurnIds = useMemo(() => new Set(queuedTurns.map(turn => turn.id)), [queuedTurns]);
  useEffect(() => {
    onProcessingChange?.(processing);
  }, [onProcessingChange, processing]);
  const canCancelReply = processing && !!history.data?.cancelSupported
    && conversationId != null && history.data?.processingTurnId != null;
  const cancelReply = () => {
    if (!canCancelReply || canceling) return;
    setCanceling(true);
    void apiClient.post(`${base}/${conversationId}/turns/${history.data!.processingTurnId}/cancel`)
      .then(() => history.refetch())
      .catch(error => message.error(error instanceof Error ? error.message : t('conversation.failed')))
      .finally(() => setCanceling(false));
  };
  useEffect(() => {
    if (followFeed.current && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [history.data, sending, replyingQuestion]);
  useEffect(() => () => {
    if (scrollFrame.current != null) cancelAnimationFrame(scrollFrame.current);
  }, []);
  const send = async () => {
    if (sending || canceling || !selection?.agentId) return;
    if (!ready) { message.error(t('target.requiredBeforeConversation')); return; }
    turnHistory.returnLatest();
    followFeed.current = true;
    setSending(true);
    try {
      const prepared = files.length ? (await apiClient.post<History>(`${base}/prepare`, { agentId: selection!.agentId })).data : null;
      const attachmentIds: number[] = [];
      for (const file of files) {
        const form = new FormData(); form.append('file', file);
        attachmentIds.push((await apiClient.post<{ id: number }>(`${base}/${prepared!.id}/attachments`, form, {
          transformRequest: [(data, headers) => {
            headers.delete?.('Content-Type');
            delete headers['Content-Type'];
            delete headers['content-type'];
            return data;
          }],
        })).data.id);
      }
      await apiClient.post(base, { agentId: selection!.agentId, content: input, clientMessageId: requestId, attachmentIds, browser: CODE_ONLY_BROWSER,
        ...(commentReferences.length ? { commentIds: commentReferences.map(comment => comment.id) } : {}),
        ...(element ? { element } : {}) });
      onStarted?.();
      setInput(''); setFiles([]); setCommentReferences([]); setRequestId(createClientMessageId()); onClearElement?.(); await history.refetch();
    } catch (error) { message.error(error instanceof Error ? error.message : t('conversation.failed')); }
    finally { setSending(false); }
  };
  useImperativeHandle(ref, () => ({
    addComments: comments => {
      setCommentReferences(previous => [...previous, ...comments.filter(comment => !previous.some(item => String(item.id) === String(comment.id)))]);
      setRequestId(createClientMessageId()); inputRef.current?.focus({ cursor: 'end' });
    },
    sendComment: async (content, selectedElement, clientMessageId) => {
      if (!selection?.agentId) throw new Error(t('conversation.agentRequired'));
      if (!ready) throw new Error(t('target.requiredBeforeConversation'));
      if (sending) throw new Error(t('runtime.sending'));
      setSending(true);
      try {
        await apiClient.post(base, { agentId: selection.agentId, content, clientMessageId, browser: CODE_ONLY_BROWSER, element: selectedElement });
        onStarted?.();
        turnHistory.returnLatest(); followFeed.current = true;
        await history.refetch();
      } finally { setSending(false); }
    },
    startPreparation: async (content, clientMessageId, runtimeAction) => {
      if (!selection?.agentId) throw new Error(t('conversation.agentRequired'));
      if (sending) throw new Error(t('runtime.sending'));
      setSending(true);
      try {
        await apiClient.post(base, {
          agentId: selection.agentId, content, clientMessageId, browser: CODE_ONLY_BROWSER, runtimeAction,
        });
        onStarted?.();
        turnHistory.returnLatest(); followFeed.current = true;
        await history.refetch();
      } finally { setSending(false); }
    },
  }));
  const settledQuestions = useMemo(() => new Set([
    ...(history.data?.questionHistory ?? []),
    ...(history.data?.answerDeliveries ?? []),
  ].map(card => card.requestId)), [history.data?.answerDeliveries, history.data?.questionHistory]);
  const [liveSettledQuestions, setLiveSettledQuestions] = useState(() => new Map<number, ReadonlySet<string>>());
  useEffect(() => setLiveSettledQuestions(new Map()), [conversationId]);
  const recordSettledQuestions = useCallback((_conversationId: number, turnId: number, requestIds: readonly string[]) => {
    if (_conversationId !== conversationId) return;
    setLiveSettledQuestions(previous => {
      const identities = new Set(requestIds);
      const existing = previous.get(turnId);
      if ((!existing && identities.size === 0) || (existing?.size === identities.size
        && [...identities].every(identity => existing.has(identity)))) return previous;
      const next = new Map(previous);
      if (identities.size) next.set(turnId, identities); else next.delete(turnId);
      return next;
    });
  }, [conversationId]);
  const renderedTurns = useMemo(() => turnHistory.turns.map(turn => {
    if (canceledPlaceholder(turn) || queuedTurnIds.has(turn.id)) return null;
    const reply = isReply(turn);
    const turnStatus = !reply
      ? canceled(turn) ? t('conversation.stopped') : turn.error
      : null;
    const participant = turnHistory.participants?.[String(turn.submittedUserId)]
      ?? t('conversation.participant', { id: turn.submittedUserId ?? '' });
    return <div key={turn.id} className={`prd-conversation-turn-group ${reply ? 'assistant' : 'user'}`}>
    <div data-turn-id={turn.id} className={reply ? 'aw-cl-turn assistant' : 'aw-cl-turn user'}>
    <div className={`prd-conversation-author ${reply ? 'assistant' : 'user'}`}>
      <span className="prd-conversation-author-icon" aria-hidden>{reply ? <RobotOutlined /> : <UserOutlined />}</span>
      <span className="prd-conversation-author-name">{reply ? selectedAgentName : participant}</span>
      {!reply && queued(turn) && <Tag color="default">{t('conversation.queued')}</Tag>}
    </div>
    <div className={reply ? undefined : 'aw-cl-bubble'}>
    {!reply && <>
      {turnElement(turn) && <div><Tag color="blue">{t('conversation.selectedElement', { label: elementLabel(turnElement(turn)!) })}</Tag></div>}
      {turnReviewComments(turn).map(comment => <div key={comment.id} className="prd-review-history-reference"><Tag>{comment.routePath}</Tag><p>{comment.commentText}</p></div>)}
    </>}
    <AutoConversationTurnContent base={`${base}/${conversationId}`} conversationId={conversationId!} turn={turn} scrollMode="flow" />
    {turnHistory.attachments?.[String(turn.id)]?.map(file => file.previewable
      ? <PrdScreenshot key={file.id} name={file.name} source={`${base}/${conversationId}/attachments/${file.id}/preview`} />
      : <Tag key={file.id}>{file.name}</Tag>)}
    </div>
    <div className="prd-conversation-message-actions" data-has-status={!!turnStatus}>
      {turnStatus && <div className="prd-conversation-turn-status" role="status">{turnStatus}</div>}
      <ConversationTurnCopyButton base={`${base}/${conversationId}`} conversationId={conversationId!}
        turn={turn} label={t('conversation.copyMessage')} />
      {reply && turn.gmtCreate && <time className="prd-conversation-reply-time"
        dateTime={String(turn.gmtCreate)} title={formatDateTime(turn.gmtCreate)}>
        {formatDateTime(turn.gmtCreate, REPLY_TIME_FORMAT)}
      </time>}
    </div>
    </div>
    {!reply && conversationId != null && <ChiefTurnEvents
      base={`${base}/${conversationId}`}
      showCompletedEvents={false}
      showProcessingIndicator={false}
      foldScope={`prd:${conversationId}`}
      scope={['prd-conversation', workitemId, conversationId]}
      conversationId={conversationId}
      turnId={turn.id}
      processing={processing && turn.id === history.data?.processingTurnId}
      questionHistory={history.data?.questionHistory ?? history.data?.answerDeliveries}
      questionHistoryPaged={history.data?.questionHistoryPaged}
      questionRefreshKey={[...(history.data?.pendingElicitations ?? []), ...(history.data?.answerDeliveries ?? [])]
        .filter(card => card.turnId === turn.id).map(card => `${card.requestId}:${card.status}`).join('|')}
      answerDeliveries={history.data?.answerDeliveries}
      onSettledQuestions={recordSettledQuestions}
      onContentChange={() => {
        if (followFeed.current && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
      }}
    />}
  </div>;
  }), [base, conversationId, history.data?.answerDeliveries, history.data?.pendingElicitations,
    history.data?.processingTurnId, history.data?.questionHistory, history.data?.questionHistoryPaged,
    processing, queuedTurnIds, recordSettledQuestions, selectedAgentName, t, turnHistory.attachments, turnHistory.participants, turnHistory.turns, workitemId]);
  const handleFeedScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    followFeed.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (scrollFrame.current != null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      turnHistory.onScroll(element);
    });
  };
  return <div className="prd-conversation">
    {settingsOpen && <section className="prd-conversation-settings" aria-label={t('conversation.settings')}>
      <div className="prd-conversation-settings-body">
      <strong>{t('conversation.employee')}</strong>
      <SquadAgentSelector value={selection} onChange={setSelection} locked={setupLocked || sending || processing} compact />
      {setupExtra}
      </div>
    </section>}
    {selectedAgentOffline && <Alert type="warning" showIcon message={t('conversation.employeeOffline')} />}
    {history.isError && !history.data && <div className="prd-conversation-inline-status" role="status">
      <span>{t('conversation.failed')}</span>
      <Button type="link" size="small" onClick={() => void history.refetch()}>{t('preview.retry')}</Button>
    </div>}
    <div ref={feedRef} role="log" aria-label={t('conversation.title')} className="aw-cl-column prd-conversation-feed" onScroll={handleFeedScroll}>
      {renderedTurns}
      {processing && conversationId != null && history.data?.processingTurnId != null
        && !turnHistory.turns.some(turn => !isReply(turn) && turn.id === history.data?.processingTurnId)
        && <ChiefTurnEvents
          base={`${base}/${conversationId}`}
          showCompletedEvents={false}
          showProcessingIndicator={false}
          foldScope={`prd:${conversationId}`}
          scope={['prd-conversation', workitemId, conversationId]}
          conversationId={conversationId}
          turnId={history.data.processingTurnId}
          processing
          questionHistory={history.data.questionHistory ?? history.data.answerDeliveries}
          questionHistoryPaged={history.data.questionHistoryPaged}
          questionRefreshKey={[...(history.data.pendingElicitations ?? []), ...(history.data.answerDeliveries ?? [])]
            .filter(card => card.turnId === history.data?.processingTurnId)
            .map(card => `${card.requestId}:${card.status}`).join('|')}
          answerDeliveries={history.data.answerDeliveries}
          onSettledQuestions={recordSettledQuestions}
          onContentChange={() => {
            if (followFeed.current && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
          }}
        />}
      {turnHistory.browsingHistory && <Button onClick={() => { turnHistory.returnLatest(); followFeed.current = true; requestAnimationFrame(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }); }}>{historyLatestLabel}</Button>}
      {documentLink}
      {(processing || sending) && <Space className="prd-conversation-progress"><Spin size="small" />{t('conversation.working')}</Space>}
      <AnswerDeliveryStatus cards={history.data?.answerDeliveries}
        currentTurnId={history.data?.processingTurnId ?? undefined} />
      {conversationId != null && history.data?.pendingElicitations
        ?.filter(card => !settledQuestions.has(card.requestId)
          && !liveSettledQuestions.get(card.turnId)?.has(card.requestId))
        .map(card => <ElicitationWizard
          key={card.requestId}
          requestId={card.requestId}
          message={card.message || undefined}
          schema={parseSchema(card.requestedSchema)}
          submitting={replyingQuestion === card.requestId}
          onReply={reply => {
            setReplyingQuestion(card.requestId);
            void apiClient.post(`${base}/${conversationId}/elicitations/${card.requestId}/reply`, {
              action: reply.action,
              content: reply.content == null ? null : JSON.stringify(reply.content),
            }).then(() => history.refetch())
              .catch(error => message.error(error instanceof Error ? error.message : t('conversation.failed')))
              .finally(() => setReplyingQuestion(null));
          }}
        />)}
    </div>
    <div className="prd-conversation-composer">
    {queuedTurns.length > 0 && <section className="prd-conversation-queue" aria-label={t('conversation.queueTitle')}>
      <div className="prd-conversation-queue-heading">
        <ClockCircleOutlined aria-hidden />
        <strong>{t('conversation.queued')}</strong>
        <span>{t('conversation.queueCount', { count: queuedTurns.length })}</span>
      </div>
      <p className="prd-conversation-queue-hint">{t('conversation.queueHint')}</p>
      <ol>{queuedTurns.map((turn, index) => {
        const references = [
          ...turnReviewComments(turn).map(comment => comment.commentText),
          ...(history.data?.attachments?.[String(turn.id)] ?? []).map(file => file.name),
        ];
        const content = turn.content.trim() || t(references.length ? 'conversation.queueReferencesOnly' : 'conversation.request');
        const referenceText = references.join(t('conversation.queueReferenceSeparator'));
        return <li key={turn.id}>
          <span className="prd-conversation-queue-position" aria-hidden>{index + 1}</span>
          <div className="prd-conversation-queue-content">
            <p title={content}>{content.slice(0, 180)}</p>
            {references.length > 0 && <p className="prd-conversation-queue-references" title={referenceText}>
              <span>{t('conversation.queueReferences')}</span> {referenceText.slice(0, 180)}
            </p>}
          </div>
        </li>;
      })}</ol>
    </section>}
    {element && <Space size={6} wrap>
      <Tag color="blue" closable={!sending} title={element.selector} onClose={() => onClearElement?.()}>
        {t('conversation.selectedElement', { label: elementLabel(element) })}
      </Tag>
      {element.page && <Tag>{element.page}</Tag>}
    </Space>}
    {commentReferences.length > 0 && <div className="prd-review-reference-drafts" aria-label={t('reviewComments.references')}>
      <span>{t('reviewComments.references')}</span><Space size={4} wrap>{commentReferences.map(comment => <Tag key={comment.id} closable={!sending} title={comment.commentText}
        onClose={() => { setCommentReferences(previous => previous.filter(item => item.id !== comment.id)); setRequestId(createClientMessageId()); }}>{comment.commentText.slice(0, 32)}</Tag>)}</Space>
    </div>}
    <Input.TextArea ref={inputRef} aria-label={t('conversation.title')} placeholder={t('conversation.inputHint')} value={input} rows={3} disabled={sending || !ready}
      onKeyDown={event => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        if (selection?.agentId && (input.trim() || files.length || commentReferences.length)) void send();
      }}
      onPaste={event => {
        const images = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
        if (images.length) { event.preventDefault(); setFiles(previous => [...previous, ...images]); }
      }}
      onChange={event => { setInput(event.target.value); setRequestId(createClientMessageId()); }} />
    {files.length > 0 && <Space wrap>{files.map((file, index) => <span key={index}><PrdScreenshot source={file} name={file.name} />
      <Tag closable={!sending} onClose={() => setFiles(previous => previous.filter((_, i) => i !== index))}>{file.name}</Tag></span>)}</Space>}
    <div className="prd-conversation-actions">
    <Upload className="prd-conversation-attachment" accept="image/*" multiple beforeUpload={file => { setFiles(previous => [...previous, file]); return false; }} showUploadList={false}>
      <Tooltip title={t('conversation.screenshot')}><Button type="text" aria-label={t('conversation.screenshot')} icon={<PaperClipOutlined />} disabled={sending || !ready} /></Tooltip>
    </Upload>
    <div className="prd-conversation-submit-actions">
      {canCancelReply && <Button className="prd-conversation-stop" icon={<StopOutlined />}
        loading={canceling} disabled={canceling || sending} onClick={cancelReply}>
        {t('conversation.stop')}
      </Button>}
      <Button type="primary" loading={sending}
        disabled={sending || canceling || !ready || !selection?.agentId || (!input.trim() && !files.length && !commentReferences.length)}
        onClick={() => void send()}>
        {t(processing ? 'conversation.enqueue' : setupLocked ? 'conversation.send' : 'conversation.startDesign')}
      </Button>
    </div>
    </div>
    </div>
  </div>;
});

function parseSchema(value: string | null): unknown {
  try { return JSON.parse(value || '{}') as unknown; } catch { return {}; }
}
