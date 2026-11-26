import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { useTranslation } from 'react-i18next';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import { Select, Button, Modal, Form, Input, Popconfirm } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { StatusTag } from '@/shared/ui/StatusTag';
import type { StatusTemplate, WorkType } from '../types';

interface Props {
  createOpen: boolean;
  onCloseCreate: () => void;
  templates: StatusTemplate[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreate: (name: string) => void;
  onSetDefault: (id: number) => void;
  onDelete: (id: number) => void;
  workType: WorkType;
}

export function TemplateSelector({ createOpen, onCloseCreate, templates, selectedId, onSelect, onCreate, onSetDefault, onDelete }: Props) {
  const { t } = useTranslation('statemachine');
  const labelOf = useSystemLabel();
  const [form] = Form.useForm();
  useLocalizedValidation(form, createOpen);

  const selected = templates.find((t) => t.id === selectedId);

  const handleCreate = () => {
    form.validateFields().then(({ name }) => {
      onCreate(name);
      onCloseCreate();
      form.resetFields();
    }, () => {});
  };

  return (
    <>
      <div className="aw-stpl-row">
        <span className="aw-stpl-cur">{t('templates.current')}</span>
        <Select
          aria-label={t('templates.current')}
          value={selectedId}
          onChange={onSelect}
          style={{ width: 240 }}
          options={templates.map((template) => {
            const name = labelOf(template.systemLabelKey, template.name);
            return {
              value: template.id,
              label: template.isDefault ? t('templates.defaultOption', { name }) : name,
            };
          })}
        />
        {selected?.isDefault && <StatusTag label={t('templates.default')} colorKey="blue" size="sm" />}
        <div className="aw-stpl-ops">
          {selected && !selected.isDefault && (
            <Button icon={<AwStrokeIcon name="star" />} onClick={() => onSetDefault(selected.id)}>{t('templates.setDefault')}</Button>
          )}
          {selected && !selected.isDefault && (
            <Popconfirm title={t('templates.confirmDelete')} onConfirm={() => onDelete(selected.id)} okText={t('common.delete')} cancelText={t('common.cancel')}>
              <Button danger icon={<AwStrokeIcon name="trash" />}>{t('common.delete')}</Button>
            </Popconfirm>
          )}
        </div>
      </div>

      <Modal closable={{ 'aria-label': t('common.close') }} title={t('actions.createTemplate')} open={createOpen} onOk={handleCreate} onCancel={() => onCloseCreate()} width={420} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('templates.name')} rules={[{ required: true, message: t('templates.nameRequired') }]} extra={t('templates.nameHelp')}>
            <Input placeholder={t('templates.namePlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
