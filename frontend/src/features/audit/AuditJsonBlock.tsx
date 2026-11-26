import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { Button, message } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { copyTextToClipboard } from '@/shared/lib/clipboard';
import './AuditLogPageV2.css';

function jsonTokenClass(token: string): string {
  if (token.startsWith('"')) return token.endsWith(':') ? 'audit-jk' : 'audit-js';
  return /^(true|false|null)$/.test(token) ? 'audit-jb' : 'audit-jn';
}

export function AuditJsonBlock({ titleKey, value }: { titleKey: 'fullRecord' | 'eventDetail'; value: object }) {
  const { t } = useTranslation('audit');
  const title = t(titleKey);
  const text = JSON.stringify(value, null, 2);
  // JSON.stringify supplies valid JSON; render tokens as React text, never HTML.
  const tokens = text.split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g);

  async function copy() {
    if (await copyTextToClipboard(text)) message.success(i18n.t('audit:copiedNamed', { title: i18n.t(`audit:${titleKey}`) }));
    else message.error(i18n.t('audit:copyFailed'));
  }

  return (
    <section aria-label={title} className="audit-json-sec">
      <div className="audit-json-head">
        <div className="audit-json-title">{title}</div>
        <Button size="small" icon={<AwStrokeIcon name="copy" />} aria-label={t('copyNamed', { title })} onClick={() => void copy()}>{t('copy')}</Button>
      </div>
      <pre className="audit-json-box">
        <code>{tokens.map((token, index) => {
          if (index % 2 === 0) return token;
          return <span key={index} className={jsonTokenClass(token)}>{token}</span>;
        })}</code>
      </pre>
    </section>
  );
}
