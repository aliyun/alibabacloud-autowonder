import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { ApiError } from '@/shared/types/common';
import { Table } from '@/shared/theme/ThemedTable';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { NoticeTip } from '@/shared/ui/NoticeTip';
import { ExclamationCircleFilled } from '@ant-design/icons';
import { useRef, useState, type ReactNode } from 'react';
import { Button, Modal, Popconfirm, Select, Tag, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { RefSelectProps } from 'antd/es/select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PLATFORM_ADMIN_CANDIDATES_QUERY_KEY,
  PLATFORM_ADMINS_QUERY_KEY,
  addPlatformAdmin,
  getPlatformAdmins,
  removePlatformAdmin,
  searchPlatformAdminCandidates,
  type PlatformAdmin,
  type PlatformAdminList,
} from './adminApi';

type Selection = { value: number; label: string };
type AddResult = {
  item: Selection;
  status: 'success' | 'failed' | 'unattempted' | 'uncertain' | 'unknown';
  error?: Error;
};
type UnknownWrite = { item: Selection; error: Error };
const resultKeys = {
  success: 'adminResultSuccess',
  failed: 'adminResultFailed',
  unattempted: 'adminResultUnattempted',
  uncertain: 'adminResultUncertain',
  unknown: 'adminResultUnknown',
} as const;

function displayName(admin: PlatformAdmin): string {
  return admin.nickname || admin.username;
}

export function PlatformAdminPanel() {
  const { t } = useTranslation('platform');
  const permissionHint = t('adminPermission');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<Selection[]>([]);
  const [results, setResults] = useState<AddResult[]>([]);
  const [pending, setPending] = useState(false);
  const [unknownWrite, setUnknownWrite] = useState<UnknownWrite | null>(null);
  const [readError, setReadError] = useState<Error | null>(null);
  const lock = useRef<'add' | 'remove' | 'read' | null>(null);
  const unknownRef = useRef<UnknownWrite | null>(null);
  const pickerRef = useRef<RefSelectProps>(null);

  const { data, error, isLoading } = useQuery({
    queryKey: PLATFORM_ADMINS_QUERY_KEY,
    queryFn: getPlatformAdmins,
    retry: false,
  });
  const admins = data?.admins ?? [];
  const canManage = Boolean(data?.canManage);
  const mayManage = () => Boolean(queryClient.getQueryData<PlatformAdminList>(PLATFORM_ADMINS_QUERY_KEY)?.canManage);

  const candidateQuery = useQuery({
    queryKey: [...PLATFORM_ADMIN_CANDIDATES_QUERY_KEY, keyword],
    queryFn: () => searchPlatformAdminCandidates(keyword),
    enabled: open && canManage,
    retry: false,
  });

  const removeMutation = useMutation({
    mutationFn: removePlatformAdmin,
    retry: false,
    onSuccess: async (list) => {
      message.success(i18n.t('platform:adminRemoved'));
      queryClient.setQueryData(PLATFORM_ADMINS_QUERY_KEY, list);
      await queryClient.invalidateQueries({ queryKey: PLATFORM_ADMIN_CANDIDATES_QUERY_KEY });
    },
    onError: (err: Error) => message.error(err.message || i18n.t('platform:adminRemoveFailed')),
    onSettled: () => { lock.current = null; },
  });

  const busy = pending || removeMutation.isPending;
  const controlsLocked = busy || !canManage || Boolean(unknownWrite);
  const mayEdit = () => !lock.current && mayManage() && !unknownRef.current;
  const reset = () => {
    setSelected([]);
    setKeyword('');
    setResults([]);
    setReadError(null);
  };
  const close = () => {
    if (lock.current) return;
    setOpen(false);
    // Keep an unresolved write across closing/reopening; cancellation cannot unlock a blind POST.
    if (!unknownRef.current) reset();
  };
  const finish = () => {
    message.success(i18n.t('platform:adminAdded'));
    setOpen(false);
    reset();
    void queryClient.invalidateQueries({ queryKey: PLATFORM_ADMIN_CANDIDATES_QUERY_KEY, refetchType: 'none' });
  };
  const record = (item: Selection, status: AddResult['status'], rawError?: Error) => {
    setResults((current) => current.map((result) => result.item.value === item.value
      ? { item, status, error: rawError }
      : result));
  };
  const acceptSuccess = (item: Selection, list: PlatformAdminList, rawError?: Error) => {
    queryClient.setQueryData(PLATFORM_ADMINS_QUERY_KEY, list);
    setSelected((current) => current.filter((entry) => entry.value !== item.value));
    record(item, 'success', rawError);
  };
  const reconcile = async (write: UnknownWrite): Promise<boolean> => {
    try {
      const list = await getPlatformAdmins();
      queryClient.setQueryData(PLATFORM_ADMINS_QUERY_KEY, list);
      const committed = list.admins.some((admin) => admin.userId === write.item.value);
      if (committed) acceptSuccess(write.item, list, write.error);
      else record(write.item, 'uncertain', write.error);
      unknownRef.current = null;
      setUnknownWrite(null);
      setReadError(null);
      return committed;
    } catch (err) {
      unknownRef.current = write;
      setUnknownWrite(write);
      setReadError(err instanceof Error ? err : new Error(String(err)));
      record(write.item, 'unknown', write.error);
      return false;
    }
  };
  const handleAdd = async () => {
    if (!mayEdit() || selected.length === 0) return;
    lock.current = 'add';
    setPending(true);
    const snapshot = selected.map((item) => ({ ...item }));
    setResults(snapshot.map((item) => ({ item, status: 'unattempted' })));
    let successes = 0;
    try {
      for (const item of snapshot) {
        if (!mayManage()) break;
        try {
          const list = await addPlatformAdmin(item.value);
          acceptSuccess(item, list);
          successes++;
          if (!list.canManage) break;
        } catch (err) {
          const rawError = err instanceof Error ? err : new Error(String(err));
          record(item, 'failed', rawError);
          if (err instanceof ApiError && err.code === '31002') continue;
          // The client wraps transport failures as 10000. Only read back; never replay this write.
          if (!(err instanceof ApiError) || err.code === '10000') {
            if (await reconcile({ item, error: rawError })) successes++;
          }
          break;
        }
      }
      if (successes === snapshot.length) finish();
    } finally {
      lock.current = null;
      setPending(false);
    }
  };
  const retryRead = async () => {
    if (lock.current || !unknownRef.current) return;
    lock.current = 'read';
    setPending(true);
    try {
      const committed = await reconcile(unknownRef.current);
      if (committed && selected.length === 1) finish();
    } finally {
      lock.current = null;
      setPending(false);
    }
  };
  const handleRemove = (userId: number) => {
    const current = queryClient.getQueryData<PlatformAdminList>(PLATFORM_ADMINS_QUERY_KEY);
    if (!mayEdit() || !current?.admins.some((admin) => admin.userId === userId && admin.removable)) return;
    lock.current = 'remove';
    removeMutation.mutate(userId);
  };
  const withReason = (control: ReactNode, reason: string | null) => {
    if (!reason) return <>{control}</>;
    return <Tooltip title={reason}><span>{control}</span></Tooltip>;
  };

  const columns: ColumnsType<PlatformAdmin> = [
    {
      title: t('admin'),
      key: 'administrator',
      width: '24%',
      render: (_, admin) => (
        <span style={{ position: 'relative' }}>
          <span style={{ fontWeight: 500 }}>{displayName(admin)}</span>
          {admin.self && <Tag color="blue" style={{ position: 'absolute', marginLeft: 6, whiteSpace: 'nowrap' }}>{t('me')}</Tag>}
        </span>
      ),
    },
    {
      title: t('username'),
      dataIndex: 'username',
      width: '20%',
      ellipsis: { showTitle: false },
      render: (v: string) => <EllipsisText tooltip={v}>{v ?? '—'}</EllipsisText>,
    },
    {
      title: t('email'),
      dataIndex: 'email',
      width: '32%',
      ellipsis: { showTitle: false },
      render: (email: string | null) => <EllipsisText tooltip={email ?? undefined}>{email || '-'}</EllipsisText>,
    },
    {
      title: t('accountStatus'),
      key: 'status',
      width: '12%',
      render: (_, admin) => (
        <Tag color={admin.active ? 'success' : 'orange'}>{admin.active ? t('active') : t('deactivated')}</Tag>
      ),
    },
    {
      title: t('actions'),
      key: 'action',
      width: '12%',
      render: (_, admin) => {
        const reason = !canManage ? permissionHint : !admin.removable && admin.self ? t('selfRemoval') : !admin.removable && admins.length <= 1 ? t('lastAdmin') : admin.removeDisabledReason;
        const enabled = canManage && admin.removable && !busy && !unknownWrite;
        return withReason(
          <Popconfirm
            icon={<ExclamationCircleFilled aria-hidden="true" />}
            title={t('removeConfirm', { name: displayName(admin) })}
            okText={t('confirmRemove')}
            cancelText={t('cancel')}
            disabled={!enabled}
            okButtonProps={{ disabled: !enabled }}
            onConfirm={() => handleRemove(admin.userId)}
          >
            <Button type="link" size="small" aria-label={t('remove')} danger disabled={!enabled}>{t('remove')}</Button>
          </Popconfirm>,
          enabled ? null : reason,
        );
      },
    },
  ];

  if (error && !data) {
    return (
      <NoticeTip
        kind="error"
        title={t('adminLoadFailed')}
        detail={error instanceof Error ? error.message : t('retryLater')}
      />
    );
  }

  const candidates = candidateQuery.isError ? [] : (candidateQuery.data ?? [])
    .filter((candidate) => !admins.some((admin) => admin.userId === candidate.userId));
  const successful = results.filter((result) => result.status === 'success').length;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
      <NoticeTip kind="info" title={t('adminHint')} />
      <div>
        {withReason(
          <Button
            type="primary"
            icon={<AwStrokeIcon name="plus" />}
            disabled={!canManage || busy}
            aria-label={t('addAdmin')}
            onClick={() => { if (!lock.current && mayManage()) setOpen(true); }}
          >
            {t('addAdmin')}
          </Button>,
          canManage ? null : permissionHint,
        )}
      </div>
      <Table
        rowKey="userId"
        columns={columns}
        dataSource={admins}
        loading={isLoading || removeMutation.isPending}
        pagination={false}
        scroll={{ x: 920 }}
      />
      <Modal
        open={open}
        title={t('addAdmin')}
        width={520}
        className="aw-admin-add-modal"
        style={{ maxWidth: 'calc(100vw - 32px)' }}
        closable={busy ? false : { 'aria-label': t('adminClose') }}
        closeIcon={<AwStrokeIcon name="x" />}
        keyboard={!busy}
        maskClosable={!busy}
        styles={{ mask: { backgroundColor: 'rgba(0, 0, 0, .45)' } }}
        onCancel={close}
        afterOpenChange={(visible) => { if (visible && mayEdit()) pickerRef.current?.focus(); }}
        destroyOnHidden
        footer={
          <div className="aw-admin-add-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button aria-label={t('cancel')} disabled={busy} onClick={close}>{t('cancel')}</Button>
            <Button type="primary" disabled={controlsLocked || selected.length === 0} loading={pending} onClick={handleAdd}>
              {t('adminAddCount', { count: selected.length })}
            </Button>
          </div>
        }
      >
        <div className="aw-admin-add-body" style={{ display: 'grid', gap: 8 }}>
          <label htmlFor="platform-admin-picker">{t('searchUsers')}</label>
          <Select<Selection[]>
            ref={pickerRef}
            id="platform-admin-picker"
            mode="multiple"
            labelInValue
            showSearch
            autoFocus
            filterOption={false}
            aria-label={t('searchUsers')}
            disabled={controlsLocked}
            value={selected}
            placeholder={t('searchHint')}
            loading={candidateQuery.isFetching}
            style={{ width: '100%', minWidth: 0 }}
            searchValue={keyword}
            onSearch={(value) => { if (mayEdit()) setKeyword(value); }}
            onChange={(values) => {
              if (!mayEdit()) return;
              setSelected(values.map((value) => selected.find((item) => item.value === value.value)
                ?? { value: value.value, label: String(value.label) }));
            }}
            options={candidates.map((candidate) => ({
              value: candidate.userId,
              label: selected.find((item) => item.value === candidate.userId)?.label
                ?? `${candidate.nickname || candidate.username}${candidate.email ? ` (${candidate.email})` : ''}`,
            }))}
            tagRender={({ value, label }) => (
              <Tag className="aw-admin-selected-tag" color="blue" onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}>
                <span className="aw-admin-tag-label">{label}</span>
                <Button
                  type="text"
                  size="small"
                  icon={<AwStrokeIcon name="x" />}
                  aria-label={t('adminRemoveSelection', { name: String(label) })}
                  disabled={controlsLocked}
                  onKeyDown={(event) => event.stopPropagation()}
                  onKeyUp={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (mayEdit()) setSelected((current) => current.filter((item) => item.value !== value));
                  }}
                />
              </Tag>
            )}
            notFoundContent={candidateQuery.isError ? null
              : candidateQuery.isFetching || candidateQuery.data === undefined ? t('adminCandidatesLoading')
                : keyword.trim() ? t('noCandidates') : t('searchHint')}
          />
          {(selected.length > 0 || keyword) && (
            <Button
              className="aw-admin-clear"
              type="text"
              aria-label={t('clearUser')}
              disabled={controlsLocked}
              onClick={() => { if (mayEdit()) { setSelected([]); setKeyword(''); } }}
            >{t('clearUser')}</Button>
          )}
          {candidateQuery.isError && (
            <NoticeTip
              kind="error"
              title={t('adminCandidatesFailed')}
              detail={candidateQuery.error instanceof Error ? candidateQuery.error.message : t('retryLater')}
              action={<Button disabled={busy || !canManage || candidateQuery.isFetching} onClick={() => {
                if (!lock.current && mayManage() && !candidateQuery.isFetching) void candidateQuery.refetch();
              }}>{t('adminRetryCandidates')}</Button>}
            />
          )}
          {!canManage && <NoticeTip kind="warning" title={permissionHint} />}
          {results.length > 0 && (
            <div role="status">
              <p>{t('adminAddSummary', { successful })}</p>
              <ul className="aw-admin-add-results" aria-label={t('adminAddResults')}>
                {results.map((result) => (
                  <li key={result.item.value} data-result={result.status}>
                    <span>{result.item.label}</span>{t('adminResultSeparator')}<span>{t(resultKeys[result.status])}</span>
                    {result.error && <div>{result.error.message}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unknownWrite && (
            <NoticeTip
              kind="error"
              title={t('adminReconcileFailed')}
              detail={readError?.message}
              action={<Button disabled={busy} onClick={retryRead}>{t('adminRetryRoster')}</Button>}
            />
          )}
        </div>
      </Modal>
    </div>
  );
}
