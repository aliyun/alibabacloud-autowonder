import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Form, Input, List, Modal, Popconfirm, Select, Tag, Typography } from 'antd';
import { useState } from 'react';
import type { MemoryAcl } from './api';
import { useMemoryAclMutation, useMemoryAcls } from './hooks';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';

const PERMISSION_TAG_COLOR: Record<string, string | undefined> = { READ: undefined, WRITE: 'green', ADMIN: 'blue' };
const SUBJECT_TAG_COLOR: Record<string, string | undefined> = { AGENT: 'purple' };
const ROLE_SUBJECT = 'ROLE';
const ALL_AGENTS_REF = 'ALL_AGENTS';
const AGGREGATE_IDENTITY = new Set(['AGENT', 'SQUAD']);

export function MemoryAclPanel({ storeId, administrator }: { storeId?: number; administrator: boolean }) {
  const { t } = useTranslation('memory');
  const subjectLabels = { USER: t('acl.subjects.USER'), AGENT: t('acl.subjects.AGENT'), SQUAD: t('acl.subjects.SQUAD'), ROLE: t('acl.subjects.ROLE') } as const;
  const permissionLabels = { READ: t('acl.permissions.READ'), WRITE: t('acl.permissions.WRITE'), ADMIN: t('acl.permissions.ADMIN') } as const;
  const { data = [] } = useMemoryAcls(storeId, administrator);
  const { put, remove } = useMemoryAclMutation(storeId);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<MemoryAcl>();
  useLocalizedValidation(form, administrator && open);
  const runWithAccess = useAccessCommand();
  if (!administrator) return <Alert type="info" showIcon message={t('acl.adminOnly')} />;
  const submit = async () => {
    await runWithAccess('ADMIN', t('acl.setCommand'), async () => {
      try {
        await put.mutateAsync(await form.validateFields());
        form.resetFields();
        setOpen(false);
      } catch {
        // 校验失败由表单提示；提交失败保持弹窗打开，由 react-query 记录错误状态。
      }
    });
  };
  const subjectRefLabel = (acl: MemoryAcl) => acl.subjectType === ROLE_SUBJECT && acl.subjectRef === ALL_AGENTS_REF ? t('acl.allAgents')
    : AGGREGATE_IDENTITY.has(acl.subjectType) && !acl.subjectRef.startsWith('#') ? `#${acl.subjectRef}` : acl.subjectRef;
  const subjectLabel = (type: string) => Object.prototype.hasOwnProperty.call(subjectLabels, type) ? subjectLabels[type as keyof typeof subjectLabels] : type;
  const permissionLabel = (permission: string) => Object.prototype.hasOwnProperty.call(permissionLabels, permission) ? permissionLabels[permission as keyof typeof permissionLabels] : permission;
  return <div className="mem-acl-panel">
    <div className="mem-panel-intro">
      <Typography.Text type="secondary" className="mem-panel-hint">{t('acl.hint')}</Typography.Text>
      <Button type="primary" onClick={() => setOpen(true)}>{t('acl.add')}</Button>
    </div>
    <List dataSource={data} locale={{ emptyText: t('acl.empty') }} renderItem={(acl) => <List.Item className="mem-acl-item" actions={acl.id ? [<Popconfirm okText={t('actions.delete')} cancelText={t('actions.cancel')} key="delete" title={t('acl.deleteConfirm')} onConfirm={() => runWithAccess('ADMIN', t('acl.removeCommand'), () => remove.mutate(acl.id!))}><Button danger type="link" className="mem-op-link">{t('actions.delete')}</Button></Popconfirm>] : []}>
      <Tag className="mem-acl-type" color={SUBJECT_TAG_COLOR[acl.subjectType]}>{subjectLabel(acl.subjectType)}</Tag>
      <span className="mem-acl-subject">{subjectRefLabel(acl)}</span>
      <Tag color={PERMISSION_TAG_COLOR[acl.permission]}>{permissionLabel(acl.permission)}</Tag>
    </List.Item>} />
    <Modal width={480} closable={{ 'aria-label': t('actions.close') }} title={t('acl.create')} open={open} onCancel={() => setOpen(false)} onOk={submit} confirmLoading={put.isPending} okText={t('actions.save')} cancelText={t('actions.cancel')}>
      <Form form={form} layout="vertical" initialValues={{ subjectType: 'AGENT', permission: 'READ' }}>
        <Form.Item name="subjectType" label={t('acl.subjectType')} rules={[{ required: true, message: t('validation.subjectType') }]}><Select options={Object.entries(subjectLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Form.Item name="subjectRef" label={t('acl.subjectRef')} extra={t('acl.subjectHelp')} rules={[{ required: true, message: t('validation.subjectRef') }]}><Input placeholder={t('acl.subjectPlaceholder')} /></Form.Item>
        <Form.Item name="permission" label={t('acl.permission')} extra={t('acl.permissionHelp')} rules={[{ required: true, message: t('validation.permission') }]}><Select options={Object.entries(permissionLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
