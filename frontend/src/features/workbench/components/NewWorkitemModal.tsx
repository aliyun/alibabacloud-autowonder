import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Button, DatePicker, Form, Input, Modal, Radio, Space, Tabs, Typography, message } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { useCreateWorkitem, useAssignWorkitem } from '@/features/workitem/hooks';
import { uploadRequirementDocuments, type CreateWorkitemParams } from '@/features/workitem/api';
import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { useWorkitemDuplicateCheck } from '@/features/workitem/useWorkitemDuplicateCheck';
import { DuplicateWorkitemsModal } from '@/features/workitem/components/DuplicateWorkitemsModal';
import { DeliveryTargetFields } from '@/features/workitem/components/DeliveryTargetFields';
import {
  WORKITEM_CREATE_INITIAL_VALUES,
  WorkitemCreateFields,
} from '@/features/workitem/components/WorkitemCreateFields';
import { setupStatus } from '@/features/chiefOfStaff/api';
import { openChiefPanel } from '@/features/workspaceGuide/bridge';
import { i18n } from '@/shared/i18n';

type StartMode = 'later' | 'now' | 'scheduled';

interface NewWorkitemModalProps {
  open: boolean;
  onClose: () => void;
}

function createClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `workbench-create-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function NewWorkitemModal({ open, onClose }: NewWorkitemModalProps) {
  const { t } = useTranslation('workbench');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  useLocalizedValidation(form, open);
  const createMut = useCreateWorkitem();
  const assignMut = useAssignWorkitem();
  const accessCommand = useAccessCommand();
  const titleValue = Form.useWatch<string>('title', form) ?? '';
  const duplicateCheck = useWorkitemDuplicateCheck({ title: titleValue });
  const agentId = Form.useWatch<number | undefined>('agentId', form);
  const [startMode, setStartMode] = useState<StartMode>('now');
  const [activeTab, setActiveTab] = useState('default');
  const [smartDraft, setSmartDraft] = useState('');
  const [prefillRejected, setPrefillRejected] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const openedRef = useRef(false);
  const submitLock = useRef(false);

  const setupQuery = useQuery({
    queryKey: ['chief', 'setup', 'workbench-create'],
    queryFn: setupStatus,
    enabled: open && activeTab === 'smart',
    staleTime: 15_000,
    retry: false,
  });
  const chiefReady = setupQuery.data?.ready === true;

  useEffect(() => {
    if (open) {
      setActiveTab('default');
      setPrefillRejected(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || activeTab !== 'smart' || !chiefReady || openedRef.current) {
      return;
    }
    // 进入智能模式才建立与当前空间 Chief 的对话；每次打开弹窗只自动打开一次。
    openedRef.current = true;
    openChiefPanel({
      expanded: true,
      prefill: smartDraft.trim() || null,
      clientMessageId: createClientMessageId(),
      onPrefillResult: (accepted) => setPrefillRejected(!accepted),
    });
  }, [activeTab, chiefReady, open, smartDraft]);

  useEffect(() => {
    if (!open) {
      openedRef.current = false;
    }
  }, [open]);

  // 取消数字员工选择后清除不再有效的启动安排，避免提交残留参数。
  useEffect(() => {
    if (agentId == null) {
      setStartMode('now');
      form.setFieldValue('scheduledStartAt', undefined);
    }
  }, [agentId, form]);

  const submitLabel = !agentId
    ? t('create.submitCreate')
    : startMode === 'scheduled'
      ? t('create.submitSchedule')
      : startMode === 'now'
        ? t('create.submitStart')
        : t('create.submitCreate');

  const showScheduledStart = agentId != null && startMode === 'scheduled';

  const handleSubmit = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    duplicateCheck.markSubmitted();
    accessCommand('READ_WRITE', i18n.t('workitem:actions.create'), async () => {
      if (submitLock.current) return;
      submitLock.current = true;
      setSubmitting(true);
      const hasAttachments = attachments.length > 0;
      const scheduledStartAt = startMode === 'scheduled' && values.scheduledStartAt
        ? (values.scheduledStartAt as Dayjs).toISOString()
        : undefined;
      try {
        const params: CreateWorkitemParams = {
          workType: values.workType,
          title: values.title,
          contentMd: values.contentMd,
          priority: values.priority,
        };
        // 带附件时先创建未分配工单，上传附件后再分配：首次派发的任务包必须已包含图片。
        if (values.agentId != null && !hasAttachments) {
          params.assigneeType = 'AGENT';
          params.assigneeRef = values.agentId;
          if (values.squadId != null) {
            params.squadId = values.squadId;
          }
          if (scheduledStartAt) {
            params.scheduledStartAt = scheduledStartAt;
          }
        }
        const created = await createMut.mutateAsync(params);
        const leaveCreated = () => {
          form.resetFields();
          setStartMode('now');
          setAttachments([]);
          submitLock.current = false;
          setSubmitting(false);
          onClose();
          navigate(`/workitems/${created.id}`);
        };
        if (hasAttachments) {
          try {
            await uploadRequirementDocuments(created.id, attachments);
          } catch {
            message.error(i18n.t('workitem:create.attachmentsUploadFailed'));
            leaveCreated();
            return;
          }
          if (values.agentId != null) {
            try {
              await assignMut.mutateAsync({
                id: created.id,
                assigneeType: 'AGENT',
                assigneeRef: values.agentId,
                squadId: values.squadId ?? undefined,
                scheduledStartAt,
              });
            } catch {
              message.error(i18n.t('workitem:create.assignmentFailed'));
              leaveCreated();
              return;
            }
          }
        }
        message.success(values.agentId ? t('create.successStarted') : t('create.success'));
        queryClient.invalidateQueries({ queryKey: ['workbench'] });
        leaveCreated();
      } catch {
        submitLock.current = false;
        setSubmitting(false);
        duplicateCheck.resetSubmission();
      }
    });
  };

  const handleReopenChief = () => {
    setPrefillRejected(false);
    openChiefPanel({
      expanded: true,
      prefill: smartDraft.trim() || null,
      clientMessageId: createClientMessageId(),
      onPrefillResult: (accepted) => setPrefillRejected(!accepted),
    });
  };

  const defaultTab = (
    <Form form={form} layout="vertical" initialValues={WORKITEM_CREATE_INITIAL_VALUES}>
      <WorkitemCreateFields
        titleHandlers={duplicateCheck.titleHandlers}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
      />
      <DeliveryTargetFields form={form} required={false} />
      {agentId != null ? (
        <Form.Item label={t('create.delivery.mode')}>
          <Radio.Group value={startMode} onChange={(event) => setStartMode(event.target.value as StartMode)}>
            <Radio.Button value="now">{t('create.delivery.now')}</Radio.Button>
            <Radio.Button value="scheduled">{t('create.delivery.scheduled')}</Radio.Button>
          </Radio.Group>
          <Typography.Text type="secondary" className="aw-workbench-timezone">
            {t('create.delivery.timezone')}
          </Typography.Text>
        </Form.Item>
      ) : null}
      {showScheduledStart ? (
        <Form.Item
          name="scheduledStartAt"
          label={i18n.t('workitem:start.scheduledTime')}
          rules={[
            { required: true, message: t('create.delivery.timeRequired') },
            {
              validator: (_rule, value: Dayjs | undefined) => (
                !value || value.isAfter(dayjs())
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('create.delivery.timeRequired')))
              ),
            },
          ]}
        >
          <DatePicker
            showTime
            style={{ width: '100%' }}
            placeholder={i18n.t('workitem:start.timePlaceholder')}
            disabledDate={(current) => !!current && current.isBefore(new Date(), 'minute')}
          />
        </Form.Item>
      ) : null}
      <Space>
        <Button type="primary" loading={createMut.isPending || submitting} onClick={() => { void handleSubmit(); }}>
          {submitLabel}
        </Button>
        <Button onClick={onClose}>{i18n.t('workitem:create.cancel')}</Button>
      </Space>
      <DuplicateWorkitemsModal
        open={duplicateCheck.modal.open}
        matches={duplicateCheck.modal.matches}
        truncated={duplicateCheck.modal.truncated}
        partial={duplicateCheck.modal.partial}
        onDismiss={duplicateCheck.dismiss}
      />
    </Form>
  );

  const smartTab = (
    <div className="aw-workbench-smart">
      <Typography.Paragraph type="secondary">{t('create.smart.description')}</Typography.Paragraph>
      {setupQuery.isLoading ? (
        <Typography.Text type="secondary">{t('create.smart.checking')}</Typography.Text>
      ) : !chiefReady ? (
        <Alert type="info" showIcon message={t('create.smart.unavailable')} />
      ) : null}
      <Form layout="vertical">
        <Form.Item label={t('create.smart.draftLabel')}>
          <Input.TextArea
            rows={5}
            aria-label={t('create.smart.draftLabel')}
            value={smartDraft}
            placeholder={t('create.smart.draftPlaceholder')}
            onChange={(event) => setSmartDraft(event.target.value)}
          />
        </Form.Item>
      </Form>
      {prefillRejected ? <Alert type="warning" showIcon message={t('create.smart.prefillRejected')} /> : null}
      <Button type="primary" disabled={!chiefReady || !smartDraft.trim()} onClick={handleReopenChief}>
        {t('create.smart.open')}
      </Button>
    </div>
  );

  return (
    <Modal
      title={t('create.title')}
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      destroyOnHidden={false}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'default', label: t('create.tabs.default'), children: defaultTab },
          { key: 'smart', label: t('create.tabs.smart'), children: smartTab },
        ]}
      />
    </Modal>
  );
}
