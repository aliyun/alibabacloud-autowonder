import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, Select, Space, Typography, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { createRepo, listRepos } from '@/features/repo/api';
import type { PrdDesign, SelectTargetRequest } from '../api';

interface TargetProjectSelectorProps {
  design: PrdDesign;
  onConfirm: (request: SelectTargetRequest) => void | Promise<void>;
  onUseTemplate?: () => void;
  usingTemplate?: boolean;
  confirming: boolean;
  disabled?: boolean;
  embedded?: boolean;
}

const TEMPLATE_SOURCE = 'template';
type ProjectSourceKind = 'git' | 'local' | typeof TEMPLATE_SOURCE;

function sourceKind(value: string): ProjectSourceKind {
  return value.startsWith('/') || value.startsWith('file://') || /^[A-Za-z]:[\\/]/.test(value) ? 'local' : 'git';
}

function sourceName(value: string) {
  const normalized = value.replace(/[?#].*$/, '').replace(/[\\/]$/, '');
  const leaf = normalized.split(/[\\/]/).pop() || 'frontend-project';
  return leaf.replace(/\.git$/, '') || 'frontend-project';
}

export function TargetProjectSelector({
  design, onConfirm, onUseTemplate, usingTemplate, confirming, disabled, embedded,
}: TargetProjectSelectorProps) {
  const { t } = useTranslation('prd');
  const [repoId, setRepoId] = useState<number | undefined>(design.targetRepoId ?? undefined);
  const [kind, setKind] = useState<ProjectSourceKind>(usingTemplate ? TEMPLATE_SOURCE : 'git');
  const [source, setSource] = useState('');
  const [appRoot, setAppRoot] = useState(design.targetAppRoot || '.');
  const [notes, setNotes] = useState(design.targetProjectNotes || '');
  const [creating, setCreating] = useState(false);
  const selectsTemplate = kind === TEMPLATE_SOURCE;
  const repos = useQuery({
    queryKey: ['prd', 'target', 'repos'],
    queryFn: () => listRepos({ page: 1, size: 100 }),
    enabled: !selectsTemplate,
  });
  const selectedRepo = useMemo(() => (repos.data ?? []).find(repo => repo.id === repoId), [repoId, repos.data]);

  useEffect(() => {
    setRepoId(design.targetRepoId ?? undefined);
    setAppRoot(design.targetAppRoot || '.');
    setNotes(design.targetProjectNotes || '');
  }, [design.targetRepoId, design.targetAppRoot, design.targetProjectNotes]);
  useEffect(() => {
    if (!selectedRepo?.url) return;
    setSource(selectedRepo.url);
    setKind(sourceKind(selectedRepo.url));
  }, [selectedRepo?.url]);
  useEffect(() => {
    if (usingTemplate) setKind(TEMPLATE_SOURCE);
  }, [usingTemplate]);

  const submit = async () => {
    const value = source.trim();
    if (!value) return;
    setCreating(true);
    try {
      const matching = (repos.data ?? []).find(repo => repo.url === value);
      let selectedId = matching?.id;
      if (selectedId == null) {
        const created = await createRepo({ name: sourceName(value), url: value });
        selectedId = created.id;
        setRepoId(created.id);
        await repos.refetch();
      }
      await onConfirm({ repoId: selectedId, appRoot: appRoot.trim() || '.', projectNotes: notes });
    } catch {
      message.error(t('target.sourceSaveFailed'));
    } finally {
      setCreating(false);
    }
  };
  const inputLabel = t(kind === 'git' ? 'target.gitSourceLabel' : 'target.localSourceLabel');
  const sourceHint = selectsTemplate ? t('target.templateSourceHint')
    : t(kind === 'git' ? 'target.gitSourceHint' : 'target.localSourceHint');
  const content = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {!embedded && <Typography.Text type="secondary">{t('target.manualHint')}</Typography.Text>}
      {!selectsTemplate && repos.isError && <Alert type="error" closable message={t('target.repoLoadFailed')} action={<Button type="link" onClick={() => void repos.refetch()}>{t('preview.retry')}</Button>} />}
      <Form layout="vertical">
        <Form.Item className="prd-target-source" label={t('target.sourceLabel')} extra={sourceHint}>
          <Space.Compact block>
            <Select<ProjectSourceKind>
              aria-label={t('target.sourceTypeLabel')}
              value={kind}
              disabled={disabled || confirming || creating}
              style={{ width: 128 }}
              onChange={(next) => {
                setKind(next);
                setSource('');
                setRepoId(undefined);
              }}
              options={[
                { value: 'git', label: t('target.gitSourceType') },
                { value: 'local', label: t('target.localSourceType') },
                ...(onUseTemplate ? [{ value: TEMPLATE_SOURCE, label: t('target.templateSourceType') }] : []),
              ]}
            />
            {!selectsTemplate && <Input
              aria-label={inputLabel}
              value={source}
              maxLength={2048}
              placeholder={t(kind === 'git' ? 'target.gitSourcePlaceholder' : 'target.localSourcePlaceholder')}
              disabled={disabled || confirming || creating}
              onChange={event => { setSource(event.target.value); setRepoId(undefined); }}
            />}
          </Space.Compact>
        </Form.Item>
        {selectsTemplate ? (
          !disabled && <Button type="primary" loading={confirming} disabled={creating} onClick={onUseTemplate}>
            {t('target.useTemplate')}
          </Button>
        ) : (
          <>
            <details className="prd-target-advanced">
              <summary>{t('target.advanced')}</summary>
              <Form.Item label={t('target.directoryLabel')} extra={t('target.directoryHint')}>
                <Input aria-label={t('target.directoryLabel')} value={appRoot} maxLength={512}
                  disabled={disabled || confirming} onChange={event => setAppRoot(event.target.value)} />
              </Form.Item>
              <Form.Item label={t('target.notesLabel')}>
                <Input.TextArea aria-label={t('target.notesLabel')} value={notes} maxLength={8000}
                  rows={4} placeholder={t('target.notesPlaceholder')} disabled={disabled || confirming}
                  onChange={event => setNotes(event.target.value)} />
              </Form.Item>
            </details>
            {!disabled && <Button className="prd-target-confirm" type="primary" loading={confirming || creating} disabled={!source.trim()}
              onClick={() => void submit()}>
              {t('target.confirm')}
            </Button>}
          </>
        )}
      </Form>
    </Space>
  );
  return embedded
    ? <div data-testid="prd-target-selector">{content}</div>
    : <Card size="small" title={t('target.title')} data-testid="prd-target-selector">{content}</Card>;
}
