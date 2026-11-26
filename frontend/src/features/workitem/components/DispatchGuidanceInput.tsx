import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Typography } from 'antd';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { useTranslation } from 'react-i18next';
import { getDispatchGuidance, sendDispatchGuidance, type DispatchGuidance } from '../api';
import { createUuidV4 } from '@/shared/lib/uuid';
import './DispatchGuidanceInput.css';

export function DispatchGuidanceInput({ dispatchId }: { dispatchId: number }) {
  const { t } = useTranslation('workitem');
  const access = useAccessCommand();
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<DispatchGuidance[]>([]);
  const request = useRef<{ content: string; key: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try { const rows = await getDispatchGuidance(dispatchId); if (mounted.current) setHistory(rows); }
      catch { /* Submission errors are shown separately; a refresh preserves existing history. */ }
      finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [dispatchId]);
  const send = async () => {
    if (sending || !content.trim()) return;
    const text = content;
    if (request.current?.content !== text) request.current = { content: text, key: createUuidV4() };
    setSending(true); setError(null);
    try {
      const rows = await sendDispatchGuidance(dispatchId, text, request.current.key);
      if (mounted.current) { setHistory(rows); setContent(''); request.current = null; }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : t('runtimeLog.guidance.failed')); }
    finally { if (mounted.current) setSending(false); }
  };
  return <section className="dispatch-guidance" aria-label={t('runtimeLog.guidance.title')}>
    <div className="dispatch-guidance-box">
      <Input.TextArea className="dispatch-guidance-text" variant="borderless" aria-label={t('runtimeLog.guidance.title')} placeholder={t('runtimeLog.guidance.placeholder')} value={content}
        maxLength={16000} autoSize={{ minRows: 2, maxRows: 2 }} disabled={sending}
        onChange={e => setContent(e.target.value)} />
      <div className="dispatch-guidance-row">
        <span className="dispatch-guidance-hint">{t('runtimeLog.guidance.hint')}</span>
        <Button type="primary" size="small" className="dispatch-guidance-send" loading={sending} disabled={!content.trim()} onClick={() => access('READ_WRITE', t('runtimeLog.guidance.send'), () => void send(), 'DISPATCH')}>{t('runtimeLog.guidance.send')}</Button>
      </div>
    </div>
    {error && <Alert type="error" showIcon message={error} style={{ marginTop: 8 }} />}
    {history.map(row => <div key={row.id} style={{ marginTop: 8 }}>
      <Typography.Text type="secondary">{t('runtimeLog.guidance.actor', { id: row.actorId })}{t(`runtimeLog.guidance.status.${row.status}`)}</Typography.Text>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.content}</div>
      {row.error && <Alert type="error" message={row.error} />}
    </div>)}
  </section>;
}
