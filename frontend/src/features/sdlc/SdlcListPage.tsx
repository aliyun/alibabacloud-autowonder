import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { formatNumber } from '@/shared/i18n/format';
import { i18n } from '@/shared/i18n';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { Button, Space, Popconfirm, Tooltip, Select, message, Modal, Form, Input, Switch, Tabs, Spin, Empty, Alert } from 'antd';
import { PageHead } from '@/shared/ui/PageHead';
import { Toolbar } from '@/shared/ui/Toolbar';
import { TableCard, TableFooter } from '@/shared/ui/TableCard';
import { Table } from '@/shared/theme/ThemedTable';
import { StatusTag } from '@/shared/ui/StatusTag';
import type { StatusColorKey } from '@/shared/ui/StatusTag';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listSdlcTemplatesPage, listAllSdlcTemplates, createSdlcTemplate, deleteSdlcTemplate, enableSdlcTemplate, disableSdlcTemplate } from './api';
import type { SdlcTemplate } from './api';
import type { ColumnsType } from 'antd/es/table';
import { SquadWorkflowPanel } from './workflow/SquadWorkflowPanel';
import { SDLC_AI_ENABLED } from './featureFlags';
import { SquadFilterBar, useSquadOptions } from '@/features/squad/SquadFilterBar';
import { SquadTags } from '@/features/squad/SquadTags';
import { buildSdlcGroupViews } from './squadView';
import './SdlcListPage.css';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { readViewPreference, writeViewPreference } from '@/shared/lib/viewPreference';
import { usePageSizePreference } from '@/shared/lib/usePageSizePreference';
import { EllipsisText } from '@/shared/ui/EllipsisText';

const SDLCS_VIEW_STORAGE_KEY = 'autowonder.sdlcs.view';
const SDLCS_VIEW_OPTIONS = ['list', 'grouped'] as const;
const SDLCS_PAGE_SIZE_STORAGE_KEY = 'autowonder.sdlcs.pageSize';

const squadGroupBodyId = (key: string) => `sdlc-group-body-${key}`;

const statusMeta: Record<string, { colorKey: StatusColorKey; key: 'status.draft' | 'status.enabled' | 'status.disabled' }> = {
  DRAFT: { colorKey: 'gray', key: 'status.draft' as const },
  ENABLED: { colorKey: 'green', key: 'status.enabled' as const },
  DISABLED: { colorKey: 'amber', key: 'status.disabled' as const },
};

// 原型 24 模版列表工单类型列：需求/任务蓝、Bug 红、未绑定通用为 outline 中性。
const workTypeColors: Record<string, StatusColorKey> = {
  REQUIREMENT: 'blue',
  REQ: 'blue',
  TASK: 'blue',
  BUG: 'red',
};

export function SdlcListPage() {
  const { t } = useTranslation('sdlc');
  const { t: squadT } = useTranslation('squad');
  const workTypes = new Map<string, string>([['REQUIREMENT', t('workType.requirement')], ['REQ', t('workType.requirement')], ['TASK', t('workType.task')], ['BUG', t('workType.bug')]]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rawAccessCommand = useAccessCommand();
  const accessCommand: typeof rawAccessCommand = (required, action, command) =>
    rawAccessCommand(required, action, command, 'SDLC');
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSizePreference(SDLCS_PAGE_SIZE_STORAGE_KEY, [10, 20, 50, 100], 10);
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('templates');
  const [squadFilter, setSquadFilter] = useState<number[]>([]);
  const [grouped, setGrouped] = useState(
    () => readViewPreference(SDLCS_VIEW_STORAGE_KEY, SDLCS_VIEW_OPTIONS, 'grouped') === 'grouped',
  );
  const [form] = Form.useForm();
  useLocalizedValidation(form, createOpen);
  const { options: squadOptions, nameById: squadNameById, isLoading: squadsLoading } = useSquadOptions();

  const { data: result, isLoading: pageLoading } = useQuery({
    queryKey: ['sdlcs', 'page', page, size, squadFilter],
    queryFn: () => listSdlcTemplatesPage({ page, size, squadIds: squadFilter }),
    enabled: !grouped,
  });

  // The grouped view groups by squad, so it must load every workflow: a page boundary would split
  // one squad into several groups. The flat list view keeps the server-side paging above.
  const allQuery = useQuery({
    queryKey: ['sdlcs', 'all', squadFilter],
    queryFn: () => listAllSdlcTemplates({ squadIds: squadFilter }),
    enabled: grouped,
  });

  const data = result?.list ?? [];
  const total = result?.total ?? 0;
  const allTotal = allQuery.data?.total ?? 0;

  // The squad filter is applied server-side, so page 1 is the only page that can hold the new result set.
  useEffect(() => {
    setPage(1);
  }, [squadFilter]);

  // Deleting the last row (or a concurrent change) can invalidate the current page.
  useEffect(() => {
    if (!grouped && result) {
      const lastPage = Math.max(1, Math.ceil(result.total / size));
      if (page > lastPage) setPage(lastPage);
    }
  }, [grouped, result, page, size]);

  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = (key: string) => setCollapsedGroups((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const squadGroups = useMemo(
    () => (allQuery.data
      ? buildSdlcGroupViews({
        items: allQuery.data.items,
        squadOptions,
        nameById: squadNameById,
        selectedSquadIds: squadFilter,
      })
      : []),
    [allQuery.data, squadOptions, squadNameById, squadFilter, squadT],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['sdlcs'] });

  const createMut = useMutation({
    mutationFn: createSdlcTemplate,
    onSuccess: (newSdlc) => {
      invalidate();
      setCreateOpen(false);
      form.resetFields();
      message.success(i18n.t('sdlc:messages.created'));
      navigate(`/sdlcs/${newSdlc.id}`);
    },
    onError: (error: Error) => { message.error(error.message || i18n.t('sdlc:messages.saveFailed')); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteSdlcTemplate,
    onSuccess: () => { invalidate(); message.success(i18n.t('sdlc:messages.deleted')); },
    onError: (error: Error) => { message.error(error.message || i18n.t('sdlc:messages.deleteFailed')); },
  });

  const enableMut = useMutation({
    mutationFn: enableSdlcTemplate,
    onSuccess: () => { invalidate(); message.success(i18n.t('sdlc:status.enabled')); },
  });

  const disableMut = useMutation({
    mutationFn: disableSdlcTemplate,
    onSuccess: () => { invalidate(); message.success(i18n.t('sdlc:status.disabled')); },
  });

  const columns: ColumnsType<SdlcTemplate> = [
    {
      title: t('fields.id'), dataIndex: 'id', width: 70,
      render: (v: number | string) => <span className="sdlc-id-cell">{v}</span>,
    },
    {
      title: t('fields.name'), dataIndex: 'name', align: 'left', ellipsis: { showTitle: false },
      render: (name: string, record) => (
        <EllipsisText tooltip={name}>
          <a className="sdlc-name-link" onClick={() => navigate(`/sdlcs/${record.id}`)}>{name}</a>
        </EllipsisText>
      ),
    },
    {
      title: t('fields.description'), dataIndex: 'description', align: 'left', ellipsis: { showTitle: false },
      render: (v: string) => <EllipsisText tooltip={v} style={{ color: 'var(--aw-text-3)' }}>{v}</EllipsisText>,
    },
    {
      title: t('fields.workType'), dataIndex: 'workType', width: 90,
      render: (v: string | null) => (
        <StatusTag
          size="sm"
          colorKey={Object.prototype.hasOwnProperty.call(workTypeColors, v ?? '') ? workTypeColors[v as string] : 'outline'}
          label={v != null ? workTypes.get(v) ?? v : t('workType.general')}
        />
      ),
    },
    { title: t('fields.stepCount'), width: 80, render: (_, record) => formatNumber(record.stepCount ?? record.steps?.length ?? 0) },
    {
      title: t('fields.squad'), width: 150, ellipsis: true,
      render: (_, record) => <span className="sdlc-squad-cell"><SquadTags squadIds={record.squadIds} squadNames={record.squadNames} /></span>,
    },
    {
      title: t('fields.status'), dataIndex: 'status', width: 100,
      render: (s: string) => (
        <StatusTag
          dot
          label={Object.prototype.hasOwnProperty.call(statusMeta, s) ? t(statusMeta[s].key) : s}
          colorKey={Object.prototype.hasOwnProperty.call(statusMeta, s) ? statusMeta[s].colorKey : 'gray'}
        />
      ),
    },
    {
      title: t('fields.actions'), width: 118,
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title={t('actions.details')}>
            <Button
              type="text"
              size="small"
              className="aw-op-btn"
              icon={<AwStrokeIcon name="eye" />}
              aria-label={t('actions.details')}
              onClick={() => navigate(`/sdlcs/${record.id}`)}
            />
          </Tooltip>
          {record.status === 'DRAFT' || record.status === 'DISABLED' ? (
            <Popconfirm title={t('confirm.enable')} description={t('confirm.enableLockHint')} onConfirm={() => accessCommand(
              'READ_WRITE',
              t('commands.enable'),
              () => enableMut.mutate(record.id),
            )}>
              <Tooltip title={t('actions.enable')}>
                <Button type="text" size="small" className="aw-op-btn" icon={<AwStrokeIcon name="play" />} aria-label={t('actions.enable')} />
              </Tooltip>
            </Popconfirm>
          ) : (
            <Popconfirm title={t('confirm.disable')} onConfirm={() => accessCommand(
              'READ_WRITE',
              t('commands.disable'),
              () => disableMut.mutate(record.id),
            )}>
              <Tooltip title={t('actions.disable')}>
                <Button type="text" size="small" className="aw-op-btn" icon={<AwStrokeIcon name="pause" />} aria-label={t('actions.disable')} />
              </Tooltip>
            </Popconfirm>
          )}
          {record.status !== 'ENABLED' && (
            <Popconfirm title={t('confirm.delete')} onConfirm={() => accessCommand(
              'READ_WRITE',
              t('commands.delete'),
              () => deleteMut.mutate(record.id),
            )}>
              <Tooltip title={t('commands.delete')}>
                <Button type="text" size="small" className="aw-op-btn aw-op-btn--del" icon={<AwStrokeIcon name="trash" />} aria-label={t('commands.delete')} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHead
        title={t('list.title')}
        description={t('list.description')}
      />
    <Tabs
      className="aw-list-tabs sdlc-list-tabs"
      activeKey={activeTab}
      onChange={setActiveTab}
      items={[
        {
          key: 'templates',
          label: t('list.templates'),
          children: (
            <>
              <Toolbar
                left={<SquadFilterBar
                  options={squadOptions}
                  value={squadFilter}
                  onChange={setSquadFilter}
                  grouped={grouped}
                  onGroupedChange={(next) => {
                    setGrouped(next);
                    writeViewPreference(SDLCS_VIEW_STORAGE_KEY, next ? 'grouped' : 'list');
                  }}
                  loading={squadsLoading}
                  groupLabel={squadT('groupBySquad')}
                />}
                right={<Space>
                  {SDLC_AI_ENABLED && (
                    <Button onClick={() => accessCommand(
                      'READ_WRITE',
                      t('commands.aiGenerate'),
                      () => navigate('/sdlcs/generate'),
                    )}>{t('actions.aiGenerate')}</Button>
                  )}
                  <Button type="primary" icon={<AwStrokeIcon name="plus" />} onClick={() => accessCommand(
                    'READ_WRITE',
                    t('commands.create'),
                    () => setCreateOpen(true),
                  )}>{t('actions.new')}</Button>
                </Space>}
              />
              {grouped ? (
                allQuery.isError ? (
                  <TableCard flush>
                    <Alert
                      type="error"
                      showIcon
                      message={t('messages.loadFailed')}
                      action={<Button size="small" onClick={() => { void allQuery.refetch(); }}>{t('messages.retry')}</Button>}
                    />
                  </TableCard>
                ) : allQuery.isLoading ? (
                  <TableCard flush>
                    <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
                  </TableCard>
                ) : (
                  <TableCard
                    flush
                    footer={<div className="aw-table-footer"><span>{t('list.total', { count: allTotal })}</span></div>}
                  >
                    {squadGroups.length === 0 ? (
                      <Empty description={t('list.empty')} />
                    ) : squadGroups.map((group) => {
                      const bodyId = squadGroupBodyId(group.key);
                      const expanded = !collapsedGroups.has(group.key);
                      return (
                        <section
                          key={group.key}
                          className="sdlc-squad-group"
                        >
                          <div
                            className="sdlc-squad-group-header"
                            onClick={(event) => {
                              if ((event.target as HTMLElement).closest('a')) return;
                              toggleGroup(group.key);
                            }}
                          >
                            <button
                              type="button"
                              className="sdlc-squad-group-caret"
                              aria-expanded={expanded}
                              aria-controls={bodyId}
                              aria-label={expanded ? t('list.collapseGroup') : t('list.expandGroup')}
                              onClick={(event) => { event.stopPropagation(); toggleGroup(group.key); }}
                            >
                              <AwStrokeIcon name={expanded ? 'chev-d' : 'chev-r'} size={14} />
                            </button>
                            <strong>
                              {group.squadId == null ? (
                                group.label
                              ) : (
                                <Link to={`/squads?squadId=${group.squadId}`}>{group.label}</Link>
                              )}
                            </strong>
                            <span className="sdlc-squad-group-count">{t('list.groupCount', { count: group.items.length })}</span>
                          </div>
                          <div id={bodyId} className="sdlc-squad-group-body">
                            {expanded && (
                              <Table
                                rowKey="id"
                                columns={columns}
                                dataSource={group.items}
                                pagination={false}
                                locale={{ emptyText: t('list.empty') }}
                              />
                            )}
                          </div>
                        </section>
                      );
                    })}
                  </TableCard>
                )
              ) : (
                <TableCard
                  flush
                  footer={(
                    <TableFooter
                      total={total}
                      page={page}
                      pageSize={size}
                      totalText={t('list.total', { count: total })}
                      onPageChange={(p, ps) => { setPage(ps !== size ? 1 : p); setSize(ps); }}
                      onPageSizeChange={setSize}
                    />
                  )}
                >
                  <Table
                    rowKey="id"
                    columns={columns}
                    dataSource={data}
                    loading={pageLoading}
                    pagination={false}
                  />
                </TableCard>
              )}

              <Modal
                title={t('commands.create')}
                width={480}
                open={createOpen}
                closable={{ 'aria-label': t('gallery.close') }}
                onOk={() => form.validateFields().then(v => accessCommand(
                  'READ_WRITE',
                  t('commands.create'),
                  () => createMut.mutate(v),
                ), () => {})}
                onCancel={() => {
                  form.resetFields(['stageTimingEnabled']);
                  setCreateOpen(false);
                }}
                confirmLoading={createMut.isPending}
              >
                <Form form={form} layout="vertical">
                  <Form.Item name="name" label={t('fields.templateName')} rules={[{ required: true, message: t('validation.name') }]}>
                    <Input placeholder={t('placeholder.name')} />
                  </Form.Item>
                  <Form.Item name="description" label={t('fields.description')}>
                    <Input.TextArea rows={2} placeholder={t('placeholder.description')} />
                  </Form.Item>
                  <Form.Item name="workType" label={t('fields.workType')}>
                    <Select allowClear placeholder={t('placeholder.workType')}
                      options={[
                        { value: 'REQUIREMENT', label: t('workType.requirement') },
                        { value: 'TASK', label: t('workType.task') },
                        { value: 'BUG', label: t('workType.bug') },
                      ]} />
                  </Form.Item>
                  <Form.Item name="stageTimingEnabled" label={t('fields.stageTiming')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Form>
              </Modal>
            </>
          ),
        },
        {
          key: 'workflow',
          label: t('workflow.tab'),
          children: <SquadWorkflowPanel />,
        },
      ]}
    />
    </>
  );
}
