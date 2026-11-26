import { Form, Input } from 'antd';
import { useTranslation } from 'react-i18next';

export interface WorkspaceFormValues {
  name: string;
  description?: string;
  background?: string;
}

export function WorkspaceFormFields() {
  const { t } = useTranslation('auth');
  return <>
    <Form.Item name="name" label={t('workspace.name')} rules={[
      { required: true, whitespace: true, message: t('workspace.nameRequired') },
      { max: 128, message: t('workspace.nameLength') },
    ]}>
      <Input placeholder={t('workspace.namePlaceholder')} maxLength={128} />
    </Form.Item>
    <Form.Item name="description" label={t('workspace.description')} rules={[{ max: 512, message: t('workspace.descriptionLength') }]}>
      <Input placeholder={t('workspace.descriptionPlaceholder')} maxLength={512} />
    </Form.Item>
    <Form.Item name="background" label={t('workspace.background')}>
      <Input.TextArea placeholder={t('workspace.backgroundPlaceholder')} rows={4} />
    </Form.Item>
  </>;
}
