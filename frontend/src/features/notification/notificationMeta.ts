import type { TFunction } from 'i18next';
import type { Notification } from '@/shared/types/notification';
import type { StatusColorKey } from '@/shared/ui/StatusTag';

// 类型 Tag 配色（原型 ⑥ 字典色）：失败/超时红、等待人工与降级琥珀、成功与状态变更绿、
// AI 会话紫、指派/评论/排队蓝、中性过程态灰；未知类型灰 + 原文。
export const TYPE_TAG_COLOR: Record<string, StatusColorKey> = {
  SCHEDULED_TASK_RUN_FAILED: 'red',
  SCHEDULED_TASK_RUN_TIMED_OUT: 'red',
  DELIVERY_BLOCKED: 'red',
  REVIEW_REQUIRED: 'amber',
  SCHEDULED_TASK_RUN_WAITING_HUMAN: 'amber',
  SCHEDULED_TASK_RESUME_DEGRADED: 'amber',
  SCHEDULED_TASK_OWNER_INACTIVE: 'amber',
  WORKSPACE_ACCESS_REQUEST: 'amber',
  SCHEDULED_TASK_RUN_SUCCEEDED: 'green',
  WATCHED_COMPLETED: 'green',
  WATCHED_STATUS_CHANGED: 'green',
  WORKSPACE_ACCESS_REVIEWED: 'green',
  AI_SESSION_DONE: 'violet',
  WORKITEM_ASSIGNED: 'blue',
  COMMENT_MENTION: 'blue',
  WATCHED_COMMENT: 'blue',
  WATCHED_ASSIGNED: 'blue',
  EXTERNAL_COMMENT: 'blue',
  DUPLICATE_INTENT: 'blue',
  SCHEDULED_TASK_RUN_QUEUED: 'blue',
  SCHEDULED_TASK_RUN_STARTING: 'blue',
  PASSWORD_RESET_BY_ADMIN: 'gray',
  SCHEDULED_TASK_RUN_WAITING_EXECUTOR: 'gray',
  SCHEDULED_TASK_RUN_RUNNING: 'gray',
  SCHEDULED_TASK_RUN_PAUSED: 'gray',
  SCHEDULED_TASK_RUN_CANCELED: 'gray',
  SCHEDULED_TASK_RUN_SKIPPED: 'gray',
};

export const typeKeys = {
  WORKITEM_ASSIGNED: 'types.WORKITEM_ASSIGNED',
  COMMENT_MENTION: 'types.COMMENT_MENTION',
  WORKSPACE_ACCESS_REQUEST: 'types.WORKSPACE_ACCESS_REQUEST',
  WORKSPACE_ACCESS_REVIEWED: 'types.WORKSPACE_ACCESS_REVIEWED',
  WATCHED_COMMENT: 'types.WATCHED_COMMENT',
  WATCHED_ASSIGNED: 'types.WATCHED_ASSIGNED',
  WATCHED_STATUS_CHANGED: 'types.WATCHED_STATUS_CHANGED',
  WATCHED_COMPLETED: 'types.WATCHED_COMPLETED',
  EXTERNAL_COMMENT: 'types.EXTERNAL_COMMENT',
  SCHEDULED_TASK_RESUME_DEGRADED: 'types.SCHEDULED_TASK_RESUME_DEGRADED',
  SCHEDULED_TASK_OWNER_INACTIVE: 'types.SCHEDULED_TASK_OWNER_INACTIVE',
  DELIVERY_BLOCKED: 'types.DELIVERY_BLOCKED',
  AI_SESSION_DONE: 'types.AI_SESSION_DONE',
  REVIEW_REQUIRED: 'types.REVIEW_REQUIRED',
  SCHEDULED_TASK_RUN_QUEUED: 'types.SCHEDULED_TASK_RUN_QUEUED',
  SCHEDULED_TASK_RUN_STARTING: 'types.SCHEDULED_TASK_RUN_STARTING',
  SCHEDULED_TASK_RUN_WAITING_EXECUTOR: 'types.SCHEDULED_TASK_RUN_WAITING_EXECUTOR',
  SCHEDULED_TASK_RUN_RUNNING: 'types.SCHEDULED_TASK_RUN_RUNNING',
  SCHEDULED_TASK_RUN_WAITING_HUMAN: 'types.SCHEDULED_TASK_RUN_WAITING_HUMAN',
  SCHEDULED_TASK_RUN_PAUSED: 'types.SCHEDULED_TASK_RUN_PAUSED',
  SCHEDULED_TASK_RUN_SUCCEEDED: 'types.SCHEDULED_TASK_RUN_SUCCEEDED',
  SCHEDULED_TASK_RUN_FAILED: 'types.SCHEDULED_TASK_RUN_FAILED',
  SCHEDULED_TASK_RUN_TIMED_OUT: 'types.SCHEDULED_TASK_RUN_TIMED_OUT',
  SCHEDULED_TASK_RUN_CANCELED: 'types.SCHEDULED_TASK_RUN_CANCELED',
  SCHEDULED_TASK_RUN_SKIPPED: 'types.SCHEDULED_TASK_RUN_SKIPPED',
  PASSWORD_RESET_BY_ADMIN: 'types.PASSWORD_RESET_BY_ADMIN',
  DUPLICATE_INTENT: 'types.DUPLICATE_INTENT',
} as const;

export function typeLabel(type: string, t: TFunction<'notification'>): string {
  return Object.prototype.hasOwnProperty.call(typeKeys, type)
    ? t(typeKeys[type as keyof typeof typeKeys])
    : type;
}

const refKeys = {
  WORKITEM: 'refs.WORKITEM',
  WORKSPACE_ACCESS_REQUEST: 'refs.WORKSPACE_ACCESS_REQUEST',
  SCHEDULED_TASK_RUN: 'refs.SCHEDULED_TASK_RUN',
} as const;

/** 缺少 refType/refId 时返回 null，详情元信息行据此省略关联段与分隔点。 */
export function relatedText(notification: Notification | null, t: TFunction<'notification'>): string | null {
  if (!notification || (!notification.refType && notification.refId == null)) {
    return null;
  }
  const code = notification.refType;
  const label = code && Object.prototype.hasOwnProperty.call(refKeys, code)
    ? t(refKeys[code as keyof typeof refKeys])
    : code ?? t('unknownRef');
  return notification.refId != null ? `${label} #${notification.refId}` : label;
}
