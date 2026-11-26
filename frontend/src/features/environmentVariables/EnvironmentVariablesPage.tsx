import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { formatDateTime } from '@/shared/i18n/format';
import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import { PageHead } from '@/shared/ui/PageHead';
import { TableCard } from '@/shared/ui/TableCard';
import { EmptyState } from '@/shared/ui/EmptyState';
import { NoticeTip } from '@/shared/ui/NoticeTip';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Typography,
  message} from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import {
  CloseCircleOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useQueryClient } from '@tanstack/react-query';
import {
  createEnvironmentVariable,
  deleteEnvironmentVariable,
  updateEnvironmentVariable,
} from './api';
import { environmentVariablesQueryKey, useEnvironmentVariables } from './hooks';
import { QODER_PAT_PRESETS } from './presets';
import type { QoderPatPreset } from './presets';
import type { CreateEnvironmentVariableInput, EnvironmentVariable } from './types';
import { useAuthStore } from '@/shared/auth/store';
import { ApiError } from '@/shared/types/common';
import './EnvironmentVariablesPage.css';

const { Text } = Typography;

interface VariableFormValues extends CreateEnvironmentVariableInput {
  replaceValue?: boolean;
}

const EMPTY_FORM_VALUES: VariableFormValues = { name: '', value: '', description: '', replaceValue: false };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatDateTime(date, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false });
}

export function EnvironmentVariablesPage() {
  const { t } = useTranslation('environmentVariables');
  const systemLabel = useSystemLabel();
  const workspaceId = useAuthStore((state) => state.currentWorkspace?.id);
  const accessLevel = useAuthStore((state) => state.accessLevel);
  const isAdmin = accessLevel === 'ADMIN';
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useEnvironmentVariables();
  const boundaryGeneration = useRef(0);
  const [savingGeneration, setSavingGeneration] = useState<number>();
  const [deleting, setDeleting] = useState<{ generation: number; id: number }>();
  const [editing, setEditing] = useState<EnvironmentVariable | 'create'>();
  const [presetKey, setPresetKey] = useState<QoderPatPreset['key']>();
  const [descriptionEdited, setDescriptionEdited] = useState(false);
  const [operationError, setOperationError] = useState<{ error: unknown }>();
  const [saveError, setSaveError] = useState<{ error: unknown }>();
  const [form] = Form.useForm<VariableFormValues>();
  useLocalizedValidation(form, Boolean(editing));
  const replaceValue = Form.useWatch('replaceValue', form);
  const preset = QODER_PAT_PRESETS.find((item) => item.key === presetKey);
  const isCreating = editing === 'create';
  const presetNameExists = preset
    ? (query.data ?? []).some((variable) => variable.name.toUpperCase() === preset.name.toUpperCase())
    : false;

  const valueRules = preset ? [
    { required: true, whitespace: true, message: t('patValueRequired') },
    {
      validator: (_: unknown, value: string | undefined) => (
        value && /\s/.test(value.trim())
          ? Promise.reject(new Error(t('patValueWhitespace')))
          : Promise.resolve()
      ),
    },
  ] : undefined;

  useEffect(() => useAuthStore.subscribe((state, previous) => {
    if (state.currentWorkspace?.id !== previous.currentWorkspace?.id
      || state.accessLevel !== previous.accessLevel) {
      boundaryGeneration.current += 1;
    }
  }), []);
  useEffect(() => () => {
    boundaryGeneration.current += 1;
  }, []);

  const showCreate = () => {
    setOperationError(undefined);
    setSaveError(undefined);
    setPresetKey(undefined);
    setDescriptionEdited(false);
    setEditing('create');
    form.setFieldsValue(EMPTY_FORM_VALUES);
  };

  const selectPreset = (next: QoderPatPreset) => {
    setPresetKey(next.key);
    setDescriptionEdited(false);
    form.setFieldsValue({ name: next.name, description: t(next.descriptionKey) });
  };

  const showEdit = (variable: EnvironmentVariable) => {
    setOperationError(undefined);
    setSaveError(undefined);
    setEditing(variable);
    form.setFieldsValue({
      name: variable.name,
      description: variable.description ?? '',
      value: '',
      replaceValue: false,
    });
  };

  // 弹窗内容按需挂载，首帧 setFieldsValue 会早于 Form 注册而丢失；改用 initialValues 回填。
  const initialValues: VariableFormValues = editing && editing !== 'create'
    ? { name: editing.name, description: editing.description ?? '', value: '', replaceValue: false }
    : EMPTY_FORM_VALUES;

  const closeEditor = () => {
    setEditing(undefined);
    setPresetKey(undefined);
    setDescriptionEdited(false);
    setSaveError(undefined);
    form.resetFields();
  };

  useEffect(() => {
    setSavingGeneration(undefined);
    setDeleting(undefined);
    setEditing(undefined);
    setPresetKey(undefined);
    setOperationError(undefined);
    setSaveError(undefined);
    form.setFieldsValue(EMPTY_FORM_VALUES);
  }, [accessLevel, form, workspaceId]);

  const save = async () => {
    const generation = boundaryGeneration.current;
    const formWorkspaceId = workspaceId;
    const stillAuthorizedForFormWorkspace = () => {
      const auth = useAuthStore.getState();
      return generation === boundaryGeneration.current
        && formWorkspaceId !== undefined
        && auth.hasAccess('ADMIN')
        && auth.accessLevel === accessLevel
        && auth.currentWorkspace?.id === formWorkspaceId;
    };
    if (!stillAuthorizedForFormWorkspace()) {
      closeEditor();
      return;
    }
    setSaveError(undefined);
    let values: VariableFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (!stillAuthorizedForFormWorkspace()) {
      return;
    }
    setSavingGeneration(generation);
    try {
      if (editing === 'create') {
        await createEnvironmentVariable({
          name: values.name,
          value: preset ? (values.value ?? '').trim() : values.value ?? '',
          description: values.description,
          // 用户未改写预置说明时才声明来源；改写后按自定义内容保存。
          presetKey: preset && !descriptionEdited ? preset.key : undefined,
        });
        if (!stillAuthorizedForFormWorkspace()) {
          await queryClient.invalidateQueries({ queryKey: environmentVariablesQueryKey(formWorkspaceId), exact: true });
          return;
        }
        await queryClient.invalidateQueries({ queryKey: environmentVariablesQueryKey(formWorkspaceId), exact: true });
        if (!stillAuthorizedForFormWorkspace()) return;
        if (preset) {
          message.open({
            type: 'success',
            content: <Space size={4} wrap>
              <span>{t('createdGoMount')}</span>
              <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => navigate('/agents')}>{t('goMount')}</Button>
            </Space>,
          });
        } else {
          message.success(i18n.t('environmentVariables:created'));
        }
      } else if (editing) {
        const input = values.replaceValue
          ? { name: values.name, description: values.description, updateValue: true, value: values.value ?? '' }
          : { name: values.name, description: values.description, updateValue: false };
        await updateEnvironmentVariable(editing.id, input);
        if (!stillAuthorizedForFormWorkspace()) {
          await queryClient.invalidateQueries({ queryKey: environmentVariablesQueryKey(formWorkspaceId), exact: true });
          return;
        }
        await queryClient.invalidateQueries({ queryKey: environmentVariablesQueryKey(formWorkspaceId), exact: true });
        if (!stillAuthorizedForFormWorkspace()) return;
        message.success(i18n.t('environmentVariables:updated'));
      }
      closeEditor();
    } catch (error) {
      if (stillAuthorizedForFormWorkspace()) {
        setSaveError({ error });
      }
    } finally {
      if (stillAuthorizedForFormWorkspace()) setSavingGeneration(undefined);
    }
  };

  const remove = async (variable: EnvironmentVariable) => {
    const generation = boundaryGeneration.current;
    const deleteWorkspaceId = workspaceId;
    const deleteAccessLevel = accessLevel;
    const isCurrentDelete = () => {
      const auth = useAuthStore.getState();
      return generation === boundaryGeneration.current
        && deleteWorkspaceId !== undefined
        && deleteAccessLevel === 'ADMIN'
        && auth.currentWorkspace?.id === deleteWorkspaceId
        && auth.accessLevel === deleteAccessLevel;
    };
    if (!isCurrentDelete()) return;
    setOperationError(undefined);
    setDeleting({ generation, id: variable.id });
    try {
      await deleteEnvironmentVariable(variable.id);
      if (!isCurrentDelete()) {
        await queryClient.invalidateQueries({ queryKey: environmentVariablesQueryKey(deleteWorkspaceId), exact: true });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: environmentVariablesQueryKey(deleteWorkspaceId), exact: true });
      if (!isCurrentDelete()) return;
      message.success(i18n.t('environmentVariables:deleted'));
    } catch (error) {
      if (isCurrentDelete()) {
        setOperationError({ error });
      }
    } finally {
      if (isCurrentDelete()) setDeleting(undefined);
    }
  };

  const refresh = () => {
    void query.refetch();
  };

  return (
    <>
      <PageHead title={t('title')} description={t('description')} />

      <NoticeTip kind="info" title={t('pagePatHint')} style={{ marginBottom: 12 }} />

      {operationError && <Alert closable={{ closeIcon: <AwStrokeIcon name="x" size={14} />, 'aria-label': t('dismissError') }} type="error" showIcon icon={<CloseCircleOutlined aria-hidden="true" />} message={t('operationFailed')} description={errorMessage(operationError.error, t('deleteFailed'))} style={{ marginBottom: 12 }} onClose={() => setOperationError(undefined)} />}
      {query.isError && <Alert type="error" showIcon icon={<CloseCircleOutlined aria-hidden="true" />} message={t('loadFailed')} description={errorMessage(query.error, t('retryLater'))} style={{ marginBottom: 12 }} />}

      <TableCard flush>
        <div className="env-vars-toolbar">
          <Space size={8}>
            {isAdmin && <Button aria-label={t('add')} type="primary" icon={<AwStrokeIcon name="plus" />} onClick={showCreate}>{t('add')}</Button>}
            <Button aria-label={t('refresh')} icon={<AwStrokeIcon name="refresh" />} loading={query.isFetching} onClick={refresh}>{t('refresh')}</Button>
          </Space>
        </div>
        <Table<EnvironmentVariable>
          rowKey="id"
          size="middle"
          loading={{ spinning: query.isLoading, tip: t('loading') }}
          dataSource={query.data ?? []}
          pagination={false}
          locale={{ emptyText: <EmptyState icon={<AwStrokeIcon name="key" size={30} />} title={t('empty')} /> }}
          scroll={{ x: 920 }}
          columns={[
            { title: t('name'), dataIndex: 'name', align: 'left', width: 210, render: (name: string) => <Text code>{name}</Text> },
            {
              title: t('value'),
              width: 88,
              render: (_, variable) => <Text code>{variable.value}</Text>,
            },
            { title: t('notes'), dataIndex: 'description', align: 'left', ellipsis: true, render: (value: string | null, variable) => {
              const text = value ? systemLabel(variable.descriptionLabelKey, value) : '';
              return text ? <span title={text}>{text}</span> : <Text type="secondary">—</Text>;
            } },
            {
              title: <Tooltip title={t('mountStatusHelp')}><span>{t('mountStatus')}</span></Tooltip>,
              key: 'mountStatus',
              align: 'left',
              width: 150,
              render: (_, variable) => {
                const online = variable.onlineMountCount;
                const draft = variable.draftMountCount;
                if (online === undefined || draft === undefined) return <Text type="secondary">{t('mountUnknown')}</Text>;
                if (online > 0) return <Tag color="success">{t('mountLive', { count: online })}</Tag>;
                if (draft > 0) return <Tag color="warning">{t('mountDraftOnly')}</Tag>;
                return <Text type="secondary">{t('mountNone')}</Text>;
              },
            },
            { title: t('updatedAt'), dataIndex: 'gmtModified', width: 170, render: (value: string) => <span className="env-vars-time">{formatDate(value)}</span> },
            ...(isAdmin ? [{
              title: t('actions'),
              key: 'actions',
              width: 100,
              render: (_: unknown, variable: EnvironmentVariable) => <Space size={4}>
                <Button type="text" size="small" className="aw-op-btn" icon={<AwStrokeIcon name="edit" />} aria-label={t('editNamed', { name: variable.name })} onClick={() => showEdit(variable)} />
                <Popconfirm
                  icon={<AwStrokeIcon name="alert-c" />}
                  title={t('confirmDeleteNamed', { name: variable.name })}
                  description={t('irreversible')}
                  okText={t('confirmDelete')}
                  cancelText={t('cancel')}
                  okButtonProps={{
                    danger: true,
                    loading: deleting?.generation === boundaryGeneration.current && deleting.id === variable.id,
                    'aria-label': t('confirmDelete'),
                  }}
                  onConfirm={() => remove(variable)}
                >
                  <Button danger type="text" size="small" className="aw-op-btn aw-op-btn--del" icon={<AwStrokeIcon name="trash" />} aria-label={t('deleteNamed', { name: variable.name })} />
                </Popconfirm>
              </Space>,
            }] : []),
          ]}
        />
      </TableCard>

      <Modal
        closable={{ closeIcon: <AwStrokeIcon name="x" size={14} />, 'aria-label': t('close') }}
        title={isCreating ? t('add') : t('edit')}
        open={Boolean(editing)}
        width={460}
        rootClassName="env-vars-editor"
        okText={isCreating ? t('create') : t('save')}
        cancelText={t('cancel')}
        confirmLoading={savingGeneration === boundaryGeneration.current}
        okButtonProps={{ 'aria-label': isCreating ? t('create') : t('save') }}
        onOk={() => void save()}
        onCancel={closeEditor}
        destroyOnHidden
      >
        {saveError && <NoticeTip kind="error" title={t('saveFailedTitle')} detail={errorMessage(saveError.error, t('saveFailed'))} style={{ marginBottom: 12 }} />}
        {isCreating && <div className="env-quick-create">
          <div className="env-quick-head">
            <span className="env-quick-title">{t('quickCreate')}</span>
            {preset && <Button type="link" size="small" className="env-quick-reset" onClick={() => setPresetKey(undefined)}>{t('presetResetToCustom')}</Button>}
          </div>
          <div className="env-quick-btns">
            {QODER_PAT_PRESETS.map((item) => <Button key={item.key} size="small" type={presetKey === item.key ? 'primary' : 'default'}
              aria-pressed={presetKey === item.key} onClick={() => selectPreset(item)}>{t(item.labelKey)}</Button>)}
          </div>
          <div className="env-quick-hint">{preset ? t(preset.hintKey) : t('quickCreateHint')}</div>
        </div>}
        <Form key={editing === 'create' ? 'create' : `edit-${editing?.id ?? 'none'}`} form={form} layout="vertical" preserve={false} clearOnDestroy initialValues={initialValues} className="env-vars-form">
          <Form.Item label={t('name')} name="name" extra={preset ? t('presetNameLocked') : t('nameHelp')} rules={[{ required: true, whitespace: true, message: t('nameRequired') }, { pattern: /^[A-Za-z_][A-Za-z0-9_]*$/, message: t('namePattern') }]}>
            <Input autoComplete="off" placeholder={t('namePlaceholder')} maxLength={128} disabled={Boolean(preset)} />
          </Form.Item>
          {preset && presetNameExists && <NoticeTip kind="warning" title={t('presetExistsWarning', { name: preset.name })} style={{ marginBottom: 14 }} />}
          {!isCreating && <Form.Item name="replaceValue" valuePropName="checked">
            <Checkbox>{t('replaceValue')}</Checkbox>
          </Form.Item>}
          {(isCreating || replaceValue) && <Form.Item label={isCreating ? t('value') : t('newValue')} name="value" rules={valueRules}>
            <Input.Password iconRender={(visible) => <Button type="text" htmlType="button" aria-label={visible ? t('hideValue') : t('showValue')}
              icon={visible ? <EyeOutlined aria-hidden="true" /> : <EyeInvisibleOutlined aria-hidden="true" />}
              style={{ padding: 0, width: 16, height: 16 }} />} autoComplete="new-password" placeholder={t('valuePlaceholder')} />
          </Form.Item>}
          {!isCreating && !replaceValue && <NoticeTip className="env-vars-value-alert" kind="info" title={t('unchangedValue')} />}
          <Form.Item label={t('notes')} name="description" rules={[{ max: 512, message: t('descriptionLimit') }]}>
            <Input.TextArea rows={3} placeholder={t('descriptionPlaceholder')} onChange={() => setDescriptionEdited(true)} />
          </Form.Item>
        </Form>
        {preset && <NoticeTip
          kind="info"
          title={t('patGuideTitle')}
          detail={<Space direction="vertical" size={8}>
            <Text>{t('patGuideValue')}</Text>
            <a href={preset.tokenUrl} target="_blank" rel="noopener noreferrer">{t('patGuideOpenLink')}</a>
            <ol style={{ margin: 0, paddingInlineStart: 20 }}>
              <li>{t('patGuideStepToken')}</li>
              <li>{t('patGuideStepMount')}</li>
              <li>{t('patGuideStepPublish')}</li>
              <li>{t('patGuideStepRestart')}</li>
            </ol>
            <Text type="danger">{t('patGuideRisk')}</Text>
          </Space>}
        />}
      </Modal>
    </>
  );
}
