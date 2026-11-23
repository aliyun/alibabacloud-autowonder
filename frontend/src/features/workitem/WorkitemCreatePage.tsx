import { PageHeading } from '@/shared/ui/PageHeading';
import { PageBackButton } from '@/shared/ui/PageBackButton';
import { Card, Form, Button, message } from 'antd';
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateWorkitem } from './hooks';
import { uploadRequirementDocuments } from './api';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { useWorkitemDuplicateCheck } from './useWorkitemDuplicateCheck';
import { DuplicateWorkitemsModal } from './components/DuplicateWorkitemsModal';
import { WORKITEM_CREATE_INITIAL_VALUES, WorkitemCreateFields } from './components/WorkitemCreateFields';

export function WorkitemCreatePage() {
  const { t } = useTranslation('workitem');
  const navigate = useNavigate();
  const [form] = Form.useForm();
  useLocalizedValidation(form);
  const createMut = useCreateWorkitem();
  const accessCommand = useAccessCommand();
  const titleValue = Form.useWatch<string>('title', form) ?? '';
  const duplicateCheck = useWorkitemDuplicateCheck({ title: titleValue });
  const [attachments, setAttachments] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // 上传附件发生在创建成功之后，期间按钮已不再处于创建中，需单独阻止重复提交。
  const submitLock = useRef(false);

  const handleSubmit = (values: {
    workType: string;
    title: string;
    contentMd: string;
    priority: number;
  }) => {
    // 提交后立即作废本次预检：迟到的结果只走系统通知，不再打断创建流程。
    duplicateCheck.markSubmitted();
    accessCommand('READ_WRITE', t('actions.create'), async () => {
      if (submitLock.current) return;
      submitLock.current = true;
      setSubmitting(true);
      try {
        const wi = await createMut.mutateAsync({
          workType: values.workType,
          title: values.title,
          contentMd: values.contentMd,
          priority: values.priority,
        });
        if (attachments.length > 0) {
          try {
            await uploadRequirementDocuments(wi.id, attachments);
          } catch {
            // 工单已创建，不能留在创建页重复提交；附件可在详情页重新上传。
            message.error(i18n.t('workitem:create.attachmentsUploadFailed'));
            navigate(`/workitems/${wi.id}`);
            return;
          }
        }
        message.success(i18n.t('workitem:messages.created'));
        navigate(`/workitems/${wi.id}`);
      } catch {
        submitLock.current = false;
        setSubmitting(false);
        duplicateCheck.resetSubmission();
        return; // create failed; interceptor already showed the error, stay on form to retry
      }
    });
  };

  return (
    <Card className="aw-content-card" title={<PageHeading title={<span className="aw-detail-title"><PageBackButton to="/workitems" label={t('create.back')} /><span>{t('create.title')}</span></span>} />}>
      <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={WORKITEM_CREATE_INITIAL_VALUES}>
        <WorkitemCreateFields
          titleHandlers={duplicateCheck.titleHandlers}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
        />
        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={createMut.isPending || submitting}
            style={{ marginRight: 8 }}
          >
            {t('create.submit')}
          </Button>
          <Button onClick={() => navigate('/workitems')}>{t('create.cancel')}</Button>
        </Form.Item>
      </Form>
      <DuplicateWorkitemsModal
        open={duplicateCheck.modal.open}
        matches={duplicateCheck.modal.matches}
        truncated={duplicateCheck.modal.truncated}
        partial={duplicateCheck.modal.partial}
        onDismiss={duplicateCheck.dismiss}
      />
    </Card>
  );
}
