import { useState } from 'react';
import { Button, Input, Popconfirm, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import { PageHead } from '@/shared/ui/PageHead';
import { Toolbar } from '@/shared/ui/Toolbar';
import { TableCard, TableFooter } from '@/shared/ui/TableCard';
import { Table } from '@/shared/theme/ThemedTable';
import { TimeCell } from '@/shared/ui/TimeCell';
import { StatusTag, type StatusColorKey } from '@/shared/ui/StatusTag';
import { EmptyState } from '@/shared/ui/EmptyState';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import type { ColumnsType } from 'antd/es/table';
import type { Workitem } from '@/shared/types/workitem';
import { STATUS_CATEGORY_TAG_COLOR, statusCategoryOf, workTypeMap } from './constants';
import { useRecycledWorkitemList, useRestoreWorkitem } from './hooks';
import './WorkitemRecycleBinPage.css';

const PAGE_SIZE = 20;

/** 工单回收站：只展示软删除工单；恢复仅还原可见性，不自动恢复执行。 */
export function WorkitemRecycleBinPage() {
  const { t } = useTranslation('workitem');
  const systemLabel = useSystemLabel();
  const accessCommand = useAccessCommand();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(PAGE_SIZE);
  const [workType, setWorkType] = useState<string | undefined>();
  const [keyword, setKeyword] = useState<string | undefined>();

  const { data, isLoading } = useRecycledWorkitemList({ page, size, workType, keyword });
  const items = data?.list ?? [];
  const total = data?.total ?? 0;
  const restoreMutation = useRestoreWorkitem();

  const columns: ColumnsType<Workitem> = [
    {
      title: t('recycleBin.id'),
      dataIndex: 'id',
      width: 90,
      render: (id: number) => <span className="aw-recycle-bin-id">{id}</span>,
    },
    {
      title: t('fields.title'),
      dataIndex: 'title',
      ellipsis: { showTitle: false },
      render: (title: string) => <EllipsisText>{title}</EllipsisText>,
    },
    {
      title: t('fields.type'),
      dataIndex: 'workType',
      width: 100,
      render: (type: string) => {
        const meta = workTypeMap[type];
        return <StatusTag label={meta?.label ?? type} colorKey={(meta?.color ?? 'gray') as StatusColorKey} />;
      },
    },
    {
      title: t('recycleBin.previousStatus'),
      dataIndex: 'statusName',
      width: 140,
      render: (statusName: string | null, record: Workitem) => (statusName
        ? <StatusTag
          label={systemLabel(record.statusLabelKey, statusName)}
          colorKey={STATUS_CATEGORY_TAG_COLOR[statusCategoryOf(record)] ?? 'gray'}
          dot
        />
        : t('recycleBin.notAvailable')),
    },
    {
      title: t('fields.creator'),
      dataIndex: 'creatorDisplayName',
      width: 150,
      ellipsis: { showTitle: false },
      render: (creatorDisplayName: string | null, record: Workitem) => (
        <EllipsisText>{creatorDisplayName || record.creatorName || t('recycleBin.notAvailable')}</EllipsisText>
      ),
    },
    {
      title: t('recycleBin.deletedAt'),
      dataIndex: 'deletedAt',
      width: 190,
      render: (deletedAt: string | null) => (deletedAt ? <TimeCell value={deletedAt} /> : t('recycleBin.unknownDeletedAt')),
    },
    {
      title: t('fields.actions'),
      key: 'actions',
      width: 110,
      render: (_: unknown, record: Workitem) => (
        <Popconfirm
          title={t('recycleBin.restoreConfirmTitle', { title: record.title })}
          description={t('recycleBin.restoreConfirmDescription')}
          okText={t('recycleBin.restore')}
          cancelText={t('list.cancel')}
          onConfirm={() => accessCommand(
            'READ_WRITE',
            t('recycleBin.restoreCommand'),
            () => restoreMutation.mutate({ id: record.id }),
          )}
        >
          <Button
            size="small"
            data-testid={`restore-workitem-${record.id}`}
            aria-label={t('recycleBin.restoreCommand')}
            icon={<AwStrokeIcon name="undo" size={14} />}
            loading={restoreMutation.isPending}
          >{t('recycleBin.restore')}</Button>
        </Popconfirm>
      ),
    },
  ];

  const tableEmpty = (
    <div className="aw-recycle-bin-empty" data-testid="recycle-bin-empty">
      <EmptyState
        icon={<AwStrokeIcon name={keyword ? 'search' : 'trash'} size={20} />}
        title={keyword ? t('recycleBin.noMatches', { keyword }) : t('recycleBin.empty')}
        subtext={keyword ? t('recycleBin.noMatchesSubtext') : t('recycleBin.emptySubtext')}
      />
    </div>
  );

  const handlePageChange = (nextPage: number, nextSize: number) => {
    setPage(nextPage);
    setSize(nextSize);
  };

  return (
    <div className="aw-recycle-bin-page">
      <PageHead title={t('recycleBin.title')} description={t('recycleBin.scope')} />

      <Toolbar left={<>
        <Select
          placeholder={t('list.typeFilter')}
          value={workType}
          allowClear
          style={{ width: 140, flexShrink: 0 }}
          onChange={(value) => { setWorkType(value); setPage(1); }}
          options={Object.entries(workTypeMap).map(([value, meta]) => ({ value, label: meta.label }))}
        />
        <Input
          aria-label={t('list.search')}
          allowClear
          prefix={<AwStrokeIcon name="search" />}
          placeholder={t('list.search')}
          onPressEnter={(event) => {
            const value = (event.target as HTMLInputElement).value;
            setKeyword(value.trim() || undefined);
            setPage(1);
          }}
          style={{ width: 240, maxWidth: '100%', flex: '0 1 240px', minWidth: 150 }}
        />
      </>} />

      <TableCard
        flush
        className="aw-workitems"
        footer={total > 0 ? <TableFooter
          total={total}
          page={page}
          pageSize={size}
          onPageChange={handlePageChange}
          onPageSizeChange={setSize}
          totalText={t('list.pagination_other', { count: total })}
        /> : undefined}
      >
        <Table<Workitem>
          rowKey="id"
          columns={columns}
          dataSource={items}
          loading={isLoading}
          tableLayout="fixed"
          pagination={false}
          locale={{ emptyText: tableEmpty }}
        />
      </TableCard>
    </div>
  );
}
