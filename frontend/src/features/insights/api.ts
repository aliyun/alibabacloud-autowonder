import { apiClient } from '@/shared/api/client';
import type { InsightMetrics, InsightAuditPage, InsightWorker, TimeRange, HumanAgentParticipation, HumanAgentSlowTail, MemberDeliveryReport, StageDurationReport, StageDurationPlan, StageDurationAgentVersion } from './types';

export async function getInsightMetrics(params: {
  workerId?: number;
  timeRange: TimeRange;
}): Promise<InsightMetrics> {
  const resp = await apiClient.get<InsightMetrics>('/api/insights/metrics', {
    params: { worker_id: params.workerId || undefined, time_range: params.timeRange },
  });
  return resp.data;
}

export async function getInsightAudit(params: {
  page: number;
  pageSize: number;
  riskLevel?: string;
  workerId?: number;
  workerName?: string;
  timeRange: TimeRange;
}): Promise<InsightAuditPage> {
  const resp = await apiClient.get<InsightAuditPage>('/api/insights/audit', {
    params: {
      page: params.page,
      page_size: params.pageSize,
      risk_level: params.riskLevel || undefined,
      worker_id: params.workerId,
      time_range: params.timeRange,
    },
  });
  return resp.data;
}

export async function getStageWorkers(excludeCanceled = false): Promise<InsightWorker[]> {
  const resp = await apiClient.get<InsightWorker[]>('/api/insights/stage-duration/workers', { params: { exclude_canceled_workitems: excludeCanceled } });
  return resp.data;
}

export async function getInsightWorkers(): Promise<InsightWorker[]> {
  const resp = await apiClient.get<InsightWorker[]>('/api/insights/workers');
  return resp.data;
}

export interface StageDurationQuery {
  startDate: string;
  endDate: string;
  squadId?: number;
  sdlcId?: number | string;
  agentId?: string | number;
  agentVersionId?: number;
  status?: string;
  excludeCanceled?: boolean;
  groupBy?: 'stage' | 'agent_version' | 'sdlc_snapshot';
  maxDispatchId?: number | null;
}

function stageDurationParams(params: StageDurationQuery) {
  return {
    start_date: params.startDate, end_date: params.endDate, squad_id: params.squadId, sdlc_id: params.sdlcId,
    agent_id: params.agentId, group_by: params.groupBy, agent_version_id: params.agentVersionId, status: params.status,
    exclude_canceled_workitems: params.excludeCanceled,
    ...(params.maxDispatchId == null ? {} : { max_dispatch_id: params.maxDispatchId }),
  };
}

export async function getStageDuration(params: StageDurationQuery): Promise<StageDurationReport> {
  const resp = await apiClient.get<StageDurationReport>('/api/insights/stage-duration', { params: stageDurationParams(params) });
  return resp.data;
}

export async function getStageDurationPlan(params: StageDurationQuery): Promise<StageDurationPlan> {
  const resp = await apiClient.get<StageDurationPlan>('/api/insights/stage-duration/plan', { params: stageDurationParams(params) });
  return resp.data;
}

export async function getStageVersions(agentId: string, excludeCanceled = false): Promise<StageDurationAgentVersion[]> {
  const resp = await apiClient.get<StageDurationAgentVersion[]>('/api/insights/stage-duration/versions', { params: { agent_id: agentId, exclude_canceled_workitems: excludeCanceled } });
  return resp.data;
}

export async function getStageVersionSamples(agentId: string, versionIds: string[], range: { startDate: string; endDate: string }, excludeCanceled = false): Promise<StageDurationReport> {
  const resp = await apiClient.get<StageDurationReport>('/api/insights/stage-duration/version-samples', {
    params: { agent_id: agentId, version_ids: versionIds.join(','), start_date: range.startDate, end_date: range.endDate, exclude_canceled_workitems: excludeCanceled },
  });
  return resp.data;
}

export async function getHumanAgentParticipation(params: {
  startDate: string;
  endDate: string;
  workType?: string;
}): Promise<HumanAgentParticipation> {
  const resp = await apiClient.get<HumanAgentParticipation>('/api/insights/human-agent-participation', {
    params: participationParams(params),
  });
  return resp.data;
}

export async function getHumanAgentSlowTail(params: {
  startDate: string;
  endDate: string;
  workType?: string;
}): Promise<HumanAgentSlowTail> {
  const resp = await apiClient.get<HumanAgentSlowTail>('/api/insights/human-agent-participation/slowest', {
    params: participationParams(params),
  });
  return resp.data;
}

/** 仅选中具体类型时才加入 work_type 键；ALL/缺省时 params 与改动前逐键一致。 */
function participationParams(params: { startDate: string; endDate: string; workType?: string }) {
  const query: Record<string, string> = { start_date: params.startDate, end_date: params.endDate };
  if (params.workType && params.workType !== 'ALL') {
    query.work_type = params.workType;
  }
  return query;
}

/** summary 的工单类型只收敛统计卡；members 明细由后端保持全类型，表格不随类型变化。 */
export async function getMemberDelivery(params: {
  startDate: string;
  endDate: string;
  workType?: string;
}): Promise<MemberDeliveryReport> {
  const query: Record<string, string> = { start_date: params.startDate, end_date: params.endDate };
  if (params.workType && params.workType !== 'ALL') {
    query.work_type = params.workType;
  }
  const resp = await apiClient.get<MemberDeliveryReport>('/api/insights/member-delivery', { params: query });
  return resp.data;
}

export async function forceRefreshParticipation(): Promise<void> {
  await apiClient.post('/api/insights/human-agent-participation/refresh');
}
