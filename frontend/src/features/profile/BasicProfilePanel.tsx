import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { useEffect, useState } from 'react';
import { Button, Form, Input, Tag, message } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { NoticeTip } from '@/shared/ui/NoticeTip';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { USER_PROFILE_QUERY_KEY, getMyProfile, updateMyProfile, type MyProfile } from './profileApi';
import {
  EMAIL_VERIFICATION_POLICY_QUERY_KEY,
  fetchEmailVerificationPolicy,
  sendEmailCode,
  verifyEmailCode,
  type SendCodeResult,
} from '@/features/auth/emailVerificationApi';
import { useAuthStore } from '@/shared/auth/store';
import { EmailSuffixHint } from '@/features/auth/EmailSuffixHint';

type ProfileFormValues = {
  nickname: string;
  email: string;
  phone: string;
  emailVerificationCode?: string;
};

const PHONE_PATTERN = /^\+?[0-9][0-9 -]*$/;

function getApiMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function toFormValues(profile: MyProfile): ProfileFormValues {
  return {
    nickname: profile.nickname ?? '',
    email: profile.email ?? '',
    phone: profile.phone ?? '',
    emailVerificationCode: '',
  };
}

export function BasicProfilePanel() {
  const { t } = useTranslation('profile');
  const [form] = Form.useForm<ProfileFormValues>();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const [hydrated, setHydrated] = useState(false);
  const [challenge, setChallenge] = useState<SendCodeResult | null>(null);
  const [sentTo, setSentTo] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);

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
  useLocalizedValidation(form, !profileQuery.isError);
  const profile = profileQuery.data;
  const verificationEnabled = policyQuery.data?.verificationEnabled ?? false;
  const emailVerified = profile?.emailVerified ?? false;

  useEffect(() => {
    if (profileQuery.isSuccess && profile && !hydrated) {
      form.setFieldsValue(toFormValues(profile));
      setHydrated(true);
    }
  }, [form, profile, profileQuery.isSuccess, hydrated]);

  const nicknameValue = Form.useWatch('nickname', form) ?? '';
  const emailValue = Form.useWatch('email', form) ?? '';
  const phoneValue = Form.useWatch('phone', form) ?? '';
  const codeValue = Form.useWatch('emailVerificationCode', form) ?? '';
  const emailChanged = hydrated && profile != null && emailValue.trim() !== (profile.email ?? '');
  const needsVerification = verificationEnabled && (emailChanged || !emailVerified);
  const isDirty = hydrated && profile != null && (
    nicknameValue !== (profile.nickname ?? '')
    || emailValue !== (profile.email ?? '')
    || phoneValue !== (profile.phone ?? '')
  );
  const canSave = isDirty || (needsVerification && Boolean(codeValue.trim()));

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = window.setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  useEffect(() => {
    // 更换目标邮箱后旧验证码与发送状态一律作废。
    if (challenge && sentTo && emailValue.trim() !== sentTo) {
      setChallenge(null);
      setSentTo('');
      setSecondsLeft(0);
      form.setFieldValue('emailVerificationCode', '');
    }
  }, [challenge, emailValue, form, sentTo]);

  const sendCode = async () => {
    const email = emailValue.trim();
    if (!email.includes('@')) {
      message.error(t('basic.emailRequired'));
      return;
    }
    setSendingCode(true);
    try {
      const result = await sendEmailCode({ purpose: 'PROFILE_EMAIL', email });
      setChallenge(result);
      setSentTo(email);
      setSecondsLeft(policyQuery.data?.resendIntervalSeconds ?? 60);
      message.success(t('basic.sent'));
    } catch (error) {
      message.error(getApiMessage(error, t('basic.sendFailed')));
    } finally {
      setSendingCode(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const values = await form.validateFields();
      let proof: string | undefined;
      if (needsVerification) {
        const email = values.email.trim();
        if (!challenge || sentTo !== email || !values.emailVerificationCode) {
          throw new Error(t('basic.codeRequired'));
        }
        const verified = await verifyEmailCode({
          purpose: 'PROFILE_EMAIL',
          email,
          challengeId: challenge.challengeId,
          code: values.emailVerificationCode.trim(),
        });
        proof = verified.proof ?? undefined;
        if (!proof) {
          throw new Error(t('basic.verifyFailed'));
        }
      }
      return updateMyProfile({
        nickname: values.nickname.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
        emailVerificationProof: proof,
      });
    },
    onSuccess: async (data) => {
      message.success(i18n.t('profile:basic.saved'));
      form.setFieldsValue(toFormValues(data));
      setChallenge(null);
      setSentTo('');
      setSecondsLeft(0);
      // The authoritative server row refreshes the cache; the auth-store copy keeps its
      // tokens/permissions untouched so the top-bar nickname updates without re-login.
      const current = useAuthStore.getState().user;
      setUser({
        id: current?.id ?? data.id,
        username: current?.username ?? data.username,
        nickname: data.nickname ?? '',
        email: data.email ?? '',
        isAdmin: current?.isAdmin ?? null,
        phone: data.phone,
      });
      await queryClient.invalidateQueries({ queryKey: USER_PROFILE_QUERY_KEY });
    },
    onError: (error) => {
      message.error(getApiMessage(error, i18n.t('profile:basic.saveFailed')));
    },
  });

  const loading = profileQuery.isLoading || saveMutation.isPending;

  if (profileQuery.isError) {
    return (
      <section className="aw-card prof-panel" aria-label={t('basic.title')}>
        <div className="prof-sec-head">
          <div className="prof-sec-head-text">
            <b>{t('basic.title')}</b>
            <div className="prof-sec-desc">{t('basic.desc')}</div>
          </div>
        </div>
        <div className="prof-sec-body">
          <NoticeTip
            kind="error"
            title={t('basic.loadFailed')}
            detail={getApiMessage(profileQuery.error, t('retryLater'))}
            action={(
              <Button size="small" onClick={() => profileQuery.refetch()} loading={profileQuery.isFetching}>
                {t('retry')}
              </Button>
            )}
          />
        </div>
      </section>
    );
  }

  const verifiedNow = emailVerified && !emailChanged;
  const displayName = nicknameValue || profile?.nickname || profile?.username || '';
  const initial = Array.from(displayName || 'U')[0].toUpperCase();

  return (
    <section className="aw-card prof-panel" aria-label={t('basic.title')}>
      <div className="prof-sec-head">
        <div className="prof-sec-head-text">
          <b>{t('basic.title')}</b>
          <div className="prof-sec-desc">{t('basic.desc')}</div>
        </div>
        {verificationEnabled ? (
          <div className="prof-sec-extra">
            <Tag color={verifiedNow ? 'green' : 'gold'}>{verifiedNow ? t('basic.verified') : t('basic.pending')}</Tag>
          </div>
        ) : null}
      </div>
      <div className="prof-sec-body">
        <Form
          form={form}
          layout="vertical"
          disabled={loading}
          onFinish={() => saveMutation.mutate()}
        >
          <div className="prof-idcard">
            <span className="prof-avatar" aria-hidden="true">{initial}</span>
            <div className="prof-idcard-main">
              <div className="prof-idcard-name">
                {displayName}
                {verificationEnabled && !verifiedNow ? <Tag color="gold">{t('basic.pending')}</Tag> : null}
              </div>
              <div className="prof-idcard-sub" title={t('basic.identityLine', { username: profile?.username ?? '', email: profile?.email ?? '' })}>
                {t('basic.identityLine', { username: profile?.username ?? '', email: profile?.email ?? '' })}
              </div>
            </div>
            <div className="prof-idcard-right">{t('basic.usernameHint')}</div>
          </div>

          <div className="prof-grid-2">
            <Form.Item
              label={t('basic.nickname')}
              name="nickname"
              extra={t('basic.nicknameHint')}
              rules={[
                { required: true, whitespace: true, message: t('basic.nicknameRequired') },
                { max: 64, message: t('basic.nicknameMax') },
              ]}
            >
              <Input placeholder={t('basic.nicknameRequired')} maxLength={64} autoComplete="off" />
            </Form.Item>

            <Form.Item
              label={t('basic.phone')}
              name="phone"
              extra={t('basic.phoneHint')}
              rules={[
                { max: 32, message: t('basic.phoneMax') },
                { pattern: PHONE_PATTERN, message: t('basic.phoneInvalid') },
              ]}
            >
              <Input placeholder={t('basic.phonePlaceholder')} maxLength={32} autoComplete="off" />
            </Form.Item>
          </div>

          <Form.Item
            label={(
              <span data-testid="profile-email-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {t('basic.email')}
                {verificationEnabled && <Tag data-testid="profile-email-verification-status" color={verifiedNow ? 'green' : 'gold'} style={{ margin: 0 }}>
                  {verifiedNow ? t('basic.verified') : t('basic.pending')}
                </Tag>}
              </span>
            )}
            name="email"
            extra={policyQuery.data?.suffixRestrictionEnabled
              ? <EmailSuffixHint policy={policyQuery.data} />
              : needsVerification ? t('basic.hint') : t('basic.emailHint')}
            validateFirst
            rules={[
              { required: true, whitespace: true, message: t('basic.emailMissing') },
              { type: 'email', message: t('basic.emailInvalid') },
              { max: 128, message: t('basic.emailMax') },
            ]}
          >
            <Input aria-label={t('basic.email')} placeholder={t('basic.emailPlaceholder')} maxLength={128} autoComplete="off" />
          </Form.Item>

          {needsVerification && (
            <Form.Item
              label={t('basic.codeLabel')}
              name="emailVerificationCode"
              rules={[{ required: true, message: t('basic.codeRequired') }]}
            >
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                addonAfter={(
                  <Button
                    type="text"
                    htmlType="button"
                    onClick={sendCode}
                    loading={sendingCode}
                    disabled={secondsLeft > 0}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {secondsLeft > 0
                      ? t('basic.resendIn', { seconds: secondsLeft })
                      : challenge ? t('basic.resend') : t('basic.sendCode')}
                  </Button>
                )}
              />
            </Form.Item>
          )}

          <div className="prof-actions">
            <span className="prof-actions-left prof-foot-hint">
              {profileQuery.isSuccess && !canSave ? t('basic.unchanged') : ''}
            </span>
            <Button aria-label={t('basic.save')}
              type="primary"
              htmlType="submit"
              icon={<AwStrokeIcon name="check" />}
              loading={saveMutation.isPending}
              disabled={!canSave}
            >{t('basic.save')}</Button>
          </div>
        </Form>
      </div>
    </section>
  );
}
