import { statusCategoryOf } from './constants';
import type { Workitem } from '@/shared/types/workitem';

/**
 * 待决策分类工具。
 *
 * 工单「待决策」状态由服务端统一下发的看板分类（statusCategory，规格 3.1）判定，
 * 与「需人工」标签完全同条件；状态名称不参与判断。
 */

export function isPendingDecision(item: Workitem): boolean {
  return statusCategoryOf(item) === 'PENDING_DECISION';
}

/**
 * 判断工单是否为「需要当前登录人决策」的工单：
 * 必须处于待决策状态，且指派给人类用户、且指派引用等于当前用户 id。
 */
export function isMyPendingDecision(
  item: Workitem,
  userId: number | null | undefined,
): boolean {
  if (userId == null) return false;
  return isPendingDecision(item) && item.assigneeType === 'HUMAN' && item.assigneeRef === userId;
}
