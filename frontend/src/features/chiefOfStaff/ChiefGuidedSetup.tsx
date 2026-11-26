import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Segmented, Tag } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { buildExecutorLaunchCommand } from '@/features/executor/api';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { copyTextToClipboard } from '@/shared/lib/clipboard';
import * as api from './api';

export interface ChiefGuidedSetupProps {
  setup: api.SetupStatus;
  substep: number;
  clientKind: string;
  onClientKindChange: (value: string) => void;
  os: 'posix' | 'windows';
  onOsChange: (value: 'posix' | 'windows') => void;
  command: string | null;
  onCommandChange: (value: string | null) => void;
  onAdvance: () => void;
  onSetupCompleted?: (setup: api.SetupStatus) => Promise<void> | void;
  onSetupError?: (message: string | null) => void;
  onCheckStatus: () => void;
  onResetWait: () => void;
  waitExpired: boolean;
}

/**
 * 引导中的 Chief 准备区：子步 0 一次点击完成「补齐配置 + 生成 + 复制」，子步 1 自动探测上线。
 * 所有完成判断都来自真实接口与 setup 状态，不靠点击次数推进。
 */
export function ChiefGuidedSetup({
  setup,
  substep,
  clientKind,
  onClientKindChange,
  os,
  onOsChange,
  command,
  onCommandChange,
  onAdvance,
  onSetupCompleted,
  onSetupError,
  onCheckStatus,
  onResetWait,
  waitExpired,
}: ChiefGuidedSetupProps) {
  const { t } = useTranslation('workspaceGuide');
  const [busy, setBusy] = useState(false);
  const [error, setInlineError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const autoSkipped = useRef(false);
  // 只根据进入子步 0 时的执行器状态决定是否跳过；本次点击新建的执行器仍要走完复制流程。
  const configuredAtEntry = useRef<boolean | null>(setup.executorConfigured);
  useEffect(() => {
    if (substep !== 0) {
      configuredAtEntry.current = null;
    } else if (configuredAtEntry.current === null) {
      configuredAtEntry.current = setup.executorConfigured;
    }
    // 仅在切换子步时快照，忽略本子步内 completeSetup 带来的状态更新。
  }, [substep]);

  // 已有执行器时子步 0 没有可做的决定，直接进入等待上线。
  useEffect(() => {
    if (substep !== 0 || configuredAtEntry.current !== true || command) {
      autoSkipped.current = false;
      return;
    }
    if (autoSkipped.current) {
      return;
    }
    autoSkipped.current = true;
    onAdvance();
  }, [command, onAdvance, substep]);

  useEffect(() => {
    if (substep !== 0) {
      return;
    }
    setCopied(false);
    setCopyFailed(false);
    setInlineError(null);
  }, [substep]);

  function setError(message: string | null) {
    if (onSetupError) onSetupError(message);
    else setInlineError(message);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('setup.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  function generateAndCopy() {
    void run(async () => {
      setCopyFailed(false);
      let executorId = setup.executorId;
      if (!setup.executorConfigured) {
        const updated = await api.completeSetup(clientKind);
        await onSetupCompleted?.(updated);
        executorId = updated.executorId;
      }
      if (!executorId) {
        throw new Error(t('setup.actionFailed'));
      }
      const result = await buildExecutorLaunchCommand(executorId, { os });
      onCommandChange(result.command);
      if (await copyTextToClipboard(result.command)) {
        setCopied(true);
        if (substep === 0) {
          onAdvance();
        }
      } else {
        setCopyFailed(true);
      }
    });
  }

  function copyAgain() {
    if (!command) {
      return;
    }
    const text = command;
    void run(async () => {
      if (await copyTextToClipboard(text)) {
        setCopyFailed(false);
        setCopied(true);
      } else {
        setCopyFailed(true);
      }
    });
  }

  const osLabel = os === 'windows' ? t('setup.windows') : t('setup.posix');
  const commandBox = command
    ? <div className="aw-chief-guide-command">
      <Button type="text" icon={<CopyOutlined />} loading={busy}
        aria-label={t('setup.copyIcon')} title={t('setup.copyIcon')} onClick={copyAgain} />
      <pre>{command}</pre>
    </div>
    : null;

  return <section className="aw-chief-setup aw-chief-setup-guided" data-guide-setup
    data-substep={substep}
    aria-label={t(substep === 0 ? 'stageAccess.title' : 'stageWait.title')}>
    <div className="aw-chief-setup-steps" aria-hidden="true">
      {[t('setup.stepAccess'), t('setup.stepWait')].map((label, index) =>
        <div key={label} className={`aw-chief-setup-step ${index < substep ? 'is-done' : index === substep ? 'is-on' : ''}`}>
          <span className="aw-chief-setup-step-n">{index < substep ? <AwStrokeIcon name="check" /> : index + 1}</span>
          {label}
        </div>)}
    </div>

    {substep === 0
      ? <div className="aw-chief-setup-body">
        <div className="aw-chief-setup-field">
          <span className="aw-guide-secondary">{t('setup.clientLabel')}</span>
          <Segmented aria-label={t('setup.clientLabel')} value={clientKind} disabled={setup.executorConfigured}
            onChange={value => onClientKindChange(value as string)}
            options={[{ value: 'QODER_CLI', label: t('setup.clientQoder') },
              { value: 'QODER_CN_CLI', label: t('setup.clientQoderCn') }]} />
        </div>
        <div className="aw-chief-setup-field">
          <span className="aw-guide-secondary">{t('setup.osLabel')}</span>
          <Segmented aria-label={t('setup.osLabel')} value={os} onChange={value => onOsChange(value as 'posix' | 'windows')}
            options={[{ value: 'posix', label: t('setup.posix') }, { value: 'windows', label: t('setup.windows') }]} />
        </div>
        <Button className="aw-chief-setup-primary" type="primary" block loading={busy} onClick={generateAndCopy}>
          {busy ? t('setup.generatingCopy') : t('setup.generateCopyAction')}
        </Button>
        {commandBox}
        {command && <div className="aw-chief-setup-foot">
          {copied ? <Tag>{t('setup.copiedTag')}</Tag> : <Button size="small" onClick={copyAgain}>{t('setup.copyAction')}</Button>}
          <span className="aw-chief-setup-wait"><span className="aw-chief-setup-pulse" />{t('setup.waitingToPaste')}</span>
        </div>}
        {copyFailed && <>
          <Alert type="error" message={t('setup.copyFailed')} />
          <Button onClick={onAdvance}>{t('manualCopied')}</Button>
        </>}
        {command && !copyFailed && <p className="aw-chief-setup-hint">{t('setup.pasteHint')}</p>}
      </div>
      : <div className="aw-chief-setup-body">
        {command
          ? <>
            <div className="aw-guide-secondary">{t('setup.commandLabel', { os: osLabel })}</div>
            {commandBox}
            <div className="aw-chief-setup-foot">
              {copied ? <Tag>{t('setup.copiedTag')}</Tag> : null}
              <span className="aw-chief-setup-wait"><span className="aw-chief-setup-pulse" />{t('setup.waitingOnline')}</span>
            </div>
            {copyFailed && <Alert type="error" message={t('setup.copyFailed')} />}
          </>
          : <>
            <div className="aw-chief-setup-field">
              <span className="aw-guide-secondary">{t('setup.osLabel')}</span>
              <Segmented aria-label={t('setup.osLabel')} value={os} onChange={value => onOsChange(value as 'posix' | 'windows')}
                options={[{ value: 'posix', label: t('setup.posix') }, { value: 'windows', label: t('setup.windows') }]} />
            </div>
            <Alert type="warning"
              message={t(setup.executorConfigured ? 'setup.commandMissingConfigured' : 'setup.commandMissing')} />
            <Button className="aw-chief-setup-primary" type="primary" block loading={busy} onClick={generateAndCopy}>
              {busy ? t('setup.generatingCopy') : t('setup.generateCopyAction')}
            </Button>
          </>}
        <div className={`aw-chief-setup-status${waitExpired ? ' is-paused' : ''}`} role="status">
          <Badge status={waitExpired ? 'default' : 'processing'}
            text={waitExpired ? t('setup.probingPaused') : t('setup.probing')} />
          <Button size="small" loading={busy} onClick={onCheckStatus}>{t('setup.checkStatus')}</Button>
        </div>
        {waitExpired
          ? <>
            <Alert type="warning" message={t('setup.waitExpired')} />
            <Button onClick={onResetWait}>{t('retry')}</Button>
          </>
          : command ? <p className="aw-chief-setup-hint">{t('setup.commandRunningHint')}</p> : null}
      </div>}

    {error && <Alert type="error" message={error} />}
  </section>;
}
