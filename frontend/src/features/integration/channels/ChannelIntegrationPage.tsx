import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  GROUP_CHAT_PUBLIC_QUERY_KEY,
  IM_SELECTION_QUERY_KEY,
  PLATFORM_IM_CHANNELS_QUERY_KEY,
  getImSelection,
  getPlatformImChannels,
  getPublicGroupChatConfig,
  selectedImProvider,
  type GroupChatPublicConfig,
} from '@/features/platform/brandingApi';
import { Alert, Button, Space, Spin, Tag, Tooltip } from 'antd';
import { EmptyState } from '@/shared/ui/EmptyState';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useAuthStore } from '@/shared/auth/store';
import { CHANNEL_REGISTRY } from './channelRegistry';
import '../Integrations.css';

type RuntimeStatusKey =
  | 'runtimeActive'
  | 'runtimeDraining'
  | 'runtimePaused'
  | 'runtimeDisabled'
  | 'runtimeError'
  | 'platformStatusUnknown';

const STATUS_LABELS: Readonly<Record<string, RuntimeStatusKey>> = {
  ACTIVE: 'runtimeActive',
  DRAINING: 'runtimeDraining',
  PAUSED: 'runtimePaused',
  DISABLED: 'runtimeDisabled',
  ERROR: 'runtimeError',
};

const STATUS_COLORS: Readonly<Record<string, string>> = {
  ACTIVE: 'green',
  DRAINING: 'orange',
  PAUSED: 'gold',
  DISABLED: 'default',
  ERROR: 'red',
};

/**
 * Platform group-chat access lives directly above the list title. It describes only what the
 * platform configuration permits; it is never green by default and never implies every group is
 * confirmed or every message is delivered. When it is not ready the platform rejects new shared
 * bindings, so the page shows the reason and the way to fix it instead of letting the user try.
 */
function PlatformChannelAccess({ config, failed, canConfigure }: {
  config?: GroupChatPublicConfig;
  failed: boolean;
  canConfigure: boolean;
}) {
  const { t } = useTranslation('integration');
  const navigate = useNavigate();
  const labelKey = config ? STATUS_LABELS[config.status] : undefined;
  const label = failed
    ? t('platformStatusLoadFailed')
    : labelKey ? t(labelKey) : t('platformStatusUnknown');
  const color = failed || !config ? 'default' : STATUS_COLORS[config.status] ?? 'default';
  const ready = !failed && Boolean(config?.ready);
  const hint = failed
    ? t('platformAccessLoadFailedHint')
    : !config
      ? t('platformAccessUnknownHint')
      : config.ready
        ? null
        : config.status === 'DISABLED'
          ? t('runtimeDisabledHint')
          : config.status === 'ERROR'
            ? t('runtimeErrorHint')
            : config.status === 'PAUSED'
              ? t('runtimePausedHint')
              : t('platformAccessNotReadyHint');
  const accessHint = hint
    ? [hint, !canConfigure && !failed && config ? t('platformNotReadyContactAdmin') : null].filter(Boolean).join(' ')
    : '';
  return (
    <div className={`integration-access${ready ? '' : ' integration-access--blocked'}`}>
      <div className="integration-access-line">
        <span className="integration-access-label">{t('platformChannelAccess')}</span>
        <Tooltip title={t('platformChannelAccessHint')} trigger={['hover', 'focus']}>
          <Tag color={color} tabIndex={0} style={{ marginInlineEnd: 0 }}>{label}</Tag>
        </Tooltip>
        {config && config.drainingCount > 0 && (
          <Tag color="orange">{t('runtimeDrainingCount', { count: config.drainingCount })}</Tag>
        )}
        {config && config.failedCount > 0 && (
          <Tag color="red">{t('runtimeFailedCount', { count: config.failedCount })}</Tag>
        )}
        {config && config.unknownCount > 0 && (
          <Tag color="gold">{t('runtimeUnknownCount', { count: config.unknownCount })}</Tag>
        )}
      </div>
      {hint && (
        <div className="integration-access-hint">
          <span>{accessHint}</span>
          {canConfigure && (
            <Button type="link" size="small" onClick={() => navigate('/workspaces/branding?tab=notification')}>
              {t('goPlatformConfig')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function ChannelIntegrationPage() {
  const { t } = useTranslation('integration');
  // Only platform administrators can open the notification tab where the shared group bot lives;
  // other members are pointed at their administrator instead of a dead end.
  const isPlatformAdmin = useAuthStore((s) => s.user?.isAdmin === true);
  const channelsQuery = useQuery({ queryKey: PLATFORM_IM_CHANNELS_QUERY_KEY, queryFn: getPlatformImChannels });
  const selectionQuery = useQuery({ queryKey: IM_SELECTION_QUERY_KEY, queryFn: getImSelection });
  const groupConfigQuery = useQuery({
    queryKey: GROUP_CHAT_PUBLIC_QUERY_KEY,
    queryFn: getPublicGroupChatConfig,
    refetchInterval: 15000,
  });
  if (channelsQuery.isLoading) {
    return (
      <div className="integration-loading">
        <Spin />
        <span>{t('loading')}</span>
      </div>
    );
  }
  if (channelsQuery.isError) return <Alert type="error" message={t('channelsFailed')} />;
  // The persisted platform selection is authoritative; the channel list only fills in
  // enabled state and acts as a fallback while the selection request is in flight.
  const activeKey = selectionQuery.data?.provider ?? selectedImProvider(channelsQuery.data ?? []);

  const activeChannels = CHANNEL_REGISTRY.filter((channel) => channel.key === activeKey);
  const activeChannel = activeChannels[0];
  // Only a successful response that says "not ready" blocks creation; an unavailable status
  // request must not silently disable an otherwise valid platform configuration.
  const platformReady = !(groupConfigQuery.isSuccess && !groupConfigQuery.data.ready);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div className="integration-hint">{t('channelsDescription')}</div>
      {/* Runtime state is read from the workspace-visible group-config endpoint so a channel
          that stopped receiving (PAUSED/DRAINING) is visible where members manage bindings. */}
      <PlatformChannelAccess config={groupConfigQuery.data} failed={groupConfigQuery.isError} canConfigure={isPlatformAdmin} />
      {activeChannel?.enabled && activeChannel.Panel ? (
        <activeChannel.Panel platformReady={platformReady} />
      ) : (
        <EmptyState icon={<AwStrokeIcon name="globe" size={20} />} title={t('unavailableChannel')} />
      )}
    </Space>
  );
}
