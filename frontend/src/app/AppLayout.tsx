import { useTranslation } from 'react-i18next';
import { ChiefOfStaff } from '@/features/chiefOfStaff/ChiefOfStaff';
import { LanguageSwitch } from '@/shared/i18n/LanguageSwitch';
import { PlatformBrand } from '@/shared/ui/PlatformBrand';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Dropdown, Typography, Button, message } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckOutlined, LoadingOutlined } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { AppearanceSwitch } from '@/shared/theme/AppearanceProvider';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import { Sidebar } from './Sidebar';
import { NotificationBell } from '@/shared/ui/NotificationBell';
import { NotificationReminderHost } from '@/features/notification/NotificationReminderHost';
import { PageHeader } from '@/shared/ui/PageHeader';
import { UserMenu } from '@/shared/ui/UserMenu';
import { HelpCenterLink } from '@/shared/ui/HelpCenterLink';
import { ChiefEntryButton } from './ChiefEntryButton';
import { WorkspaceGuideHost } from '@/features/workspaceGuide/WorkspaceGuideHost';
import { useAuthStore } from '@/shared/auth/store';
import { refreshCurrentMembership } from '@/shared/auth/refreshCurrentMembership';
import { myWorkspacesQueryKey } from '@/features/auth/api';
import { apiClient } from '@/shared/api/client';
import type { WorkspaceInfo, SwitchWorkspaceResponse } from '@/shared/types/common';
import { ApiError } from '@/shared/types/common';
import { refreshTenantScopedQueries } from '@/features/workitem/queryCache';

const { Text } = Typography;

const SIDEBAR_COLLAPSED_KEY = 'autowonder.sidebar.collapsed';

/** ≤1080 轨道强制收起为图标轨道（56）；设置面板仍在设置时内联，更窄再由 Sidebar 切浮层。 */
const COMPACT_NAV_QUERY = '(max-width: 1080px)';

function subscribeCompactNav(callback: () => void) {
  if (typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const query = window.matchMedia(COMPACT_NAV_QUERY);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

function getCompactNavSnapshot() {
  return typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_NAV_QUERY).matches;
}

function useCompactNav() {
  return useSyncExternalStore(subscribeCompactNav, getCompactNavSnapshot, () => false);
}

const DESIGN_ROUTE = /^\/workitems\/[1-9]\d*\/design\/?$/;
// 原型 05 工单详情 / 12 定时任务运行详情 / 43 个人工作台 / 14 SDLC 详情自带整页画布（内部按块分块）；
// 数据洞察由多个自带边框的 panel 组成，外层不再套全局页框（2026-11-21 用户要求去掉最外层框）。
const FRAMELESS_ROUTES = [
  /^\/workitems\/[1-9]\d*\/?$/, DESIGN_ROUTE, /^\/scheduled-task-runs\/[1-9]\d*\/?$/, /^\/scheduled-tasks\/[1-9]\d*\/?$/,
  /^\/workbench\/?$/, /^\/sdlcs\/[1-9]\d*\/?$/, /^\/insights\/?$/, /^\/profile\/settings\/?$/,
  // 设置中心自带二级导航与画布，外层不再套 .aw-content-frame。
  /^\/settings(?:\/|$)/,
  /^\/agents\/?$/, /^\/agents\/new\/?$/, /^\/agents\/reviews\/?$/,
  /^\/executors\/?$/, /^\/squads\/?$/, /^\/repos\/?$/, /^\/memories\/?$/, /^\/skills\/?$/,
  /^\/sdlcs\/?$/, /^\/sdlcs\/generate\/?$/,
  /^\/status-templates\/?$/, /^\/integrations\/?$/, /^\/audit-logs\/?$/,
];

function readCollapsedPref(): boolean {
  try {
    // 34j：默认展开轨道；仅显式收起过（'1'）才保持收起。
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsedPref(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function getWorkspaceDeepLinkId(search: string): number | null {
  const value = new URLSearchParams(search).get('workspaceId');
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function removeWorkspaceDeepLink(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('workspaceId');
  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : '';
}

export function AppLayout({ helpCenter = false }: { helpCenter?: boolean }) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace);
  const setWorkspaceSession = useAuthStore((s) => s.setWorkspaceSession);

  const designWorkbench = DESIGN_ROUTE.test(location.pathname);
  const [navigationCollapsed, setCollapsed] = useState<boolean>(readCollapsedPref);
  const [designNavigationCollapsed, setDesignNavigationCollapsed] = useState(true);
  const collapsed = designWorkbench ? designNavigationCollapsed : navigationCollapsed;
  const compactNav = useCompactNav();
  const effectiveCollapsed = collapsed || compactNav;
  useEffect(() => { if (designWorkbench) setDesignNavigationCollapsed(true); }, [designWorkbench]);

  useEffect(() => {
    if (helpCenter) return;
    const refresh = () => {
      void refreshCurrentMembership();
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [helpCenter]);

  const { data: workspaces } = useQuery({
    queryKey: myWorkspacesQueryKey(user?.id ?? null),
    enabled: !helpCenter,
    queryFn: async () => {
      const resp = await apiClient.get<WorkspaceInfo[]>('/api/workspaces/mine');
      return resp.data;
    },
  });
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<number | null>(null);
  const switchingRef = useRef<number | null>(null);

  const handleWorkspaceSwitch = useCallback(async (workspace: WorkspaceInfo) => {
    if (workspace.id === currentWorkspace?.id || switchingRef.current === workspace.id) return;
    switchingRef.current = workspace.id;
    setSwitchingWorkspaceId(workspace.id);
    try {
      const resp = await apiClient.post<SwitchWorkspaceResponse>(`/api/workspaces/${workspace.id}/switch`);
      setWorkspaceSession(resp.data.accessToken, workspace, resp.data.accessLevel);
      await refreshTenantScopedQueries(queryClient);
      message.success(t('workspace.switched', { name: workspace.name }));
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : t('workspace.switchFailed'));
    } finally {
      switchingRef.current = null;
      setSwitchingWorkspaceId(null);
    }
  }, [currentWorkspace?.id, setWorkspaceSession, queryClient, t]);

  useEffect(() => {
    if (helpCenter) return;
    const targetWorkspaceId = getWorkspaceDeepLinkId(location.search);
    if (!targetWorkspaceId) {
      return;
    }
    const cleanPath = `${location.pathname}${removeWorkspaceDeepLink(location.search)}${location.hash}`;
    if (currentWorkspace?.id === targetWorkspaceId) {
      navigate(cleanPath, { replace: true });
      return;
    }
    let cancelled = false;
    async function switchToLinkedWorkspace() {
      try {
        const workspacesResp = await apiClient.get<WorkspaceInfo[]>('/api/workspaces/mine');
        if (cancelled) {
          return;
        }
        const targetWorkspace = workspacesResp.data.find((workspace) => workspace.id === targetWorkspaceId);
        if (!targetWorkspace) {
          message.error(t('workspace.notMember'));
          return;
        }
        const switchResp = await apiClient.post<SwitchWorkspaceResponse>(`/api/workspaces/${targetWorkspaceId}/switch`);
        if (cancelled) {
          return;
        }
        setWorkspaceSession(switchResp.data.accessToken, targetWorkspace, switchResp.data.accessLevel);
        await refreshTenantScopedQueries(queryClient);
        navigate(cleanPath, { replace: true });
      } catch {
        if (!cancelled) {
          message.error(t('workspace.linkedSwitchFailed'));
        }
      }
    }
    void switchToLinkedWorkspace();
    return () => {
      cancelled = true;
    };
  }, [
    t,
    helpCenter,
    currentWorkspace?.id,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    queryClient,
    setWorkspaceSession,
  ]);

  const toggleCollapsed = () => {
    if (designWorkbench) {
      setDesignNavigationCollapsed((previous) => !previous);
      return;
    }
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsedPref(next);
      return next;
    });
  };

  const siderClassName = ['aw-sider', effectiveCollapsed ? 'collapsed' : ''].filter(Boolean).join(' ');

  const workspaceMenuItems = [
    ...(workspaces || []).map((workspace) => ({
      key: `workspace-${workspace.id}`,
      label: (
        <EllipsisText tooltip={workspace.name}>
          {workspace.name}
        </EllipsisText>
      ),
      icon: workspace.id === currentWorkspace?.id
        ? (workspace.id === switchingWorkspaceId ? <LoadingOutlined /> : <CheckOutlined style={{ color: 'var(--aw-accent-text)' }} />)
        : (workspace.id === switchingWorkspaceId ? <LoadingOutlined /> : undefined),
      disabled: workspace.id === switchingWorkspaceId,
      onClick: () => { void handleWorkspaceSwitch(workspace); },
    })),
    { type: 'divider' as const },
    { key: 'manage-workspaces', label: t('workspace.manage'), onClick: () => navigate('/workspaces') },
  ];

  const workspaceName = currentWorkspace?.name || t('workspace.unselected');

  return (
    <div className={helpCenter ? 'aw-shell help-layout' : 'aw-shell'}>
      {!helpCenter && (
        <aside className={siderClassName}>
          <div className="aw-brand">
            <PlatformBrand to="/workbench" collapsed={effectiveCollapsed} />
          </div>

          <Sidebar
            collapsed={effectiveCollapsed}
            onToggleCollapsed={toggleCollapsed}
            workspaceSwitcher={(
              <Dropdown menu={{ items: workspaceMenuItems }} trigger={['click']} placement="bottomLeft"
                overlayClassName="aw-workspace-menu" overlayStyle={{ width: 196, minWidth: 196, maxWidth: 196 }}>
                <button type="button" className="aw-ws-switch" title={effectiveCollapsed ? workspaceName : undefined}>
                  <span className="aw-initial-mark" aria-hidden="true">{workspaceName[0]}</span>
                  <span className="aw-ws-name">
                    <EllipsisText tooltip={workspaceName} style={{ fontSize: 12, color: 'var(--aw-text-2)' }}>
                      {workspaceName}
                    </EllipsisText>
                  </span>
                  <AwStrokeIcon name="chev-d" size={12} className="aw-ws-caret" />
                </button>
              </Dropdown>
            )}
          />
        </aside>
      )}

      <div className="aw-main">
        <PageHeader actions={<>
            {user && (helpCenter || currentWorkspace) && <ChiefEntryButton standalone={helpCenter} />}
            {!helpCenter && <HelpCenterLink />}
            <LanguageSwitch />
            <AppearanceSwitch />
            {(!helpCenter || user) && <NotificationBell fetchUnread={!helpCenter} />}
            {helpCenter && !user ? <Button href="/login">{t('account.login')}</Button> : <UserMenu />}
          </>}>
          {helpCenter && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, overflow: 'hidden' }}>
              <PlatformBrand to="/workitems" />
              <Text type="secondary" style={{ marginLeft: 12 }}>{t('navigation.help')}</Text>
            </div>
          )}
        </PageHeader>
        {user && <ChiefOfStaff hideLauncher={helpCenter} />}
        {!helpCenter && user && currentWorkspace && <WorkspaceGuideHost />}
        <main
          className={helpCenter ? 'aw-content help-content' : designWorkbench ? 'aw-content aw-design-content' : 'aw-content'}
          style={helpCenter ? { padding: 0, overflow: 'hidden' } : undefined}
        >
          {helpCenter || FRAMELESS_ROUTES.some((pattern) => pattern.test(location.pathname))
            ? <Outlet />
            : <section className="aw-content-frame" aria-label={t('navigation.content')}><Outlet /></section>}
        </main>
      </div>
      {/* 已登录且有当前空间时挂唯一提醒宿主；身份变化由宿主自行重建隔离状态。 */}
      {!helpCenter && user && currentWorkspace && <NotificationReminderHost />}
    </div>
  );
}
