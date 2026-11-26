import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArtifactPreviewModal } from '@/features/workitem/components/ArtifactPreviewModal';
import type { Artifact } from '@/shared/types/workitem';
import { designDocumentPath, useDesignHandoff } from '../handoff';
import { PrdHandoffStatus } from './PrdHandoffStatus';

export function PrdHandoffSummary({ workitemId, documents }: { workitemId: string; documents: Artifact[] }) {
  const navigate = useNavigate();
  const { data: handoff } = useDesignHandoff(workitemId);
  const [preview, setPreview] = useState<Artifact | null>(null);
  const review = handoff?.review ?? handoff?.completed;
  if (!review) return null;

  return <>
    <PrdHandoffStatus workitemId={workitemId} review={review} openWorkbenchToSubmit={handoff?.canSubmit}
      onReadDocument={versionId => {
        const attachment = documents.find(file => file.id === review.attachmentId);
        if (attachment) setPreview(attachment);
        else navigate(designDocumentPath(workitemId, versionId));
      }} />
    <ArtifactPreviewModal artifact={preview} open={!!preview} onClose={() => setPreview(null)} />
  </>;
}
