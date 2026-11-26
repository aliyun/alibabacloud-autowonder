import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState, type ReactNode, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent } from 'react';
import { Button, message, Popconfirm, Spin, Tooltip } from 'antd';
import { FileImageOutlined, FileMarkdownOutlined } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { Artifact } from '@/shared/types/workitem';
import {
  DOCUMENT_ACCEPT_ATTRIBUTE,
  DOCUMENT_MAX_DOCUMENTS,
  DOCUMENT_UPLOAD_MESSAGES,
  documentsFromDataTransfer,
  filesFromClipboard,
  pastedFileForUpload,
  transferContainsFiles,
  validateDocumentSelection,
} from '@/shared/lib/documentUpload';
import { getArtifactDownloadUrl } from '../api';
import { useDeleteRequirementDocument, useUploadRequirementDocuments } from '../hooks';
import { ArtifactPreviewModal } from './ArtifactPreviewModal';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';

const VISUAL_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

interface RequirementDocumentsCardProps {
  workitemId: number | string;
  documents: Artifact[];
  loading?: boolean;
  children?: ReactNode;
  hasGeneratedContext?: boolean;
}

function displayName(name: string): string {
  return name.startsWith('requirements/') ? name.slice('requirements/'.length) : name;
}

function isVisualName(name: string): boolean {
  const lower = name.toLowerCase();
  return VISUAL_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function formatBytes(size: number | null): string {
  if (size == null) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function RequirementDocumentsCard({ workitemId, documents, loading, children, hasGeneratedContext }: RequirementDocumentsCardProps) {
  const { t } = useTranslation('workitem');
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<Artifact['id'] | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const accessCommand = useAccessCommand();
  const uploadMutation = useUploadRequirementDocuments(workitemId);
  const deleteMutation = useDeleteRequirementDocument(workitemId);

  useEffect(() => {
    // 页面其他区域默认 drop 会直接打开文件、丢弃当前页面，统一阻止；上传只经卡片区域内完成。
    const blockPageFileDrop = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', blockPageFileDrop);
    window.addEventListener('drop', blockPageFileDrop);
    return () => {
      window.removeEventListener('dragover', blockPageFileDrop);
      window.removeEventListener('drop', blockPageFileDrop);
    };
  }, []);

  const submitFiles = (incoming: File[]) => {
    accessCommand('READ_WRITE', t('documents.uploadCommand'), () => {
      if (incoming.length === 0) return;
      const verdict = validateDocumentSelection(incoming, {
        existingCount: documents.length,
        existingNames: documents.map((document) => displayName(document.name)),
        existingTotalBytes: documents.reduce((total, document) => total + (document.size ?? 0), 0),
      });
      if (!verdict.ok) {
        message.error(verdict.message);
        return;
      }
      uploadMutation.mutate({ files: incoming });
    });
  };

  const handleDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!transferContainsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!transferContainsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!transferContainsFiles(event.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const { files, containsDirectory } = documentsFromDataTransfer(event.dataTransfer);
    if (containsDirectory) {
      message.error(DOCUMENT_UPLOAD_MESSAGES.directory);
      return;
    }
    if (files.length === 0) {
      message.error(DOCUMENT_UPLOAD_MESSAGES.noLocalFile);
      return;
    }
    submitFiles(files);
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const clipboardFiles = filesFromClipboard(event.clipboardData);
    // 纯文本粘贴交还浏览器默认行为，不影响输入框/评论框。
    if (clipboardFiles.length === 0) return;
    event.preventDefault();
    submitFiles(clipboardFiles.map((file) => pastedFileForUpload(file)));
  };

  const handleDownload = async (artifact: Artifact) => {
    const url = await getArtifactDownloadUrl(artifact.id);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <section data-testid="requirement-documents-card" className="aw-req-context">
      <div className="aw-req-context-head">
        <h3>
          <AwStrokeIcon name="paperclip" size={14} />
          <span>{t('documents.title')}</span>
          <span className="aw-req-context-count">{t('documents.countLabel', { total: documents.length })}</span>
        </h3>
        <input
          ref={inputRef}
          data-testid="requirement-document-file-input"
          aria-label={t('documents.selectFile')}
          type="file"
          multiple
          accept={DOCUMENT_ACCEPT_ATTRIBUTE}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
          onChange={(event) => {
            submitFiles(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <Button
          className="aw-card-head-btn aw-req-context-upload"
          icon={<AwStrokeIcon name="upload" />}
          loading={uploadMutation.isPending}
          disabled={uploadMutation.isPending || documents.length >= DOCUMENT_MAX_DOCUMENTS}
          onClick={() => accessCommand(
            'READ_WRITE',
            t('documents.uploadCommand'),
            () => inputRef.current?.click(),
          )}
        >
          {t('documents.upload')}
        </Button>
      </div>
      {children}
      <div
        data-testid="requirement-document-dropzone"
        className="aw-req-dropzone"
        data-drag-active={dragActive ? 'true' : 'false'}
        aria-label={t('documents.dropzone')}
        tabIndex={0}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 16 }}><Spin size="small" /></div>
        ) : documents.length === 0 ? (
          hasGeneratedContext ? null : (
            <>
              <p className="aw-req-empty">{t('documents.empty')}</p>
              <p className="aw-doc-meta">{t('documents.help')}</p>
            </>
          )
        ) : documents.map((artifact) => {
          const name = displayName(artifact.name);
          return (
            <div key={artifact.id} className="aw-doc-item">
              <span className="aw-doc-ic">
                {isVisualName(artifact.name) ? <FileImageOutlined /> : <FileMarkdownOutlined />}
              </span>
              <div className="aw-doc-info">
                <span className="aw-doc-name" title={name}>{name}</span>
                <span className="aw-doc-meta">{t('documents.itemMeta', { size: formatBytes(artifact.size), type: artifact.type })}</span>
              </div>
              <div className="aw-doc-ops">
                <Button
                  className="aw-doc-op aw-doc-op-preview"
                  aria-label={t('documents.previewFile', { name })}
                  icon={<AwStrokeIcon name="eye" />}
                  onClick={() => setPreviewArtifact(artifact)}
                >
                  {t('documents.preview')}
                </Button>
                <Tooltip title={t('documents.download')}>
                  <Button
                    className="aw-doc-op"
                    aria-label={t('documents.downloadFile', { name })}
                    icon={<AwStrokeIcon name="dl" />}
                    onClick={() => handleDownload(artifact)}
                  />
                </Tooltip>
                <Popconfirm
                  title={t('documents.deleteConfirm', { name })}
                  okText={t('detail.delete')}
                  cancelText={t('detail.cancel')}
                  open={deleteConfirmId === artifact.id}
                  onOpenChange={(open) => {
                    if (!open) {
                      setDeleteConfirmId(null);
                      return;
                    }
                    accessCommand(
                      'READ_WRITE',
                      t('documents.deleteCommand'),
                      () => setDeleteConfirmId(artifact.id),
                    );
                  }}
                  onConfirm={() => {
                    setDeleteConfirmId(null);
                    accessCommand(
                      'READ_WRITE',
                      t('documents.deleteCommand'),
                      () => deleteMutation.mutate({ artifactId: artifact.id }),
                    );
                  }}
                >
                  <Button
                    className="aw-doc-op aw-doc-op-danger"
                    aria-label={t('documents.deleteFile', { name })}
                    icon={<AwStrokeIcon name="trash" />}
                    loading={deleteMutation.isPending}
                  />
                </Popconfirm>
              </div>
            </div>
          );
        })}
      </div>
      <ArtifactPreviewModal
        open={!!previewArtifact}
        artifact={previewArtifact}
        onClose={() => setPreviewArtifact(null)}
      />
    </section>
  );
}
