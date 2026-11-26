import { Form, Input, Select, message } from 'antd';
import { useState } from 'react';
import type { ClipboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { filesFromClipboard, pastedFileForUpload } from '@/shared/lib/documentUpload';
import { priorityMap, workTypeMap } from '../constants';
import { appendCreateAttachments, WorkitemCreateAttachments } from './WorkitemCreateAttachments';
import './createFields.css';

const { TextArea } = Input;

export interface WorkitemTitleHandlers {
  onBlur: () => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
}

interface WorkitemCreateFieldsProps {
  /** page=创建页（类型→标题→描述→附件→优先级，原型 11）；modal=新建弹窗（标题→类型+优先级→描述→附件，原型 36）。 */
  variant?: 'page' | 'modal';
  /** 标题查重预检的输入事件；页面与工作台创建弹窗各自持有 hook 实例。 */
  titleHandlers?: WorkitemTitleHandlers;
  /** 待创建的附件；提交时随工单一起上传为需求与设计附件。 */
  attachments: File[];
  onAttachmentsChange: (files: File[]) => void;
}

/** 新建工单的基础字段，创建页与工作台弹窗共用，保持原有校验与默认值。 */
export function WorkitemCreateFields({
  variant = 'page',
  titleHandlers,
  attachments,
  onAttachmentsChange,
}: WorkitemCreateFieldsProps) {
  const { t } = useTranslation('workitem');
  const [attachError, setAttachError] = useState<string | null>(null);
  const addFiles = (incoming: File[]) => {
    const selection = appendCreateAttachments(attachments, incoming);
    if (selection.error) {
      message.error(selection.error);
      setAttachError(selection.error);
      return;
    }
    setAttachError(null);
    onAttachmentsChange(selection.files);
  };
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = filesFromClipboard(event.clipboardData);
    if (pasted.length === 0) return;
    // 剪贴板同时带文本时照常粘贴文本，只提取其中的图片/文件。
    if (!event.clipboardData.getData('text/plain')) event.preventDefault();
    addFiles(pasted.map((file) => pastedFileForUpload(file)));
  };
  const typeField = (
    <Form.Item name="workType" label={t('fields.type')} rules={[{ required: true }]}>
      <Select
        options={Object.entries(workTypeMap).map(([value, meta]) => ({ value, label: meta.label }))}
      />
    </Form.Item>
  );
  const titleField = (
    <Form.Item name="title" label={t('fields.title')} rules={[{ required: true, message: t('create.titleRequired') }]}>
      <Input
        placeholder={t('create.titlePlaceholder')}
        maxLength={200}
        onBlur={titleHandlers?.onBlur}
        onCompositionStart={titleHandlers?.onCompositionStart}
        onCompositionEnd={titleHandlers?.onCompositionEnd}
      />
    </Form.Item>
  );
  const descriptionField = (
    <Form.Item name="contentMd" label={t('fields.description')} rules={[{ required: true, message: t('create.descriptionRequired') }]}>
      <TextArea rows={6} placeholder={t('create.descriptionPlaceholder')} onPaste={handlePaste} />
    </Form.Item>
  );
  const attachField = (
    <WorkitemCreateAttachments
      files={attachments}
      error={attachError}
      onAdd={addFiles}
      onRemove={(index) => {
        setAttachError(null);
        onAttachmentsChange(attachments.filter((_, itemIndex) => itemIndex !== index));
      }}
    />
  );
  const priorityField = (
    <Form.Item name="priority" label={t('fields.priority')}>
      <Select
        options={[0, 1, 2, 3].map(value => ({ value, label: t('priority.option', { priority: value, label: priorityMap[value].label }) }))}
      />
    </Form.Item>
  );
  if (variant === 'modal') {
    return (
      <>
        {titleField}
        <div className="aw-create-row">{typeField}{priorityField}</div>
        {descriptionField}
        {attachField}
      </>
    );
  }
  return (
    <>
      {typeField}
      {titleField}
      {descriptionField}
      {attachField}
      {priorityField}
    </>
  );
}

/** 与创建页一致的表单初始值：REQ / 优先级 2。 */
export const WORKITEM_CREATE_INITIAL_VALUES = { workType: 'REQ', priority: 2 };
