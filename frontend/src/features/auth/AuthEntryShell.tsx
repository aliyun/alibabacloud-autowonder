import { i18n } from '@/shared/i18n';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { PlatformBrand } from '@/shared/ui/PlatformBrand';
import { HelpCenterLink } from '@/shared/ui/HelpCenterLink';
import { LanguageSwitch } from '@/shared/i18n/LanguageSwitch';
import { AppearanceSwitch } from '@/shared/theme/AppearanceProvider';
import './AuthEntryShell.css';

const flowSteps = [
  { get label() { return i18n.t('auth:intro.clarification'); } },
  { get label() { return i18n.t('auth:intro.start'); } },
  { get label() { return i18n.t('auth:intro.develop'); } },
  { get label() { return i18n.t('auth:intro.verify'); } },
  { get label() { return i18n.t('auth:intro.review'); } },
  { get label() { return i18n.t('auth:intro.deploy'); } },
  { get label() { return i18n.t('auth:intro.test'); } },
  { get label() { return i18n.t('auth:intro.deliver'); } },
];

export function AuthEntryShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation('auth');
  return (
    <>
      <header className="login-topbar">
        <PlatformBrand to="/workspaces" />
        <div className="login-topbar-right">
          <HelpCenterLink />
          <LanguageSwitch />
          <AppearanceSwitch />
        </div>
      </header>
      <main className="login-hero">
        <section className="login-story" aria-label={t('intro.label')}>
          <p className="login-story-eyebrow">{t('intro.eyebrow')}</p>
          <h1>{t('intro.title')}</h1>
          <p className="login-story-sub">{t('intro.sub')}</p>
          <figure className="login-flow" aria-label={t('intro.diagram')}>
            <svg className="flow-track" viewBox="0 0 432 204" preserveAspectRatio="none" aria-hidden="true">
              <path className="flow-track-base" d="M54 22 H392 Q414 22 414 44 V140 Q414 162 392 162 H40 Q18 162 18 140 V44 Q18 22 40 22 Z" />
              <path className="flow-track-current" pathLength="100" d="M54 22 H392 Q414 22 414 44 V140 Q414 162 392 162 H40 Q18 162 18 140 V44 Q18 22 40 22 Z" />
            </svg>
            <ol className="flow-nodes">
              {flowSteps.map((step, index) => (
                <li key={step.label} className={index >= 2 && index <= 6 ? 'flow-node flow-node--hot' : 'flow-node'}
                  style={{ gridColumn: index < 4 ? index + 1 : 8 - index, gridRow: index < 4 ? 1 : 2 }}>
                  <span className="flow-step">
                    <span className="flow-dot" aria-hidden="true">{index + 1}</span>
                    <span className="flow-label" title={step.label}>{step.label}</span>
                  </span>
                </li>
              ))}
            </ol>
            <figcaption className="flow-loop">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
              {t('intro.iterate')}
            </figcaption>
          </figure>
        </section>
        <section className="login-entry-form" aria-label={t('intro.account')}>{children}</section>
      </main>
    </>
  );
}
