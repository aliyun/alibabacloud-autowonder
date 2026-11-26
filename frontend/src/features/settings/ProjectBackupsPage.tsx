import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { formatDateTime, formatNumber } from '@/shared/i18n/format';
import { PageHead } from '@/shared/ui/PageHead';
import { Toolbar } from '@/shared/ui/Toolbar';
import { useState } from 'react';
import { Button, Space, message } from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { NoticeTip } from '@/shared/ui/NoticeTip';
import { EmptyState } from '@/shared/ui/EmptyState';
import { StatusTag, type StatusColorKey } from '@/shared/ui/StatusTag';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { useAuthStore } from '@/shared/auth/store';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { OffsetPagination } from '@/shared/ui/OffsetPagination';
import './ProjectBackupsPage.css';

export interface ProjectBackup {
  id: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  ossRef?: string;
  sizeBytes?: number;
  sha256?: string;
  errorMessage?: string;
  createdAt: string;
  finishedAt?: string;
}

const BACKUP_STATUS_TAG: Record<ProjectBackup['status'], StatusColorKey> = {
  RUNNING: 'blue',
  SUCCEEDED: 'green',
  FAILED: 'red',
};

const MEDIUM_DATETIME: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'medium' };

export function ProjectBackupsPage() {
  const workspaceId = useAuthStore((s) => s.currentWorkspace?.id);
  const isAdmin = useAuthStore((s) => s.accessLevel === 'ADMIN');
  // Remount pagination and mutation state when the selected project changes.
  return <ProjectBackupsPanel key={workspaceId} workspaceId={workspaceId} isAdmin={isAdmin} />;
}

function ProjectBackupsPanel({ workspaceId, isAdmin }: { workspaceId?: number; isAdmin: boolean }) {
  const { t } = useTranslation('settings');
  const [page, setPage] = useState(1);
  const [backupPageSize, setBackupPageSize] = useState(10);
  const queryClient = useQueryClient();
  const runAccessCommand = useAccessCommand();
  const queryKey = ['project-backups', workspaceId, backupPageSize];
  const query = useQuery({
    queryKey: [...queryKey, page],
    queryFn: async () => (await apiClient.get<ProjectBackup[]>('/api/workspaces/current/backups', {
      params: { page, size: backupPageSize },
    })).data,
    enabled: isAdmin && Boolean(workspaceId),
    refetchInterval: 5000,
  });
  const create = useMutation({
    mutationFn: async () => (await apiClient.post<ProjectBackup>('/api/workspaces/current/backups', {}, {
      timeout: 300000,
    })).data,
    onSuccess: () => { message.success(i18n.t('settings:backupCreated')); setPage(1); },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  const download = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.get<{ url: string }>(`/api/workspaces/current/backups/${id}/download`);
      const link = document.createElement('a');
      link.href = data.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.click();
    },
  });
  const tableEmpty = (
    <EmptyState
      icon={<AwStrokeIcon name="backup" size={32} />}
      title={t('backupEmpty')}
    />
  );
  return <div className="aw-backups-page">
    <PageHead
      title={t('backups')}
      description={t('backupsDescription')}
    />
    {!isAdmin ? <NoticeTip kind="warning" title={t('backupAdminOnly')} /> : <>
      <NoticeTip className="aw-backup-alert" kind="info" title={t('backupInfo')} detail={<>
        <div>{t('backupDescription')}</div>
        <div>{t('backupArchiveHint')}</div>
      </>} />
      {query.isError && <NoticeTip className="aw-backup-alert" kind="error" title={t('backupLoadFailed')} />}
      {create.isError && <NoticeTip className="aw-backup-alert" kind="error" title={t('backupCreateFailed')} />}
      <Toolbar right={<Space>
        <Button type="primary" icon={<AwStrokeIcon name="upload" />} aria-label={t('backupNow')} loading={create.isPending} onClick={() =>
          runAccessCommand('ADMIN', t('createBackup'), () => create.mutate())}>{t('backupNow')}</Button>
        <Button icon={<AwStrokeIcon name="refresh" />} aria-label={t('refresh')} onClick={() => query.refetch()} loading={query.isFetching}>{t('refresh')}</Button>
      </Space>} />
      <Table<ProjectBackup> rowKey="id" loading={query.isLoading} dataSource={query.data ?? []} pagination={false}
        scroll={{ x: 850 }} locale={{ emptyText: tableEmpty }} columns={[
          { title: t('createdAt'), dataIndex: 'createdAt', width: 190, render: (value: string) => value && !Number.isNaN(new Date(value).getTime()) ? <span className="aw-backup-mono">{formatDateTime(value, MEDIUM_DATETIME)}</span> : value || '-' },
          { title: t('status'), dataIndex: 'status', width: 96, render: (status: ProjectBackup['status']) => {
            const known = status === 'RUNNING' || status === 'SUCCEEDED' || status === 'FAILED';
            const label = status === 'RUNNING' ? t('backupRunning') : status === 'SUCCEEDED' ? t('backupSucceeded') : status === 'FAILED' ? t('backupFailed') : status;
            return <StatusTag label={label} colorKey={known ? BACKUP_STATUS_TAG[status] : 'gray'} />;
          } },
          { title: t('size'), dataIndex: 'sizeBytes', width: 110, render: (size?: number) => size == null ? '-' : t('backupSize', { size: formatNumber(size / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) },
          { title: t('backupLocation'), render: (_, row) => row.errorMessage
            ? <span className="aw-backup-reason">{row.errorMessage}</span>
            : row.ossRef ? <span className="aw-backup-mono">{row.ossRef}</span> : <span className="aw-backup-dim">{t('backupEmptyValue')}</span> },
          { title: t('actions'), width: 90, render: (_, row) => <Button size="small" aria-label={t('download')} icon={<AwStrokeIcon name="dl" size={12} />} disabled={row.status !== 'SUCCEEDED'}
            loading={download.isPending && download.variables === row.id}
            onClick={() => runAccessCommand('ADMIN', t('downloadBackup'), () => download.mutate(row.id))}>{t('download')}</Button> },
        ]} />
      <OffsetPagination
        storageKey="autowonder.projectBackups.pageSize"
        offset={(page - 1) * backupPageSize}
        loadedCount={query.data?.length ?? 0}
        onOffsetChange={(next) => setPage(Math.floor(next / backupPageSize) + 1)}
        onPageSizeChange={(next) => { setBackupPageSize(next); setPage(1); }}
      />
    </>}
  </div>;
}
