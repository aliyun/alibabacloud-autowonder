import { apiClient } from '@/shared/api/client';
import type { PrdDesignRuntime } from './designBrowser';
import type { PrototypeElement } from './components/PrdPrototypePreview';
export const REVIEW_STATUS = { OPEN: 'open', RESOLVED: 'resolved' } as const;
export const PREVIEW_STATUS = { READY: 'READY', UNCONFIGURED: 'UNCONFIGURED', OFFLINE: 'OFFLINE' } as const;
export const PREVIEW_REASON = {
  LOCAL_SERVICE_UNAVAILABLE: 'LOCAL_SERVICE_UNAVAILABLE',
  DISCONNECTED: 'DISCONNECTED',
  RUNTIME_NOT_READY: 'RUNTIME_NOT_READY',
  RECOVERY_REQUIRED: 'RECOVERY_REQUIRED',
  RECOVERING: 'RECOVERING',
  RECOVERY_TIMEOUT: 'RECOVERY_TIMEOUT',
  EXECUTOR_OFFLINE: 'EXECUTOR_OFFLINE',
  RECOVERY_UNSUPPORTED: 'RECOVERY_UNSUPPORTED',
} as const;

export interface ReviewComment {
  id: number; conversationId: number; sourceKey: string; runtimeRevision: number;
  routePath: string; selector: string; elementJson: string; commentText: string;
  status: 'open' | 'resolved'; creatorId: number; version: number;
  lastSentTurnId?: number; gmtCreate: string; gmtModified: string;
}
export interface ReviewCommentView {
  comment: ReviewComment; authorName: string; authorAvatar?: string;
  canEdit: boolean; canDelete: boolean; canUpdateStatus: boolean; earlierSource: boolean;
}
export interface DesignReviewContext {
  title: string; workitemId: number; viewerId: number; runtime: PrdDesignRuntime;
  sourceKey: string; canManage: boolean; comments: ReviewCommentView[];
}
export interface ReviewShare { id: number; token: string; enabled: number; version: number }
export interface ReviewShareResult { share: ReviewShare | null; configured: boolean; preferredIdentifier?: string; slug?: string | null; nameWasShared?: boolean }
export interface ReviewShareName { slug: string | null; canManage: boolean }
export interface PreviewEntry { status: 'READY' | 'UNCONFIGURED' | 'OFFLINE'; reason?: 'UNCONFIGURED' | typeof PREVIEW_REASON[keyof typeof PREVIEW_REASON] | null; origin: string | null; basePath: string | null; code: string | null; expiresAt: string | null }
export interface CommentReference { id: number; commentText: string; selector: string; sourceKey: string; conversationId: number }

export function commentReference(view: ReviewCommentView): CommentReference {
  const { id, commentText, selector, sourceKey, conversationId } = view.comment;
  return { id, commentText, selector, sourceKey, conversationId };
}
export function reviewEndpoint(workitemId: string, agentId?: number, token?: string) {
  return { base: token ? `/api/design-reviews/${encodeURIComponent(token)}` : `/api/workitems/${workitemId}/prd/review`,
    params: token ? {} : agentId ? { agentId } : {} };
}
export function reviewClient(endpoint: ReturnType<typeof reviewEndpoint>) {
  const { base, params } = endpoint;
  return {
    context: async () => (await apiClient.get<DesignReviewContext>(base, { params, backgroundActivity: true })).data,
    previewStatus: async () => (await apiClient.get<Pick<PreviewEntry, 'status' | 'origin' | 'basePath' | 'reason'>>(`${base}/preview-status`, { params, backgroundActivity: true })).data,
    recoverPreview: async () => (await apiClient.post<Pick<PreviewEntry, 'status' | 'origin' | 'basePath' | 'reason'>>(`${base}/preview-recovery`, null, { params, backgroundActivity: true })).data,
    previewSession: async (direct = false) => (await apiClient.post<PreviewEntry>(`${base}/preview-session`, null,
      { params: direct ? { ...params, direct: true } : params })).data,
    create: async (commentText: string, element: PrototypeElement, clientId: string, domSnapshot?: Record<string, unknown>) =>
      (await apiClient.post<ReviewCommentView>(`${base}/comments`, { commentText, element, clientId, domSnapshot }, { params })).data,
    update: async (view: ReviewCommentView, input: { commentText?: string; status?: 'open' | 'resolved' }) =>
      (await apiClient.patch<ReviewCommentView>(`${base}/comments/${view.comment.id}`, { ...input, version: view.comment.version }, { params })).data,
    remove: async (view: ReviewCommentView) => { await apiClient.delete(`${base}/comments/${view.comment.id}`, { params: { ...params, version: view.comment.version } }); },
    share: async () => (await apiClient.get<ReviewShareResult>(`${base}/share`, { params })).data,
    shareName: async () => (await apiClient.get<ReviewShareName>(`${base}/share/name`, { params })).data,
    saveShareName: async (slug: string) => (await apiClient.put<ReviewShareName>(`${base}/share/name`, { slug }, { params })).data,
    enable: async (rotate = false, confirmNamed = false) =>
      (await apiClient.post<ReviewShareResult>(`${base}/share`, null, { params: { ...params, rotate, confirmNamed } })).data,
    revoke: async () => { await apiClient.delete(`${base}/share`, { params }); },
  };
}
export function designReviewLink(identifier: string, route = '/', origin = window.location.origin) {
  const query = !route || route === '/' ? '' : `?${new URLSearchParams({ route }).toString()}`;
  return `${origin}/design-reviews/${encodeURIComponent(identifier)}${query}`;
}
