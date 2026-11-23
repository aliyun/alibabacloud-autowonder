import { Fragment } from 'react';
import { Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { EmailVerificationPolicy } from './emailVerificationApi';

/** One read-only policy hint shared by registration, profile and restricted verification. */
export function EmailSuffixHint({ policy }: { policy?: EmailVerificationPolicy }) {
  const { t } = useTranslation('auth');
  if (!policy?.suffixRestrictionEnabled) return null;
  const domains = [...new Set(policy.allowedSuffixes.map(domain => domain.trim().replace(/^@/, '')).filter(Boolean))]
    .map(domain => `@${domain}`);
  return (
    <Typography.Text data-testid="email-suffix-hint" role="group" aria-label={t('restricted.allowedSuffixes')}
      type={domains.length ? 'secondary' : 'warning'}
      style={{ display: 'block', marginTop: 8, fontSize: 14, lineHeight: '22px', overflowWrap: 'anywhere' }}>
      {domains.length ? <>
        {t('restricted.suffixHintPrefix')}
        {domains.map((domain, index) => (
          <Fragment key={domain}>
            {index > 0 && t('restricted.suffixSeparator')}<span data-email-domain={domain}>{domain}</span>
          </Fragment>
        ))}
      </> : t('restricted.noAllowedSuffixes')}
    </Typography.Text>
  );
}
