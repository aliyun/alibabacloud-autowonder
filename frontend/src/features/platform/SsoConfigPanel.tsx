import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Table } from '@/shared/theme/ThemedTable';
import { NoticeTip } from '@/shared/ui/NoticeTip';
import type { ColumnsType } from 'antd/es/table';
import type { PlatformBranding } from './brandingApi';
import { resolvePlatformBaseUrl } from './platformBaseUrl';
import {
  FEDERATION_AUTH_CONFIG_QUERY_KEY,
  FEDERATION_CONNECTIONS_QUERY_KEY,
  FEDERATION_IDPS_QUERY_KEY,
  PLATFORM_IM_SELECTION_QUERY_KEY,
  createFederationConnection,
  createFederationIdp,
  federationCallbackUrl,
  fetchFederationConnections,
  fetchFederationIdps,
  fetchPlatformAuthConfig,
  fetchPlatformImSelection,
  updateFederationConnection,
  updateFederationIdp,
  updatePlatformAuthConfig,
  type CreateConnectionParams,
  type FederationConnection,
  type FederationIdp,
  type FederationProtocol,
  type UpdateConnectionParams,
} from './ssoApi';
import './ssoConfig.css';

interface ConnectionFormValues {
  idpId: number;
  protocol: FederationProtocol;
  name: string;
  enabled: boolean;
  issuer: string;
  samlSsoUrl?: string;
  samlCert?: string;
  oidcAuthorizeUrl?: string;
  oidcTokenUrl?: string;
  oidcJwksUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string;
  subjectClaim?: string;
  nameClaim?: string;
  emailClaim?: string;
  usernameClaim?: string;
  feishuUserIdClaim?: string;
  autoProvision: boolean;
  bindExistingByUsername: boolean;
  defaultLogin: boolean;
  allowedTenants?: string;
}

interface IdpFormValues {
  name: string;
  description?: string;
}

function trimmed(value: string | null | undefined): string | null {
  const next = (value ?? '').trim();
  return next ? next : null;
}

function text(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizeProtocol(value: string): FederationProtocol {
  return value === 'OIDC' ? 'OIDC' : 'SAML2';
}

function toCreateParams(values: ConnectionFormValues): CreateConnectionParams {
  const common = {
    idpId: values.idpId,
    protocol: values.protocol,
    name: values.name.trim(),
    enabled: values.enabled ? 1 : 0,
    issuer: text(values.issuer),
    // 可选字段发送裁剪后的字符串：编辑时清空即发送空串，后端按“清空”处理。
    subjectClaim: text(values.subjectClaim),
    nameClaim: text(values.nameClaim),
    emailClaim: text(values.emailClaim),
    usernameClaim: text(values.usernameClaim),
    feishuUserIdClaim: text(values.feishuUserIdClaim),
    autoProvision: values.autoProvision ? 1 : 0,
    bindExistingByUsername: values.bindExistingByUsername ? 1 : 0,
    defaultLogin: values.defaultLogin,
  };
  if (values.protocol === 'SAML2') {
    return {
      ...common,
      samlSsoUrl: text(values.samlSsoUrl),
      samlCert: text(values.samlCert),
    };
  }
  return {
    ...common,
    oidcAuthorizeUrl: text(values.oidcAuthorizeUrl),
    oidcTokenUrl: text(values.oidcTokenUrl),
    oidcJwksUrl: text(values.oidcJwksUrl),
    clientId: text(values.clientId),
    // 编辑时留空表示沿用已存密钥；undefined 让字段不出现在请求体里。
    clientSecret: trimmed(values.clientSecret) ?? undefined,
    scopes: text(values.scopes),
    allowedTenants: text(values.allowedTenants),
  };
}

function toUpdateParams(params: CreateConnectionParams): UpdateConnectionParams {
  return {
    name: params.name,
    enabled: params.enabled,
    issuer: params.issuer,
    samlSsoUrl: params.samlSsoUrl,
    samlCert: params.samlCert,
    oidcAuthorizeUrl: params.oidcAuthorizeUrl,
    oidcTokenUrl: params.oidcTokenUrl,
    oidcJwksUrl: params.oidcJwksUrl,
    clientId: params.clientId,
    clientSecret: params.clientSecret,
    scopes: params.scopes,
    subjectClaim: params.subjectClaim,
    nameClaim: params.nameClaim,
    emailClaim: params.emailClaim,
    usernameClaim: params.usernameClaim,
    feishuUserIdClaim: params.feishuUserIdClaim,
    autoProvision: params.autoProvision,
    bindExistingByUsername: params.bindExistingByUsername,
    defaultLogin: params.defaultLogin,
    allowedTenants: params.allowedTenants,
  };
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="sso-section-title">{children}</div>;
}

export function SsoConfigPanel({ branding }: { branding?: PlatformBranding | null }) {
  const { t } = useTranslation('platform');
  const queryClient = useQueryClient();
  // 后端以 effectivePublicBaseUrl 生成 ACS/Redirect URI，这里必须用同一基准。
  const platformBaseUrl = resolvePlatformBaseUrl(branding);
  const idpsQuery = useQuery({
    queryKey: FEDERATION_IDPS_QUERY_KEY,
    queryFn: fetchFederationIdps,
    retry: false,
  });
  const connectionsQuery = useQuery({
    queryKey: FEDERATION_CONNECTIONS_QUERY_KEY,
    queryFn: fetchFederationConnections,
    retry: false,
  });
  const authConfigQuery = useQuery({
    queryKey: FEDERATION_AUTH_CONFIG_QUERY_KEY,
    queryFn: fetchPlatformAuthConfig,
    retry: false,
  });
  const channelQuery = useQuery({
    queryKey: PLATFORM_IM_SELECTION_QUERY_KEY,
    queryFn: fetchPlatformImSelection,
    retry: false,
  });
  const idps = idpsQuery.data ?? [];
  const connections = connectionsQuery.data ?? [];
  const registrationEnabled = authConfigQuery.data?.registrationEnabled ?? true;
  const channelProvider = channelQuery.data?.provider ?? null;

  const [connectionEditor, setConnectionEditor] = useState<FederationConnection | 'new' | null>(null);
  const [idpEditor, setIdpEditor] = useState<FederationIdp | 'new' | null>(null);
  const [callbackTarget, setCallbackTarget] = useState<FederationConnection | null>(null);
  const [savingConnection, setSavingConnection] = useState(false);
  const [savingIdp, setSavingIdp] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // 保存成功必须以服务端回读为准：写后重新拉取两个列表与认证配置，任一失败都不提示成功。
  const readback = async () => {
    const [nextIdps, nextConnections, nextAuthConfig] = await Promise.all([
      fetchFederationIdps(),
      fetchFederationConnections(),
      fetchPlatformAuthConfig(),
    ]);
    queryClient.setQueryData(FEDERATION_IDPS_QUERY_KEY, nextIdps);
    queryClient.setQueryData(FEDERATION_CONNECTIONS_QUERY_KEY, nextConnections);
    queryClient.setQueryData(FEDERATION_AUTH_CONFIG_QUERY_KEY, nextAuthConfig);
  };

  const toggleRegistration = async (enabled: boolean) => {
    setBusyKey('registration');
    try {
      await updatePlatformAuthConfig({ registrationEnabled: enabled });
      await readback();
      message.success(i18n.t('platform:ssoRegistrationUpdated'));
    } catch (error) {
      message.error(errorText(error, i18n.t('platform:ssoRegistrationUpdateFailed')));
    } finally {
      setBusyKey(null);
    }
  };

  const toggleDefaultLogin = async (connection: FederationConnection) => {
    setBusyKey(`default-${connection.id}`);
    try {
      await updateFederationConnection(connection.id, { defaultLogin: !connection.defaultLogin });
      await readback();
      message.success(i18n.t(connection.defaultLogin
        ? 'platform:ssoDefaultLoginCleared'
        : 'platform:ssoDefaultLoginSet'));
    } catch (error) {
      message.error(errorText(error, i18n.t('platform:ssoDefaultLoginUpdateFailed')));
    } finally {
      setBusyKey(null);
    }
  };

  const handleConnectionSubmit = async (values: ConnectionFormValues) => {
    const editing = connectionEditor !== 'new' ? connectionEditor : null;
    const created = toCreateParams(values);
    setSavingConnection(true);
    try {
      if (editing) {
        await updateFederationConnection(editing.id, toUpdateParams(created));
      } else {
        await createFederationConnection(created);
      }
      await readback();
      message.success(i18n.t(editing ? 'platform:ssoConnectionUpdated' : 'platform:ssoConnectionCreated'));
      setConnectionEditor(null);
    } catch (error) {
      message.error(errorText(error, i18n.t('platform:ssoConnectionSaveFailed')));
    } finally {
      setSavingConnection(false);
    }
  };

  const handleIdpSubmit = async (values: IdpFormValues) => {
    const editing = idpEditor !== 'new' ? idpEditor : null;
    setSavingIdp(true);
    try {
      if (editing) {
        await updateFederationIdp(editing.id, {
          name: values.name.trim(),
          description: trimmed(values.description),
        });
      } else {
        await createFederationIdp({
          name: values.name.trim(),
          description: trimmed(values.description),
        });
      }
      await readback();
      message.success(i18n.t(editing ? 'platform:ssoIdpUpdated' : 'platform:ssoIdpCreated'));
      setIdpEditor(null);
    } catch (error) {
      message.error(errorText(error, i18n.t('platform:ssoIdpSaveFailed')));
    } finally {
      setSavingIdp(false);
    }
  };

  const toggleConnection = async (connection: FederationConnection) => {
    setBusyKey(`connection-${connection.id}`);
    try {
      await updateFederationConnection(connection.id, {
        enabled: connection.enabled === 1 ? 0 : 1,
      });
      await readback();
      message.success(i18n.t('platform:ssoStatusUpdated'));
    } catch (error) {
      message.error(errorText(error, i18n.t('platform:ssoStatusUpdateFailed')));
    } finally {
      setBusyKey(null);
    }
  };

  const toggleIdp = async (idp: FederationIdp) => {
    setBusyKey(`idp-${idp.id}`);
    try {
      await updateFederationIdp(idp.id, { enabled: idp.enabled === 1 ? 0 : 1 });
      await readback();
      message.success(i18n.t('platform:ssoStatusUpdated'));
    } catch (error) {
      message.error(errorText(error, i18n.t('platform:ssoStatusUpdateFailed')));
    } finally {
      setBusyKey(null);
    }
  };

  const loadError = idpsQuery.error || connectionsQuery.error || authConfigQuery.error;
  if (loadError) {
    return (
      <div className="aw-sso-panel">
        <NoticeTip
          kind="error"
          title={t('ssoLoadFailed')}
          detail={loadError instanceof Error ? loadError.message : t('retryLater')}
          action={
            <Button size="small" onClick={() => {
              void idpsQuery.refetch();
              void connectionsQuery.refetch();
              void authConfigQuery.refetch();
            }}>
              {t('ssoRetry')}
            </Button>
          }
        />
      </div>
    );
  }

  const connectionCountBySource = new Map<number, number>();
  for (const connection of connections) {
    connectionCountBySource.set(connection.idpId, (connectionCountBySource.get(connection.idpId) ?? 0) + 1);
  }

  const enabledIdpIds = new Set(idps.filter((idp) => idp.enabled === 1).map((idp) => idp.id));
  // 列表顺序即后端按 sort_order/id 返回的添加顺序；这里不提供排序字段或拖拽入口。
  const loginEntries = connections.filter(
    (connection) => connection.enabled === 1 && enabledIdpIds.has(connection.idpId),
  );

  const idpColumns: ColumnsType<FederationIdp> = [
    {
      title: t('ssoIdpName'),
      dataIndex: 'name',
      align: 'left',
      ellipsis: true,
      render: (name: string) => <span className="sso-strong">{name}</span>,
    },
    {
      title: t('ssoIdpDescription'),
      dataIndex: 'description',
      align: 'left',
      ellipsis: true,
      render: (description: string | null) => (
        <span className="sso-dim">{description || t('ssoValueMissing')}</span>
      ),
    },
    {
      title: t('ssoIdpConnections'),
      key: 'connections',
      width: 110,
      render: (_, idp) => t('ssoCountTag', { count: connectionCountBySource.get(idp.id) ?? 0 }),
    },
    {
      title: t('ssoIdpStatus'),
      key: 'status',
      width: 170,
      render: (_, idp) => {
        const switchingOff = idp.enabled === 1;
        const impact = connectionCountBySource.get(idp.id) ?? 0;
        const requiresConfirm = switchingOff && impact > 0;
        const switchControl = (
          <Switch
            size="small"
            aria-label={t('ssoToggleIdpAria', { name: idp.name })}
            checked={switchingOff}
            disabled={busyKey === `idp-${idp.id}`}
            // 需要二次确认时，点击只负责打开确认气泡，真正的停用由 onConfirm 执行。
            onChange={() => {
              if (!requiresConfirm) void toggleIdp(idp);
            }}
          />
        );
        return (
          <span className="sso-cell">
            {requiresConfirm ? (
              <Popconfirm
                title={t('ssoDisableIdpConfirm', { name: idp.name })}
                description={t('ssoDisableIdpImpact', { connections: impact })}
                okText={t('ssoConfirmDisable')}
                cancelText={t('cancel')}
                onConfirm={() => { void toggleIdp(idp); }}
              >
                {switchControl}
              </Popconfirm>
            ) : switchControl}
            <Tag color={switchingOff ? 'green' : undefined} className={switchingOff ? undefined : 'aw-tag-gray'}>
              {switchingOff ? t('ssoStatusEnabled') : t('ssoStatusDisabled')}
            </Tag>
          </span>
        );
      },
    },
    {
      title: t('actions'),
      key: 'actions',
      width: 90,
      render: (_, idp) => (
        <span className="sso-actions">
          <Button type="link" size="small" onClick={() => setIdpEditor(idp)}>
            {t('ssoEditIdp')}
          </Button>
        </span>
      ),
    },
  ];

  const connectionColumns: ColumnsType<FederationConnection> = [
    {
      title: t('ssoConnectionName'),
      dataIndex: 'name',
      align: 'left',
      ellipsis: true,
      render: (name: string) => <span className="sso-strong">{name}</span>,
    },
    {
      title: t('ssoIdpColumn'),
      dataIndex: 'idpName',
      align: 'left',
      ellipsis: true,
      render: (idpName: string | null) => idpName || t('ssoValueMissing'),
    },
    {
      title: t('ssoDefaultLogin'),
      key: 'defaultLogin',
      width: 110,
      render: (_, connection) => {
        const usable = connection.enabled === 1 && enabledIdpIds.has(connection.idpId);
        return (
          <Switch
            size="small"
            aria-label={t('ssoDefaultLoginAria', { name: connection.name })}
            checked={connection.defaultLogin}
            disabled={!usable || busyKey === `default-${connection.id}`}
            onChange={() => void toggleDefaultLogin(connection)}
          />
        );
      },
    },
    {
      title: t('ssoProtocol'),
      dataIndex: 'protocol',
      width: 110,
      render: (protocol: string) => {
        const label = protocol === 'SAML2' ? t('ssoProtocolSaml') : t('ssoProtocolOidc');
        return <Tag color={protocol === 'SAML2' ? undefined : 'blue'}>{label}</Tag>;
      },
    },
    {
      title: t('ssoConnectionStatus'),
      key: 'status',
      width: 170,
      render: (_, connection) => (
        <span className="sso-cell">
          <Switch
            size="small"
            aria-label={t('ssoToggleConnectionAria', { name: connection.name })}
            checked={connection.enabled === 1}
            disabled={busyKey === `connection-${connection.id}`}
            onChange={() => void toggleConnection(connection)}
          />
          <Tag color={connection.enabled === 1 ? 'green' : undefined} className={connection.enabled === 1 ? undefined : 'aw-tag-gray'}>
            {connection.enabled === 1 ? t('ssoStatusEnabled') : t('ssoStatusDisabled')}
          </Tag>
        </span>
      ),
    },
    {
      title: t('actions'),
      key: 'actions',
      width: 176,
      render: (_, connection) => (
        <span className="sso-actions">
          <Button type="link" size="small" onClick={() => setConnectionEditor(connection)}>
            {t('ssoConfigure')}
          </Button>
          <Button type="link" size="small" onClick={() => setCallbackTarget(connection)}>
            {t('ssoCallbackInfo')}
          </Button>
        </span>
      ),
    },
  ];

  const connectionEditorValue = connectionEditor === 'new' ? null : connectionEditor;
  const idpEditorValue = idpEditor === 'new' ? null : idpEditor;
  const platformName = branding?.platformName?.trim() || t('ssoPlatformNameFallback');
  const callbackUrl = callbackTarget
    ? federationCallbackUrl(callbackTarget.id, callbackTarget.protocol, platformBaseUrl)
    : '';
  const callbackHint = callbackTarget
    ? (callbackTarget.protocol === 'SAML2' ? t('ssoSamlCallbackHint') : t('ssoOidcCallbackHint'))
    : '';

  return (
    <div className="aw-sso-panel">
      <NoticeTip kind="info" title={t('ssoHint')} style={{ marginBottom: 12 }} />

      <Card
        className="aw-platform-message-card"
        style={{ marginBottom: 12 }}
        title={(
          <div className="aw-config-card-title">
            <span>{t('ssoRegistrationSection')}</span>
            <div className="aw-config-tags">
              <Tag color={registrationEnabled ? 'green' : undefined} className={registrationEnabled ? undefined : 'aw-tag-gray'}>
                {registrationEnabled ? t('ssoRegistrationOn') : t('ssoRegistrationOff')}
              </Tag>
            </div>
          </div>
        )}
      >
        <div className="sso-toggle-row">
          <Switch
            size="small"
            aria-label={t('ssoRegistrationToggleAria')}
            checked={registrationEnabled}
            disabled={busyKey === 'registration'}
            onChange={(checked) => void toggleRegistration(checked)}
          />
          <div className="sso-toggle-copy">
            <b>{t('ssoRegistrationLabel')}</b>
            <p>{t('ssoRegistrationHint')}</p>
          </div>
        </div>
      </Card>

      <Card
        className="aw-platform-message-card"
        style={{ marginBottom: 12 }}
        title={(
          <div className="aw-config-card-title">
            <span>{t('ssoIdpSection')}</span>
            <div className="aw-config-tags">
              <Tag className="aw-tag-gray">{t('ssoCountTag', { count: idps.length })}</Tag>
            </div>
          </div>
        )}
        extra={idps.length > 0 ? (
          <Button type="primary" className="sso-head-action" onClick={() => setIdpEditor('new')}>
            {t('ssoAddIdp')}
          </Button>
        ) : undefined}
      >
        <div className="sso-table-scroll">
          <Table<FederationIdp>
            className="sso-table"
            rowKey="id"
            size="small"
            columns={idpColumns}
            dataSource={idps}
            loading={idpsQuery.isLoading}
            pagination={false}
            locale={{
              emptyText: (
                <div className="sso-empty">
                  <b>{t('ssoEmptyIdpsTitle')}</b>
                  <p>{t('ssoEmptyIdpsHint')}</p>
                  <Button size="small" type="primary" onClick={() => setIdpEditor('new')}>
                    {t('ssoAddIdp')}
                  </Button>
                </div>
              ),
            }}
          />
        </div>
        <p className="sso-hint">{t('ssoIdpDisableHint')}</p>
      </Card>

      <Card
        className="aw-platform-message-card"
        style={{ marginBottom: 12 }}
        title={(
          <div className="aw-config-card-title">
            <span>{t('ssoConnectionsSection')}</span>
            <div className="aw-config-tags">
              <Tag className="aw-tag-gray">{t('ssoCountTag', { count: connections.length })}</Tag>
            </div>
          </div>
        )}
        extra={connections.length > 0 ? (
          <Tooltip title={idps.length === 0 ? t('ssoNoIdpsHint') : undefined}>
            <span>
              <Button
                type="primary"
                className="sso-head-action"
                disabled={idps.length === 0}
                onClick={() => setConnectionEditor('new')}
              >
                {t('ssoAddConnection')}
              </Button>
            </span>
          </Tooltip>
        ) : undefined}
      >
        <p className="sso-hint sso-hint-tight">{t('ssoConnectionHint')}</p>
        <div className="sso-table-scroll">
          <Table<FederationConnection>
            className="sso-table"
            rowKey="id"
            size="small"
            columns={connectionColumns}
            dataSource={connections}
            loading={connectionsQuery.isLoading}
            pagination={false}
            locale={{
              emptyText: (
                <div className="sso-empty">
                  <b>{t('ssoEmptyConnectionsTitle')}</b>
                  <p>{t('ssoEmptyConnectionsHint')}</p>
                  <Tooltip title={idps.length === 0 ? t('ssoNoIdpsHint') : undefined}>
                    <span>
                      <Button
                        size="small"
                        disabled={idps.length === 0}
                        onClick={() => setConnectionEditor('new')}
                      >
                        {t('ssoAddConnection')}
                      </Button>
                    </span>
                  </Tooltip>
                </div>
              ),
            }}
          />
        </div>
        <p className="sso-hint">{t('ssoConnectionDisableHint')}</p>
      </Card>

      <Card
        className="aw-platform-message-card"
        title={(
          <div className="aw-config-card-title">
            <span>{t('ssoPreviewTitle')}</span>
            <div className="aw-config-tags">
              <Tag className="aw-tag-gray">{t('ssoPreviewTag')}</Tag>
            </div>
          </div>
        )}
      >
        <p className="sso-hint sso-hint-tight">{t('ssoPreviewHint')}</p>
        <div className="sso-preview-frame">
          <div className="sso-preview-card">
            <h4>{t('ssoPreviewCardTitle', { name: platformName })}</h4>
            <p className="sso-preview-sub">{t('ssoPreviewCardSub', { name: platformName })}</p>
            {loginEntries.length > 0 && (
              <>
                <div className="sso-preview-sso-list">
                  {loginEntries.map((connection) => (
                    <button key={connection.id} type="button" className="sso-preview-sso-btn" disabled>
                      {t('ssoPreviewLoginWith', { name: connection.name })}
                    </button>
                  ))}
                </div>
                <div className="sso-preview-divider">{t('ssoPreviewOr')}</div>
                <p className="sso-preview-local">{t('ssoPreviewLocalLabel', { name: platformName })}</p>
              </>
            )}
            <div className="sso-preview-form">
              <input className="sso-preview-input" placeholder={t('ssoPreviewUsername')} disabled />
              <input className="sso-preview-input" type="password" placeholder={t('ssoPreviewPassword')} disabled />
              <button type="button" className="sso-preview-login" disabled>{t('ssoPreviewLogin')}</button>
            </div>
          </div>
        </div>
        <p className="sso-hint">
          {loginEntries.length === 0 ? t('ssoPreviewEmpty') : t('ssoPreviewNote')}
        </p>
      </Card>

      <SsoIdpModal
        open={idpEditor !== null}
        idp={idpEditorValue}
        saving={savingIdp}
        onCancel={() => setIdpEditor(null)}
        onSubmit={(values) => void handleIdpSubmit(values)}
      />

      <SsoConnectionModal
        open={connectionEditor !== null}
        connection={connectionEditorValue}
        idps={idps}
        channelProvider={channelProvider}
        saving={savingConnection}
        onCancel={() => setConnectionEditor(null)}
        onSubmit={(values) => void handleConnectionSubmit(values)}
      />

      <Modal
        open={callbackTarget !== null}
        title={t('ssoCallbackTitle')}
        width={520}
        className="sso-modal"
        footer={<Button onClick={() => setCallbackTarget(null)}>{t('ssoCallbackClose')}</Button>}
        onCancel={() => setCallbackTarget(null)}
      >
        {callbackTarget && (
          <>
            <b className="sso-callback-name">{callbackTarget.name}</b>
            <div className="sso-code-line">
              <code>{callbackUrl}</code>
              <Typography.Text copyable={{ text: callbackUrl }} aria-label={t('ssoCopyCallback')} />
            </div>
            <p className="sso-hint">{callbackHint}</p>
            <p className="sso-hint">{t('ssoCallbackDeployHint')}</p>
          </>
        )}
      </Modal>
    </div>
  );
}

interface SsoIdpModalProps {
  open: boolean;
  idp: FederationIdp | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: IdpFormValues) => void;
}

function SsoIdpModal({ open, idp, saving, onCancel, onSubmit }: SsoIdpModalProps) {
  const { t } = useTranslation('platform');
  const [form] = Form.useForm<IdpFormValues>();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ name: idp?.name ?? '', description: idp?.description ?? '' });
  }, [open, idp, form]);

  return (
    <Modal
      open={open}
      title={idp ? t('ssoEditIdpTitle') : t('ssoAddIdp')}
      okText={t('ssoSaveIdp')}
      cancelText={t('cancel')}
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={onCancel}
      width={520}
      className="sso-modal"
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false} onFinish={onSubmit}>
        <Form.Item
          label={t('ssoIdpName')}
          name="name"
          rules={[{ required: true, whitespace: true, message: t('ssoIdpNameRequired') }]}
        >
          <Input maxLength={64} placeholder={t('ssoIdpNamePlaceholder')} />
        </Form.Item>
        <Form.Item label={t('ssoIdpDescription')} name="description">
          <Input.TextArea rows={3} maxLength={512} placeholder={t('ssoIdpDescriptionPlaceholder')} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface SsoConnectionModalProps {
  open: boolean;
  connection: FederationConnection | null;
  idps: FederationIdp[];
  channelProvider: string | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: ConnectionFormValues) => void;
}

function SsoConnectionModal({
  open,
  connection,
  idps,
  channelProvider,
  saving,
  onCancel,
  onSubmit,
}: SsoConnectionModalProps) {
  const { t } = useTranslation('platform');
  const [form] = Form.useForm<ConnectionFormValues>();
  const [protocol, setProtocol] = useState<FederationProtocol>('SAML2');
  const editing = Boolean(connection);
  const defaultIdpId = idps[0]?.id;
  const isSaml = protocol === 'SAML2';

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (connection) {
      const nextProtocol = normalizeProtocol(connection.protocol);
      setProtocol(nextProtocol);
      form.setFieldsValue({
        idpId: connection.idpId,
        protocol: nextProtocol,
        name: connection.name,
        enabled: connection.enabled === 1,
        issuer: connection.issuer ?? '',
        samlSsoUrl: connection.samlSsoUrl ?? '',
        samlCert: connection.samlCert ?? '',
        oidcAuthorizeUrl: connection.oidcAuthorizeUrl ?? '',
        oidcTokenUrl: connection.oidcTokenUrl ?? '',
        oidcJwksUrl: connection.oidcJwksUrl ?? '',
        clientId: connection.clientId ?? '',
        // 永不回显明文密钥：编辑态只看到“已配置”提示。
        clientSecret: '',
        scopes: connection.scopes ?? '',
        subjectClaim: connection.subjectClaim ?? '',
        nameClaim: connection.nameClaim ?? '',
        emailClaim: connection.emailClaim ?? '',
        usernameClaim: connection.usernameClaim ?? '',
        feishuUserIdClaim: connection.feishuUserIdClaim ?? '',
        autoProvision: connection.autoProvision,
        bindExistingByUsername: connection.bindExistingByUsername,
        defaultLogin: connection.defaultLogin,
        allowedTenants: connection.allowedTenants ?? '',
      });
      return;
    }
    setProtocol('SAML2');
    form.setFieldsValue({
      idpId: defaultIdpId,
      protocol: 'SAML2',
      name: '',
      enabled: false,
      issuer: '',
      samlSsoUrl: '',
      samlCert: '',
      oidcAuthorizeUrl: '',
      oidcTokenUrl: '',
      oidcJwksUrl: '',
      clientId: '',
      clientSecret: '',
      scopes: '',
      subjectClaim: '',
      nameClaim: '',
      emailClaim: '',
      usernameClaim: '',
      feishuUserIdClaim: '',
      autoProvision: false,
      bindExistingByUsername: false,
      defaultLogin: false,
      allowedTenants: '',
    });
  }, [open, connection, defaultIdpId, form]);

  const idpOptions = idps.map((idp) => ({ value: idp.id, label: idp.name }));
  const channelIsFeishu = channelProvider === 'FEISHU';
  const channelIsDingtalk = channelProvider === 'DINGTALK';

  return (
    <Modal
      open={open}
      title={editing ? t('ssoEditConnection') : t('ssoAddConnection')}
      okText={t('ssoSaveConnection')}
      cancelText={t('cancel')}
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={onCancel}
      width={760}
      className="sso-modal"
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false} onFinish={onSubmit}>
        <SectionTitle>{t('ssoBasicInfo')}</SectionTitle>
        <div className="sso-form-grid">
          <Form.Item
            label={t('ssoIdp')}
            name="idpId"
            rules={[{ required: true, message: t('ssoIdpRequired') }]}
          >
            <Select
              disabled={editing}
              options={idpOptions}
              placeholder={t('ssoIdpPlaceholder')}
            />
          </Form.Item>
          <Form.Item
            label={t('ssoProtocol')}
            name="protocol"
            rules={[{ required: true, message: t('ssoProtocolRequired') }]}
          >
            <Select
              disabled={editing}
              onChange={(value: FederationProtocol) => setProtocol(value)}
              options={[
                { value: 'SAML2', label: t('ssoProtocolSaml') },
                { value: 'OIDC', label: t('ssoProtocolOidc') },
              ]}
            />
          </Form.Item>
        </div>
        <Form.Item
          label={t('ssoConnectionName')}
          name="name"
          extra={t('ssoConnectionNameHint')}
          rules={[{ required: true, whitespace: true, message: t('ssoConnectionNameRequired') }]}
        >
          <Input maxLength={64} placeholder={t('ssoConnectionNamePlaceholder')} />
        </Form.Item>

        <SectionTitle>{t('ssoProtocolConfig')}</SectionTitle>
        <Form.Item
          label={t('ssoIssuer')}
          name="issuer"
          rules={[{ required: true, whitespace: true, message: t('ssoIssuerRequired') }]}
        >
          <Input
            placeholder={isSaml ? t('ssoIssuerSamlPlaceholder') : t('ssoIssuerOidcPlaceholder')}
          />
        </Form.Item>

        {isSaml ? (
          <>
            <Form.Item
              label={t('ssoSamlSsoUrl')}
              name="samlSsoUrl"
              rules={[{ required: true, whitespace: true, message: t('ssoSamlSsoUrlRequired') }]}
            >
              <Input placeholder={t('ssoSamlSsoUrlPlaceholder')} />
            </Form.Item>
            <Form.Item
              label={t('ssoSamlCert')}
              name="samlCert"
              extra={t('ssoSamlCertHint')}
              rules={[{ required: true, whitespace: true, message: t('ssoSamlCertRequired') }]}
            >
              <Input.TextArea rows={4} placeholder={t('ssoSamlCertPlaceholder')} />
            </Form.Item>
          </>
        ) : (
          <>
            <div className="sso-form-grid">
              <Form.Item
                label={t('ssoOidcAuthorizeUrl')}
                name="oidcAuthorizeUrl"
                rules={[{ required: true, whitespace: true, message: t('ssoOidcAuthorizeUrlRequired') }]}
              >
                <Input placeholder={t('ssoOidcAuthorizeUrlPlaceholder')} />
              </Form.Item>
              <Form.Item
                label={t('ssoOidcTokenUrl')}
                name="oidcTokenUrl"
                rules={[{ required: true, whitespace: true, message: t('ssoOidcTokenUrlRequired') }]}
              >
                <Input placeholder={t('ssoOidcTokenUrlPlaceholder')} />
              </Form.Item>
              <Form.Item
                label={t('ssoOidcJwksUrl')}
                name="oidcJwksUrl"
                rules={[{ required: true, whitespace: true, message: t('ssoOidcJwksUrlRequired') }]}
              >
                <Input placeholder={t('ssoOidcJwksUrlPlaceholder')} />
              </Form.Item>
              <Form.Item
                label={t('ssoClientId')}
                name="clientId"
                rules={[{ required: true, whitespace: true, message: t('ssoClientIdRequired') }]}
              >
                <Input placeholder={t('ssoClientIdPlaceholder')} />
              </Form.Item>
              <Form.Item
                label={t('ssoClientSecret')}
                name="clientSecret"
                extra={editing && connection?.clientSecretConfigured ? t('ssoClientSecretKeepHint') : undefined}
                rules={editing ? [] : [{ required: true, whitespace: true, message: t('ssoClientSecretRequired') }]}
              >
                <Input.Password
                  autoComplete="new-password"
                  placeholder={editing ? t('ssoClientSecretPlaceholder') : t('ssoClientSecretCreatePlaceholder')}
                />
              </Form.Item>
              <Form.Item label={t('ssoScopes')} name="scopes">
                <Input placeholder={t('ssoScopesPlaceholder')} />
              </Form.Item>
            </div>
            <Form.Item
              label={t('ssoAllowedTenants')}
              name="allowedTenants"
              extra={t('ssoAllowedTenantsHint')}
            >
              <Input placeholder={t('ssoAllowedTenantsPlaceholder')} />
            </Form.Item>
          </>
        )}

        <SectionTitle>{t('ssoAttributeMapping')}</SectionTitle>
        <p className="sso-hint sso-hint-tight">{t('ssoAttributeHint')}</p>
        <div className="sso-form-grid">
          <Form.Item label={t('ssoSubjectClaim')} name="subjectClaim">
            <Input placeholder={t('ssoSubjectClaimPlaceholder')} />
          </Form.Item>
          <Form.Item label={t('ssoNameClaim')} name="nameClaim">
            <Input placeholder={t('ssoNameClaimPlaceholder')} />
          </Form.Item>
          <Form.Item label={t('ssoEmailClaim')} name="emailClaim">
            <Input placeholder={t('ssoEmailClaimPlaceholder')} />
          </Form.Item>
          <Form.Item
            label={t('ssoUsernameClaim')}
            name="usernameClaim"
            extra={t('ssoUsernameClaimHint')}
          >
            <Input placeholder={t('ssoUsernameClaimPlaceholder')} maxLength={128} />
          </Form.Item>
          <Form.Item
            label={t('ssoFeishuUserIdClaim')}
            name="feishuUserIdClaim"
            extra={channelIsFeishu
              ? t('ssoFeishuClaimHintActive')
              : t('ssoFeishuClaimHintInactive', {
                channel: channelIsDingtalk ? t('ssoChannelDingtalk') : t('ssoChannelUnknown'),
              })}
          >
            <Input placeholder={t('ssoFeishuUserIdClaimPlaceholder')} maxLength={128} />
          </Form.Item>
        </div>

        <SectionTitle>{t('ssoConnectionStatus')}</SectionTitle>
        <div className="sso-switch-row">
          <div className="sso-switch-copy">
            <b>{t('ssoEnableConnection')}</b>
            <p>{t('ssoEnableConnectionHint')}</p>
          </div>
          <Form.Item name="enabled" valuePropName="checked" noStyle>
            <Switch size="small" aria-label={t('ssoEnableConnection')} />
          </Form.Item>
        </div>
        <Form.Item noStyle shouldUpdate={(prev, next) => prev.enabled !== next.enabled}>
          {({ getFieldValue }) => (
            <div className="sso-switch-row">
              <div className="sso-switch-copy">
                <b>{t('ssoDefaultLoginLabel')}</b>
                <p>{t('ssoDefaultLoginHint')}</p>
              </div>
              <Form.Item name="defaultLogin" valuePropName="checked" noStyle>
                <Switch size="small" aria-label={t('ssoDefaultLoginLabel')} disabled={!getFieldValue('enabled')} />
              </Form.Item>
            </div>
          )}
        </Form.Item>
        <div className="sso-switch-row">
          <div className="sso-switch-copy">
            <b>{t('ssoAutoProvisionLabel')}</b>
            <p>{t('ssoAutoProvisionHint')}</p>
          </div>
          <Form.Item name="autoProvision" valuePropName="checked" noStyle>
            <Switch size="small" aria-label={t('ssoAutoProvisionLabel')} />
          </Form.Item>
        </div>
        <Form.Item noStyle shouldUpdate={(prev, next) => prev.usernameClaim !== next.usernameClaim}>
          {({ getFieldValue }) => (
            <div className="sso-switch-row">
              <div className="sso-switch-copy">
                <b>{t('ssoBindExistingLabel')}</b>
                <p>{t('ssoBindExistingHint')}</p>
              </div>
              <Form.Item name="bindExistingByUsername" valuePropName="checked" noStyle>
                <Switch
                  size="small"
                  aria-label={t('ssoBindExistingLabel')}
                  // 新建连接默认跟随用户标识声明，未手填也可启用；既有连接没有声明时必须先显式配置。
                  disabled={editing && !text(getFieldValue('usernameClaim'))}
                />
              </Form.Item>
            </div>
          )}
        </Form.Item>
        {!editing && <p className="sso-hint">{t('ssoNewConnectionDisabledHint')}</p>}
        {editing && <p className="sso-hint">{t('ssoEditLockedHint')}</p>}
      </Form>
    </Modal>
  );
}
