import { Button, Tooltip, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setupStatus } from '@/features/chiefOfStaff/api';
import { ChiefIcon } from '@/features/chiefOfStaff/ChiefIcon';
import { platformAgentIssue, usePlatformAgentStatus } from '@/features/agent/usePlatformAgentStatus';
import { useAuthStore } from '@/shared/auth/store';
import {
  openChiefPanel,
  useChiefPanelOpen,
} from '@/features/workspaceGuide/bridge';

/** 顶部帮助中心左侧的 Chief 机器人入口：打开 Chief；引导由蒙版内的目标提亮定位，不再依赖该入口。 */
export function ChiefEntryButton({ standalone = false }: { standalone?: boolean }) {
  const { t } = useTranslation('workspaceGuide');
  const { t: chiefT } = useTranslation('chiefOfStaff');
  const panelOpen = useChiefPanelOpen();
  const issue = platformAgentIssue(usePlatformAgentStatus().data?.state);
  const [checking, setChecking] = useState(false);
  const pending = useRef<symbol>();
  useEffect(() => () => { pending.current = undefined; }, []);

  const handleClick = async () => {
    if (!standalone) {
      openChiefPanel({ source: 'user' });
      return;
    }
    const { user, currentWorkspace } = useAuthStore.getState();
    if (!user || !currentWorkspace) {
      void message.info(t('entryChooseWorkspace'));
      return;
    }
    if (pending.current) return;
    const request = Symbol();
    pending.current = request;
    setChecking(true);
    const isCurrent = () => {
      const current = useAuthStore.getState();
      return pending.current === request
        && current.user?.id === user.id && current.currentWorkspace?.id === currentWorkspace.id;
    };
    try {
      const setup = await setupStatus();
      if (!isCurrent()) return;
      if (setup.ready) openChiefPanel({ source: 'user', expanded: false });
      else void message.info(t('entrySetupRequired'));
    } catch {
      if (isCurrent()) void message.error(t('entryCheckFailed'));
    } finally {
      if (pending.current === request) {
        pending.current = undefined;
        setChecking(false);
      }
    }
  };

  // 执行器未就绪时把状态挂在 Chief 自己的入口上，不再全站压一条横条。
  const issueLabel = issue
    ? chiefT(issue === 'NOT_CONFIGURED' ? 'statusNotConfigured' : 'statusOffline')
    : null;
  const tooltip = issueLabel ? `${chiefT('name')} · ${issueLabel}` : chiefT('name');

  return <Tooltip title={tooltip} placement="bottom" trigger={['hover', 'focus']}>
    <span className="aw-chief-entry-wrap">
      <Button
        type="text"
        className={`aw-chief-entry${panelOpen ? ' aw-chief-entry-open' : ''}`}
        aria-label={t('entry')}
        icon={<ChiefIcon size={16} monochrome />}
        loading={checking}
        onClick={handleClick}
      />
      {issueLabel && <span className="aw-chief-entry-dot" aria-hidden="true" />}
    </span>
  </Tooltip>;
}
