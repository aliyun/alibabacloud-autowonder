import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { ApiError } from '@/shared/types/common';
import type { SwitchWorkspaceResponse } from '@/shared/types/common';
import { useAuthStore } from '@/shared/auth/store';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { refreshTenantScopedQueries } from '../queryCache';
import type { WorkitemOwningWorkspace } from '../otherWorkspace';
import './OtherWorkspacePrompt.css';

interface OtherWorkspacePromptProps {
  owning: WorkitemOwningWorkspace;
}

function projectMark(name: string) {
  const lead = name.match(/^[A-Z0-9]{1,2}/);
  if (lead) return lead[0];
  return Array.from(name.trim())[0]?.toUpperCase() ?? '·';
}

/** 跨项目工单的交接卡：说明「从哪个项目到哪个项目」后由用户决定；退出路径是返回列表，不渲染成加载失败。 */
export function OtherWorkspacePrompt({ owning }: OtherWorkspacePromptProps) {
  const { t } = useTranslation('workitem');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const setCurrentWorkspace = useAuthStore((s) => s.setCurrentWorkspace);
  const [switching, setSwitching] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const currentName = currentWorkspace?.name?.trim() || t('detail.otherWorkspaceCurrentProject');

  const handleSwitch = async () => {
    if (switching) return;
    setSwitching(true);
    setFailure(null);
    try {
      const resp = await apiClient.post<SwitchWorkspaceResponse>(
        `/api/workspaces/${owning.workspaceId}/switch`,
      );
      setAccessToken(resp.data.accessToken);
      setCurrentWorkspace(
        { id: owning.workspaceId, name: owning.workspaceName, description: '' },
        resp.data.accessLevel,
      );
      // 不导航：URL 与查询参数原样保留，租户域缓存重置后当前详情原地重新拉取
      await refreshTenantScopedQueries(queryClient);
    } catch (e) {
      setFailure(e instanceof ApiError
        ? t('detail.otherWorkspaceFailDetail', { message: e.message })
        : t('detail.otherWorkspaceSwitchFailed'));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <section className="aw-ws-handoff" aria-labelledby="aw-ws-handoff-title">
      <div className="aw-ws-handoff-head">
        <span className="aw-ws-handoff-mark" aria-hidden="true">
          <AwStrokeIcon name="alert-t" size={17} />
        </span>
        <div>
          <h2 className="aw-ws-handoff-title" id="aw-ws-handoff-title">
            {t('detail.otherWorkspaceTitle')}
          </h2>
          <p className="aw-ws-handoff-desc">{t('detail.otherWorkspaceHint')}</p>
        </div>
      </div>

      <div className="aw-ws-handoff-projects">
        <div className="aw-ws-handoff-project is-current">
          <div className="aw-ws-handoff-k">{t('detail.otherWorkspaceCurrentProject')}</div>
          <div className="aw-ws-handoff-v">
            {currentWorkspace?.name?.trim() && (
              <span className="aw-ws-handoff-mk" aria-hidden="true">{projectMark(currentName)}</span>
            )}
            <span className="aw-ws-handoff-nm" title={currentName}>{currentName}</span>
          </div>
        </div>
        <span className="aw-ws-handoff-arrow" aria-hidden="true">
          <AwStrokeIcon name="chev-r" size={13} />
        </span>
        <div className="aw-ws-handoff-project is-target">
          <div className="aw-ws-handoff-k">{t('detail.otherWorkspaceTargetProject')}</div>
          <div className="aw-ws-handoff-v">
            <span className="aw-ws-handoff-mk" aria-hidden="true">{projectMark(owning.workspaceName)}</span>
            <span className="aw-ws-handoff-nm" title={owning.workspaceName}>{owning.workspaceName}</span>
          </div>
        </div>
      </div>

      <p className="aw-ws-handoff-note">{t('detail.otherWorkspaceNote')}</p>

      {failure && (
        <p className="aw-ws-handoff-fail" role="alert">
          <AwStrokeIcon name="alert-c" size={13} />
          <span>{failure}</span>
        </p>
      )}

      <div className="aw-ws-handoff-actions">
        <Button
          type="primary"
          className="aw-ws-handoff-primary"
          loading={switching}
          onClick={handleSwitch}
        >
          {switching
            ? t('detail.otherWorkspaceSwitching')
            : failure
              ? t('detail.otherWorkspaceRetry')
              : t('detail.otherWorkspaceSwitch', { name: owning.workspaceName })}
        </Button>
        <Button disabled={switching} onClick={() => navigate('/workitems')}>
          {t('detail.otherWorkspaceBackToList')}
        </Button>
      </div>
    </section>
  );
}
