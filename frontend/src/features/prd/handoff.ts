import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export type ReviewStatus = 'SNAPSHOTTING' | 'SNAPSHOT_FAILED' | 'IN_REVIEW' | 'RETURNED' | 'WITHDRAWN'
  | 'PUSHING' | 'PUSH_FAILED' | 'ATTACHING' | 'ATTACHMENT_FAILED' | 'COMPLETED';

export interface DesignReview {
  id: number;
  versionId: number;
  status: ReviewStatus;
  repoId: number;
  repoUrl: string;
  branch: string;
  reviewerIds: number[];
  decisionReason: string | null;
  commit: string | null;
  attachmentId: number | null;
  attachmentName: string | null;
  canDecide: boolean;
  canWithdraw: boolean;
  canRetry: boolean;
}

interface ReviewState {
  canSubmit: boolean;
  managed: boolean;
  review: DesignReview | null;
  completed: DesignReview | null;
}

interface DesignDocument {
  versionId: number;
  fileName: string;
  markdown: string;
}

export const handoffPath = (item: string | number) => `/api/workitems/${item}/prd/handoff`;
export const clarificationPath = (item: string | number) => `/workitems/${item}?panel=clarify&fullscreen=1`;
export const designPreviewPath = (item: string | number) => `/workitems/${item}/design`;
export const designDocumentPath = (item: string | number, version: number) => `${designPreviewPath(item)}?prdDocument=${version}`;
export const passingReview = (state?: ReviewStatus) => state === 'PUSHING' || state === 'ATTACHING';

export function useDesignHandoff(item: string | number, enabled = true) {
  return useQuery({
    queryKey: ['prd-design-handoff', String(item)],
    queryFn: async () => (await apiClient.get<ReviewState>(handoffPath(item), { backgroundActivity: true })).data,
    enabled,
    retry: false,
    refetchInterval: query => {
      const status = query.state.data?.review?.status;
      return status === 'SNAPSHOTTING' || status === 'IN_REVIEW' || passingReview(status) ? 2500 : false;
    },
  });
}

export function useDesignDocument(item: string | number, version: number | null) {
  return useQuery({
    queryKey: ['prd-design-document', String(item), version],
    queryFn: async () => (await apiClient.get<DesignDocument>(`/api/workitems/${item}/prd/versions/${version}/markdown`)).data,
    enabled: !!version,
    retry: false,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });
}
