import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Modal, Select, Space, Spin, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/shared/api/client';
import { listRepos, type Repo } from '@/features/repo/api';
import { DeliveryTargetFields } from './DeliveryTargetFields';

export type Activity = 'clarify' | 'design';
export interface LaunchState {
  conversationId: number | null; agentId: number | null; squadId: number | null;
  repoId: number | null; phase: string; managed: boolean;
}
export const launchPath = (item: string, activity: Activity) =>
  `/api/workitems/${item}/${activity === 'design' ? 'prd' : 'clarification-conversations'}/launch`;
export async function readLaunch(item: string, activity: Activity) {
  return (await apiClient.get<LaunchState>(launchPath(item, activity))).data;
}
export function designUrl(item: string, state: LaunchState) {
  const search = new URLSearchParams();
  if (state.agentId) search.set('prdAgent', String(state.agentId));
  if (state.squadId) search.set('prdSquad', String(state.squadId));
  return `/workitems/${item}/design${search.size ? '?' + search.toString() : ''}`;
}
async function spaceRepos() {
  const rows: Repo[] = [];
  for (let page = 1; ; page++) {
    const batch = await listRepos({ page, size: 100 });
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
}

export function WorkitemLaunchModal({ item, activity, initialRepo, onEnter, onClose }: {
  item: string; activity: Activity; initialRepo: number | null;
  onEnter: (state: LaunchState) => void; onClose: () => void;
}) {
  const { t } = useTranslation('workitem');
  const design = activity === 'design';
  const [source, setSource] = useState<'NEW' | 'REPO'>(design || initialRepo ? 'REPO' : 'NEW');
  const [repoId, setRepo] = useState<number | undefined>(design ? undefined : initialRepo ?? undefined);
  const repositoryInitialized = useRef(false);
  const [form] = Form.useForm<{ squadId?: number; agentId?: number }>();
  const squadId = Form.useWatch('squadId', form);
  const agentId = Form.useWatch('agentId', form);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const repos = useQuery({ queryKey: ['workitem-launch-repos', item], queryFn: spaceRepos, enabled: !design || source === 'REPO' });
  const defaultDesignRepo = design ? repos.data?.find(repo => repo.designBaseBranch?.trim()) : undefined;
  const existingRepo = source === 'REPO';
  const chosenRepo = design && !existingRepo ? undefined : repoId;
  const sourceReady = !design || source === 'NEW' || (source === 'REPO' && !!repoId);
  const selectedRepo = repos.data?.find(repo => repo.id === chosenRepo);
  const startBranch = selectedRepo?.designBaseBranch ?? selectedRepo?.defaultBranch;
  useEffect(() => {
    if (!design || !existingRepo || !repos.isSuccess || repositoryInitialized.current) return;
    repositoryInitialized.current = true;
    setRepo(defaultDesignRepo?.id);
  }, [design, existingRepo, repos.isSuccess, defaultDesignRepo]);
  const choice = { squadId, agentId, source: design ? source : undefined, repoId: chosenRepo };
  const check = useQuery({
    queryKey: ['activity-launch-check', item, activity, source, chosenRepo, squadId, agentId],
    queryFn: async () => { await apiClient.post(launchPath(item, activity) + '/check', choice, { backgroundActivity: true }); return true; },
    enabled: sourceReady && !!agentId, retry: false, staleTime: 0,
    refetchInterval: busy ? false : 3000, refetchIntervalInBackground: false,
  });
  useEffect(() => { setError(''); }, [source, chosenRepo, squadId, agentId]);
  async function start() {
    if (submitting.current || !check.isSuccess || check.isFetching || !sourceReady || !agentId) return;
    submitting.current = true; setBusy(true); setError('');
    try { onEnter((await apiClient.post<LaunchState>(launchPath(item,activity), choice)).data); }
    catch (err) { setError(err instanceof Error ? err.message : t('launch.failed')); }
    finally { submitting.current = false; setBusy(false); }
  }
  function repositorySelect(useTemplate: boolean) {
    const options = repos.data?.map(repo => ({ value: repo.id, label: repo.name, address: repo.url }));
    return <Select
      aria-label={t(design ? 'launch.repo' : 'launch.reference')}
      showSearch allowClear optionFilterProp="label"
      disabled={busy || useTemplate}
      placeholder={t(useTemplate ? 'launch.fromTemplate' : 'launch.chooseRepo')}
      value={useTemplate ? undefined : repoId}
      loading={!useTemplate && repos.isLoading}
      onChange={value => { repositoryInitialized.current = true; setRepo(value); }}
      options={options}
      filterOption={design ? (input, option) => !!option && [option.label, option.address]
        .some(text => text?.toLowerCase().includes(input.toLowerCase())) : undefined}
      optionRender={design ? option => <RepositoryOption name={option.data.label} address={option.data.address} /> : undefined}
      labelRender={design && selectedRepo
        ? () => <RepositoryOption name={selectedRepo.name} address={selectedRepo.url} /> : undefined}
      notFoundContent={repos.isLoading ? <Spin size="small" /> : t('launch.noRepos')} />;
  }
  return <Modal open title={t(design ? 'launch.design' : 'launch.clarify')} onCancel={onClose}
    closable={!busy} maskClosable={!busy} keyboard={!busy} cancelButtonProps={{ disabled: busy }}
    okText={t(design ? 'launch.startDesign' : 'clarification.startClarify')} onOk={start}
    confirmLoading={busy} okButtonProps={{ disabled: !sourceReady || !agentId || !check.isSuccess || check.isFetching }}>
    <Form form={form} layout="vertical" disabled={busy} className="aw-launch-form">
      {design ? (
        <Form.Item label={t('launch.source')} required extra={existingRepo && (selectedRepo ? (
          <div className="aw-launch-start-branch">{startBranch
            ? t('launch.startBranch', { branch: startBranch })
            : t('launch.repoDefaultBranch')}</div>
        ) : repos.isSuccess && !defaultDesignRepo && t('launch.noDesignBaseRepo'))}>
          <Space.Compact block className="aw-launch-source">
            <Select<'NEW' | 'REPO'> aria-label={t('launch.source')} value={source} onChange={setSource}
              options={[{ value: 'NEW', label: t('launch.new') }, { value: 'REPO', label: t('launch.existing') }]} />
            {repositorySelect(!existingRepo)}
          </Space.Compact>
        </Form.Item>
      ) : (
        <Form.Item label={t('launch.reference')}>{repositorySelect(false)}</Form.Item>
      )}
      {repos.isError && (!design || existingRepo) && <Button type="link" onClick={() => repos.refetch()}>{t('clarification.retry')}</Button>}
      <DeliveryTargetFields form={form} required conversation design={design} disabled={busy} />
      {(check.isError || error) && <Alert showIcon type="error" message={error || check.error?.message}
        action={agentId ? <Typography.Link href={`/agents/${agentId}`} target="_blank">{t('launch.employeeSettings')}</Typography.Link> : undefined} />}
    </Form>
  </Modal>;
}

function RepositoryOption({ name, address }: { name: string; address?: string }) {
  const { t } = useTranslation('workitem');
  return <span className="aw-launch-repo-option" title={address ? t('launch.repositoryWithAddress', { name, address }) : name}>
    <span className="aw-launch-repo-name">{name}</span>
    {address && <span className="aw-launch-repo-address">{address}</span>}
  </span>;
}
