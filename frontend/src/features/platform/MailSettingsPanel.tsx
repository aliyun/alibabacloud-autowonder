import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Radio, Select, Space, Switch, Tag, message } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale } from '@/shared/i18n/LocaleProvider';
import { formatDateTime } from '@/shared/i18n/format';
import { EMAIL_VERIFICATION_POLICY_QUERY_KEY } from '@/features/auth/emailVerificationApi';
import './MailSettingsPanel.css';
import {
  MAIL_SETTINGS_QUERY_KEY,
  PLATFORM_EMAIL_POLICY_QUERY_KEY,
  fetchMailSettings,
  fetchPlatformEmailPolicy,
  saveMailSettings,
  testMailSettings,
  updatePlatformEmailPolicy,
  type SaveMailSettingsPayload,
  type UpdateEmailVerificationPolicyPayload,
} from './mailSettingsApi';

type MailFormValues = {
  host: string;
  port: number;
  security: 'STARTTLS' | 'SSL' | 'NONE';
  fromAddress: string;
  fromName?: string;
  authMode: 'PASSWORD' | 'NONE';
  username?: string;
  password?: string;
};

function apiMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function normalizeSuffixes(values: readonly string[]) {
  return [...new Set(values.map(value => value.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))]
    .map(domain => `@${domain}`);
}

/** 平台邮件发送配置与邮箱验证策略（仅平台管理员可见的 tab）。 */
export function MailSettingsPanel() {
  const { t } = useTranslation('platform');
  const { locale } = useLocale();
  const [form] = Form.useForm<MailFormValues>();
  const queryClient = useQueryClient();
  const [testRecipient, setTestRecipient] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [suffixes, setSuffixes] = useState<string[]>();
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);

  const settingsQuery = useQuery({
    queryKey: MAIL_SETTINGS_QUERY_KEY,
    queryFn: fetchMailSettings,
    retry: false,
  });
  const policyQuery = useQuery({
    queryKey: PLATFORM_EMAIL_POLICY_QUERY_KEY,
    queryFn: fetchPlatformEmailPolicy,
    retry: false,
  });
  const settings = settingsQuery.data;
  const policy = policyQuery.data;
  const hydratedRef = useState({ done: false })[0];
  const testedAtText = useMemo(
    () => (settings?.testedAt ? formatDateTime(settings.testedAt) : null),
    // locale 参与依赖，语言切换后按当前语言重新格式化。
    [settings?.testedAt, locale],
  );

  const security = Form.useWatch('security', form);
  const authMode = Form.useWatch('authMode', form);
  const noAuth = authMode === 'NONE';
  const plainConnection = security === 'NONE';

  useEffect(() => {
    if (settingsQuery.isSuccess && settings && !hydratedRef.done) {
      hydratedRef.done = true;
      form.setFieldsValue({
        host: settings.host ?? '',
        port: settings.port ?? 587,
        security: (settings.security as MailFormValues['security']) ?? 'STARTTLS',
        fromAddress: settings.fromAddress ?? '',
        fromName: settings.fromName ?? '',
        authMode: (settings.authMode as MailFormValues['authMode']) ?? 'PASSWORD',
        username: settings.username ?? '',
        password: '',
      });
    }
  }, [form, hydratedRef, settings, settingsQuery.isSuccess]);

  const parsedSuffixes = suffixes ?? normalizeSuffixes(policy?.allowedSuffixes ?? []);

  const buildPayload = (): SaveMailSettingsPayload => {
    const values = form.getFieldsValue();
    return {
      host: (values.host ?? '').trim(),
      port: Number(values.port),
      security: values.security ?? 'STARTTLS',
      fromAddress: (values.fromAddress ?? '').trim(),
      fromName: values.fromName?.trim() || undefined,
      authMode: values.authMode ?? 'PASSWORD',
      username: values.authMode === 'NONE' ? undefined : values.username?.trim(),
      password: values.password?.trim() || undefined,
      expectedVersion: settings?.draftVersion ?? 0,
    };
  };

  const save = async () => {
    if (saving || testing) return;
    setSaving(true);
    try {
      const payload = buildPayload();
      await saveMailSettings(payload);
      clearStoredPassword(payload.password);
      message.success(t('mail.saved'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MAIL_SETTINGS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: PLATFORM_EMAIL_POLICY_QUERY_KEY }),
      ]);
    } catch (error) {
      message.error(apiMessage(error, t('mail.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (saving || testing) return;
    if (!testRecipient.trim()) {
      setTestResult({ ok: false, text: t('mail.invalid') });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const payload = buildPayload();
      const result = await testMailSettings({ ...payload, recipient: testRecipient.trim() });
      if (result.success) clearStoredPassword(payload.password);
      setTestResult({
        ok: result.success,
        text: result.success
          ? t('mail.testPassed')
          : t('mail.testFailedWithCode', { code: result.failureCode ?? '-' }),
      });
      await queryClient.invalidateQueries({ queryKey: MAIL_SETTINGS_QUERY_KEY });
    } catch (error) {
      setTestResult({ ok: false, text: apiMessage(error, t('mail.invalid')) });
    } finally {
      setTesting(false);
    }
  };

  const clearStoredPassword = (submitted: string | undefined) => {
    // A successful request stored this secret; retain any newer unsent edit.
    if (submitted && form.getFieldValue('password')?.trim() === submitted) {
      form.setFieldValue('password', '');
    }
  };

  const updatePolicy = async (changes: Omit<UpdateEmailVerificationPolicyPayload, 'expectedVersion'>) => {
    setPolicySaving(true);
    try {
      await updatePlatformEmailPolicy({ ...changes, expectedVersion: policy?.version ?? 0 });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PLATFORM_EMAIL_POLICY_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: EMAIL_VERIFICATION_POLICY_QUERY_KEY }),
      ]);
      message.success(t('mail.saved'));
    } catch (error) {
      message.error(apiMessage(error, t('mail.verificationSaveFailed')));
    } finally {
      setPolicySaving(false);
    }
  };

  const toggleVerification = async (next: boolean) => {
    if (!next) {
      setDisableConfirmOpen(true);
      return;
    }
    await updatePolicy({ verificationEnabled: true });
  };

  const toggleForce = async (next: boolean) => {
    if (next && policy?.verificationEnabled) {
      setForceConfirmOpen(true);
      return;
    }
    await updatePolicy({ forceExistingEnabled: next });
  };

  const saveSuffix = async () => {
    await updatePolicy({
      suffixRestrictionEnabled: policy?.suffixRestrictionEnabled ?? false,
      allowedSuffixes: parsedSuffixes,
    });
  };

  if (settingsQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message={t('mail.saveFailed')}
        description={apiMessage(settingsQuery.error, t('mail.invalid'))}
      />
    );
  }

  return (
    <div className="aw-mail-settings">
      <Card
        className="aw-platform-message-card"
        title={(
          <div className="aw-config-card-title">
            <span>{t('mail.title')}</span>
            <div className="aw-config-tags" aria-live="polite">
              <Tag color={settings?.activeConfigured ? 'green' : undefined} className={settings?.activeConfigured ? undefined : 'aw-tag-gray'}>
                {settings?.activeConfigured ? t('mail.configured') : t('mail.notConfigured')}
              </Tag>
              <Tag color={settings?.activeTested ? 'green' : 'orange'}>
                {settings?.activeTested ? t('mail.tested') : t('mail.notTested')}
              </Tag>
            </div>
          </div>
        )}
        extra={<Button type="primary" onClick={save} loading={saving} disabled={testing}>{t('mail.save')}</Button>}
        style={{ marginBottom: 12 }}
      >
        <p className="mail-hint">{t('mail.hint')}</p>
        <Form
          form={form}
          layout="vertical"
          className="mail-form"
          onValuesChange={(changed) => {
            // 不加密与密码认证互斥：任一方向变化都自动联动，保证保存载荷合法。
            if (changed.security === 'NONE') {
              form.setFieldValue('authMode', 'NONE');
            } else if (changed.authMode === 'PASSWORD'
                && form.getFieldValue('security') === 'NONE') {
              form.setFieldValue('security', 'STARTTLS');
            }
          }}
        >
          <div className="mail-form-grid">
            <Form.Item label={t('mail.host')} name="host" rules={[{ required: true, message: t('mail.invalid') }]}>
              <Input />
            </Form.Item>
            <Form.Item label={t('mail.port')} name="port" rules={[{ required: true, message: t('mail.invalid') }]}>
              <Input type="number" min={1} max={65535} />
            </Form.Item>
          </div>

          <Form.Item label={t('mail.security')} name="security">
            <Radio.Group className="mail-choice-group">
              <Radio value="STARTTLS">
                <span>
                  <strong>{t('mail.securityStarttls')}</strong>
                  <small>{t('mail.securityStarttlsHint')}</small>
                </span>
              </Radio>
              <Radio value="SSL">
                <span>
                  <strong>{t('mail.securitySsl')}</strong>
                  <small>{t('mail.securitySslHint')}</small>
                </span>
              </Radio>
              <Radio value="NONE">
                <span>
                  <strong>{t('mail.securityNone')}</strong>
                  <small>{t('mail.securityNoneHint')}</small>
                </span>
              </Radio>
            </Radio.Group>
          </Form.Item>
          {plainConnection && (
            <Alert type="warning" showIcon message={t('mail.plainWarning')} style={{ marginBottom: 16 }} />
          )}

          <div className="mail-form-grid">
            <Form.Item label={t('mail.fromAddress')} name="fromAddress" rules={[{ required: true, type: 'email', message: t('mail.invalid') }]}>
              <Input />
            </Form.Item>
            <Form.Item label={t('mail.fromName')} name="fromName">
              <Input />
            </Form.Item>
          </div>

          <Form.Item label={t('mail.authMode')} name="authMode">
            <Radio.Group className="mail-auth-group">
              <Radio value="PASSWORD">{t('mail.authPassword')}</Radio>
              <Radio value="NONE">{t('mail.authNone')}</Radio>
            </Radio.Group>
          </Form.Item>
          {!noAuth && (
            <div className="mail-form-grid">
              <Form.Item label={t('mail.username')} name="username" rules={[{ required: true, message: t('mail.invalid') }]}>
                <Input />
              </Form.Item>
              <Form.Item label={t('mail.password')} name="password">
                <Input.Password autoComplete="new-password" />
              </Form.Item>
            </div>
          )}
          {!noAuth && <p className="mail-hint mail-hint-tight">{t('mail.passwordHint')}</p>}

          <div className="mail-test-block">
            <h4>{t('mail.testTitle')}</h4>
            <Space.Compact className="mail-test-combo" style={{ width: '100%', maxWidth: 580 }}>
              <Input
                aria-label={t('mail.testRecipient')}
                placeholder={t('mail.testRecipient')}
                type="email"
                value={testRecipient}
                onChange={(event) => setTestRecipient(event.target.value)}
              />
              <Button htmlType="button" onClick={runTest} loading={testing} disabled={saving}>{t('mail.sendTest')}</Button>
            </Space.Compact>
            <p className="mail-test-hint">{t('mail.testHint')}</p>
            {testResult && (
              <Alert className="mail-test-alert" type={testResult.ok ? 'success' : 'error'} showIcon message={testResult.text} />
            )}
            {testedAtText && <div className="mail-test-time">{t('mail.testAt', { time: testedAtText })}</div>}
          </div>
        </Form>
      </Card>

      <Card className="aw-platform-message-card" style={{ marginBottom: 12 }}>
        <div className="mail-policy-row">
          <div className="mail-policy-copy">
            <h3>{t('mail.verificationTitle')}</h3>
            <p className="mail-policy-hint">{t('mail.verificationHint')}</p>
          </div>
          <div className="mail-switch-wrap">
            <span className="mail-switch-state">
              {policy?.verificationEnabled ? t('mail.verificationOn') : t('mail.verificationOff')}
            </span>
            <Switch
              size="small"
              aria-label={t('mail.verificationTitle')}
              checked={policy?.verificationEnabled ?? false}
              disabled={policySaving || !policy}
              onChange={toggleVerification}
            />
          </div>
        </div>
      </Card>

      <Card className="aw-platform-message-card" style={{ marginBottom: 12 }}>
        <div className="mail-policy-row">
          <div className="mail-policy-copy">
            <h3>{t('mail.suffixTitle')}</h3>
            <p className="mail-policy-hint">{t('mail.suffixHint')}</p>
          </div>
          <div className="mail-switch-wrap">
            <span className="mail-switch-state">
              {policy?.suffixRestrictionEnabled ? t('mail.verificationOn') : t('mail.verificationOff')}
            </span>
            <Switch
              size="small"
              aria-label={t('mail.suffixTitle')}
              checked={policy?.suffixRestrictionEnabled ?? false}
              disabled={policySaving || !policy}
              onChange={(next) => updatePolicy({
                suffixRestrictionEnabled: next,
                allowedSuffixes: parsedSuffixes,
              })}
            />
          </div>
        </div>
        <div className="mail-suffix-field">
          <label htmlFor="mail-suffixes" className="mail-field-label">{t('mail.suffixLabel')}</label>
          <Select
            id="mail-suffixes"
            mode="tags"
            value={parsedSuffixes}
            onChange={values => setSuffixes(normalizeSuffixes(values))}
            tokenSeparators={[',', '，']}
            open={false}
            style={{ width: '100%' }}
            placeholder={t('mail.suffixPlaceholder')}
          />
          <div className="mail-inline-actions">
            <Button htmlType="button" onClick={saveSuffix} loading={policySaving}>{t('mail.suffixSave')}</Button>
          </div>
        </div>
      </Card>

      <Card className="aw-platform-message-card">
        <div className="mail-policy-row">
          <div className="mail-policy-copy">
            <h3>{t('mail.forceTitle')}</h3>
            <p className="mail-policy-danger">{t('mail.forceHint')}</p>
          </div>
          <div className="mail-switch-wrap">
            <span className="mail-switch-state">
              {policy?.forceExistingEnabled ? t('mail.forceOn') : t('mail.forceOff')}
            </span>
            <Switch
              size="small"
              aria-label={t('mail.forceTitle')}
              checked={policy?.forceExistingEnabled ?? false}
              disabled={policySaving || !policy?.verificationEnabled}
              onChange={toggleForce}
            />
          </div>
        </div>
      </Card>

      <Modal
        open={disableConfirmOpen}
        title={t('mail.disableConfirmTitle')}
        okText={t('mail.disableConfirmOk')}
        cancelText={t('mail.cancel')}
        okButtonProps={{ danger: true }}
        onCancel={() => setDisableConfirmOpen(false)}
        onOk={async () => {
          setDisableConfirmOpen(false);
          await updatePolicy({ verificationEnabled: false, confirmDisableVerification: true });
        }}
      >
        <p>{t('mail.disableConfirmContent')}</p>
      </Modal>

      <Modal
        open={forceConfirmOpen}
        title={t('mail.forceConfirmTitle')}
        okText={t('mail.forceConfirmOk')}
        cancelText={t('mail.cancel')}
        okButtonProps={{ danger: true }}
        onCancel={() => setForceConfirmOpen(false)}
        onOk={async () => {
          setForceConfirmOpen(false);
          await updatePolicy({ forceExistingEnabled: true });
        }}
      >
        <p>{t('mail.forceConfirmContent')}</p>
        <Alert type="error" showIcon message={t('mail.forceConfirmAlert')} style={{ marginTop: 12 }} />
      </Modal>
    </div>
  );
}
