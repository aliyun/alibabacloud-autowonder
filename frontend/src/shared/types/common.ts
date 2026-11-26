export interface ApiResult<T> {
  success: boolean;
  code: string;
  message: string;
  data: T;
  traceId: string | null;
}

export interface PageResult<T> {
  list: T[];
  total: number;
  pageNum: number;
  pageSize: number;
}

export interface UserInfo {
  id: number;
  username: string;
  nickname: string;
  email: string;
  /** 平台管理员标志（user.is_admin），由登录响应下发的服务端事实。 */
  isAdmin?: boolean | null;
  /** 联系方式（user.phone），由个人中心基本信息维护写入。 */
  phone?: string | null;
}

export interface WorkspaceInfo {
  id: number;
  name: string;
  description: string;
  background?: string | null;
  memberCount?: number | null;
  workitemCount?: number | null;
  /** org.version, echoed so the edit modal can submit it as the optimistic-lock expectation. */
  version?: number | null;
  accessLevel?: WorkspaceAccessLevel | null;
  isOwner?: boolean | null;
  canManage?: boolean | null;
}

export type WorkspaceAccessLevel = 'READ_ONLY' | 'READ_WRITE' | 'ADMIN';

/** 与后端 WorkspaceDomain 枚举一一对应的功能域。 */
export type WorkspaceDomain =
  | 'AGENT' | 'AI' | 'AIUSAGE' | 'ARTIFACT' | 'AUDIT' | 'AUTH' | 'BACKUP'
  | 'CATEGORY' | 'CLARIFICATION' | 'CONVERSATION' | 'DASHBOARD' | 'DEBUGLOG'
  | 'DISPATCH' | 'ENVIRONMENT' | 'EVOLUTION' | 'EXECUTOR' | 'INSIGHTS'
  | 'INTEGRATION' | 'MCP' | 'MEMORY' | 'PRD' | 'REPO' | 'SCHEDULEDTASK' | 'SDLC'
  | 'SETTING' | 'SKILL' | 'SQUAD' | 'STATEMACHINE' | 'TEMPLATE' | 'USER'
  | 'WORKITEM' | 'WORKSPACE';

export interface WorkspaceListItem {
  id: number;
  name: string;
  description: string;
  membershipStatus: 'MEMBER' | 'NOT_MEMBER' | 'PENDING';
  background?: string | null;
  memberCount?: number | null;
  workitemCount?: number | null;
  accessLevel: WorkspaceAccessLevel | null;
  pendingRequestId?: number | null;
  isOwner?: boolean | null;
  canManage?: boolean | null;
  /** 乐观锁版本，编辑弹窗提交时回传（平台管理员从发现页编辑空间时使用）。 */
  version?: number | null;
}

/** One row of the workspace-only recycle bin (F4). */
export interface RecycleBinItem {
  id: number;
  name: string;
  description: string | null;
  ownerId: number | null;
  ownerName: string | null;
  deletedAt: string | null;
  deletedBy: number | null;
  deletedByName: string | null;
  /** False when an in-use workspace already holds this name, so restore needs a rename. */
  restorable: boolean | null;
}

export interface LoginResponse {
  userId: number;
  accessToken: string;
  refreshToken: string;
  user: UserInfo;
  /** 普通会话为 null；需要先验证邮箱时为 EMAIL_VERIFICATION。 */
  sessionPurpose?: 'EMAIL_VERIFICATION' | null;
  /** 受限验证凭证（15 分钟），仅验证/更换邮箱接口可用。 */
  restrictedToken?: string | null;
  restrictedExpiresAt?: string | null;
}

export interface SwitchWorkspaceResponse {
  accessToken: string;
  accessLevel: WorkspaceAccessLevel;
}

export class ApiError extends Error {
  code: string;
  traceId: string | null;
  /** 业务失败时后端随 Result 下发的结构化载荷（如工单归属项目）；无载荷时为 undefined。 */
  data?: unknown;

  constructor(code: string, message: string, traceId: string | null, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.traceId = traceId;
    this.data = data;
  }
}

export const ErrorCodes = {
  PARAM_INVALID: '10001',
  UNAUTHORIZED: '10401',
  NO_PERMISSION: '10403',
  WORKSPACE_NOT_MEMBER: '11001',
  WORKSPACE_ACCESS_INSUFFICIENT: '12008',
  USER_REGISTRATION_PENDING_REVIEW: '37012',
  WORKSPACE_CREATION_PERMISSION_DENIED: '37015',
  WORKSPACE_CREATION_PERMISSION_GLOBAL_OVERRIDE: '37016',
  WORKSPACE_CREATION_PERMISSION_READONLY: '37017',
  WORKSPACE_CREATION_REQUEST_ALREADY_GRANTED: '37018',
  NOT_FOUND: '10404',
  CONFLICT: '10409',
  RATE_LIMITED: '10429',
  RETRY_LATER: '10430',
  SYSTEM_BUSY: '10431',
  ORG_VERSION_CONFLICT: '11004',
  ORG_DELETED_OR_DISABLED: '11005',
  ORG_NOT_FOUND_OR_NO_PERMISSION: '11006',
  ORG_RESTORE_NAME_CONFLICT: '11007',
  WORKITEM_VERSION_CONFLICT: '13005',
  WORKITEM_IN_OTHER_WORKSPACE: '13023',
  /** 交付已关闭导致评论未保存（整笔回滚），需要独立文案与后续指引。 */
  WORKITEM_DELIVERY_CLOSED: '13024',
  EMAIL_VERIFICATION_REQUIRED: '51001',
  EMAIL_VERIFICATION_DISABLED: '51002',
  EMAIL_CODE_INVALID: '51003',
  EMAIL_CODE_RATE_LIMITED: '51004',
  EMAIL_SEND_FAILED: '51005',
  EMAIL_SUFFIX_NOT_ALLOWED: '51006',
  EMAIL_VERIFICATION_PROOF_INVALID: '51008',
  EMAIL_VERIFICATION_TOKEN_INVALID: '51017',
} as const;
