import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { i18n } from '@/shared/i18n';
import { EmailSuffixHint } from './EmailSuffixHint';
import type { EmailVerificationPolicy } from './emailVerificationApi';

const policy = (verificationEnabled: boolean, suffixRestrictionEnabled: boolean, allowedSuffixes = ['example.com']): EmailVerificationPolicy => ({
  verificationEnabled, suffixRestrictionEnabled, allowedSuffixes,
  codeLength: 6, codeTtlSeconds: 600, resendIntervalSeconds: 60, maxAttempts: 5,
});

afterEach(async () => { await i18n.changeLanguage('zh-CN'); });

describe.each(['zh-CN', 'en-US'])('EmailSuffixHint in %s', locale => {
  it.each([[false, false], [false, true], [true, false], [true, true]])(
    'uses only suffix restriction (verification=%s, suffix=%s)', async (verification, suffix) => {
      await i18n.changeLanguage(locale);
      render(<EmailSuffixHint policy={policy(verification, suffix)} />);
      if (suffix) expect(screen.getByTestId('email-suffix-hint')).toHaveTextContent('@example.com');
      else expect(screen.queryByTestId('email-suffix-hint')).toBeNull();
    },
  );

  it('keeps the empty-list warning when verification is disabled', async () => {
    await i18n.changeLanguage(locale);
    render(<EmailSuffixHint policy={policy(false, true, [])} />);
    expect(screen.getByTestId('email-suffix-hint')).toHaveTextContent(locale === 'zh-CN'
      ? '尚未配置可用邮箱后缀，请联系管理员。'
      : 'No allowed email domains are configured. Contact an administrator.');
  });
});

it('keeps suffixes normalized, deduplicated and read-only', () => {
  render(<EmailSuffixHint policy={policy(false, true, [' example.com ', '@example.com', '@team.example', ' '])} />);
  const hint = screen.getByTestId('email-suffix-hint');
  expect(hint.querySelectorAll('[data-email-domain]')).toHaveLength(2);
  expect(within(hint).getByText('@example.com')).toBeInTheDocument();
  expect(within(hint).getByText('@team.example')).toBeInTheDocument();
  expect(hint.querySelectorAll('input, button, .ant-tag')).toHaveLength(0);
});

it('does not invent a restriction before the policy is available', () => {
  render(<EmailSuffixHint />);
  expect(screen.queryByTestId('email-suffix-hint')).toBeNull();
});
