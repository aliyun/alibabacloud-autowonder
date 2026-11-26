import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { formatDateTime, formatNumber } from '@/shared/i18n/format';
import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { getAgentRoleLabel } from '@/features/agent/constants';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Button, Modal, Form, Input, Popconfirm, message, Tag, Select, Spin, Empty, Switch, Tooltip,
} from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { MarkdownView } from '@/shared/ui/MarkdownView';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listAllSquads, createSquad, updateSquad, deleteSquad, getSquad,
  getSquadMembers, addSquadMember, removeSquadMember,
} from './api';
import { listAgents } from '@/features/agent/api';
import type { Squad, SquadExecutorSummary, SquadMember, SquadSdlcStep } from './api';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { Toolbar } from '@/shared/ui/Toolbar';
import { PageHead } from '@/shared/ui/PageHead';
import { SquadCopyModal } from './SquadCopyModal';
import './SquadListPage.css';

export function SquadListPage() {
  const { t } = useTranslation('squad');
  const queryClient = useQueryClient();
  const accessCommand = useAccessCommand();

  const [formOpen, setFormOpen] = useState(false);
  const [editingSquad, setEditingSquad] = useState<Squad | null>(null);
  const [form] = Form.useForm();
  useLocalizedValidation(form, formOpen);

  const [membersOpen, setMembersOpen] = useState(false);
  const [membersSquadId, setMembersSquadId] = useState<number | null>(null);
  const [addAgentId, setAddAgentId] = useState<number | undefined>(undefined);
  const [agentSearch, setAgentSearch] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSquad, setDetailSquad] = useState<Squad | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  const [copySquad, setCopySquad] = useState<Squad | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['squads'],
    queryFn: () => listAllSquads(),
  });

  // Squad tags on the agent / SDLC / executor pages link here as /squads?squadId=<id>; there is no
  // per-squad route, so the param drives this Modal. The param is consumed up front, otherwise a
  // stale one reopens the Modal every time the list refreshes.
  const [deepLinkSquadId, setDeepLinkSquadId] = useState<number | null>(null);

  useEffect(() => {
    const raw = searchParams.get('squadId');
    if (raw === null) return;
    const consumed = new URLSearchParams(searchParams);
    consumed.delete('squadId');
    setSearchParams(consumed, { replace: true });
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) {
      setDeepLinkSquadId(parsed);
    }
  }, [searchParams, setSearchParams]);

  // Keyed like detailSquadFull below so the deep link and the Modal address the same cache entry.
  const { data: deepLinkSquad, isError: deepLinkFailed } = useQuery({
    queryKey: ['squad-detail', deepLinkSquadId],
    queryFn: () => getSquad(deepLinkSquadId!),
    enabled: deepLinkSquadId !== null,
  });

  useEffect(() => {
    if (deepLinkSquadId === null) return;
    if (deepLinkSquad) {
      setDetailSquad(deepLinkSquad);
      setDetailOpen(true);
      setDeepLinkSquadId(null);
      return;
    }
    if (deepLinkFailed) {
      message.warning(i18n.t('deepLinkUnavailable', { ns: 'squad', id: deepLinkSquadId }));
      setDeepLinkSquadId(null);
    }
  }, [deepLinkSquadId, deepLinkSquad, deepLinkFailed]);

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['squad-members', membersSquadId],
    queryFn: () => getSquadMembers(membersSquadId!),
    enabled: !!membersSquadId,
  });

  const { data: detailMembers = [], isLoading: detailLoading } = useQuery({
    queryKey: ['squad-detail-members', detailSquad?.id],
    queryFn: () => getSquadMembers(detailSquad!.id),
    enabled: detailOpen && !!detailSquad,
  });

  // Only GET /api/squads/{id} derives the SDLC flows and executors the squad owns; the list rows omit them.
  const { data: detailSquadFull } = useQuery({
    queryKey: ['squad-detail', detailSquad?.id],
    queryFn: () => getSquad(detailSquad!.id),
    enabled: detailOpen && !!detailSquad,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['agents-for-squad'],
    queryFn: () => listAgents({ page: 1, size: 100 }),
    enabled: membersOpen,
  });

  const invalidateSquads = () => queryClient.invalidateQueries({ queryKey: ['squads'] });
  const invalidateMembers = () => queryClient.invalidateQueries({ queryKey: ['squad-members', membersSquadId] });

  const createMut = useMutation({
    mutationFn: createSquad,
    onSuccess: () => { invalidateSquads(); setFormOpen(false); form.resetFields(); message.success(i18n.t('created', { ns: 'squad' })); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data: d }: {
      id: number;
      data: { name?: string; description?: string; ownerId?: number | null; debugLogEnabled?: boolean };
    }) => updateSquad(id, d),
    onSuccess: () => { invalidateSquads(); setFormOpen(false); setEditingSquad(null); form.resetFields(); message.success(i18n.t('saved', { ns: 'squad' })); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteSquad,
    onSuccess: () => { invalidateSquads(); message.success(i18n.t('deleted', { ns: 'squad' })); },
  });

  const addMemberMut = useMutation({
    mutationFn: (agentId: number) => addSquadMember(membersSquadId!, agentId),
    onSuccess: () => { invalidateMembers(); invalidateSquads(); setAddAgentId(undefined); message.success(i18n.t('added', { ns: 'squad' })); },
  });

  const removeMemberMut = useMutation({
    mutationFn: (agentId: number) => removeSquadMember(membersSquadId!, agentId),
    onSuccess: () => { invalidateMembers(); invalidateSquads(); message.success(i18n.t('removed', { ns: 'squad' })); },
  });

  const openCreate = () => {
    accessCommand('READ_WRITE', t('create'), () => {
      setEditingSquad(null);
      form.resetFields();
      setFormOpen(true);
    });
  };

  const openEdit = (squad: Squad) => {
    accessCommand('READ_WRITE', t('editSquad'), () => {
      setEditingSquad(squad);
      form.setFieldsValue({
        name: squad.name,
        description: squad.description,
        debugLogEnabled: !!squad.debugLogEnabled,
      });
      setFormOpen(true);
    });
  };

  const openMembers = (squad: Squad) => {
    accessCommand('READ_WRITE', t('manageMembers'), () => {
      setMembersSquadId(squad.id);
      setMembersOpen(true);
    });
  };

  // 复制沿用源空间的读写权限控制；前置检查在弹窗内执行，缺在线版本时弹窗只列名称、不进选择流程。
  const openCopy = (squad: Squad) => {
    accessCommand('READ_WRITE', t('copyToWorkspace'), () => setCopySquad(squad));
  };

  const openDetail = (squad: Squad) => {
    setDetailSquad(squad);
    setExpandedIds(new Set());
    setDetailOpen(true);
  };

  const handleFormSubmit = (values: { name: string; description?: string; debugLogEnabled?: boolean }) => {
    accessCommand('READ_WRITE', editingSquad ? t('editSquad') : t('create'), () => {
      if (editingSquad) {
        // 后端 update 混合 PUT/PATCH 语义：name/description/owner_id 无条件覆盖，
        // 只有 debug_log_enabled 走 COALESCE。必须整对象提交，否则切开关会把
        // owner_id 抹成 null（name 是非空列，漏发会直接 500）。
        updateMut.mutate({
          id: editingSquad.id,
          data: {
            name: values.name ?? editingSquad.name,
            description: values.description ?? editingSquad.description,
            ownerId: editingSquad.ownerId ?? null,
            debugLogEnabled: !!values.debugLogEnabled,
          },
        });
      } else {
        createMut.mutate(values);
      }
    });
  };

  const availableAgents = (agentsData || []).filter(
    (agent) => !members.some((member) => member.agentId === agent.id),
  );
  const squads = data ?? [];
  const memberTotal = squads.reduce((sum, squad) => sum + (squad.memberCount ?? 0), 0);
  const executorOnlineTotal = squads.reduce((sum, squad) => sum + (squad.executorOnlineCount ?? 0), 0);
  const sdlcTotal = squads.reduce((sum, squad) => sum + (squad.sdlcCount ?? 0), 0);

  const detail = detailSquadFull ?? detailSquad;
  const detailExecutors = detailSquadFull?.executors ?? [];
  const sdlcFlows = buildSdlcFlows(detailMembers);
  const detailRoleCount = new Set(
    detailMembers.map((member) => member.roleName || member.roleCode).filter(Boolean),
  ).size;
  // The detail endpoint's own counters lag behind its executor list, so the stats come from the loaded rows.
  const detailOnline = detailSquadFull?.executors
    ? detailExecutors.filter((executor) => executor.status === EXECUTOR_ONLINE).length
    : detail?.executorOnlineCount ?? 0;
  const detailExecutorTotal = detailSquadFull?.executors ? detailExecutors.length : detail?.executorTotalCount ?? 0;
  const membersSquadName = squads.find((squad) => squad.id === membersSquadId)?.name
    ?? (membersSquadId ? t('squadFallback', { id: membersSquadId }) : '');

  const closeDetail = () => { setDetailOpen(false); setDetailSquad(null); setExpandedIds(new Set()); };
  const closeMembers = () => { setMembersOpen(false); setMembersSquadId(null); setAgentSearch(''); };
  const toggleExpanded = (agentId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId); else next.add(agentId);
      return next;
    });
  };
  const fromDetail = (open: (squad: Squad) => void) => {
    if (!detail) return;
    closeDetail();
    open(detail);
  };

  return (
    <>
      <div className="squad-page-head">
        <PageHead title={t('pageTitle')} description={t('pageDescription')} />
      </div>
      <section className="squad-card-page">
        {/* 原型 33 小队页：汇总徽标在工具栏左侧，刷新、新建同排在右侧，一行收口。 */}
        <Toolbar
          left={(
            <div className="squad-summary-strip">
              <SummaryBadge label={t('squadTotal')} value={squads.length} />
              <SummaryBadge label={t('agentTotal')} value={memberTotal} />
              <SummaryBadge label={t('executorsOnline')} value={executorOnlineTotal} tone="green" />
              <SummaryBadge label={t('linkedSdlcs')} value={sdlcTotal} />
            </div>
          )}
          right={(
            <div className="squad-toolbar-actions">
              <Button icon={<AwStrokeIcon name="refresh" />} loading={isFetching && !isLoading} onClick={() => { void refetch(); }}>
                {t('refresh')}
              </Button>
              <Button type="primary" icon={<AwStrokeIcon name="plus" />} aria-label={t('create')} onClick={openCreate}>
                {t('createShort')}
              </Button>
            </div>
          )}
        />

        <Spin spinning={isLoading} aria-label={t('loading')}>
          {squads.length === 0 && !isLoading ? (
            <Empty description={t('emptySquads')} />
          ) : (
            <div className="squad-card-grid">
              {squads.map((squad) => (
                <article key={squad.id} className="squad-summary-card">
                  <button
                    type="button"
                    className="squad-card-open"
                    aria-label={t('viewSquad', { name: squad.name })}
                    onClick={() => openDetail(squad)}
                  />
                  <div className="squad-card-content">
                    <div className="squad-card-head">
                      <span className="squad-card-avatar" aria-hidden>{(squad.name || '?').slice(0, 1)}</span>
                      <span className="squad-card-title">{squad.name}</span>
                      {squad.debugLogEnabled ? <Tag color="orange">{t('debug')}</Tag> : null}
                    </div>
                    <div className="squad-card-description">{squad.description || t('noDescription')}</div>
                    <SquadCardExecutors online={squad.executorOnlineCount ?? 0} total={squad.executorTotalCount ?? 0} />

                    <div className="squad-metric-grid">
                      <SquadMetric label={t('metricAgents')} value={formatNumber(squad.memberCount ?? 0)} />
                      <SquadMetric label={t('metricRoles')} value={formatNumber(squad.roleCount ?? 0)} />
                      <SquadMetric label={t('metricSdlcs')} value={formatNumber(squad.sdlcCount ?? 0)} />
                    </div>

                    <div className="squad-card-footer">
                      <span className="squad-card-when">
                        {squad.gmtCreate ? t('createdAt', { date: formatDateTime(squad.gmtCreate, { dateStyle: 'medium' }) }) : null}
                      </span>
                      <SquadOpButton icon="team" label={t('members')} onClick={() => openMembers(squad)} />
                      <SquadOpButton icon="edit" label={t('edit')} onClick={() => openEdit(squad)} />
                      <SquadOpButton icon="copy" label={t('copyToWorkspace')} onClick={() => openCopy(squad)} />
                      <Popconfirm okText={t('confirm')} cancelText={t('cancel')} title={t('confirmDelete')} onConfirm={() => accessCommand(
                        'READ_WRITE',
                        t('deleteSquad'),
                        () => deleteMut.mutate(squad.id),
                      )}>
                        <Tooltip title={t('delete')}>
                          <Button
                            type="text"
                            size="small"
                            className="aw-op-btn aw-op-btn--del"
                            icon={<AwStrokeIcon name="trash" />}
                            aria-label={t('delete')}
                          />
                        </Tooltip>
                      </Popconfirm>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Spin>
      </section>

      <Modal
        closable={{ 'aria-label': t('close'), closeIcon: <AwStrokeIcon name="x" /> }}
        title={editingSquad ? t('editSquad') : t('create')}
        open={formOpen}
        okText={t('confirm')}
        cancelText={t('cancel')}
        onOk={() => form.submit()}
        onCancel={() => { setFormOpen(false); setEditingSquad(null); }}
        confirmLoading={createMut.isPending || updateMut.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleFormSubmit}>
          <Form.Item name="name" label={t('name')} rules={[{ required: true, message: t('nameRequired') }]}>
            <Input placeholder={t('namePlaceholder')} />
          </Form.Item>
          <Form.Item name="description" label={t('description')}>
            <Input.TextArea rows={3} placeholder={t('descriptionPlaceholder')} />
          </Form.Item>
          {editingSquad ? (
            <Form.Item
              name="debugLogEnabled"
              label={t('debugLogs')}
              valuePropName="checked"
              extra={t('debugLogsHelp')}
            >
              <Switch aria-label={t('debugLogs')} data-testid="debug-log-switch" />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>

      <Modal
        className="squad-detail-modal"
        title={null}
        closable={false}
        open={detailOpen}
        onCancel={closeDetail}
        width={960}
        footer={(
          <div className="squad-detail-foot">
            <Button icon={<AwStrokeIcon name="team" />} onClick={() => fromDetail(openMembers)}>{t('manageMembers')}</Button>
            <Button icon={<AwStrokeIcon name="edit" />} onClick={() => fromDetail(openEdit)}>{t('edit')}</Button>
            <Button icon={<AwStrokeIcon name="copy" />} onClick={() => fromDetail(openCopy)}>{t('copyToWorkspace')}</Button>
          </div>
        )}
      >
        <div className="squad-detail-head">
          <span className="squad-card-avatar squad-detail-avatar" aria-hidden>{(detail?.name || '?').slice(0, 1)}</span>
          <div className="squad-detail-title-area">
            <div className="squad-detail-title">
              <span>{detail?.name}</span>
              {detail?.debugLogEnabled ? <Tag color="orange">{t('debug')}</Tag> : null}
            </div>
            <div className="squad-detail-desc">{detail?.description || t('noDescription')}</div>
          </div>
          <Button
            type="text"
            size="small"
            className="squad-detail-x"
            icon={<AwStrokeIcon name="x" />}
            aria-label={t('close')}
            onClick={closeDetail}
          />
        </div>

        <div className="squad-detail-body">
          <div className="squad-detail-stats">
            <DetailStat label={t('metricAgents')} value={formatNumber(detailMembers.length || detail?.memberCount || 0)} />
            <DetailStat label={t('metricRoles')} value={formatNumber(detailRoleCount || detail?.roleCount || 0)} />
            <DetailStat
              label={t('executorsOnline')}
              dot={executorDotClass(detailOnline, detailExecutorTotal)}
              value={`${formatNumber(detailOnline)}/${formatNumber(detailExecutorTotal)}`}
            />
            <DetailStat label={t('metricSdlcs')} value={formatNumber(sdlcFlows.length || detail?.sdlcCount || 0)} />
          </div>

          {detailLoading ? <div className="squad-detail-loading"><Spin aria-label={t('loading')} /></div> : (
            <>
              <DetailSection title={t('members')} count={detailMembers.length} />
              {detailMembers.length === 0 ? <div className="squad-detail-empty">{t('emptyMembers')}</div> : (
                <table className="squad-detail-table">
                  <colgroup>
                    <col style={{ width: 28 }} /><col style={{ width: '35%' }} /><col style={{ width: '17%' }} />
                    <col style={{ width: '22%' }} /><col style={{ width: '24%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th aria-label={t('expandColumn')} />
                      <th>{t('metricAgents')}</th><th>{t('metricRoles')}</th><th>{t('colSdlc')}</th><th>{t('executor')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailMembers.map((member) => {
                      const summary = summarizeResponsibilities(member.responsibilities);
                      const hasResp = !!member.responsibilities?.trim();
                      const isOpen = hasResp && expandedIds.has(member.agentId);
                      // The members endpoint does not fill executorOnline; the detail executor list is the live source.
                      const memberExecutors = detailExecutors.filter((executor) => executor.agentId === member.agentId);
                      const isPlatform = member.agentKind === PLATFORM_KIND;
                      return (
                        <Fragment key={member.agentId}>
                          <tr className={isOpen ? 'is-open' : undefined}>
                            <td className="squad-exp-td">
                              {hasResp ? (
                                <button
                                  type="button"
                                  className="squad-exp-btn"
                                  aria-expanded={isOpen}
                                  aria-label={t(isOpen ? 'collapseResp' : 'expandResp', { name: member.agentName })}
                                  onClick={() => toggleExpanded(member.agentId)}
                                >
                                  <AwStrokeIcon name="chev-d" size={14} />
                                </button>
                              ) : null}
                            </td>
                            <td>
                              <div className="squad-member-cell">
                                <span className="squad-member-avatar" aria-hidden>{(member.agentName ?? '').slice(0, 2)}</span>
                                <div className="squad-member-text">
                                  <div className="squad-member-name">
                                    <Link className="squad-text-link squad-ellip" to={`/agents/${member.agentId}`}>{member.agentName}</Link>
                                    {isPlatform ? <Tag color="gold">{t('platform')}</Tag> : null}
                                  </div>
                                  {summary ? <div className="squad-member-resp"><EllipsisText lines={2}>{summary}</EllipsisText></div> : null}
                                </div>
                              </div>
                            </td>
                            <td><span className="squad-ellip">{getAgentRoleLabel(member.roleCode, member.roleName) || t('roleUnset')}</span></td>
                            <td>
                              {member.sdlcId != null ? (
                                <Link className="squad-text-link squad-ellip" to={`/sdlcs/${member.sdlcId}`}>{sdlcLabel(member.sdlcId, member.sdlcName)}</Link>
                              ) : <span className="squad-muted">{t('notBound')}</span>}
                            </td>
                            <td><MemberExecutorCell executors={memberExecutors} /></td>
                          </tr>
                          {isOpen ? (
                            <tr className="squad-resp-row">
                              <td colSpan={5}><MarkdownView className="squad-resp-md" content={member.responsibilities ?? ''} /></td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}

              <DetailSection title={t('sdlcWorkflows')} count={sdlcFlows.length} />
              {sdlcFlows.length === 0 ? <div className="squad-detail-empty">{t('noSdlcFlows')}</div> : (
                <div className="squad-flow-grid">
                  {sdlcFlows.map((flow) => (
                    <div key={flow.id} className="squad-flow">
                      <div className="squad-flow-head">
                        <Link className="squad-text-link squad-flow-name" to={`/sdlcs/${flow.id}`}>{flow.name}</Link>
                        <span className="squad-flow-count">{t('stepCount', { count: flow.steps.length })}</span>
                      </div>
                      {flow.steps.length === 0 ? <span className="squad-muted">{t('noSteps')}</span> : (
                        <div className="squad-steps">
                          {flow.steps.map((step, index) => {
                            const handler = step.handlerRoleRef ? getAgentRoleLabel(step.handlerRoleRef) : handlerTypeLabel(step.handlerType);
                            return (
                              <Fragment key={step.id}>
                                {index > 0 ? <span className="squad-step-sep" aria-hidden /> : null}
                                <span className="squad-step">
                                  <span className="squad-step-i">{index + 1}</span>
                                  <span>{step.name}</span>
                                  {handler ? <span className="squad-step-h">{handler}</span> : null}
                                </span>
                              </Fragment>
                            );
                          })}
                        </div>
                      )}
                      <div className="squad-flow-foot">
                        <span className="squad-flow-foot-k">{t('sdlcMembers')}</span>
                        <span className="squad-ellip">{flow.memberNames.join(t('listSeparator'))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      <Modal
        className="squad-sm-modal"
        closable={{ 'aria-label': t('close'), closeIcon: <AwStrokeIcon name="x" /> }}
        title={t('manageMembers')}
        open={membersOpen}
        onCancel={closeMembers}
        footer={null}
        width={520}
      >
        <div className="squad-sm-sub">{t('membersSubtitle', { name: membersSquadName, count: members.length })}</div>
        <div className="squad-add-row">
          <Select
            className="squad-add-select"
            placeholder={t('selectAgent')}
            aria-label={t('selectAgent')}
            value={addAgentId}
            onChange={(value) => { setAddAgentId(value); setAgentSearch(''); }}
            searchValue={agentSearch}
            onSearch={setAgentSearch}
            options={availableAgents.map((agent) => ({
              value: agent.id,
              label: agent.name,
              role: getAgentRoleLabel(agent.roleCode, agent.roleName),
            }))}
            optionRender={(option) => (
              <div className="squad-opt">
                <span className="squad-member-avatar" aria-hidden>{String(option.data.label ?? '').slice(0, 2)}</span>
                <span className="squad-opt-name">{highlightMatch(String(option.data.label ?? ''), agentSearch)}</span>
                {option.data.role ? <span className="squad-opt-role">{option.data.role}</span> : null}
              </div>
            )}
            showSearch
            filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
          />
          <Button type="primary" icon={<AwStrokeIcon name="plus" />}
            disabled={!addAgentId} loading={addMemberMut.isPending}
            onClick={() => addAgentId && accessCommand(
              'READ_WRITE',
              t('addMember'),
              () => addMemberMut.mutate(addAgentId),
            )}>
            {t('add')}
          </Button>
        </div>

        <div className="squad-ml-sec">
          <span>{t('currentMembers')}</span>
          <span className="squad-detail-sec-c">{formatNumber(members.length)}</span>
        </div>
        {membersLoading ? <div className="squad-detail-loading"><Spin aria-label={t('loading')} /></div> : members.length === 0 ? (
          <div className="squad-detail-empty squad-ml-empty">{t('emptyMembersHint')}</div>
        ) : (
          <div className="squad-ml-list">
            {members.map((item: SquadMember) => (
              <div key={item.agentId} className="squad-ml-row">
                <span className="squad-member-avatar" aria-hidden>{(item.agentName ?? '').slice(0, 2)}</span>
                <span className="squad-ml-name">{item.agentName}</span>
                {item.agentKind === PLATFORM_KIND ? <Tag color="gold">{t('platform')}</Tag> : null}
                <span className="squad-ml-role">{getAgentRoleLabel(item.roleCode, item.roleName) || t('roleUnset')}</span>
                <Popconfirm
                  okText={t('remove')}
                  cancelText={t('cancel')}
                  okButtonProps={{ danger: true }}
                  title={t('confirmRemove')}
                  onConfirm={() => accessCommand('READ_WRITE', t('removeMember'), () => removeMemberMut.mutate(item.agentId))}
                >
                  <Tooltip title={t('remove')}>
                    <Button
                      type="text"
                      size="small"
                      className="aw-op-btn aw-op-btn--del"
                      icon={<AwStrokeIcon name="trash" />}
                      aria-label={t('remove')}
                    />
                  </Tooltip>
                </Popconfirm>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <SquadCopyModal squad={copySquad} onClose={() => setCopySquad(null)} />
    </>
  );
}

function SummaryBadge({ label, value, tone }: { label: string; value: number; tone?: 'green' }) {
  useTranslation('squad');
  return (
    <span className={tone ? `squad-summary-badge squad-summary-badge--${tone}` : 'squad-summary-badge'}>
      {label}<b>{formatNumber(value)}</b>
    </span>
  );
}

function SquadMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="squad-metric">
      <span className="squad-metric-k">{label}</span>
      <strong className="squad-metric-v">{value}</strong>
    </div>
  );
}

function DetailStat({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="squad-detail-stat">
      <div className="squad-detail-stat-k">{label}</div>
      <div className="squad-detail-stat-v">{dot ? <i className={dot} /> : null}{value}</div>
    </div>
  );
}

function DetailSection({ title, count }: { title: string; count: number }) {
  return (
    <div className="squad-detail-sec">
      <span>{title}</span>
      <span className="squad-detail-sec-c">{formatNumber(count)}</span>
    </div>
  );
}

function SquadOpButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <Tooltip title={label}>
      <Button type="text" size="small" className="aw-op-btn" icon={<AwStrokeIcon name={icon} />} aria-label={label} onClick={onClick} />
    </Tooltip>
  );
}

function executorDotClass(online: number, total: number) {
  if (total > 0 && online === total) return 'squad-dot is-on';
  if (online > 0) return 'squad-dot is-part';
  return 'squad-dot';
}

function SquadCardExecutors({ online, total }: { online: number; total: number }) {
  const { t } = useTranslation('squad');
  return (
    <div className={total > 0 ? 'squad-card-exec' : 'squad-card-exec is-muted'}>
      <i className={executorDotClass(online, total)} />
      {total > 0 ? t('cardExecutors', { online: formatNumber(online), total: formatNumber(total) }) : t('noExecutor')}
    </div>
  );
}

function MemberExecutorCell({ executors }: { executors: SquadExecutorSummary[] }) {
  const { t } = useTranslation('squad');
  if (executors.length === 0) {
    return <span className="squad-exec-state squad-muted"><i className="squad-dot" />{t('noExecutor')}</span>;
  }
  const lead = executors.find((executor) => executor.status === EXECUTOR_ONLINE) ?? executors[0];
  const others = executors.filter((executor) => executor !== lead);
  const leadOnline = lead.status === EXECUTOR_ONLINE;
  const meta = [
    leadOnline ? null : executorStatusLabel(lead.status),
    lead.lastHeartbeat ? t('heartbeat', { time: formatDateTime(lead.lastHeartbeat) }) : null,
  ].filter(Boolean).join(' · ');
  return (
    <div className="squad-ex-cell">
      <div className="squad-ex-l1">
        <i className={leadOnline ? 'squad-dot is-on' : 'squad-dot'} />
        <span className="squad-mono squad-ellip">{lead.name}</span>
        {others.length > 0 ? (
          <Tooltip title={others.map((executor) => (
            <div key={executor.id}>{t('executorStatusLine', { name: executor.name, status: executorStatusLabel(executor.status) })}</div>
          ))}>
            <span className="squad-ex-more">{t('executorMore', { count: others.length })}</span>
          </Tooltip>
        ) : null}
      </div>
      {meta ? <div className="squad-ex-l2">{meta}</div> : null}
    </div>
  );
}

function highlightMatch(text: string, keyword: string): ReactNode {
  const needle = keyword.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

// Responsibilities are free-form markdown; the table shows the first paragraph or first list item, headings skipped.
function summarizeResponsibilities(text?: string) {
  if (!text) return '';
  const block: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || /^#{1,6}\s/.test(trimmed)) {
      if (block.length) break;
      continue;
    }
    const item = trimmed.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      if (block.length) break;
      return item[1];
    }
    block.push(trimmed);
  }
  return block.join(' ');
}

const PLATFORM_KIND = 'PLATFORM';
const EXECUTOR_ONLINE = 'ONLINE';

function sdlcLabel(id: number, name?: string | null) {
  return name || `#${id}`;
}

function buildSdlcFlows(members: SquadMember[]) {
  const flows = new Map<number, { id: number; name: string; steps: SquadSdlcStep[]; memberNames: string[] }>();
  members.forEach((member) => {
    if (member.sdlcId == null) return;
    const flow = flows.get(member.sdlcId) ?? {
      id: member.sdlcId, name: sdlcLabel(member.sdlcId, member.sdlcName), steps: [], memberNames: [],
    };
    flow.memberNames.push(member.agentName);
    if (flow.steps.length === 0 && member.sdlcSteps?.length) {
      flow.steps = [...member.sdlcSteps].sort((x, y) => x.stepOrder - y.stepOrder);
    }
    flows.set(member.sdlcId, flow);
  });
  return Array.from(flows.values());
}

const executorStatusKeys = new Map([
  ['ONLINE', 'executorStatus.ONLINE'], ['OFFLINE', 'executorStatus.OFFLINE'],
  ['BUSY', 'executorStatus.BUSY'], ['REVOKED', 'executorStatus.REVOKED'],
] as const);
function executorStatusLabel(status: string) {
  const key = executorStatusKeys.get(status as Parameters<typeof executorStatusKeys.get>[0]);
  return key ? i18n.t(key, { ns: 'squad' }) : status;
}
const handlerTypeKeys = new Map([
  ['AGENT', 'handlerType.AGENT'], ['HUMAN', 'handlerType.HUMAN'], ['SYSTEM', 'handlerType.SYSTEM'],
] as const);
function handlerTypeLabel(handlerType: string) {
  const key = handlerTypeKeys.get(handlerType as Parameters<typeof handlerTypeKeys.get>[0]);
  return key ? i18n.t(key, { ns: 'squad' }) : handlerType;
}
