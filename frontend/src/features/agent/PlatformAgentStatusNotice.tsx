import { useTranslation } from 'react-i18next';
import { NoticeTip } from '@/shared/ui/NoticeTip';
import { platformAgentIssue, usePlatformAgentStatus } from './usePlatformAgentStatus';

/**
 * 执行器页的页内提示：只在能修复它的页面出现。
 * 其它入口用 Chief 角标承载同一状态，不再全站常驻横条。
 */
export function PlatformAgentStatusNotice() {
  const { t } = useTranslation('shell');
  const { data } = usePlatformAgentStatus();
  const issue = platformAgentIssue(data?.state);
  if (!issue) return null;
  return (
    <NoticeTip
      kind="warning"
      style={{ marginBottom: 16 }}
      title={t(issue === 'NOT_CONFIGURED' ? 'banner.notConfigured' : 'banner.offline')}
      detail={t(issue === 'NOT_CONFIGURED' ? 'banner.notConfiguredHint' : 'banner.offlineHint')}
    />
  );
}
