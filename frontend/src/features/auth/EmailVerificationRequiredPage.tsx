import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Typography } from 'antd';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/shared/auth/store';
import {
  sendEmailCode,
  signOutRestricted,
  verifyEmailCode,
  EMAIL_VERIFICATION_POLICY_QUERY_KEY,
  fetchEmailVerificationPolicy,
} from './emailVerificationApi';
import { useQuery } from '@tanstack/react-query';
import { AuthEntryShell } from './AuthEntryShell';
import { EmailSuffixHint } from './EmailSuffixHint';

const { Title } = Typography;

/**
 * 受限验证页：只接受登录/SSO 完成时取得的 15 分钟受限凭证，
 * 可验证或更换邮箱；验证成功后服务端重新签发正常会话。
 */
export function EmailVerificationRequiredPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const restrictedToken = useAuthStore((s) => s.restrictedToken);
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);
  const setRestrictedToken = useAuthStore((s) => s.setRestrictedToken);
  const clearSession = useAuthStore((s) => s.clearSession);

  const [editedEmail, setEmail] = useState<string>();
  const email = editedEmail ?? user?.email ?? '';
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const policyQuery = useQuery({
    queryKey: EMAIL_VERIFICATION_POLICY_QUERY_KEY,
    queryFn: fetchEmailVerificationPolicy,
    retry: false,
  });

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = window.setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  if (!restrictedToken) {
    return <Navigate to={accessToken ? '/workspaces' : '/login'} replace />;
  }

  const sendCode = async () => {
    const target = email.trim();
    if (!target.includes('@')) {
      setError(t('emailVerification.emailRequired'));
      return;
    }
    setError(null);
    setSending(true);
    try {
      const result = await sendEmailCode({ purpose: 'RESTRICTED', email: target }, restrictedToken);
      setChallengeId(result.challengeId);
      setSentTo(target);
      setCode('');
      setSecondsLeft(policyQuery.data?.resendIntervalSeconds ?? 60);
    } catch (e) {
      setChallengeId(null);
      setError(e instanceof Error && e.message ? e.message : t('emailVerification.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    const target = email.trim();
    if (!challengeId || sentTo !== target || !code.trim()) {
      setError(t('emailVerification.codeRequired'));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await verifyEmailCode({
        purpose: 'RESTRICTED',
        email: target,
        challengeId,
        code: code.trim(),
      }, restrictedToken);
      const session = result.session;
      if (!session) {
        setError(t('emailVerification.verifyFailed'));
        return;
      }
      setTokens(session.accessToken, session.refreshToken);
      setUser(session.user);
      setRestrictedToken(null);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('emailVerification.verifyFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const signOut = async () => {
    try {
      await signOutRestricted(restrictedToken);
    } catch {
      // 退出以本地清理为准，服务端凭证到期后自然失效。
    }
    clearSession();
    navigate('/login', { replace: true });
  };

  return (
    <AuthEntryShell>
      <Card className="auth-entry-card" variant="borderless">
        <Title level={3} className="auth-entry-title">{t('restricted.title')}</Title>
        <Alert
          type="warning"
          showIcon
          message={t('restricted.notice')}
          style={{ marginBottom: 16 }}
        />
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="restricted-username" style={{ display: 'inline-block', marginBottom: 8 }}>
            {t('restricted.usernameLabel')}
          </label>
          <Input id="restricted-username" value={user?.username ?? ''} readOnly autoComplete="username" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="restricted-email" style={{ display: 'inline-block', marginBottom: 8 }}>
            {t('restricted.emailLabel')}
          </label>
          <Input
            id="restricted-email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
              setChallengeId(null);
              setSentTo('');
              setCode('');
              setSecondsLeft(0);
            }}
            autoComplete="email"
          />
          {policyQuery.isError ? (
            <Alert type="warning" showIcon style={{ marginTop: 8 }}
              message={t('restricted.policyUnavailable')}
              action={<Button size="small" onClick={() => { void policyQuery.refetch(); }}>{t('restricted.retryPolicy')}</Button>} />
          ) : <EmailSuffixHint policy={policyQuery.data} />}
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="restricted-code" style={{ display: 'inline-block', marginBottom: 8 }}>
            {t('restricted.codeLabel')}
          </label>
          <div className="code-row" style={{ display: 'flex', gap: 8 }}>
            <Input
              id="restricted-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
            />
            <Button
              htmlType="button"
              onClick={sendCode}
              loading={sending}
              disabled={secondsLeft > 0}
              style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {secondsLeft > 0
                ? t('restricted.resendIn', { seconds: secondsLeft })
                : t('restricted.sendCode')}
            </Button>
          </div>
        </div>
        <Button type="primary" block onClick={verify} loading={submitting}>
          {t('restricted.verify')}
        </Button>
        <div className="auth-entry-link" style={{ marginTop: 12 }}>
          <Button type="link" onClick={signOut}>{t('restricted.signOut')}</Button>
        </div>
      </Card>
    </AuthEntryShell>
  );
}
