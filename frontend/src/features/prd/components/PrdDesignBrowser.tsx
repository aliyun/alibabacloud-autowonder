import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Input, Tooltip, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { ArrowLeftOutlined, ArrowRightOutlined, AppstoreOutlined, CloseOutlined, CommentOutlined, ReloadOutlined } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { apiClient } from '@/shared/api/client';
import { createClientMessageId } from '@/features/workitem/clarification/api';
import { designElementText, designNavigationUrl, isDesignFrameMessage, type PrdDesignRuntime } from '../designBrowser';
import type { PrototypeElement } from './PrdPrototypePreview';
import { PrdReviewPanel } from './PrdReviewPanel';
import { PrdReviewShare } from './PrdReviewShare';
import { PREVIEW_STATUS, PREVIEW_REASON, REVIEW_STATUS, commentReference, reviewClient, reviewEndpoint, type CommentReference, type DesignReviewContext, type PreviewEntry, type ReviewCommentView } from '../review';
import { usePrdPreview } from '../usePrdPreview';
import { scopePreviewLinks } from '../previewLinkScope';
import './PrdDesignBrowser.css';

type SelectionRect = { x: number; y: number; width: number; height: number };

function displayRoute(url: string, basePath = '/') {
  if (!url) return '';
  const route = new URL(url);
  const root = basePath === '/' ? '/' : basePath.replace(/\/+$/, '');
  const pathname = basePath !== '/' && route.pathname === root ? '/'
    : basePath !== '/' && route.pathname.startsWith(`${root}/`) ? '/' + route.pathname.slice(root.length + 1)
      : route.pathname;
  return `${pathname}${route.search}${route.hash}`;
}

export function PrdDesignBrowser(props: Parameters<typeof LivePrdDesignBrowser>[0]) {
  const { t } = useTranslation('prd');
  const [params] = useSearchParams();
  if (/^\/design-preview\/[^/]+(?:\/|$)/.test(window.location.pathname)) {
    const standalone = new URL(props.remote
      ? `/design-reviews/${encodeURIComponent(props.remote.token)}`
      : `/workitems/${encodeURIComponent(props.workitemId)}/design`, window.location.origin);
    if (!props.remote) for (const key of ['prdAgent', 'prdSquad']) {
      const value = params.get(key);
      if (value) standalone.searchParams.set(key, value);
    }
    return <section className="prd-design-browser">
      <div className="prd-browser-empty" role="status">
        <div className="prd-browser-empty-icon"><AppstoreOutlined /></div>
        <h3>{t('runtime.nestedTitle')}</h3>
        <p>{t('runtime.nestedHint')}</p>
        <Button onClick={() => window.open(standalone.href, '_blank', 'noopener,noreferrer')}>{t('runtime.openStandalone')}</Button>
      </div>
    </section>;
  }
  return <LivePrdDesignBrowser {...props} />;
}

function LivePrdDesignBrowser({ workitemId, onComment, onReferences, onRecoverPreview, recoveryDisabled = false, processing = false, agentName, remote, immersive = false }: {
  workitemId: string;
  onComment?: (text: string, element: PrototypeElement, clientMessageId: string) => Promise<void>;
  onReferences?: (comments: CommentReference[]) => void;
  onRecoverPreview?: () => Promise<void>;
  recoveryDisabled?: boolean;
  processing?: boolean;
  agentName?: string;
  immersive?: boolean;
  remote?: { token: string; context: DesignReviewContext; entry: PreviewEntry | null; initialRoute: string; refreshSession: () => void; reconnect?: () => void; connecting?: boolean };
}) {
  const { t } = useTranslation('prd');
  const [params] = useSearchParams();
  const agentId = Number(params.get('prdAgent')) || undefined;
  const runtimeQuery = useQuery({
    queryKey: ['prd-design-runtime', workitemId, agentId],
    queryFn: async () => (await apiClient.get<PrdDesignRuntime | null>(`/api/workitems/${workitemId}/prd/runtime`, {
      params: agentId ? { agentId } : {},
      backgroundActivity: true,
    })).data,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    enabled: !remote,
  });
  const runtime = remote?.context.runtime ?? runtimeQuery.data;
  const reviewEnabled = !!onReferences || !!remote;
  const review = reviewClient(reviewEndpoint(workitemId, agentId, remote?.token));
  const reviewQuery = useQuery({ queryKey: ['prd-review', workitemId, agentId, remote?.token], queryFn: review.context,
    enabled: reviewEnabled && !remote && !!runtime, refetchInterval: 3000 });
  const reviewContext = remote?.context ?? reviewQuery.data;
  const comments = reviewContext?.comments ?? [];
  const [panelOpen, setPanelOpen] = useState(!!remote && !immersive);
  const [markerPositions, setMarkerPositions] = useState<{ id: string; rect: SelectionRect }[]>([]);
  const [routeState, setRouteState] = useState('/');
  const [committedRoute, setCommittedRoute] = useState('');
  const snapshot = useRef<Record<string, unknown>>({});
  const [locating, setLocating] = useState<{ requestId: string; navigationId: string; view: ReviewCommentView } | null>(null);
  const locateRef = useRef(locating); locateRef.current = locating;
  const [markerPulse, setMarkerPulse] = useState<{ id: number; requestId: string } | null>(null);
  const locatedMarkerId = locating?.view.comment.id ?? markerPulse?.id;
  const frameName = useRef(`design-${createClientMessageId()}`);
  const lastSubmittedCode = useRef('');
  const forceReentry = useRef(false);
  const runtimeIdentity = `${workitemId}:${agentId ?? ''}:${runtime?.conversationId ?? ''}:${runtime?.sourceKey ?? ''}:${runtime?.executorId ?? ''}:${runtime?.directory ?? ''}`;
  const memberPreview = usePrdPreview(reviewEndpoint(workitemId, agentId), runtimeIdentity,
    !remote && (runtime?.status === 'PREPARED' || runtime?.status === 'READY'));
  const previewEntry = remote ? remote.entry : memberPreview.entry;
  const scope = useRef('/');
  if (previewEntry?.basePath) scope.current = previewEntry.basePath;
  const basePath = scope.current;
  const entryUrl = previewEntry?.status === 'READY' && previewEntry.origin && previewEntry.basePath
    ? designNavigationUrl(`${previewEntry.origin}${basePath}`, remote?.initialRoute ?? runtime?.route ?? '/', true, basePath) : null;
  const bindingIdentity = useRef('');
  if (previewEntry?.origin && previewEntry.basePath) bindingIdentity.current = `${previewEntry.origin}${previewEntry.basePath}`;
  const identity = `${runtimeIdentity}:${bindingIdentity.current}`;
  const frame = useRef<HTMLIFrameElement>(null);
  const previousRuntime = useRef<{ identity: string; revision: number }>();
  const currentRef = useRef('');
  const [mountedUrl, setMountedUrl] = useState('');
  const [address, setAddress] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [ready, setReady] = useState(false);
  const [viteError, setViteError] = useState(false);
  const viteErrorObserver = useRef<MutationObserver | null>(null);
  const readyRef = useRef(false); readyRef.current = ready;
  const inspectorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposeLinkScope = useRef<(() => void) | null>(null);
  const recoveryAttempts = useRef(0);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [offline, setOffline] = useState(false);
  const [invalidAddress, setInvalidAddress] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [selected, setSelected] = useState<PrototypeElement | null>(null);
  const picking = inspecting && !selected;
  const pickingRef = useRef(false);
  pickingRef.current = picking;
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [commentPosition, setCommentPosition] = useState({ left: 12, top: 12, width: 320 });
  const [comment, setComment] = useState('');
  const [commentId, setCommentId] = useState(createClientMessageId);
  const [submitting, setSubmitting] = useState(false);
  const [requestingRecovery, setRequestingRecovery] = useState(false);
  const [commentError, setCommentError] = useState('');
  const history = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const [position, setPosition] = useState(-1);
  const [historyLength, setHistoryLength] = useState(0);

  function showUrl(url: string, action = 'push') {
    currentRef.current = url; setAddress(displayRoute(url, scope.current)); setRouteState(displayRoute(url, scope.current)); setInvalidAddress(false);
    if (history.current[historyIndex.current] === url) return;
    if (action === 'pop') {
      const index = history.current.lastIndexOf(url);
      if (index >= 0) { historyIndex.current = index; setPosition(index); return; }
    }
    if (action === 'replace' && historyIndex.current >= 0) history.current[historyIndex.current] = url;
    else {
      history.current = [...history.current.slice(0, historyIndex.current + 1), url];
      historyIndex.current = history.current.length - 1;
    }
    setPosition(historyIndex.current); setHistoryLength(history.current.length);
  }
  function post(type: string, data: Record<string, unknown> = {}) {
    if (currentRef.current) frame.current?.contentWindow?.postMessage({ type, ...data }, new URL(currentRef.current).origin);
  }
  function reload() {
    if (!currentRef.current) return;
    recoveryAttempts.current = 0;
    setMountedUrl(currentRef.current); setRefresh(value => value + 1);
  }
  function connectLoadedFrame() {
    disposeLinkScope.current?.(); disposeLinkScope.current = null;
    try {
      const view = frame.current?.contentWindow;
      if (entryUrl && view?.location.origin === window.location.origin
        && designNavigationUrl(entryUrl, view.location.href, true, scope.current)) {
        disposeLinkScope.current = scopePreviewLinks(view.document, entryUrl, scope.current);
      }
    } catch { /* Inaccessible or out-of-scope documents cannot host app navigation. */ }
    if (inspectorTimer.current) clearTimeout(inspectorTimer.current);
    // Give an application's own provider its two animation frames to announce readiness.
    // Plain HTML and existing projects may have no provider; use the same inspector protocol.
    inspectorTimer.current = setTimeout(() => {
      inspectorTimer.current = null;
      if (readyRef.current || !entryUrl) return;
      try {
        const view = frame.current?.contentWindow;
        if (!view || view.location.origin !== window.location.origin
          || !designNavigationUrl(entryUrl, view.location.href, true, scope.current)
          || view.document.readyState !== 'complete' || !view.document.body?.childElementCount
          || view.document.querySelector('vite-error-overlay')) return;
        const navigation = view.performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        if (!navigation.some(entry => entry.responseStatus >= 200 && entry.responseStatus < 300)) return;
        const classicScripts = new Set(Array.from(view.document.querySelectorAll<HTMLScriptElement>('script[src]:not([type="module"])'),
          node => node.src));
        const modulePreloads = new Set(Array.from(view.document.querySelectorAll<HTMLLinkElement>('link[rel~="modulepreload"]'),
          node => node.href));
        const failedModule = view.performance.getEntriesByType('resource').some(entry => {
          const resource = entry as PerformanceResourceTiming;
          if (resource.responseStatus < 400) return false;
          // Optional runtime configuration is commonly loaded through a classic script before
          // the Vite entrypoint. Its absence must not hide an otherwise rendered application.
          // Module scripts, dynamic imports, and module preloads still block readiness.
          return modulePreloads.has(resource.name)
            || (resource.initiatorType === 'script' && !classicScripts.has(resource.name));
        });
        if (failedModule) return;
        if (view.document.querySelector('script[data-autowonder-preview-inspector]')) return;
        const script = view.document.createElement('script');
        script.dataset.autowonderPreviewInspector = 'true';
        script.src = new URL('/preview-inspector/bridge-v1.js', window.location.origin).href;
        // Execute inside the frame so messages retain the real frame as their source.
        view.document.head.append(script);
      } catch { /* Error documents and inaccessible frames must not become ready. */ }
    }, 100);
  }
  function watchViteError() {
    viteErrorObserver.current?.disconnect();
    viteErrorObserver.current = null;
    try {
      const document = frame.current?.contentDocument;
      if (!document?.documentElement) { setViteError(false); return; }
      const sync = () => setViteError(!!document.querySelector('vite-error-overlay'));
      sync();
      viteErrorObserver.current = new MutationObserver(sync);
      viteErrorObserver.current.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      // Preview entrypoints are same-origin. If a future deployment changes that contract,
      // an inaccessible document is unknown rather than a Vite compilation failure.
      setViteError(false);
    }
  }
  function recoverFailedFrame() {
    if (readyRef.current || offline || recoveryTimer.current || recoveryAttempts.current >= 3) return;
    try {
      const view = frame.current?.contentWindow;
      if (!view || view.document.querySelector('#root, #app')?.childElementCount) return;
      const retryable = new Set([401, 403, 502, 503, 504]);
      const failedDocument = view.performance.getEntriesByType('navigation')
        .some(entry => retryable.has((entry as PerformanceNavigationTiming).responseStatus));
      const startupModules = new Set([
        ...Array.from(view.document.querySelectorAll<HTMLLinkElement>('link[rel~="modulepreload"]'), node => node.href),
        ...Array.from(view.document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'), node => node.src),
      ]);
      const failedModule = view.performance.getEntriesByType('resource').some(entry => {
        const resource = entry as PerformanceResourceTiming;
        // Chromium may record modulepreload requests as `other`, and reuse the failed response for the import.
        return retryable.has(resource.responseStatus)
          && (resource.initiatorType === 'script' || startupModules.has(resource.name));
      });
      if (!failedDocument && !failedModule) return;
    } catch { return; }
    const delay = 1000 * 2 ** recoveryAttempts.current++;
    recoveryTimer.current = setTimeout(() => {
      recoveryTimer.current = null;
      if (readyRef.current || !frame.current) return;
      forceReentry.current = true;
      const reconnect = remote ? remote.reconnect ?? remote.refreshSession : memberPreview.reconnect;
      void Promise.resolve(reconnect()).catch(() => {});
    }, delay);
  }
  useEffect(() => {
    recoveryAttempts.current = 0;
    return () => {
      if (inspectorTimer.current) clearTimeout(inspectorTimer.current); inspectorTimer.current = null;
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current); recoveryTimer.current = null;
      viteErrorObserver.current?.disconnect(); viteErrorObserver.current = null;
      disposeLinkScope.current?.(); disposeLinkScope.current = null;
    };
  }, [identity]);
  useEffect(() => { if (waiting) recoverFailedFrame(); }, [waiting, ready, offline, identity]);
  useEffect(() => {
    if (!previewEntry?.code || !entryUrl || !frame.current || lastSubmittedCode.current === previewEntry.code) return;
    lastSubmittedCode.current = previewEntry.code;
    const code = previewEntry.code;
    if (ready && !offline && !forceReentry.current) {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 5000);
      void fetch(`${previewEntry.origin}${basePath}_autowonder/renew`, {
        method: 'POST', credentials: 'include', redirect: 'error',
        body: new URLSearchParams({ code }), signal: controller.signal,
      }).then(response => {
        if (response.status !== 204) throw new Error('Preview session renewal failed');
      }).catch(() => {
        if (!frame.current || lastSubmittedCode.current !== code) return;
        forceReentry.current = true;
        const reconnect = remote ? remote.reconnect ?? remote.refreshSession : memberPreview.reconnect;
        void Promise.resolve(reconnect()).catch(() => {});
      }).finally(() => clearTimeout(deadline));
      return;
    }
    forceReentry.current = false;
    const form = document.createElement('form'); form.method = 'POST'; form.target = frameName.current;
    form.action = `${previewEntry.origin}${basePath}_autowonder/enter`; form.style.display = 'none';
    for (const [name, value] of Object.entries({ code: previewEntry.code, route: displayRoute(currentRef.current, scope.current) || remote?.initialRoute || runtime?.route || '/' })) {
      const input = document.createElement('input'); input.name = name; input.value = value; form.append(input);
    }
    document.body.append(form); form.submit(); form.remove();
  }, [previewEntry?.code, mountedUrl, entryUrl]);
  useEffect(() => {
    const previous = previousRuntime.current;
    if (previous?.identity !== identity) {
      history.current = []; historyIndex.current = -1; setPosition(-1); setHistoryLength(0);
      setReady(false); setOffline(false); setSelected(null); setInspecting(false); setMarkerPositions([]); setLocating(null);
      setMarkerPulse(null);
      currentRef.current = ''; setAddress(''); setMountedUrl('');
      if (entryUrl) { showUrl(entryUrl); setMountedUrl(entryUrl); }
    } else if (entryUrl && !currentRef.current) {
      showUrl(entryUrl); setMountedUrl(entryUrl);
    } else if (entryUrl && runtime?.revision !== previous?.revision) {
      // Keep the route the user is inspecting when code changes.
      reload();
    }
    previousRuntime.current = { identity, revision: runtime?.revision ?? 0 };
  }, [identity, entryUrl, runtime?.revision]);

  useEffect(() => {
    if (!mountedUrl) return;
    viteErrorObserver.current?.disconnect(); viteErrorObserver.current = null;
    setReady(false); setViteError(false); setWaiting(false); setInspecting(false); setSelected(null); setMarkerPositions([]);
    const timer = setTimeout(() => setWaiting(true), 8000);
    return () => clearTimeout(timer);
  }, [mountedUrl, refresh]);

  useEffect(() => {
    if (previewEntry?.status !== 'READY') { setOffline(!!previewEntry && !!runtime && runtime.status === 'READY'); setReady(false); }
    else setOffline(false);
  }, [previewEntry?.status, runtime?.status]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!isDesignFrameMessage(event, frame.current, currentRef.current)) return;
      const data = event.data as Record<string, unknown>;
      if (data.type === 'demo:ready') {
        recoveryAttempts.current = 0;
        if (recoveryTimer.current) clearTimeout(recoveryTimer.current); recoveryTimer.current = null;
        setReady(true); setOffline(false); setWaiting(false); setCommittedRoute(displayRoute(currentRef.current, scope.current));
      }
      if (data.type === 'route:changed' && typeof data.url === 'string') {
        const next = designNavigationUrl(currentRef.current, data.url, true, scope.current);
        if (next) { showUrl(next, typeof data.action === 'string' ? data.action : 'push'); setCommittedRoute(displayRoute(next, scope.current)); setSelected(null); }
      }
      if (data.type === 'inspect:exit') setInspecting(false);
      if (pickingRef.current && data.type === 'inspect:select' && typeof data.selector === 'string' && typeof data.tagName === 'string') {
        pickingRef.current = false;
        setSelected({ selector: data.selector.slice(0, 1000), cssPath: data.selector.slice(0, 1000), xpath: '',
          tag: data.tagName.slice(0, 64), text: designElementText(data.textPreview),
          page: displayRoute(currentRef.current, scope.current).slice(0, 2048) });
        snapshot.current = { tagName: data.tagName, textPreview: data.textPreview, rect: data.rect, route: data.route, a11y: data.a11y, anchor: data.anchor };
        const rect = data.rect as SelectionRect | undefined;
        setSelectionRect(rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ? rect : null);
        setComment(''); setCommentError(''); setCommentId(createClientMessageId());
      }
      if (data.type === 'review-markers:positions' && Array.isArray(data.positions)) {
        setMarkerPositions(data.positions.filter((item: { id?: unknown; rect?: SelectionRect }) => typeof item?.id === 'string' && item.rect
          && [item.rect.x, item.rect.y, item.rect.width, item.rect.height].every(Number.isFinite)).slice(0, 1000));
      }
      const location = locateRef.current;
      if (data.type === 'review-marker:located' && location && data.requestId === location.requestId && data.navigationId === location.navigationId) {
        locateRef.current = null;
        if (data.found === true) setMarkerPulse({ id: location.view.comment.id, requestId: location.requestId });
        else void message.info(t('reviewComments.notFound'));
        setLocating(null);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  const previewInteractive = ready && !offline && !viteError;
  useEffect(() => {
    if (!previewInteractive) { setMarkerPositions([]); return; }
    const markers = comments.filter(view => !view.earlierSource && view.comment.routePath === routeState
      && (view.comment.status === REVIEW_STATUS.OPEN || view.comment.id === locatedMarkerId)).map(view => {
      let domSnapshot = {}; try { domSnapshot = JSON.parse(view.comment.elementJson).domSnapshot ?? {}; } catch { /* An old comment can still use its selector. */ }
      return { id: String(view.comment.id), selector: view.comment.selector, domSnapshot };
    });
    post('review-markers:sync', { markers });
  }, [previewInteractive, routeState, reviewContext, locatedMarkerId]);
  useEffect(() => { if (!remote && !previewInteractive) setPanelOpen(false); }, [previewInteractive, remote]);
  useEffect(() => {
    if (!markerPulse) return;
    const timer = setTimeout(() => setMarkerPulse(null), 1100);
    return () => clearTimeout(timer);
  }, [markerPulse]);
  useEffect(() => {
    if (!locating) return;
    const timer = setTimeout(() => { setLocating(null); void message.info(t('reviewComments.notFound')); }, 10000);
    return () => clearTimeout(timer);
  }, [locating]);
  useEffect(() => {
    if (!locating || !ready || locating.view.comment.routePath !== routeState || committedRoute !== routeState) return;
    let domSnapshot = {}; try { domSnapshot = JSON.parse(locating.view.comment.elementJson).domSnapshot ?? {}; } catch { /* Selector-only legacy anchor. */ }
    post('review-marker:locate', { id: String(locating.view.comment.id), requestId: locating.requestId, navigationId: locating.navigationId,
      selector: locating.view.comment.selector, domSnapshot, routePath: basePath + locating.view.comment.routePath.slice(1) });
  }, [locating, ready, routeState, committedRoute]);
  useEffect(() => { if (ready) post(picking ? 'inspect:enter' : 'inspect:exit'); }, [ready, picking]);
  useEffect(() => { if (!inspecting || offline) setSelected(null); }, [inspecting, offline]);
  useEffect(() => {
    if (!selected) return;
    const document = frame.current?.contentDocument;
    const view = document?.defaultView;
    let element: Element | null | undefined;
    try { element = document?.querySelector(selected.selector); } catch { return; }
    if (!element || !view) return;
    const target = element;
    const measure = () => {
      if (!target.isConnected) { setSelectionRect(null); return; }
      const { x, y, width, height } = target.getBoundingClientRect();
      setSelectionRect(previous => previous?.x === x && previous.y === y
        && previous.width === width && previous.height === height ? previous : { x, y, width, height });
    };
    view.addEventListener('scroll', measure, true);
    view.addEventListener('resize', measure);
    return () => {
      view.removeEventListener('scroll', measure, true);
      view.removeEventListener('resize', measure);
    };
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
    const positionComment = () => {
      const bounds = frame.current?.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24);
      const x = (bounds?.x ?? 0) + (selectionRect?.x ?? 0);
      const y = (bounds?.y ?? 0) + (selectionRect?.y ?? 0);
      const right = x + (selectionRect?.width ?? 0) + 8;
      const bottom = y + (selectionRect?.height ?? 0) + 8;
      setCommentPosition({ width,
        left: Math.max(12, Math.min(right + width + 12 > window.innerWidth ? x - width - 8 : right, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(bottom + 220 > window.innerHeight ? y - 220 : bottom, window.innerHeight - 232)) });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) { setSelected(null); setInspecting(false); }
    };
    positionComment();
    window.addEventListener('resize', positionComment);
    window.addEventListener('scroll', positionComment, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', positionComment);
      window.removeEventListener('scroll', positionComment, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selected, selectionRect, submitting]);

  function navigate(input: string) {
    const next = designNavigationUrl(currentRef.current, input, true, scope.current);
    if (!next) { setInvalidAddress(true); return; }
    showUrl(next);
    if (ready) post('browser:navigate', { navigationId: createClientMessageId(), url: next });
    else setMountedUrl(next);
  }
  function go(delta: number) {
    const index = historyIndex.current + delta;
    const next = history.current[index];
    if (!next) return;
    historyIndex.current = index; setPosition(index); showUrl(next, 'pop');
    if (ready) post(delta < 0 ? 'browser:back' : 'browser:forward');
    else setMountedUrl(next);
  }
  function closeComment() { setSelected(null); setInspecting(false); }
  function locate(view: ReviewCommentView) {
    if (view.earlierSource || !entryUrl) return;
    const request = { requestId: createClientMessageId(), navigationId: createClientMessageId(), view };
    locateRef.current = request;
    setMarkerPulse(null);
    setLocating(request);
    if (routeState !== view.comment.routePath) navigate(view.comment.routePath);
  }
  async function submitComment() {
    if (!selected || !comment.trim() || submitting) return;
    setSubmitting(true); setCommentError('');
    try {
      if (reviewEnabled) {
        const created = await review.create(comment.trim(), selected, commentId, snapshot.current);
        if (!remote) await reviewQuery.refetch();
        if (reviewContext?.canManage) onReferences?.([commentReference(created)]);
        if (remote) { setPanelOpen(true); remote.refreshSession(); }
      } else await onComment?.(comment.trim(), selected, commentId);
      closeComment();
    }
    catch (error) { setCommentError(error instanceof Error ? error.message : t('conversation.failed')); }
    finally { setSubmitting(false); }
  }

  async function recoverPreview() {
    if (!onRecoverPreview || recoveryDisabled || requestingRecovery) return;
    setRequestingRecovery(true);
    try {
      await onRecoverPreview();
      await memberPreview.reconnect();
    } finally {
      setRequestingRecovery(false);
    }
  }

  const failed = runtime?.status === 'FAILED';
  const unavailable = !!previewEntry && previewEntry.status !== PREVIEW_STATUS.READY;
  const recovering = unavailable && previewEntry.reason === PREVIEW_REASON.RECOVERING;
  const loadingEntry = !previewEntry && (runtime?.status === 'STARTING' || runtime?.status === 'PREPARED'
    || runtime?.status === PREVIEW_STATUS.READY);
  const showDesignMask = processing && viteError;
  const showPreviewLoading = !ready && !viteError;
  const connectionLabel = ready && !offline ? t('runtime.ready') : unavailable ? t('runtime.disconnected') : t('runtime.connecting');
  return <section className={`prd-design-browser${immersive ? ' prd-design-browser-immersive' : ''}`}>
    <div role="toolbar" aria-label={t('runtime.toolbar')} className="prd-browser-toolbar">
      {!immersive && <>
      <Button type="text" size="small" aria-label={t('runtime.back')} icon={<ArrowLeftOutlined />} disabled={position <= 0 || submitting} onClick={() => go(-1)} />
      <Button type="text" size="small" aria-label={t('runtime.forward')} icon={<ArrowRightOutlined />} disabled={position < 0 || position >= historyLength - 1 || submitting} onClick={() => go(1)} />
      <Button type="text" size="small" aria-label={t('runtime.reload')} icon={<ReloadOutlined />} disabled={!entryUrl || submitting} onClick={reload} />
      <div className="prd-browser-address" data-invalid={invalidAddress}>
        <Tooltip title={connectionLabel}><span className="prd-browser-connection" role="status" aria-label={connectionLabel} data-connected={ready && !offline} /></Tooltip>
        <input aria-label={t('runtime.address')} value={address} placeholder={t('runtime.pathPlaceholder')} disabled={!entryUrl || submitting} spellCheck={false}
          aria-invalid={invalidAddress} title={entryUrl ?? undefined} onChange={event => setAddress(event.target.value)}
          onFocus={event => event.currentTarget.select()} onBlur={() => setAddress(displayRoute(currentRef.current, scope.current))}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); navigate(address); }
            if (event.key === 'Escape') { setAddress(displayRoute(currentRef.current, scope.current)); event.currentTarget.blur(); }
          }} />
      </div>
      </>}
      <Button type="text" size="small" aria-label={t('runtime.inspect')} icon={<AwStrokeIcon name="inspect" size={16} />} aria-pressed={inspecting}
        disabled={!previewInteractive || submitting} onClick={() => setInspecting(value => !value)} />
      {reviewEnabled && <>{(remote || previewInteractive) && <Button type="text" size="small" className="prd-browser-text-button" aria-label={t('reviewComments.title')} aria-pressed={panelOpen} onClick={() => setPanelOpen(value => !value)}><CommentOutlined /><span>{t('reviewComments.trigger')}</span><span>{comments.filter(view => !view.earlierSource && view.comment.status === REVIEW_STATUS.OPEN).length}</span></Button>}
        {!remote && runtime && <PrdReviewShare client={review} identity={identity} route={routeState} canManage={!!reviewContext?.canManage} />}</>}
    </div>
    {invalidAddress && <Alert className="prd-browser-notice" type="warning" message={t('runtime.invalidAddress')} />}
    {failed && <Alert className="prd-browser-notice" type="error" message={t('runtime.failed')} description={runtime?.error} />}
    {picking && <div className="prd-browser-inspect-hint" role="status"><AwStrokeIcon name="inspect" size={16} /><span>{t('runtime.inspectHint')}</span><Button type="text" size="small" aria-label={t('runtime.exitInspect')} icon={<CloseOutlined />} onClick={() => setInspecting(false)} /></div>}
    <div className="prd-browser-review-body"><div className="prd-browser-viewport">
    {mountedUrl && entryUrl ? <iframe ref={frame} key={`${identity}:${refresh}`} src={mountedUrl} className="prd-browser-frame"
      onLoad={() => { watchViteError(); recoverFailedFrame(); connectLoadedFrame(); }}
      name={frameName.current}
      title={t('runtime.frame')} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer"
      style={{ width: '100%' }} />
      : <div className="prd-browser-empty">
        <div className="prd-browser-empty-icon"><AppstoreOutlined /></div>
        {unavailable && <h3>{t(recovering ? 'reviewShare.recoveringTitle' : 'runtime.disconnected')}</h3>}
        {!recovering && <p>{runtimeQuery.isError && !runtime ? t('runtime.loadFailed')
          : unavailable && !remote && onRecoverPreview && previewEntry.status === PREVIEW_STATUS.UNCONFIGURED
            ? t('runtime.recoverUnconfiguredHint', { agent: agentName ?? t('runtime.selectedAgent') })
          : unavailable && !remote && onRecoverPreview
            ? t('runtime.recoverHint', { agent: agentName ?? t('runtime.selectedAgent') })
          : unavailable && previewEntry.status === PREVIEW_STATUS.UNCONFIGURED ? t('reviewShare.unconfigured')
          : unavailable && previewEntry.reason === PREVIEW_REASON.RECOVERY_TIMEOUT ? t('reviewShare.recoveryTimeout')
          : unavailable && previewEntry.reason === PREVIEW_REASON.EXECUTOR_OFFLINE ? t('reviewShare.executorOffline')
          : unavailable && previewEntry.reason === PREVIEW_REASON.RECOVERY_UNSUPPORTED ? t('reviewShare.recoveryUnsupported')
          : unavailable && previewEntry.reason === PREVIEW_REASON.LOCAL_SERVICE_UNAVAILABLE ? t('reviewShare.localServiceUnavailable')
          : unavailable && previewEntry.reason === PREVIEW_REASON.DISCONNECTED ? t('reviewShare.executorDisconnected')
          : unavailable && previewEntry.reason === PREVIEW_REASON.RUNTIME_NOT_READY ? t('reviewShare.runtimeNotReady')
          : remote ? unavailable ? t('reviewShare.offline') : t('runtime.connecting')
          : loadingEntry ? t('runtime.loadingPreview') : runtime?.status === PREVIEW_STATUS.READY ? t('runtime.restore') : t('runtime.empty')}</p>}
        {!processing && !recovering && (runtimeQuery.isError && !runtime
          ? <Button size="small" icon={<ReloadOutlined />} onClick={() => void runtimeQuery.refetch()}>{t('preview.retry')}</Button>
          : unavailable && !remote && onRecoverPreview
            ? <Button size="small" icon={<ReloadOutlined />} aria-label={t('runtime.recoverAction')}
              loading={requestingRecovery || memberPreview.connecting}
              disabled={recoveryDisabled}
              onClick={() => void recoverPreview()}>{t('runtime.recoverAction')}</Button>
          : unavailable && (!remote || remote.reconnect) && <Button size="small" icon={<ReloadOutlined />} loading={remote ? remote.connecting : memberPreview.connecting}
            onClick={remote ? remote.reconnect : memberPreview.reconnect}>{t('preview.retry')}</Button>)}
      </div>}
      {mountedUrl && entryUrl && !offline && (showPreviewLoading || showDesignMask) && <div className="prd-browser-empty prd-browser-frame-loading" role="status">
        <div className="prd-browser-empty-icon"><AppstoreOutlined /></div>
        <p>{t(showDesignMask ? 'runtime.designingWait' : 'runtime.loadingPreview')}</p>
      </div>}
      {previewInteractive && selected && selectionRect && <div aria-hidden="true" className="prd-browser-selection-outline"
        style={{ left: selectionRect.x, top: selectionRect.y, width: selectionRect.width, height: selectionRect.height }} />}
      {previewInteractive && <div className="prd-review-markers">{markerPositions.map(position => {
        const view = comments.find(item => String(item.comment.id) === position.id && !item.earlierSource && item.comment.routePath === routeState && (item.comment.status === REVIEW_STATUS.OPEN || locatedMarkerId === item.comment.id));
        return view ? <Tooltip key={position.id} title={view.comment.commentText}><button type="button" className="prd-review-marker" aria-label={t('reviewComments.locate', { id: view.comment.id })}
          style={{ left: Math.max(0, position.rect.x + position.rect.width - 10), top: Math.max(0, position.rect.y - 10) }}
          onClick={() => { setPanelOpen(true); locate(view); }}>
          {comments.filter(item => !item.earlierSource && item.comment.routePath === routeState).findIndex(item => item.comment.id === view.comment.id) + 1}
          {markerPulse?.id === view.comment.id && <span key={markerPulse.requestId} aria-hidden="true" className="prd-review-marker-pulse" />}
        </button></Tooltip> : null;
      })}</div>}
    </div>
    {panelOpen && <PrdReviewPanel comments={comments} viewerId={reviewContext?.viewerId} loading={reviewQuery.isFetching} error={reviewQuery.isError}
      onClose={() => setPanelOpen(false)} onLocate={locate} canSend={!!reviewContext?.canManage} onReferences={onReferences}
      onUpdate={async (view, input) => { await review.update(view, input); if (remote) remote.refreshSession(); else await reviewQuery.refetch(); }}
      onDelete={async view => { await review.remove(view); if (remote) remote.refreshSession(); else await reviewQuery.refetch(); }} />}</div>
    {selected && <div role="dialog" aria-label={t('runtime.comment')} className="prd-browser-comment" style={commentPosition}>
      <Button type="text" size="small" className="prd-browser-comment-close" aria-label={t('runtime.cancel')} icon={<CloseOutlined />} disabled={submitting} onClick={closeComment} />
      <div className="prd-browser-comment-heading"><code>{t('runtime.elementTag', { tag: selected.tag })}</code><span title={selected.text || selected.selector}>{selected.text || selected.selector}</span></div>
      <Input.TextArea aria-label={t('runtime.comment')} placeholder={t('runtime.commentPlaceholder')} value={comment} rows={3} disabled={submitting} autoFocus
        onChange={event => { setComment(event.target.value); setCommentId(createClientMessageId()); }}
        onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submitComment(); } }} />
      {commentError && <div role="status" className="prd-browser-comment-error">{commentError}</div>}
      <div className="prd-browser-comment-actions"><Button type="text" size="small" disabled={submitting} onClick={closeComment}>{t('runtime.cancel')}</Button>
        <Button type="primary" size="small" loading={submitting} disabled={!comment.trim()} onClick={() => void submitComment()}>{reviewEnabled ? remote || !reviewContext?.canManage ? t('reviewComments.post') : t('reviewComments.saveReference') : t('runtime.sendComment')}</Button></div>
    </div>}
  </section>;
}
