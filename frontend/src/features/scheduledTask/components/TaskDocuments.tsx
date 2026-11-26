import { useTranslation } from 'react-i18next';
import { Button, Popconfirm, Tooltip } from 'antd';
import { useState } from 'react';
import type { Artifact } from '@/shared/types/workitem';
import { ArtifactPreviewModal } from '@/features/workitem/components/ArtifactPreviewModal';
import { formatAttachmentSize } from '@/features/workitem/clarification/attachmentUpload';
import { formatDateTime } from '@/shared/i18n/format';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';

const MONTH_DAY: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit' };

export function TaskDocuments({ documents, onDelete }: { documents: Artifact[]; onDelete: (artifact: Artifact) => void }) {
  const { t } = useTranslation('scheduledTask');
  const [preview, setPreview] = useState<Artifact | null>(null);
  return (
    <div className="aw-card aw-sched-panel" data-region="documents">
      <div className="aw-card-head"><span className="aw-card-title">{t('form.documents')}</span><span className="aw-sched-sub">{t('detail.documentsSub')}</span></div>
      <div className="aw-card-body">
        {documents.length === 0 ? <div className="aw-sched-empty">{t('detail.documentsEmpty')}</div> : documents.map((artifact) => (
          <div key={artifact.id} className="aw-sched-doc">
            <AwStrokeIcon name="doc" />
            <span className="dn" title={artifact.name}>{artifact.name}</span>
            <span className="dm">{t('detail.documentMeta', { size: formatAttachmentSize(artifact.size), date: formatDateTime(artifact.gmtCreate, MONTH_DAY) })}</span>
            <Tooltip title={t('actions.preview')}><Button className="aw-op-btn" type="text" aria-label={t('actions.preview')} icon={<AwStrokeIcon name="eye" />} onClick={() => setPreview(artifact)} /></Tooltip>
            <Popconfirm title={t('confirm.deleteArtifact')} okText={t('actions.confirmDelete')} okButtonProps={{ danger: true }} cancelText={t('actions.cancel')} onConfirm={() => onDelete(artifact)}>
              <Button className="aw-op-btn aw-op-btn--del" type="text" aria-label={t('actions.delete')} icon={<AwStrokeIcon name="trash" />} />
            </Popconfirm>
          </div>
        ))}
      </div>
      <ArtifactPreviewModal open={preview != null} artifact={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
