import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Button, message, Popconfirm } from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listRepos, deleteRepo } from './api';
import type { Repo } from './api';
import type { ColumnsType } from 'antd/es/table';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { i18n } from '@/shared/i18n';
import { TableCard, TableFooter } from '@/shared/ui/TableCard';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import { TimeCell } from '@/shared/ui/TimeCell';

const MISSING = '-';

/** 列表 tab 一次拉取第一页 100 条；页脚分页器与查询共用同一组参数。 */
const REPO_LIST_PAGE = 1;
const REPO_LIST_SIZE = 100;

const idCellStyle = { fontFamily: 'var(--aw-mono)', fontSize: 11, color: 'var(--aw-text-3)' };
const urlCellStyle = { fontFamily: 'var(--aw-mono)', fontSize: 12, color: 'var(--aw-text-2)' };

export function RepoListPage() {
  const { t } = useTranslation('repo');
  const queryClient = useQueryClient();
  const runWithAccess = useAccessCommand();
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const { data: repos = [], isLoading } = useQuery({
    queryKey: ['repos', REPO_LIST_PAGE, REPO_LIST_SIZE],
    queryFn: () => listRepos({ page: REPO_LIST_PAGE, size: REPO_LIST_SIZE }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteRepo(id),
    onSuccess: () => {
      message.success(i18n.t('repo:feedback.deleted'));
      setPendingDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ['repos'] });
      queryClient.invalidateQueries({ queryKey: ['repo-relations'] });
    },
    onError: (error: Error) => {
      setPendingDeleteId(null);
      message.error(error.message || i18n.t('repo:errors.deleteRepo'));
    },
  });

  const columns: ColumnsType<Repo> = [
    {
      title: t('fields.id'), dataIndex: 'id', width: 120, ellipsis: { showTitle: false },
      render: (v: number) => <EllipsisText tooltip={String(v)}><span style={idCellStyle}>{v}</span></EllipsisText>,
    },
    {
      title: t('fields.name'), dataIndex: 'name', align: 'left', width: 200, ellipsis: { showTitle: false },
      render: (name: string, record: Repo) => (
        <EllipsisText tooltip={name}><Link to={`/repos/${record.id}`} style={{ fontWeight: 600 }}>{name}</Link></EllipsisText>
      ),
    },
    {
      title: t('fields.url'), dataIndex: 'url', align: 'left', width: 260, ellipsis: { showTitle: false },
      render: (v: string) => <EllipsisText><span style={urlCellStyle}>{v}</span></EllipsisText>,
    },
    {
      title: t('fields.description'), dataIndex: 'description', align: 'left', ellipsis: { showTitle: false },
      render: (v: string | null) => (v ? <EllipsisText>{v}</EllipsisText> : MISSING),
    },
    {
      title: t('fields.created'), dataIndex: 'gmtCreate', width: 150,
      render: (v: string) => <TimeCell value={v} />,
    },
    {
      title: t('fields.actions'), width: 72,
      render: (_: unknown, record: Repo) => (
        <Popconfirm
          title={t('confirm.deleteRepo', { name: record.name })}
          description={t('confirm.deleteHint')}
          open={pendingDeleteId === record.id}
          onOpenChange={(open) => {
            if (!open) setPendingDeleteId(null);
          }}
          onConfirm={() => runWithAccess(
            'READ_WRITE',
            t('actions.deleteRepo'),
            () => deleteMutation.mutate(record.id),
          )}
          okText={t('actions.delete')}
          okButtonProps={{ danger: true }}
          cancelText={t('actions.cancel')}
        >
          <Button
            type="text"
            size="small"
            className="aw-op-btn aw-op-btn--del"
            aria-label={t('actions.deleteRepoLabel', { name: record.name })}
            title={t('actions.deleteRepoLabel', { name: record.name })}
            icon={<AwStrokeIcon name="trash" />}
            onClick={() => runWithAccess(
              'READ_WRITE',
              t('actions.deleteRepo'),
              () => setPendingDeleteId(record.id),
            )}
          />
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      {/* 页面标题、Tab 与新建仓库页头操作由 ReposHubPage 的 HubPageShell 提供。 */}
      <TableCard
        flush
        className="aw-repos"
        footer={
          <TableFooter
            total={repos.length}
            page={REPO_LIST_PAGE}
            pageSize={REPO_LIST_SIZE}
            totalText={t('list.total', { count: repos.length })}
          />
        }
      >
        <Table
          scroll={{ x: 1040 }}
          rowKey="id"
          columns={columns}
          dataSource={repos}
          loading={isLoading}
          pagination={false}
        />
      </TableCard>
    </>
  );
}
