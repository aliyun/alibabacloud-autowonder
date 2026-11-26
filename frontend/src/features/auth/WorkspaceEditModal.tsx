import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { i18n } from '@/shared/i18n';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef } from 'react';
import { Form, Modal, message } from 'antd';
import { ApiError, ErrorCodes } from '@/shared/types/common';
import type { WorkspaceInfo } from '@/shared/types/common';
import { useUpdateWorkspace } from './workspaceLifecycleApi';
import { WorkspaceFormFields, type WorkspaceFormValues } from './WorkspaceFormFields';
import './workspaceLifecycle.css';

interface WorkspaceEditModalProps {
  workspace: WorkspaceInfo | null;
  onClose: () => void;
}

export function WorkspaceEditModal({ workspace, onClose }: WorkspaceEditModalProps) {
  const { t } = useTranslation('auth');
  const [form] = Form.useForm<WorkspaceFormValues>();
  useLocalizedValidation(form, workspace !== null);
  const { mutateAsync, isPending } = useUpdateWorkspace();
  const submitting = useRef(false);

  // Refetching the same id must not replace an in-progress draft.
  useEffect(() => {
    if (!workspace) return;
    form.setFieldsValue({ name: workspace.name, description: workspace.description ?? '', background: workspace.background ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  const handleSubmit = async () => {
    if (!workspace || submitting.current) return;
    submitting.current = true;
    try {
      let values: WorkspaceFormValues;
      try {
        values = await form.validateFields();
      } catch {
        return;
      }
      await mutateAsync({ id: workspace.id, name: values.name, description: values.description ?? null, background: values.background ?? null, version: workspace.version ?? 0 });
      message.success(i18n.t('auth:workspace.updated'));
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === ErrorCodes.ORG_VERSION_CONFLICT) {
        message.error(i18n.t('auth:workspace.versionConflict'));
        return;
      }
      message.error(e instanceof ApiError ? e.message : i18n.t('auth:workspace.saveFailed'));
    } finally {
      submitting.current = false;
    }
  };

  return <Modal className="ws-modal" width={520} centered styles={{ mask: { backgroundColor: 'rgba(0,0,0,.45)' } }}
    // 原型用原生 dialog，关闭后不把焦点还给「编辑」触发按钮；antd 默认还原会留下 :focus-visible 主题色描边。
    focusTriggerAfterClose={false}
    title={workspace ? t('workspace.editTitle', { name: workspace.name }) : ''}
    open={workspace !== null} okText={t('action.save')} cancelText={t('action.cancel')}
    confirmLoading={isPending} onCancel={() => { if (!submitting.current) onClose(); }} onOk={handleSubmit}
    cancelButtonProps={{ disabled: isPending }} closable={!isPending} maskClosable={!isPending} keyboard={!isPending} destroyOnHidden
  >
    <Form form={form} className="ws-workspace-form" layout="vertical"><WorkspaceFormFields /></Form>
  </Modal>;
}
