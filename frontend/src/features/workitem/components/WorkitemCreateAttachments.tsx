import { useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import {
  DOCUMENT_ACCEPT_ATTRIBUTE,
  DOCUMENT_MAX_DOCUMENTS,
  validateDocumentSelection,
} from '@/shared/lib/documentUpload';

export interface CreateAttachmentSelection {
  files: File[];
  error?: string;
}

/** 新建工单附件沿用需求文档的额度与重名规则，粘贴与选择文件走同一处校验。 */
export function appendCreateAttachments(
  current: File[],
  incoming: File[],
): CreateAttachmentSelection {
  if (incoming.length === 0) return { files: current };
  const verdict = validateDocumentSelection(incoming, {
    existingCount: current.length,
    existingNames: current.map((file) => file.name),
    existingTotalBytes: current.reduce((total, file) => total + file.size, 0),
  });
  if (!verdict.ok) return { files: current, error: verdict.message };
  return { files: [...current, ...incoming] };
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function isVisualFile(name: string): boolean {
  return /\.(png|jpe?g|webp)$/i.test(name);
}

function FileChip({ file, disabled, onRemove }: { file: File; disabled: boolean; onRemove: () => void }) {
  const { t } = useTranslation('workitem');
  const [previewUrl, setPreviewUrl] = useState<string>();
  useEffect(() => {
    if (!isVisualFile(file.name)) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <span className="aw-file-chip">
      {previewUrl
        ? <img className="aw-chip-thumb" src={previewUrl} alt={file.name} />
        : <AwStrokeIcon name="file" size={12} className="aw-chip-ic" />}
      <span className="aw-chip-name" title={file.name}>{file.name}</span>
      <span className="aw-chip-size">{formatBytes(file.size)}</span>
      <button
        type="button"
        className="aw-chip-remove"
        disabled={disabled}
        aria-label={t('comment.removeAttachment', { name: file.name })}
        onClick={onRemove}
      >
        <AwStrokeIcon name="x" size={11} />
      </button>
    </span>
  );
}

interface WorkitemCreateAttachmentsProps {
  files: File[];
  disabled?: boolean;
  /** 校验失败时就地替换额度提示的红字；文件不追加、已选不变。 */
  error?: string | null;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}

/** 创建页与工作台弹窗共用的附件字段：按钮 + 计数 + 提示 + 紧凑芯片横排自动换行。 */
export function WorkitemCreateAttachments({
  files,
  disabled = false,
  error = null,
  onAdd,
  onRemove,
}: WorkitemCreateAttachmentsProps) {
  const { t } = useTranslation('workitem');
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="aw-create-attach" data-testid="workitem-create-attachments">
      <div className="aw-create-attach-label">
        {t('create.attachLabel')}
        <span className="aw-optional-tag">{t('create.optional')}</span>
      </div>
      <div className="aw-create-attach-tools">
        <Button
          size="small"
          icon={<AwStrokeIcon name="upload" size={12} />}
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          {t('create.attachFiles')}
        </Button>
        {files.length > 0 ? (
          <span className="aw-create-attach-count">
            {t('create.attachmentCount', { count: files.length, max: DOCUMENT_MAX_DOCUMENTS })}
          </span>
        ) : null}
      </div>
      {error
        ? <div className="aw-create-attach-err" role="alert">{error}</div>
        : <div className="aw-create-attach-hint">{t('create.attachmentHint')}</div>}
      {files.length > 0 ? (
        <div className="aw-create-attach-files">
          {files.map((file, index) => (
            <FileChip
              key={`${file.name}-${index}`}
              file={file}
              disabled={disabled}
              onRemove={() => onRemove(index)}
            />
          ))}
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={DOCUMENT_ACCEPT_ATTRIBUTE}
        hidden
        style={{ display: 'none' }}
        disabled={disabled}
        aria-label={t('create.attachFiles')}
        data-testid="workitem-create-file-input"
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (selected.length > 0) onAdd(selected);
        }}
      />
    </div>
  );
}