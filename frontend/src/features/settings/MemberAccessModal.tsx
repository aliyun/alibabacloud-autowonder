import { workspaceRoleLabel } from './roles';
import { useTranslation } from 'react-i18next';
import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { useEffect, useRef, useState } from 'react';
import { Form, Modal, Select } from 'antd';
import type { MemberVO, WorkspaceRoleVO } from './api';
import './MemberAccessModal.css';

interface MemberAccessForm {
  roleId: number;
  identityTags: string[];
}

interface MemberAccessModalProps {
  open: boolean;
  member: MemberVO | null;
  roles: WorkspaceRoleVO[];
  loading: boolean;
  onClose: () => void;
  onConfirm: (values: MemberAccessForm) => void | Promise<void>;
}

function normalizeTags(tags: string[] | undefined) {
  return Array.from(new Set(
    (tags ?? []).map((tag) => tag.trim()).filter(Boolean),
  ));
}

export function MemberAccessModal({
  open,
  member,
  roles,
  loading,
  onClose,
  onConfirm,
}: MemberAccessModalProps) {
  const { t } = useTranslation('settings');
  const [form] = Form.useForm<MemberAccessForm>();
  const [dirty, setDirty] = useState(false);

  useLocalizedValidation(form, open);
  const seeded = useRef(false);

  useEffect(() => {
    if (open && member) {
      seeded.current = true;
      setDirty(false);
    } else if (open || seeded.current) {
      seeded.current = false;
      setDirty(false);
      form.resetFields();
    }
  }, [form, member, open]);

  const handleOk = async () => {
    let values: MemberAccessForm;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    await onConfirm({
      roleId: values.roleId,
      identityTags: normalizeTags(values.identityTags),
    });
  };

  return (
    <Modal
      className="aw-member-modal"
      closable={{ 'aria-label': t('close') }}
      okButtonProps={{ 'aria-label': t('save'), disabled: !dirty }}
      title={t('editAccessTitle', { name: member ? member.nickname || member.username : '' })}
      width={420}
      open={open}
      okText={t('save')}
      cancelText={t('cancel')}
      confirmLoading={loading}
      onCancel={onClose}
      onOk={handleOk}
      destroyOnHidden
    >
      <Form
        key={member?.userId ?? 'none'}
        form={form}
        layout="vertical"
        preserve={false}
        // 弹窗关闭会销毁表单，store 里的草稿必须一起清掉，否则会给下一位成员回填上一位的值。
        clearOnDestroy
        initialValues={member ? { roleId: member.roleId, identityTags: member.identityTags } : undefined}
        onValuesChange={() => setDirty(true)}
      >
        <Form.Item
          name="roleId"
          label={t('role')}
          extra={t('roleHelp')}
          rules={[{ required: true, message: t('chooseRole') }]}
        >
          <Select aria-label={t('role')} options={roles.map((role) => ({ value: role.id, label: workspaceRoleLabel(role) }))} />
        </Form.Item>
        <Form.Item
          name="identityTags"
          label={t('tags')}
          extra={t('identityTagsHelp')}
          rules={[{
            validator: (_, value: string[] | undefined) => {
              const tags = normalizeTags(value);
              if (tags.length > 8) {
                return Promise.reject(new Error(t('maxTags')));
              }
              if (tags.some((tag) => tag.length > 32)) {
                return Promise.reject(new Error(t('maxTagLength')));
              }
              return Promise.resolve();
            },
          }]}
        >
          <Select
            mode="tags"
            aria-label={t('tags')}
            placeholder={t('tagPlaceholder')}
            tokenSeparators={[',']}
            options={(member?.identityTags ?? []).map((tag) => ({ label: tag, value: tag }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
