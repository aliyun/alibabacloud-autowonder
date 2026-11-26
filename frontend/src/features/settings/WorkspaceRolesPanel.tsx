import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Form, Input, Modal, Popconfirm, Segmented, Tooltip } from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import { formatNumber } from '@/shared/i18n/format';
import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { workspaceDomainLabel } from '@/shared/auth/access';
import type { WorkspaceDomain } from '@/shared/types/common';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { NoticeTip } from '@/shared/ui/NoticeTip';
import { StatusTag } from '@/shared/ui/StatusTag';
import { Toolbar } from '@/shared/ui/Toolbar';
import type { WorkspaceRoleRequest, WorkspaceRoleVO } from './api';
import { useDeleteWorkspaceRole, useSaveWorkspaceRole, useWorkspaceRoles } from './hooks';
import { CONFIGURABLE_DOMAINS, ReadOnlyFeatures, type ConfigurableDomain } from './ReadOnlyFeatures';
import { workspaceRoleLabel } from './roles';
import './WorkspaceRolesPanel.css';

type RoleMode = 'ALL_WRITE' | 'ALL_READ' | 'CUSTOM';

const CHIP_LIMIT = 3;

function configurableDomains(domains: WorkspaceDomain[]): WorkspaceDomain[] {
  return domains.filter((domain) => CONFIGURABLE_DOMAINS.includes(domain as ConfigurableDomain));
}

function roleModeOf(domains: WorkspaceDomain[]): RoleMode {
  if (domains.length === 0) return 'ALL_WRITE';
  if (domains.length === CONFIGURABLE_DOMAINS.length) return 'ALL_READ';
  return 'CUSTOM';
}

export function WorkspaceRolesPanel({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation('settings');
  const { data: roles = [], isLoading } = useWorkspaceRoles();
  const save = useSaveWorkspaceRole();
  const remove = useDeleteWorkspaceRole();
  const accessCommand = useAccessCommand();
  const [editing, setEditing] = useState<WorkspaceRoleVO | null | undefined>(undefined);
  const [readOnlyDomains, setReadOnlyDomains] = useState<WorkspaceDomain[]>([]);
  const [mode, setMode] = useState<RoleMode>('ALL_WRITE');
  const [form] = Form.useForm<WorkspaceRoleRequest>();
  const open = editing !== undefined;
  const canEdit = (role: WorkspaceRoleVO | null | undefined) => isAdmin && (!role?.builtIn || role.code === 'READ_WRITE');
  const viewOnly = !canEdit(editing);
  const builtInViewOnly = Boolean(editing?.builtIn) && !editing?.administrator && viewOnly;
  useLocalizedValidation(form, open);

  const openEditor = (role: WorkspaceRoleVO | null) => {
    const domains = configurableDomains(role?.readOnlyDomains ?? []);
    setReadOnlyDomains(domains);
    setMode(roleModeOf(domains));
    setEditing(role);
  };
  const handleModeChange = (next: RoleMode) => {
    setMode(next);
    if (next === 'ALL_WRITE') setReadOnlyDomains([]);
    if (next === 'ALL_READ') setReadOnlyDomains([...CONFIGURABLE_DOMAINS]);
  };
  const handleDomainsChange = (next: WorkspaceDomain[]) => {
    setReadOnlyDomains(next);
    setMode(roleModeOf(next));
  };
  const handleSave = async () => {
    let request: WorkspaceRoleRequest;
    try { request = await form.validateFields(); } catch { return; }
    await accessCommand('ADMIN', t('saveRole'), async () => {
      try {
        await save.mutateAsync({
          id: editing?.id,
          request: {
            ...request,
            name: editing?.builtIn ? undefined : request.name?.trim(),
            readOnlyDomains,
            version: editing?.version,
          },
        });
        setEditing(undefined);
      } catch { /* The mutation displays the error and preserves the draft. */ }
    });
  };

  const modeLabel = (role: WorkspaceRoleVO) => {
    if (role.administrator) return t('allPermissions');
    const readOnly = configurableDomains(role.readOnlyDomains);
    if (readOnly.length === 0) return t('roleModeAllWrite');
    if (readOnly.length === CONFIGURABLE_DOMAINS.length) return t('roleModeAllRead');
    return t('roleModeCustom');
  };
  const totalMembers = roles.reduce((sum, role) => sum + role.memberCount, 0);
  const modeOptions = [
    { label: t('roleModeAllWrite'), value: 'ALL_WRITE' as const },
    { label: t('roleModeAllRead'), value: 'ALL_READ' as const },
    { label: t('roleModeCustom'), value: 'CUSTOM' as const },
  ];
  const footerSummary = `${t('roleCount', { count: roles.length })} · ${t('roleFooterMembers', { count: totalMembers, formatted: formatNumber(totalMembers) })}；${t('rolesFooterHint')}`;
  const roleModalTitle = editing ? `${viewOnly ? t('viewRole') : t('editRole')} · ${workspaceRoleLabel(editing)}` : t('createRole');

  return <>
    <Toolbar
      left={<span className="aw-roles-hint">{t('rolesHint')}</span>}
      right={<Button type="primary" icon={<AwStrokeIcon name="plus" />} disabled={!isAdmin}
        onClick={() => accessCommand('ADMIN', t('createRole'), () => openEditor(null))}>{t('createRole')}</Button>}
    />
    <Table<WorkspaceRoleVO>
      rowKey="id" dataSource={roles} loading={isLoading} pagination={false} scroll={{ x: 880 }}
      columns={[
        {
          title: t('role'),
          key: 'name',
          width: 220,
          render: (_, role) => <div className="aw-role-cell">
            <span className={role.administrator ? 'aw-role-mark is-admin' : role.builtIn ? 'aw-role-mark' : 'aw-role-mark is-custom'}>
              <AwStrokeIcon name={role.administrator ? 'crown' : role.builtIn ? 'shield' : 'team'} size={14} />
            </span>
            <span className="aw-role-text">
              <span className="aw-role-name">{workspaceRoleLabel(role)}</span>
              <span className="aw-role-source">{role.builtIn ? t('roleSourceBuiltIn') : t('roleSourceCustom')}</span>
            </span>
          </div>,
        },
        {
          title: t('readOnlyDomains'),
          key: 'permissions',
          render: (_, role) => {
            const readOnly = configurableDomains(role.readOnlyDomains);
            const custom = readOnly.length > 0 && readOnly.length < CONFIGURABLE_DOMAINS.length;
            const shown = custom ? readOnly.slice(0, CHIP_LIMIT) : [];
            const rest = custom ? readOnly.slice(CHIP_LIMIT) : [];
            return <div className="aw-role-perm-line">
              <StatusTag
                size="sm"
                dot={role.administrator}
                colorKey={role.administrator ? 'green' : readOnly.length === CONFIGURABLE_DOMAINS.length ? 'gray' : 'plain'}
                label={modeLabel(role)}
              />
              {shown.map((domain) => <StatusTag key={domain} size="sm" colorKey="gray" label={workspaceDomainLabel(domain)} />)}
              {rest.length > 0 && <Tooltip title={rest.map(workspaceDomainLabel).join(t('listSeparator'))}>
                <span className="aw-role-chip-more">{t('roleChipMore', { count: rest.length })}</span>
              </Tooltip>}
            </div>;
          },
        },
        {
          title: t('assignedMembers'),
          dataIndex: 'memberCount',
          width: 110,
          render: (count: number) => <span className="aw-role-members">{t('roleMemberCount', { count, formatted: formatNumber(count) })}</span>,
        },
        {
          title: t('actions'),
          key: 'actions',
          width: 150,
          render: (_, role) => <div className="aw-role-ops">
            <Button type="link" size="small"
              onClick={() => canEdit(role)
                ? accessCommand('ADMIN', t('editRole'), () => openEditor(role))
                : openEditor(role)}>
              {canEdit(role) ? t('editPermissions') : t('viewPermissions')}
            </Button>
            {!role.builtIn && (role.memberCount > 0
              ? <Tooltip title={t('deleteRoleBlocked', { count: role.memberCount })}>
                <span><Button type="link" size="small" danger disabled>{t('deleteRole')}</Button></span>
              </Tooltip>
              : <Popconfirm title={t('deleteRoleConfirm', { name: workspaceRoleLabel(role) })}
                onConfirm={() => accessCommand('ADMIN', t('deleteRole'), () => remove.mutateAsync({ id: role.id, version: role.version }))}>
                <Button type="link" size="small" danger disabled={!isAdmin} loading={remove.isPending}>{t('deleteRole')}</Button>
              </Popconfirm>)}
          </div>,
        },
      ]}
    />
    <div className="aw-roles-footer">{footerSummary}</div>
    <Modal open={open} title={roleModalTitle}
      className="aw-role-modal" width={720} destroyOnHidden
      closable={{ 'aria-label': t('close') }} onCancel={() => setEditing(undefined)}
      onOk={handleSave} okText={t('saveRole')} cancelText={t('cancel')} confirmLoading={save.isPending}
      footer={viewOnly ? [<Button key="close" onClick={() => setEditing(undefined)}>{t('close')}</Button>] : undefined}>
      <Form key={editing?.id ?? 'new'} form={form} layout="vertical" preserve={false} disabled={viewOnly}
        initialValues={{ name: editing?.builtIn ? undefined : editing ? workspaceRoleLabel(editing) : '' }}>
        <div className="aw-role-form-row">
          <Form.Item label={t('roleName')} extra={t('roleNameHelp')}
            rules={editing?.builtIn ? undefined : [{ required: true, whitespace: true, message: t('roleNameRequired') }, { max: 80, message: t('roleNameLength') }]}
            name={editing?.builtIn ? undefined : 'name'}>
            {editing?.builtIn
              ? <Input value={workspaceRoleLabel(editing)} disabled aria-label={t('roleName')} />
              : <Input maxLength={80} aria-label={t('roleName')} />}
          </Form.Item>
          {!editing?.administrator && <Form.Item className="aw-role-mode-item" label={t('roleMode')} extra={t('roleModeHelp')}>
            <Segmented aria-label={t('roleMode')} options={modeOptions} value={mode} disabled={viewOnly}
              onChange={(value) => handleModeChange(value as RoleMode)} />
          </Form.Item>}
        </div>
        {builtInViewOnly && <NoticeTip kind="info" className="aw-role-notice" title={t('readOnlyRoleNotice')} />}
        {editing?.administrator
          ? <NoticeTip kind="info" title={t('allPermissions')} detail={t('adminPermissionHint')} />
          : <ReadOnlyFeatures value={readOnlyDomains} onChange={handleDomainsChange} disabled={viewOnly} />}
      </Form>
      {!editing?.administrator && <div className="aw-role-summary">
        {t('roleSummary', { readOnly: readOnlyDomains.length, readWrite: CONFIGURABLE_DOMAINS.length - readOnlyDomains.length })}
      </div>}
    </Modal>
  </>;
}
