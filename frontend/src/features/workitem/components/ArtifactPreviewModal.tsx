import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Tooltip } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { FilePreview } from '@/shared/ui/FilePreview';
import type { Artifact } from '@/shared/types/workitem';
import { getArtifactDownloadUrl, getArtifactPreviewBlob } from '../api';
import './ArtifactPreviewModal.css';

interface ArtifactPreviewModalProps {
  open: boolean;
  artifact: Artifact | null;
  onClose: () => void;
}

export function ArtifactPreviewModal({ open, artifact, onClose }: ArtifactPreviewModalProps) {
  const { t } = useTranslation('workitem');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => { if (!open) setFullscreen(false); }, [open]);
  useEffect(() => {
    if (!open || !fullscreen) return;
    const restore = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', restore);
    return () => document.removeEventListener('keydown', restore);
  }, [open, fullscreen]);
  const id = artifact?.id;
  const loadBlob = useCallback(() => getArtifactPreviewBlob(id!), [id]);
  useEffect(() => {
    let cancelled = false;
    setDownloadUrl(null);
    if (open && id != null) {
      getArtifactDownloadUrl(id).then(url => { if (!cancelled) setDownloadUrl(url); }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [id, open]);

  const fullscreenLabel = t(fullscreen ? 'detail.exitFullscreen' : 'detail.fullscreen');
  const filename = artifact?.name ?? t('artifacts.preview');
  return <Modal title={<div className="aw-artifact-preview-title">
    <AwStrokeIcon name="file" size={14} />
    <span className="aw-artifact-preview-name" title={filename}>{filename}</span>
    {downloadUrl && <Tooltip title={t('artifacts.download')}>
      <Button size="middle" aria-label={t('artifacts.download')} icon={<AwStrokeIcon name="dl" />}
        href={downloadUrl} target="_blank" rel="noreferrer" />
    </Tooltip>}
    <Tooltip title={fullscreenLabel}>
      <Button size="middle"
        aria-label={fullscreenLabel} aria-pressed={fullscreen}
        icon={<AwStrokeIcon name="fullscreen" />}
        onClick={() => setFullscreen(value => !value)} />
    </Tooltip>
  </div>} className={`aw-artifact-preview-modal${fullscreen ? ' is-fullscreen' : ''}`}
    open={open} onCancel={onClose} keyboard={!fullscreen} width={fullscreen ? '100vw' : 880} forceRender
    footer={null}>
    {open && artifact && <FilePreview name={artifact.name} size={artifact.size} loadBlob={loadBlob} />}
  </Modal>;
}
