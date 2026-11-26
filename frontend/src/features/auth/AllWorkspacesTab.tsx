import { i18n } from '@/shared/i18n';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Button, Empty, Input, Modal, Pagination, Spin, Typography, message } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient, leaveDeletedWorkspace } from '@/shared/api/client';
import { useAuthStore } from '@/shared/auth/store';
import { ApiError } from '@/shared/types/common';
import type { SwitchWorkspaceResponse, WorkspaceInfo, WorkspaceListItem } from '@/shared/types/common';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { refreshTenantScopedQueries } from '@/features/workitem/queryCache';
import { useAllWorkspaces, useCancelAccessRequest } from './workspaceDiscoveryApi';
import { AccessRequestModal } from './AccessRequestModal';
import { WorkspaceEditModal } from './WorkspaceEditModal';
import { WorkspaceDeleteModal } from './WorkspaceDeleteModal';
import { WorkspaceCard } from './WorkspaceCard';
import { WorkspaceBackgroundModal } from './WorkspaceBackgroundModal';
import './workspaceLifecycle.css';

const { Text } = Typography;
const PAGE_SIZE = 20;
const KEYWORD_DEBOUNCE_MS = 300;

interface AllWorkspacesTabProps {
  /** 切换成功后要恢复的站内目标；由空间选择页传入，缺省落到首页。 */
  switchDestination?: string;
}

export function AllWorkspacesTab({ switchDestination = '/' }: AllWorkspacesTabProps) {
  const { t } = useTranslation('auth');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [modalTargetId, setModalTargetId] = useState<number | null>(null);
  const [switchingId, setSwitchingId] = useState<number | null>(null);
  const debouncedKeyword = useDebouncedValue(keyword, KEYWORD_DEBOUNCE_MS);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setWorkspaceSession = useAuthStore((s) => s.setWorkspaceSession);
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace);
  const switchingRef = useRef<number | null>(null);
  const lastModalTargetRef = useRef<WorkspaceListItem | null>(null);
  const [editTarget, setEditTarget] = useState<WorkspaceInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceInfo | null>(null);
  const [backgroundTargetId, setBackgroundTargetId] = useState<number | null>(null);
  const { data, isLoading, isFetching, isError, refetch } = useAllWorkspaces(debouncedKeyword, page, PAGE_SIZE);
  const workspaces = data?.list ?? [];
  const total = data?.total ?? 0;
  const showFirstLoad = isLoading && !data;
  const refetching = isFetching && Boolean(data);
  const backgroundTarget = workspaces.find(item => item.id === backgroundTargetId
    && (item.membershipStatus === 'MEMBER' || item.canManage === true)) ?? null;

  const liveModalTarget = modalTargetId === null ? null : workspaces.find((item) => item.id === modalTargetId) ?? null;
  const targetChangedStatus = liveModalTarget !== null && liveModalTarget.membershipStatus !== 'NOT_MEMBER';
  // An off-page row is not evidence of a membership change; a live row always wins.
  if (liveModalTarget !== null && liveModalTarget.id === modalTargetId) lastModalTargetRef.current = liveModalTarget;
  if (modalTargetId === null) lastModalTargetRef.current = null;
  const modalTarget = liveModalTarget ?? (lastModalTargetRef.current?.id === modalTargetId ? lastModalTargetRef.current : null);

  useEffect(() => {
    if (targetChangedStatus) {
      setModalTargetId(null);
      message.info(i18n.t('auth:workspace.membershipChanged'));
    }
  }, [targetChangedStatus, t]);

  const handleKeywordChange = (value: string) => {
    setKeyword(value);
    setPage(1);
  };
  const [cancelTargetId, setCancelTargetId] = useState<number | null>(null);
  const { mutateAsync: cancelMutateAsync, isPending: cancelling } = useCancelAccessRequest();
  const cancelTarget = cancelTargetId === null ? null : workspaces.find((item) => item.id === cancelTargetId) ?? null;

  const handleCancelRequest = async () => {
    const requestId = cancelTarget?.pendingRequestId;
    if (!cancelTarget || requestId == null) {
      setCancelTargetId(null);
      message.info(i18n.t('auth:workspace.requestChanged'));
      return;
    }
    try {
      await cancelMutateAsync({ workspaceId: cancelTarget.id, requestId });
      message.success(i18n.t('auth:workspace.requestCancelled'));
      setCancelTargetId(null);
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : i18n.t('auth:workspace.cancelFailed'));
    }
  };

  const handleSwitch = async (workspace: WorkspaceListItem) => {
    if (switchingRef.current !== null) return;
    switchingRef.current = workspace.id;
    setSwitchingId(workspace.id);
    try {
      const resp = await apiClient.post<SwitchWorkspaceResponse>(`/api/workspaces/${workspace.id}/switch`);
      const { accessToken, accessLevel } = resp.data;
      setWorkspaceSession(accessToken, workspace, accessLevel);
      await refreshTenantScopedQueries(queryClient);
      navigate(switchDestination);
    } catch (e) {
      if (e instanceof ApiError) message.error(e.message);
    } finally {
      switchingRef.current = null;
      setSwitchingId(null);
    }
  };

  const handleDeleted = (workspace: WorkspaceInfo) => {
    // The access token stays bound to a workspace that AuthFilter rejects after the delete,
    // so the binding is dropped immediately.
    void leaveDeletedWorkspace(workspace.id);
  };

  return <div>
    <div className="ws-discovery-toolbar">
      <Input aria-label={t('workspace.search')} placeholder={t('workspace.searchPlaceholder')} allowClear
        value={keyword} onChange={(event) => handleKeywordChange(event.target.value)} style={{ maxWidth: 320 }} />
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: 'var(--aw-muted)' }}>{t('workspace.count', { count: total })}</Text>
        {refetching && <LoadingOutlined data-testid="all-workspaces-refetching" style={{ color: 'var(--aw-accent-text)' }} />}
      </div>
    </div>
    {showFirstLoad ? <div data-testid="all-workspaces-loading" style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
      : isError ? <div data-testid="all-workspaces-error" style={{ textAlign: 'center', padding: 48 }}>
        <Empty description={t('workspace.loadFailed')}>
          <Button type="primary" data-testid="all-workspaces-retry" onClick={() => { void refetch(); }}>
            {t('workspace.retry')}
          </Button>
        </Empty>
      </div>
      : workspaces.length === 0 ? <div data-testid="all-workspaces-empty" className="ws-discovery-empty"><Empty description={debouncedKeyword.trim() ? t('workspace.noMatches', { keyword: debouncedKeyword.trim() }) : t('workspace.empty')} /></div>
      : <div data-testid="all-workspaces-grid" className="ws-grid">
        {workspaces.map(workspace => <WorkspaceCard key={workspace.id} workspace={workspace} discovery
          current={currentWorkspace?.id === workspace.id} switching={switchingId === workspace.id} switchBlocked={switchingId !== null}
          onEnter={handleSwitch} onBackground={item => setBackgroundTargetId(item.id)}
          onApply={item => setModalTargetId(item.id)} onCancelRequest={item => setCancelTargetId(item.id)}
          onEdit={setEditTarget} onDelete={setDeleteTarget}
        />)}
      </div>}
    {total > PAGE_SIZE && <div style={{ marginTop: 20, textAlign: 'right' }}>
      <Pagination current={page} pageSize={PAGE_SIZE} total={total} showSizeChanger={false} onChange={setPage} />
    </div>}
    <AccessRequestModal workspace={modalTarget} onClose={() => setModalTargetId(null)} />
    <WorkspaceBackgroundModal workspace={backgroundTarget} onClose={() => setBackgroundTargetId(null)} onEdit={setEditTarget} />
    <WorkspaceEditModal workspace={editTarget} onClose={() => setEditTarget(null)} />
    <WorkspaceDeleteModal workspace={deleteTarget} onDeleted={handleDeleted} onClose={() => setDeleteTarget(null)} />
    <Modal title={t('workspace.withdraw')} open={cancelTarget !== null} okText={t('workspace.confirmWithdraw')}
      // 原型用原生 dialog，关闭后不把焦点还给「撤销」触发按钮；antd 默认还原会留下 :focus-visible 主题色描边。
      focusTriggerAfterClose={false}
      cancelText={t('action.back')} okButtonProps={{ danger: true }} confirmLoading={cancelling}
      onCancel={() => setCancelTargetId(null)} onOk={handleCancelRequest} destroyOnHidden
    ><Text>{t('workspace.withdrawDescription', { name: cancelTarget?.name })}</Text></Modal>
  </div>;
}
