import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef } from 'react';
import { Alert, Button, Form, Modal, message, Spin, Tabs } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient, leaveDeletedWorkspace } from '@/shared/api/client';
import { PageHead } from '@/shared/ui/PageHead';
import { PageHeader } from '@/shared/ui/PageHeader';
import { HelpCenterLink } from '@/shared/ui/HelpCenterLink';
import { LanguageSwitch } from '@/shared/i18n/LanguageSwitch';
import { AppearanceSwitch } from '@/shared/theme/AppearanceProvider';
import { NotificationBell } from '@/shared/ui/NotificationBell';
import { UserMenu } from '@/shared/ui/UserMenu';
import { PlatformShell } from '@/shared/ui/PlatformShell';
import { ChiefEntryButton } from '@/app/ChiefEntryButton';
import { ChiefOfStaff } from '@/features/chiefOfStaff/ChiefOfStaff';
import { useAuthStore } from '@/shared/auth/store';
import type { WorkspaceInfo } from '@/shared/types/common';
import { ApiError, ErrorCodes } from '@/shared/types/common';
import { isAuthEntryPath, sanitizeReturnPath } from '@/shared/auth/returnPath';
import type { AdministratorContact } from '@/shared/types/administrator';
import { readAdministratorContacts } from '@/shared/types/administrator';
import { AdministratorContactList } from '@/shared/ui/AdministratorContactList';
import { myWorkspacesQueryKey } from './api';
import { AllWorkspacesTab } from './AllWorkspacesTab';
import { useSwitchWorkspace } from './useSwitchWorkspace';
import { SpaceDashboardPage } from '@/features/spaceDashboard/SpaceDashboardPage';
import { SpaceDashboardForbidden } from '@/features/spaceDashboard/components/SpaceDashboardForbidden';
import { WorkspaceEditModal } from './WorkspaceEditModal';
import { WorkspaceDeleteModal } from './WorkspaceDeleteModal';
import { WorkspaceCard } from './WorkspaceCard';
import { WorkspaceBackgroundModal } from './WorkspaceBackgroundModal';
import { WorkspaceFormFields, type WorkspaceFormValues } from './WorkspaceFormFields';
import './workspaceLifecycle.css';

/** 只恢复站内安全路径；外部地址、协议相对地址与认证入口一律丢弃并回退默认首页。 */
function safeReturnTo(value: string | null): string | null {
  const safe = sanitizeReturnPath(value);
  return safe && !isAuthEntryPath(safe) ? safe : null;
}

export function WorkspaceSelectPage() {
  const { t } = useTranslation('auth');
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editTarget, setEditTarget] = useState<WorkspaceInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceInfo | null>(null);
  const [backgroundTargetId, setBackgroundTargetId] = useState<number | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const targetWorkspaceId = Number(searchParams.get('targetWorkspaceId')) || null;
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const deepLinkAttempted = useRef(false);
  const [deepLinkDenied, setDeepLinkDenied] = useState(false);
  const switchWorkspace = useSwitchWorkspace();
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace);
  const user = useAuthStore((s) => s.user);
  const [form] = Form.useForm<WorkspaceFormValues>();
  useLocalizedValidation(form, showCreateForm);
  const [deniedContacts, setDeniedContacts] = useState<AdministratorContact[] | null>(null);
  const [requesting, setRequesting] = useState(false);
  // 能力查询按当前账号隔离；点击创建卡时重新校验，不使用登录时缓存做最终判断。
  const permissionQuery = useQuery({
    queryKey: ['workspace-creation-permission', user?.id ?? null],
    queryFn: async () => {
      const resp = await apiClient.get<{
        canCreate: boolean;
        pending: boolean;
        administratorContacts: AdministratorContact[] | null;
      }>('/api/workspaces/creation-requests/me');
      return resp.data;
    },
    enabled: user != null,
    retry: false,
  });
  const { data: workspaces, isLoading, refetch } = useQuery({
    queryKey: myWorkspacesQueryKey(user?.id ?? null),
    queryFn: async () => {
      const resp = await apiClient.get<WorkspaceInfo[]>('/api/workspaces/mine');
      return resp.data;
    },
  });
  const backgroundTarget = workspaces?.find(workspace => workspace.id === backgroundTargetId) ?? null;

  // 入口可见性只影响 Tab 是否出现，安全边界在服务端（非管理员调用接口返回 403）。
  const canSeeDashboard = user?.isAdmin === true
    || (workspaces ?? []).some((workspace) => workspace.canManage === true);
  const requestedTab = searchParams.get('tab')
    ?? (location.pathname === '/workspaces/dashboard' ? 'dashboard' : 'mine');
  const knownTab = requestedTab === 'all' || requestedTab === 'dashboard' ? requestedTab : 'mine';
  // 无管理权限却直接访问看板路径时展示无权限空态，不再静默回落到「我的工作空间」。
  const dashboardDenied = knownTab === 'dashboard' && workspaces !== undefined && !canSeeDashboard;
  // 列表未加载完成前先停留在「我的工作空间」，避免无权限判定尚未成立时提前挂载看板请求。
  const activeTab = knownTab === 'dashboard' && workspaces === undefined ? 'mine' : knownTab;

  const handleSwitch = (workspace: WorkspaceInfo, destination: string = '/') =>
    switchWorkspace(workspace, destination);

  // Cross-Workspace deep link: only a Workspace the caller is actually a member of is switched to,
  // and the return route is limited to a sanitized in-site path.
  useEffect(() => {
    if (!targetWorkspaceId || deepLinkAttempted.current || !workspaces) return;
    deepLinkAttempted.current = true;
    const target = workspaces.find((workspace) => workspace.id === targetWorkspaceId);
    if (!target) {
      setDeepLinkDenied(true);
      return;
    }
    handleSwitch(target, returnTo ?? '/').then((switched) => {
      if (!switched) setDeepLinkDenied(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetWorkspaceId, workspaces]);

  const handleCreate = async (values: WorkspaceFormValues) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const resp = await apiClient.post<WorkspaceInfo>('/api/workspaces', values);
      setShowCreateForm(false);
      form.resetFields();
      await refetch();
      await handleSwitch(resp.data);
    } catch (e) {
      // 页面打开后撤权或直接调用接口：服务端拒绝并返回管理员联系方式，展示同款受限弹窗。
      if (e instanceof ApiError && e.code === ErrorCodes.WORKSPACE_CREATION_PERMISSION_DENIED) {
        setShowCreateForm(false);
        setDeniedContacts(readAdministratorContacts(e.data));
        await permissionQuery.refetch();
      } else if (e instanceof ApiError) {
        message.error(e.message);
      } else {
        message.error(t('workspace.createFailed'));
      }
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const handleCreateCard = async () => {
    const { data } = await permissionQuery.refetch();
    if (data?.canCreate) {
      form.resetFields();
      setShowCreateForm(true);
      return;
    }
    // 联系人只在这次显式拒绝探测中下发，普通能力查询不暴露管理员联系方式。
    try {
      const resp = await apiClient.get<{ administratorContacts: AdministratorContact[] | null }>(
        '/api/workspaces/creation-requests/me',
        { params: { includeAdministratorContacts: true } },
      );
      setDeniedContacts(resp.data.administratorContacts ?? []);
    } catch {
      setDeniedContacts([]);
    }
  };

  const handleRequestPermission = async () => {
    if (requesting || permissionQuery.data?.pending) return;
    setRequesting(true);
    try {
      await apiClient.post('/api/workspaces/creation-requests');
      message.success(t('workspace.requestSent'));
      await permissionQuery.refetch();
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : t('workspace.requestFailed'));
    } finally {
      setRequesting(false);
    }
  };

  const requestPermissionLabel = permissionQuery.data?.pending
    ? t('workspace.requested')
    : t('workspace.requestPermission');
  const requestPermissionProps = {
    onClick: handleRequestPermission,
    loading: requesting,
    disabled: permissionQuery.data?.pending,
  };
  const createWorkspaceCard = (
    // 创建弹窗打开时把背后的创建卡从无障碍树中移除，避免与弹窗「创建」按钮重名。
    <div className="ws-new-wrap" aria-hidden={showCreateForm || undefined}>
      <button type="button" data-testid="workspace-create-card"
        className={workspaces?.length === 0 ? 'ws-new ws-new--full' : 'ws-new'}
        onClick={handleCreateCard}
      >
        <AwStrokeIcon name="plus" size={20} />
        <span className="ws-new-title">{t('workspace.create')}</span>
        {permissionQuery.data?.canCreate !== false && (
          <span className="ws-new-desc">{t('workspace.initialize')}</span>
        )}
      </button>
      {permissionQuery.data?.canCreate === false && (
        <button
          type="button"
          className="aw-apply-access-button"
          data-testid="workspace-request-permission"
          onClick={handleRequestPermission}
          disabled={requesting || permissionQuery.data.pending}
          aria-busy={requesting}
        >
          {requesting && <LoadingOutlined aria-hidden="true" style={{ marginInlineEnd: 6 }} />}
          {requestPermissionLabel}
        </button>
      )}
    </div>
  );

  // F6: the access token stays bound to a workspace that AuthFilter now rejects on every
  // workspace-scoped call, so the binding is dropped at the moment of deletion rather than
  // after the first failed request.
  const handleDeleted = (deleted: WorkspaceInfo) => {
    void leaveDeletedWorkspace(deleted.id);
  };

  const handleTabChange = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    if (key === 'dashboard') {
      navigate({ pathname: '/workspaces/dashboard', search: next.toString() });
      return;
    }
    next.set('tab', key);
    navigate({ pathname: '/workspaces', search: next.toString() });
  };

  const minePane = isLoading ? <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div> : (
    <div data-testid="workspace-select-grid" className="ws-grid">
      {workspaces?.map(workspace => <WorkspaceCard key={workspace.id} workspace={workspace}
        current={currentWorkspace?.id === workspace.id}
        onEnter={item => handleSwitch(item, returnTo ?? '/')} onEdit={setEditTarget} onDelete={setDeleteTarget}
        onBackground={item => setBackgroundTargetId(item.id)}
      />)}
      {createWorkspaceCard}
    </div>
  );

  return (
    <PlatformShell fullWidth topbar={<>
      <PageHeader brandTo="/workspaces" actions={<>
        <ChiefEntryButton standalone />
        <HelpCenterLink /><LanguageSwitch /><AppearanceSwitch />
        <NotificationBell fetchUnread={!!currentWorkspace} /><UserMenu />
      </>} />
      <ChiefOfStaff hideLauncher />
    </>}>
      <section className="aw-content-frame">
        <PageHead title={t('workspace.select')} description={t('workspace.selectDesc')}
          actions={<Button icon={<AwStrokeIcon name="palette" />} onClick={() => navigate('/workspaces/branding')}>{t('workspace.platformSettings')}</Button>}
        />
        {deepLinkDenied && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('workspace.deepLinkDenied')} />}
        {dashboardDenied && <SpaceDashboardForbidden />}
        {!dashboardDenied && <Tabs activeKey={activeTab} onChange={handleTabChange}
          tabBarExtraContent={<Button type="text" size="small" className="aw-recycle-bin-entry"
            data-testid="workspace-recycle-bin-entry" aria-label={t('workspace.openRecycleBin')}
            icon={<AwStrokeIcon name="trash" size={13} />} onClick={() => navigate('/workspaces/recycle-bin')}
          >{t('workspace.recycleBin')}</Button>}
          items={[
            { key: 'mine', label: <span className="ws-tab-label"><AwStrokeIcon name="user" size={13} />{t('workspace.mine')}</span>, children: minePane },
            { key: 'all', label: <span className="ws-tab-label"><AwStrokeIcon name="team" size={13} />{t('workspace.all')}</span>, children: <AllWorkspacesTab switchDestination={returnTo ?? '/'} /> },
            ...(canSeeDashboard ? [{ key: 'dashboard', label: <span className="ws-tab-label" data-testid="workspace-dashboard-tab"><AwStrokeIcon name="chart" size={13} />{t('workspace.spaceDashboard')}</span>, children: <SpaceDashboardPage /> }] : []),
          ]}
        />}
        <Modal className="ws-modal" width={520} centered styles={{ mask: { backgroundColor: 'rgba(0,0,0,.45)' } }} title={t('workspace.createTitle')}
          // 原型用原生 dialog，关闭后不把焦点还给「新建」卡片；antd 默认还原会留下 :focus-visible 主题色描边。
          focusTriggerAfterClose={false}
          open={showCreateForm} okText={t('action.create')} cancelText={t('action.cancel')}
          confirmLoading={creating} onOk={() => form.submit()}
          onCancel={() => { if (!creatingRef.current) { setShowCreateForm(false); form.resetFields(); } }}
          cancelButtonProps={{ disabled: creating }} closable={!creating} maskClosable={!creating} keyboard={!creating}
          destroyOnHidden
        >
          <Form form={form} className="ws-workspace-form" onFinish={handleCreate} layout="vertical" preserve={false}>
            <WorkspaceFormFields />
          </Form>
        </Modal>
        <WorkspaceBackgroundModal workspace={backgroundTarget} onClose={() => setBackgroundTargetId(null)} onEdit={setEditTarget} />
        <WorkspaceEditModal workspace={editTarget} onClose={() => setEditTarget(null)} />
        <WorkspaceDeleteModal workspace={deleteTarget} onDeleted={handleDeleted} onClose={() => setDeleteTarget(null)} />
        <Modal
          open={deniedContacts !== null}
          title={t('workspace.createDeniedTitle')}
          closable={false}
          maskClosable={false}
          footer={[
            <Button key="close" onClick={() => setDeniedContacts(null)}>{t('login.pendingOk')}</Button>,
            <Button key="request" type="primary" {...requestPermissionProps}>{requestPermissionLabel}</Button>,
          ]}
        >
          <p>{t('workspace.createDenied')}</p>
          <AdministratorContactList
            contacts={deniedContacts ?? []}
            title={t('contacts.title')}
            emptyText={t('contacts.empty')}
          />
        </Modal>
      </section>
    </PlatformShell>
  );
}
