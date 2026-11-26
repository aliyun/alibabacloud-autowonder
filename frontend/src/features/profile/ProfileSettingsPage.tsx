import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { PageHead } from '@/shared/ui/PageHead';
import { NoticeTip } from '@/shared/ui/NoticeTip';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Form, Input, Tag, Tooltip, message } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { McpTokenSettingsPanel } from '@/features/open-platform/McpTokenSettingsPanel';
import { BasicProfilePanel } from './BasicProfilePanel';
import { ChangePasswordPanel } from './ChangePasswordPanel';
import { DeactivationPanel } from './DeactivationPanel';
import { FederatedIdentitiesPanel } from './FederatedIdentitiesPanel';
import {
  USER_IM_IDENTITIES_QUERY_KEY,
  USER_PROFILE_QUERY_KEY,
  getMyProfile,
  listMyImIdentities,
  sendMyDingTalkIdentityTest,
  updateMyDingTalkIdentity,
  updateMyFeishuIdentity,
  sendMyFeishuIdentityTest,
  type UserImIdentity,
} from './profileApi';
import {
  EMAIL_VERIFICATION_POLICY_QUERY_KEY,
  fetchEmailVerificationPolicy,
} from '@/features/auth/emailVerificationApi';
import { useAuthStore } from '@/shared/auth/store';
import './ProfileSettingsPage.css';

const DEFAULT_TAB = 'basic';

const TAB_KEYS = ['basic', 'im', 'federated', 'mcp', 'password', 'deactivate'] as const;
type ProfileTabKey = typeof TAB_KEYS[number];

type ImIdentityFormValues = {
  externalUserId: string;
};

const EMPTY_IM_IDENTITY: UserImIdentity = {
  provider: 'DINGTALK',
  externalUserId: '',
  configured: false,
  platformReady: true,
  testAvailable: false,
};

function getApiMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getImTestStatusText(hasIdentityRow: boolean, hasSavedIdentity: boolean, identity: UserImIdentity) {
  if (!hasIdentityRow || !hasSavedIdentity) {
    return i18n.t('profile:im.saveFirst');
  }
  if (!identity.platformReady) {
    return i18n.t('profile:im.robotUnavailable');
  }
  return i18n.t(identity.testAvailable ? 'profile:im.testAvailable' : 'profile:im.saveFirst');
}

export function ProfileSettingsPage() {
  const { t } = useTranslation('profile');
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab: ProfileTabKey = TAB_KEYS.includes(requestedTab as ProfileTabKey)
    ? requestedTab as ProfileTabKey
    : DEFAULT_TAB;
  const [visitedTabs, setVisitedTabs] = useState<Set<ProfileTabKey>>(() => new Set([activeTab]));
  const [form] = Form.useForm<ImIdentityFormValues>();
  const queryClient = useQueryClient();
  const hydratedRef = useRef(false);
  const identityQuery = useQuery({
    queryKey: USER_IM_IDENTITIES_QUERY_KEY,
    queryFn: listMyImIdentities,
    retry: false,
  });
  const profileQuery = useQuery({
    queryKey: USER_PROFILE_QUERY_KEY,
    queryFn: getMyProfile,
    retry: false,
  });
  const policyQuery = useQuery({
    queryKey: EMAIL_VERIFICATION_POLICY_QUERY_KEY,
    queryFn: fetchEmailVerificationPolicy,
    retry: false,
  });
  const authUser = useAuthStore((s) => s.user);

  useEffect(() => {
    setVisitedTabs((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)));
  }, [activeTab]);

  const identityRow = identityQuery.data?.[0];
  const provider = identityRow?.provider ?? 'DINGTALK';
  const providerLabel = provider === 'FEISHU' ? t('im.feishu') : provider === 'DINGTALK' ? t('im.dingtalk') : provider;
  const isFeishu = provider === 'FEISHU';
  const hydratedProviderRef = useRef(provider);
  const hasIdentityRow = Boolean(identityRow);
  const identity = identityRow || EMPTY_IM_IDENTITY;
  const savedExternalUserId = identity.externalUserId || '';
  const currentExternalUserId = Form.useWatch('externalUserId', form) ?? savedExternalUserId;
  const normalizedCurrentExternalUserId = currentExternalUserId.trim();
  const normalizedSavedExternalUserId = savedExternalUserId.trim();
  const hasSavedIdentity = Boolean(identity.configured && normalizedSavedExternalUserId);
  const testBlockedByRobot = !identityQuery.isLoading && hasIdentityRow && !identity.platformReady;
  const testBlockedByIdentity =
    !normalizedCurrentExternalUserId ||
    !hasSavedIdentity ||
    normalizedCurrentExternalUserId !== normalizedSavedExternalUserId;

  useEffect(() => {
    if (identityQuery.data) {
      const fieldTouched = form.isFieldTouched('externalUserId');
      if (!hydratedRef.current || !fieldTouched || hydratedProviderRef.current !== provider) {
        hydratedProviderRef.current = provider;
        form.setFieldsValue({ externalUserId: savedExternalUserId });
        hydratedRef.current = true;
      }
    }
  }, [form, identityQuery.data, savedExternalUserId, provider]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const values = await form.validateFields();
      return (provider === 'FEISHU' ? updateMyFeishuIdentity : updateMyDingTalkIdentity)({ externalUserId: values.externalUserId?.trim() || '' });
    },
    onSuccess: async () => {
      message.success(i18n.t('profile:im.saved'));
      await queryClient.invalidateQueries({ queryKey: USER_IM_IDENTITIES_QUERY_KEY });
    },
    onError: (error) => {
      message.error(getApiMessage(error, i18n.t('profile:im.saveFailed')));
    },
  });

  const testMutation = useMutation({
    mutationFn: () => (provider === 'FEISHU' ? sendMyFeishuIdentityTest() : sendMyDingTalkIdentityTest()),
    onSuccess: () => {
      message.success(i18n.t('profile:im.testSent'));
    },
    onError: (error) => {
      message.error(getApiMessage(error, i18n.t('profile:im.testFailed')));
    },
  });

  const testDisabled =
    identityQuery.isLoading ||
    saveMutation.isPending ||
    testMutation.isPending ||
    testBlockedByRobot ||
    testBlockedByIdentity;
  const testDisabledReason = testBlockedByRobot
    ? t('im.robotBlocked', { provider: providerLabel })
    : testBlockedByIdentity
      ? t('im.identityBlocked', { provider: providerLabel })
      : '';
  const testStatusText = getImTestStatusText(hasIdentityRow, hasSavedIdentity, identity);

  const selectTab = (key: ProfileTabKey) => {
    if (key === activeTab) return;
    const next = new URLSearchParams(searchParams);
    if (key === DEFAULT_TAB) {
      next.delete('tab');
    } else {
      next.set('tab', key);
    }
    setSearchParams(next, { replace: true });
  };

  const profile = profileQuery.data;
  const displayName = profile?.nickname || authUser?.nickname || authUser?.username || '';
  const username = profile?.username || authUser?.username || '';
  const verificationEnabled = policyQuery.data?.verificationEnabled ?? false;
  const emailVerified = profile?.emailVerified ?? false;
  const initial = Array.from(displayName || username || 'U')[0].toUpperCase();
  const usernameHandle = username ? `@${username}` : t('account.unavailable');

  const navItems: Array<{ key: ProfileTabKey; icon: string; title: string; desc: string }> = [
    { key: 'basic', icon: 'user', title: t('basic.title'), desc: t('nav.basicDesc') },
    { key: 'im', icon: 'send', title: t('im.title'), desc: t('nav.imDesc') },
    { key: 'federated', icon: 'link', title: t('federated.title'), desc: t('nav.federatedDesc') },
    { key: 'mcp', icon: 'key', title: t('tabs.mcp'), desc: t('nav.mcpDesc') },
    { key: 'password', icon: 'lock', title: t('password.submit'), desc: t('nav.passwordDesc') },
    { key: 'deactivate', icon: 'power', title: t('deactivation.title'), desc: t('nav.deactivateDesc') },
  ];

  const renderSlot = (key: ProfileTabKey, content: ReactNode) => (
    <div
      key={key}
      className="prof-panel-slot"
      role="tabpanel"
      id={`prof-panel-${key}`}
      aria-labelledby={`prof-tab-${key}`}
      hidden={activeTab !== key}
    >
      {visitedTabs.has(key) ? content : null}
    </div>
  );

  const imPanel = (
    <section className="aw-card prof-panel" aria-label={t('im.title')}>
      <div className="prof-sec-head">
        <div className="prof-sec-head-text">
          <b>{t('im.title')}</b>
          <div className="prof-sec-desc">{t('im.desc')}</div>
        </div>
      </div>
      <div className="prof-sec-body">
        {identityQuery.error ? (
          <NoticeTip
            kind="error"
            title={t('im.loadFailed')}
            detail={getApiMessage(identityQuery.error, t('retryLater'))}
            action={<Button size="small" onClick={() => identityQuery.refetch()}>{t('retry')}</Button>}
          />
        ) : (
          <Form
            form={form}
            layout="vertical"
            disabled={identityQuery.isLoading || saveMutation.isPending}
            initialValues={{ externalUserId: '' }}
            onFinish={() => saveMutation.mutate()}
          >
            <div className="prof-channel">
              <div className="prof-channel-head">
                <span className={isFeishu ? 'prof-provider-badge prof-provider-feishu' : 'prof-provider-badge prof-provider-dingtalk'} aria-hidden="true">
                  {isFeishu ? t('im.feishuBadge') : t('im.dingtalkBadge')}
                </span>
                <div className="prof-channel-main">
                  <div className="prof-channel-name">{providerLabel}</div>
                  <div className="prof-foot-hint" style={{ marginTop: 2 }}>{t('im.hint', { provider: providerLabel })}</div>
                </div>
                <div className="prof-channel-tags">
                  <Tag color={hasSavedIdentity ? 'green' : undefined}>{hasSavedIdentity ? t('im.enabled') : t('im.disabled')}</Tag>
                  <Tag color={identity.testAvailable ? 'green' : 'gold'}>{testStatusText}</Tag>
                </div>
              </div>

              <Form.Item
                label={t('im.label', { provider: providerLabel })}
                name="externalUserId"
                extra={isFeishu ? t('im.feishuHint') : t('im.dingtalkHint')}
                style={{ marginTop: 14 }}
              >
                <Input maxLength={256} placeholder={t('im.placeholder')} autoComplete="off" />
              </Form.Item>

              {testDisabledReason ? (
                <NoticeTip
                  kind="info"
                  title={testDisabledReason}
                  detail={testBlockedByRobot ? t('im.robotHint') : undefined}
                  style={{ marginBottom: 14 }}
                />
              ) : null}

              <div className="prof-actions" style={{ marginTop: 0 }}>
                <span className="prof-actions-left prof-foot-hint">{t('im.footerHint')}</span>
                <Tooltip title={testDisabledReason || undefined}>
                  <Button aria-label={t('im.test')}
                    icon={<AwStrokeIcon name="send" />}
                    disabled={testDisabled}
                    loading={testMutation.isPending}
                    onClick={() => testMutation.mutate()}
                  >{t('im.test')}</Button>
                </Tooltip>
                <Button aria-label={t('save')}
                  type="primary"
                  htmlType="submit"
                  icon={<AwStrokeIcon name="check" />}
                  disabled={normalizedCurrentExternalUserId === normalizedSavedExternalUserId}
                  loading={saveMutation.isPending}
                >{t('save')}</Button>
              </div>
            </div>
          </Form>
        )}
      </div>
    </section>
  );

  const panelSlots = [
    renderSlot('basic', <BasicProfilePanel />),
    renderSlot('im', imPanel),
    renderSlot('federated', <FederatedIdentitiesPanel />),
    renderSlot('mcp', <McpTokenSettingsPanel />),
    renderSlot('password', <ChangePasswordPanel />),
    renderSlot('deactivate', <DeactivationPanel />),
  ];

  return (
    <div data-testid="profile-settings-shell" className="aw-detail-canvas">
      <section className="aw-detail-head-card prof-head-card">
        <PageHead
          title={t('title')}
          description={t('description')}
          actions={(
            <div className="prof-account">
              <span className="prof-avatar" aria-hidden="true">{initial}</span>
              <div className="prof-account-meta">
                <b>{displayName || t('account.unavailable')}</b>
                <span>{usernameHandle}</span>
              </div>
              {verificationEnabled ? (
                <Tag color={emailVerified ? 'green' : 'gold'}>{emailVerified ? t('basic.verified') : t('basic.pending')}</Tag>
              ) : null}
              <Tag color="green">{t('account.normal')}</Tag>
            </div>
          )}
        />
      </section>

      <div className="prof-layout">
        <aside className="aw-card prof-nav" role="tablist" aria-label={t('nav.label')} aria-orientation="vertical">
          <div className="prof-nav-head">{t('nav.heading')}</div>
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              id={`prof-tab-${item.key}`}
              aria-selected={activeTab === item.key}
              aria-controls={`prof-panel-${item.key}`}
              className={activeTab === item.key ? 'prof-nav-item active' : 'prof-nav-item'}
              data-prof-tab={item.key}
              onClick={() => selectTab(item.key)}
            >
              <span className="prof-nav-icon" aria-hidden="true"><AwStrokeIcon name={item.icon} size={15} /></span>
              <span className="prof-nav-text">
                <span className="prof-nav-title">{item.title}</span>
                <span className="prof-nav-desc">{item.desc}</span>
              </span>
            </button>
          ))}
          <div className="prof-nav-foot">{t('nav.foot')}</div>
        </aside>

        <div className="prof-panels">{panelSlots}</div>
      </div>
    </div>
  );
}
