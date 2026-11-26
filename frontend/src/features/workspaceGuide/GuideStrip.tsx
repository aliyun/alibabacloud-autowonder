import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { GuideStepper } from './GuideStepper';
import { runGuideAction, useGuideRuntime, type GuideNoticeKind } from './bridge';

const noticeKeys: Record<GuideNoticeKind, 'advanceFailed' | 'skipFailed' | 'sendFailed' | 'reserveFailed' | 'conflict'> = {
  advance: 'advanceFailed',
  skip: 'skipFailed',
  send: 'sendFailed',
  reserve: 'reserveFailed',
  conflict: 'conflict',
};

type RowTone = 'error' | 'warn' | 'info';

interface StripRow {
  tone: RowTone;
  text: string;
  retry?: () => void;
}

/**
 * 单面板讲解条：固定在 Chief 面板顶部，承担三段进度、一句指令与退出入口。
 * 只有接入与初始化两个阶段会渲染——发送受理即完成，收尾用一次性提示代替。
 */
export function GuideStrip() {
  const { t } = useTranslation('workspaceGuide');
  const runtime = useGuideRuntime();
  if (!runtime.active || runtime.pending) {
    return null;
  }
  const stage = runtime.stage;
  const phase = stage === 1 ? 1 : 2;
  const message = stage === 1
    ? t(runtime.substep === 1 ? 'strip.wait' : 'strip.access')
    : t('strip.send');
  const icon = stage === 1 ? (runtime.substep === 1 ? 'refresh' : 'term') : 'spark';
  const rows: StripRow[] = [];
  if (runtime.notice) {
    rows.push({
      tone: runtime.notice === 'conflict' ? 'info' : 'error',
      text: t(noticeKeys[runtime.notice]),
      retry: runtime.notice === 'conflict' ? undefined : () => runGuideAction('retry'),
    });
  }
  if (stage === 1 && runtime.setupError) {
    rows.push({ tone: 'error', text: runtime.setupError });
  }
  if (stage === 3 && !runtime.capabilityReady) {
    rows.push({ tone: 'warn', text: t('capabilityMissing') });
  }
  if (stage === 3 && runtime.prefillBlocked) {
    rows.push({ tone: 'warn', text: t('draftBlocked'), retry: () => runGuideAction('retryPrefill') });
  }
  const tone = rows.some(row => row.tone === 'error') ? ' error' : '';

  return <section className={`aw-guide-strip${tone}`}
    data-guide-strip data-testid="guide-strip" tabIndex={-1}
    aria-live="polite" aria-label={t('flowTitle')}>
    <div className="aw-guide-strip-row">
      <GuideStepper phase={phase} />
    </div>
    <div className="aw-guide-strip-line">
      <AwStrokeIcon name={icon} />
      <span>{message}</span>
    </div>
    {rows.map((row, index) => <div key={`${row.tone}-${index}`} className={`aw-guide-strip-line is-${row.tone}`}>
      <AwStrokeIcon name={row.tone === 'error' ? 'alert-c' : 'info'} />
      <span>{row.text}</span>
      {row.retry && <Button size="small" onClick={row.retry}>{t('retry')}</Button>}
    </div>)}
    <div className="aw-guide-strip-actions">
      <Button type="text" className="aw-guide-skip" onClick={() => runGuideAction('skip')}>{t('skip')}</Button>
      <button type="button" className="aw-guide-never" onClick={() => runGuideAction('disable')}>{t('never')}</button>
    </div>
  </section>;
}
