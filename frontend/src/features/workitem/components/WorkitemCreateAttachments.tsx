import { useRef } from 'react';
import { Button } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { DOCUMENT_ACCEPT_ATTRIBUTE, validateDocumentSelection } from '@/shared/lib/documentUpload';
import { CommentAttachment } from './CommentAttachment';

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

interface WorkitemCreateAttachmentsProps {
  files: File[];
  disabled?: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}

/** 创建页与工作台弹窗共用的附件选择区：文件按钮 + 已选附件预览。 */
export function WorkitemCreateAttachments({
  files,
  disabled = false,
  onAdd,
  onRemove,
}: WorkitemCreateAttachmentsProps) {
  const { t } = useTranslation('workitem');
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div data-testid="workitem-create-attachments" style={{ marginBottom: 16 }}>
      {files.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8, maxHeight: 160, overflowY: 'auto' }}>
          {files.map((file, index) => (
            <CommentAttachment
              key={`${file.name}-${index}`}
              attachment={{ file }}
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
      <Button
        size="small"
        icon={<PaperClipOutlined />}
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
      >
        {t('create.attachFiles')}
      </Button>
      <span style={{ marginLeft: 8, color: 'var(--aw-muted)', fontSize: 12 }}>
        {t('create.attachmentHint')}
      </span>
    </div>
  );
}
