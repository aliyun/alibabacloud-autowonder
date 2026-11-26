import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { Button, Popconfirm, Space, Spin, Tag, message } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { NoticeTip } from '@/shared/ui/NoticeTip';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SSO_PROVIDERS_QUERY_KEY, fetchSsoProviders } from '@/features/auth/ssoApi';
import {
  USER_FEDERATED_IDENTITIES_QUERY_KEY,
  listMyFederatedIdentities,
  startFederatedBinding,
  unbindFederatedIdentity,
} from './federatedApi';

function getApiMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function redirectToAuthorizeUrl(url: string) {
  try {
    window.location.href = url;
  } catch {
    // jsdom 不执行整页跳转；浏览器路径才是真实行为。
  }
}

export function FederatedIdentitiesPanel() {
  const { t } = useTranslation('profile');
  const queryClient = useQueryClient();
  const identitiesQuery = useQuery({
    queryKey: USER_FEDERATED_IDENTITIES_QUERY_KEY,
    queryFn: listMyFederatedIdentities,
    retry: false,
  });
  const providersQuery = useQuery({
    queryKey: SSO_PROVIDERS_QUERY_KEY,
    queryFn: fetchSsoProviders,
    retry: false,
  });

  const identities = identitiesQuery.data ?? [];
  const boundProviderIds = new Set(identities.map((identity) => identity.providerId));
  const bindableProviders = (providersQuery.data ?? []).filter((provider) => !boundProviderIds.has(provider.providerId));

  const bindMutation = useMutation({
    mutationFn: (providerId: number) => startFederatedBinding(providerId),
    onSuccess: (authorizeUrl) => {
      redirectToAuthorizeUrl(authorizeUrl);
    },
    onError: (error) => {
      message.error(getApiMessage(error, i18n.t('profile:federated.bindFailed')));
    },
  });

  const unbindMutation = useMutation({
    mutationFn: (identityId: number) => unbindFederatedIdentity(identityId),
    onSuccess: async () => {
      message.success(i18n.t('profile:federated.unbound'));
      await queryClient.invalidateQueries({ queryKey: USER_FEDERATED_IDENTITIES_QUERY_KEY });
    },
    onError: (error) => {
      message.error(getApiMessage(error, i18n.t('profile:federated.unbindFailed')));
    },
  });

  // 抽成具名函数而非内联在 onConfirm 上，是为了符合 accessSourceGuard 对确认类变更的扫描约定。
  // 企业身份绑定是登录用户私有数据（/api/users/me 面），不经工作区访问阶梯。
  const handleUnbind = (identityId: number) => unbindMutation.mutate(identityId);

  const renderBody = () => {
    if (identitiesQuery.isError) {
      return (
        <NoticeTip
          kind="error"
          title={t('federated.loadFailed')}
          detail={getApiMessage(identitiesQuery.error, t('retryLater'))}
          action={<Button size="small" onClick={() => identitiesQuery.refetch()}>{t('retry')}</Button>}
        />
      );
    }
    if (identitiesQuery.isLoading) {
      return <Spin size="small" />;
    }
    if (identities.length === 0) {
      return (
        <div className="prof-empty" data-testid="federated-empty">
          <span className="prof-empty-icon" aria-hidden="true"><AwStrokeIcon name="link" size={20} /></span>
          <div className="prof-empty-title">{t('federated.empty')}</div>
          <div className="prof-empty-sub">{t('federated.emptySub')}</div>
          {bindableProviders.length > 0 && (
            <div className="prof-bind-row">
              {bindableProviders.map((provider) => (
                <Button
                  key={provider.providerId}
                  data-testid={`federated-bind-${provider.providerId}`}
                  loading={bindMutation.isPending && bindMutation.variables === provider.providerId}
                  onClick={() => bindMutation.mutate(provider.providerId)}
                >
                  {t('federated.bind', { name: provider.name })}
                </Button>
              ))}
            </div>
          )}
        </div>
      );
    }
    return (
      <>
        {identities.map((identity) => (
          <div className="prof-id-row" key={identity.id} data-testid={`federated-identity-${identity.id}`}>
            <div className="prof-id-main">
              <div className="prof-id-title">
                <span>{identity.providerName}</span>
                <Tag>{identity.protocol}</Tag>
              </div>
              <div className="prof-id-sub">{identity.email || identity.subject}</div>
            </div>
            <Popconfirm
              title={t('federated.unbindConfirm')}
              okText={t('federated.unbindConfirmOk')}
              cancelText={t('cancel')}
              onConfirm={() => handleUnbind(identity.id)}
            >
              <Button danger size="small">{t('federated.unbind')}</Button>
            </Popconfirm>
          </div>
        ))}
        {bindableProviders.length > 0 && (
          <Space size={[8, 8]} wrap style={{ marginTop: 14 }}>
            {bindableProviders.map((provider) => (
              <Button
                key={provider.providerId}
                data-testid={`federated-bind-${provider.providerId}`}
                loading={bindMutation.isPending && bindMutation.variables === provider.providerId}
                onClick={() => bindMutation.mutate(provider.providerId)}
              >
                {t('federated.bind', { name: provider.name })}
              </Button>
            ))}
          </Space>
        )}
      </>
    );
  };

  return (
    <section className="aw-card prof-panel" aria-label={t('federated.title')}>
      <div className="prof-sec-head">
        <div className="prof-sec-head-text">
          <b>{t('federated.title')}</b>
          <div className="prof-sec-desc">{t('federated.desc')}</div>
        </div>
        <div className="prof-sec-extra">
          {identitiesQuery.isSuccess ? (
            <Tag color={identities.length > 0 ? 'green' : undefined}>
              {identities.length > 0 ? t('federated.boundTag', { count: identities.length }) : t('federated.unboundTag')}
            </Tag>
          ) : null}
        </div>
      </div>
      <div className="prof-sec-body">
        {renderBody()}
        <div className="prof-foot-hint" style={{ marginTop: 14 }}>{t('federated.hint')}</div>
      </div>
    </section>
  );
}
