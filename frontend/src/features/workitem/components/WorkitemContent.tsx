import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Button, Input, Space, Typography } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { MarkdownView } from '@/shared/ui/MarkdownView';
import { CopyContentMenu } from '@/shared/ui/CopyContentMenu';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { useWorkitemDuplicateCheck } from '../useWorkitemDuplicateCheck';
import { DuplicateWorkitemsModal } from './DuplicateWorkitemsModal';
import './WorkitemSection.css';

const { Text } = Typography;
const { TextArea } = Input;

interface WorkitemContentProps {
  title: string;
  contentMd: string | null;
  /** 编辑场景排除自身的工单 ID；新建表单不传。 */
  workitemId?: number | string;
  saving?: boolean;
  readOnly?: boolean;
  onSave?: (values: { title: string; contentMd: string }) => Promise<void> | void;
  /** 正文下方的内联分区（附件）。 */
  children?: ReactNode;
}

// summary 内的操作点击不触发整卡开合。
const keepSummaryState = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

export function WorkitemContent({ title, contentMd, workitemId, saving = false, readOnly = false, onSave, children }: WorkitemContentProps) {
  const { t } = useTranslation('workitem');
  const safeContentMd = contentMd ?? '';
  const accessCommand = useAccessCommand();
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftContent, setDraftContent] = useState(safeContentMd);
  const duplicateCheck = useWorkitemDuplicateCheck({
    title: draftTitle,
    excludeWorkitemId: workitemId,
    // 只在标题真的被改过时检查：进入编辑态本身不触发提醒。
    enabled: editing && draftTitle.trim().length > 0 && draftTitle.trim() !== title.trim(),
  });

  useEffect(() => {
    if (!editing) {
      setDraftTitle(title);
      setDraftContent(safeContentMd);
    }
  }, [safeContentMd, editing, title]);

  const canSave = useMemo(() => {
    return Boolean(draftTitle.trim())
      && (draftTitle.trim() !== title || draftContent !== safeContentMd);
  }, [safeContentMd, draftContent, draftTitle, title]);

  const handleCancel = () => {
    setDraftTitle(title);
    setDraftContent(safeContentMd);
    setEditing(false);
    duplicateCheck.resetSubmission();
  };

  const handleSave = async () => {
    if (!canSave || !onSave) {
      return;
    }
    // 保存点击立即生效：不等待预检，已弹出的提醒也不会阻断保存。
    duplicateCheck.markSubmitted();
    accessCommand('READ_WRITE', t('detail.editCommand'), async () => {
      await onSave({ title: draftTitle.trim(), contentMd: draftContent });
      setEditing(false);
    });
  };

  return (
    <details
      data-testid="workitem-content-section"
      className="aw-wi-section aw-wi-collapsible"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="aw-wi-section-head">
        <span className="aw-wi-section-title">{t('detail.document')}</span>
        <AwStrokeIcon name="chev-d" size={14} className="aw-wi-chev" />
        <span className="aw-wi-section-sub aw-wi-section-actions" onClick={keepSummaryState}>
          {readOnly ? (
            <Text type="secondary" style={{ fontSize: 12 }}>{t('detail.externallyMaintained')}</Text>
          ) : editing ? (
            <Space size={4}>
              <Button className="aw-card-head-btn" icon={<AwStrokeIcon name="x" />} onClick={handleCancel} disabled={saving}>
                {t('detail.cancel')}
              </Button>
              <Button
                type="primary"
                className="aw-card-head-btn-primary"
                icon={<AwStrokeIcon name="check" />}
                loading={saving}
                disabled={!canSave}
                onClick={handleSave}
              >
                {t('detail.save')}
              </Button>
            </Space>
          ) : (
            <Space size={4}>
              <CopyContentMenu contentMd={safeContentMd} withLabel className="aw-card-head-btn" />
              <Button className="aw-card-head-btn" icon={<AwStrokeIcon name="edit" />}
                onClick={() => accessCommand('READ_WRITE', t('detail.editCommand'), () => {
                  duplicateCheck.resetSubmission();
                  setEditing(true);
                  setOpen(true);
                })}>
                {t('detail.edit')}
              </Button>
            </Space>
          )}
        </span>
      </summary>
      <div className="aw-wi-section-body">
        {editing ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Input
              aria-label={t('detail.titleField')}
              value={draftTitle}
              maxLength={200}
              showCount
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={duplicateCheck.titleHandlers.onBlur}
              onCompositionStart={duplicateCheck.titleHandlers.onCompositionStart}
              onCompositionEnd={duplicateCheck.titleHandlers.onCompositionEnd}
            />
            <TextArea
              aria-label={t('detail.bodyField')}
              value={draftContent}
              rows={12}
              autoSize={{ minRows: 10, maxRows: 24 }}
              onChange={(event) => setDraftContent(event.target.value)}
            />
          </Space>
        ) : (
          <MarkdownView className="aw-req-md" content={safeContentMd} />
        )}
        {children}
      </div>
      <DuplicateWorkitemsModal
        open={duplicateCheck.modal.open}
        matches={duplicateCheck.modal.matches}
        truncated={duplicateCheck.modal.truncated}
        partial={duplicateCheck.modal.partial}
        onDismiss={duplicateCheck.dismiss}
      />
    </details>
  );
}
