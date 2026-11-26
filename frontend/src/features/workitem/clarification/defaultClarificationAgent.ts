import { listAllAgents } from '@/features/agent/api';
import type { Agent } from '@/features/agent/api';

/** 与后端 AgentSystemTag.REQ_CLARIFY 保持一致的稳定编码，展示名走前端 i18n。 */
const REQ_CLARIFY_TAG = 'REQ_CLARIFY';

export const AUTO_CLARIFICATION_AGENT_QUERY_KEY = ['clarification', 'auto-agent'] as const;

/**
 * 自动选人候选：系统标签「需求澄清」+ 已发布在线 + 至少一个执行器在线 + 非平台数字人。
 * 不要求小队归属（无小队也可澄清），也不看交付进度（未绑定 SDLC 的数字人仍可被选中）。
 */
export function isAutoClarificationCandidate(agent: Agent): boolean {
  return agent.status === 'ONLINE'
    && agent.kind !== 'PLATFORM'
    && (agent.systemTags ?? []).includes(REQ_CLARIFY_TAG)
    && (agent.executorOnlineCount ?? 0) > 0;
}

/** 候选恰好 1 个才返回该数字人；0 个或多个都返回 null，交回手动选择链路。 */
export async function loadAutoClarificationAgent(): Promise<Agent | null> {
  const online = await listAllAgents({ status: 'ONLINE' });
  const candidates = online.filter(isAutoClarificationCandidate);
  return candidates.length === 1 ? candidates[0] : null;
}
