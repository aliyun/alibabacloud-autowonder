import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { formatDateTime } from '@/shared/i18n/format';
import { AGENT_ROLE_PRESETS, getAgentRoleLabel, getAgentStatusLabel } from './constants';
import { useEffect, useMemo, useState } from 'react';
import { Avatar, Button, Empty, Input, Popconfirm, Popover, Segmented, Select, Space, Spin, Tag, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { Link, useNavigate } from 'react-router-dom';
import { Table } from '@/shared/theme/ThemedTable';
import { Toolbar } from '@/shared/ui/Toolbar';
import { TableCard, TableFooter } from '@/shared/ui/TableCard';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import { StatusTag, type StatusColorKey } from '@/shared/ui/StatusTag';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { useAgentList, useAgentSdlcOptions, useDeleteAgent } from './hooks';
import { useAuthStore } from '@/shared/auth/store';
import { AgentTagList } from './components/AgentTagList';
import { AgentTagsEditor } from './components/AgentTagsEditor';
import type { Agent, AgentKind } from './api';
import { SquadSelect, SquadViewSwitch, useSquadOptions } from '@/features/squad/SquadFilterBar';
import { groupBySquad } from '@/features/squad/squadGrouping';
import { readViewPreference, writeViewPreference } from '@/shared/lib/viewPreference';
import './AgentListPage.css';

const AGENTS_VIEW_STORAGE_KEY = 'autowonder.agents.view';
const AGENTS_VIEW_OPTIONS = ['list', 'grouped'] as const;

const agentGroupBodyId = (key: string) => `agent-group-body-${key}`;

const FILTER_SELECT_STYLE = { width: 140 };

const statusColorMap: Record<string, StatusColorKey> = {
  DRAFT: 'gray',
  ONLINE: 'green',
  OFFLINE: 'gray',
  PENDING_REVIEW: 'amber',
};

interface AgentRowActions {
  sdlcText: (agent: Agent) => string | null;
  onView: (agent: Agent) => void;
  onEdit: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
  canEditTags: boolean;
}

export function AgentListPage() {
  const { t } = useTranslation('agent');
  const navigate = useNavigate();
  const accessCommand = useAccessCommand();
  const remove = useDeleteAgent();
  const { options: sdlcOptions } = useAgentSdlcOptions();
  const sdlcNameById = useMemo(() => new Map(sdlcOptions.map((option) => [option.value, option.name])), [sdlcOptions]);
  const sdlcText = (agent: Agent) => agentSdlcText(agent, sdlcNameById);
  const canEditTags = useAuthStore((state) => state.hasAccess('READ_WRITE')
    && (state.accessLevel === 'ADMIN' || !state.readOnlyDomains.includes('AGENT')));
  const agentColumns = getAgentColumns({
    sdlcText,
    canEditTags,
    onView: (agent) => navigate(`/agents/${agent.id}`),
    onEdit: (agent) => accessCommand('READ_WRITE', t('display.editAction'), () => navigate(`/agents/${agent.id}/edit`)),
    onDelete: (agent) => accessCommand('READ_WRITE', t('display.deleteAction'), () => {
      remove.mutate(agent.id, {
        onError: (error) => message.error(error instanceof Error && error.message || i18n.t('display.deleteError', { ns: 'agent' })),
        onSuccess: () => message.success(i18n.t('display.deleted', { ns: 'agent' })),
      });
    }),
  });
  const [kindTab, setKindTab] = useState<AgentKind>('STANDARD');
  const [squadFilter, setSquadFilter] = useState<number[]>([]);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined);
  const [grouped, setGrouped] = useState(
    () => readViewPreference(AGENTS_VIEW_STORAGE_KEY, AGENTS_VIEW_OPTIONS, 'grouped') === 'grouped',
  );
  const { options: squadOptions, nameById: squadNameById, isLoading: squadsLoading } = useSquadOptions();
  const { data: agents = [], isLoading, isFetching, refetch } = useAgentList(statusFilter, kindTab, squadFilter);

  const roleOptions = useMemo(() => {
    const options = new Map(AGENT_ROLE_PRESETS.map(({ roleCode }) => [
      `code:${roleCode}`, { value: `code:${roleCode}`, label: getAgentRoleLabel(roleCode) },
    ]));
    for (const agent of agents) {
      const value = agentRoleFilterValue(agent);
      if (value && !options.has(value)) {
        options.set(value, { value, label: getAgentRoleLabel(agent.roleCode, agent.roleName) });
      }
    }
    return [...options.values()];
  }, [agents, t]);

  // The existing query loads every page; search and role filter locally for both views.
  const filteredAgents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return agents.filter((agent) => (
      (!query || agent.name.toLowerCase().includes(query) || String(agent.id).includes(query))
      && (!roleFilter || agentRoleFilterValue(agent) === roleFilter)
    ));
  }, [agents, search, roleFilter]);

  const activeCount = agents.filter((agent) => agent.status === 'ONLINE').length;
  const executorOnlineCount = agents.reduce((sum, agent) => sum + (agent.executorOnlineCount ?? 0), 0);
  const reviewCount = agents.filter((agent) => agent.status === 'PENDING_REVIEW').length;

  const squadGroups = useMemo(
    () => groupBySquad(filteredAgents, (agent) => agent.squadIds, squadNameById),
    [filteredAgents, squadNameById, t],
  );

  // 原型 06 分组头带折叠态（caret）；复用 SDLC 分组折叠的同一交互模式。
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = (key: string) => setCollapsedGroups((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  return (
    <section className="agent-card-page">
      <Toolbar
        left={<div className="agent-toolbar-filters">
          <SquadViewSwitch
            grouped={grouped}
            onGroupedChange={(next) => {
              setGrouped(next);
              writeViewPreference(AGENTS_VIEW_STORAGE_KEY, next ? 'grouped' : 'list');
            }}
          />
          <Segmented
            value={kindTab}
            onChange={(key) => setKindTab(key as AgentKind)}
            options={[
              { label: t('display.standardAgents'), value: 'STANDARD' },
              { label: t('display.platformAgents'), value: 'PLATFORM' },
            ]}
          />
          <Input
            allowClear
            prefix={<AwStrokeIcon name="search" />}
            placeholder={t('display.searchNameOrId')}
            aria-label={t('display.searchNameOrId')}
            style={{ width: 180 }}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <SquadSelect
            options={squadOptions}
            value={squadFilter}
            onChange={setSquadFilter}
            loading={squadsLoading}
            style={FILTER_SELECT_STYLE}
          />
          <Select
            allowClear
            placeholder={t('display.filterRole')}
            aria-label={t('display.filterRole')}
            style={FILTER_SELECT_STYLE}
            value={roleFilter}
            onChange={setRoleFilter}
            options={roleOptions}
            virtual={false}
          />
          <Select
            allowClear
            placeholder={t('display.filterStatus')}
            style={FILTER_SELECT_STYLE}
            value={statusFilter}
            onChange={setStatusFilter}
            options={Object.keys(statusColorMap).map((value) => ({ value, label: statusLabel(value) }))}
            aria-label={t('display.filterStatus')}
          />
        </div>}
        right={<div className="agent-toolbar-actions">
          <Button
            icon={<AwStrokeIcon name="refresh" />}
            loading={isFetching}
            onClick={() => { void refetch(); }}
          >
            {t('display.refresh')}
          </Button>
          {/* 系统平台智能体为出厂内置，不支持新建。 */}
          {kindTab === 'STANDARD' && (
            <Button type="primary" icon={<AwStrokeIcon name="plus" />} aria-label={t('display.createAction')}
              onClick={() => accessCommand('READ_WRITE', t('display.createAction'), () => navigate('/agents/new'))}>
              {t('display.createShort')}
            </Button>
          )}
        </div>}
      />

      <div className="agent-summary-strip">
        <SummaryBadge label={kindTab === 'PLATFORM' ? t('display.platformAgent') : t('display.allAgents')} value={agents.length} />
        <SummaryBadge label={t('display.inUse')} value={activeCount} />
        <SummaryBadge label={t('display.executorOnline')} value={executorOnlineCount} tone="green" />
        <SummaryBadge label={t('display.status.PENDING_REVIEW')} value={reviewCount} tone="amber" />
      </div>

      <Spin spinning={isLoading}>
        {agents.length === 0 && !isLoading ? (
          kindTab === 'PLATFORM' ? (
            <Empty description={t('display.emptyPlatform')} />
          ) : (
            <Empty description={t('display.emptyAgents')} />
          )
        ) : grouped ? (
          filteredAgents.length === 0 ? (
            <Empty description={t('display.emptyFilteredAgents')} />
          ) : (
            <div className="agent-squad-groups">
              {squadGroups.map((group) => {
                const bodyId = agentGroupBodyId(group.key);
                const expanded = !collapsedGroups.has(group.key);
                return (
                  <section
                    key={group.key}
                    className={`agent-squad-group${expanded ? '' : ' agent-squad-group--collapsed'}`}
                  >
                    <header
                      className="agent-squad-group-header"
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('a, button')) return;
                        toggleGroup(group.key);
                      }}
                    >
                      <button
                        type="button"
                        className="agent-squad-group-caret"
                        aria-expanded={expanded}
                        aria-controls={bodyId}
                        aria-label={expanded ? t('display.collapseGroup') : t('display.expandGroup')}
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
                      <span className="agent-squad-group-count">{t('display.groupCount', { count: group.items.length })}</span>
                    </header>
                    <div id={bodyId} className="agent-squad-group-body">
                      {expanded && (
                        <div className="agent-card-grid">
                          {group.items.map((agent) => (
                            <AgentCard key={agent.id} agent={agent} sdlc={sdlcText(agent)} />
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )
        ) : (
          <TableCard
            flush
            footer={(
              <TableFooter
                total={filteredAgents.length}
                page={1}
                pageSize={Math.max(filteredAgents.length, 1)}
                totalText={t('display.listSummary', {
                  count: filteredAgents.length,
                  active: filteredAgents.filter((agent) => agent.status === 'ONLINE').length,
                  review: filteredAgents.filter((agent) => agent.status === 'PENDING_REVIEW').length,
                })}
              />
            )}
          >
            <Table<Agent>
              className="agent-list-table"
              rowKey="id"
              columns={agentColumns}
              dataSource={filteredAgents}
              pagination={false}
              locale={{ emptyText: t('display.emptyFilteredAgents') }}
              tableLayout="fixed"
              scroll={{ x: 1392 }}
            />
          </TableCard>
        )}
      </Spin>
    </section>
  );
}

function agentRoleFilterValue(agent: Pick<Agent, 'roleCode' | 'roleName'>): string | undefined {
  return agent.roleCode ? `code:${agent.roleCode}` : agent.roleName ? `name:${agent.roleName}` : undefined;
}

function getAgentColumns({ sdlcText, onView, onEdit, onDelete, canEditTags }: AgentRowActions): ColumnsType<Agent> {
  const t = i18n.getFixedT(null, 'agent');
  return [
    { title: 'ID', dataIndex: 'id', width: 92, render: (id: number) => <span className="agent-mono">{id}</span> },
    {
      title: t('display.nameAndRole'),
      dataIndex: 'name',
      align: 'left',
      width: 220,
      render: (_, agent) => (
        <div className="agent-cell">
          <Avatar shape="square" src={agent.avatarUrl || undefined} size={30} aria-hidden className="agent-av">
            {agent.name.slice(0, 1)}
          </Avatar>
          <div className="agent-cell-text">
            <EllipsisText tooltip={agent.name}>
              <Link className="agent-cell-name" to={`/agents/${agent.id}`}>{agent.name}</Link>
            </EllipsisText>
            <div className="agent-cell-role">
              <EllipsisText tooltip={getAgentRoleLabel(agent.roleCode, agent.roleName)}>
                {getAgentRoleLabel(agent.roleCode, agent.roleName) || '-'}
              </EllipsisText>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: t('tags.columnTitle'),
      width: 190,
      align: 'left',
      render: (_, agent) => <AgentTagsCell agent={agent} canEdit={canEditTags} />,
    },
    { title: t('display.statusTitle'), width: 92, render: (_, agent) => <AgentStatusTag status={agent.status} /> },
    { title: t('display.executor'), width: 110, render: (_, agent) => <ExecutorState agent={agent} short /> },
    {
      title: t('fields.sdlc'),
      width: 130,
      align: 'left',
      render: (_, agent) => {
        const sdlc = sdlcText(agent);
        return sdlc && agent.sdlcId != null
          ? (
            <EllipsisText tooltip={sdlc}>
              <Link className="agent-text-link" to={`/sdlcs/${agent.sdlcId}`}>{sdlc}</Link>
            </EllipsisText>
          )
          : <span className="agent-sdlc-unbound">{t('display.notBound')}</span>;
      },
    },
    {
      title: t('display.squads'),
      width: 160,
      align: 'left',
      render: (_, agent) => <SquadLinks squadIds={agent.squadIds} squadNames={agent.squadNames} />,
    },
    { title: t('display.skills'), width: 64, render: (_, agent) => <NumPill value={agent.skillCount ?? 0} highlight /> },
    { title: t('display.memories'), width: 64, render: (_, agent) => <NumPill value={agent.memoryCount ?? 0} /> },
    { title: t('fields.repository'), width: 64, render: (_, agent) => <NumPill value={agent.repoPermCount ?? 0} /> },
    { title: t('fields.version'), width: 88, render: (_, agent) => <span className="agent-mono">{versionText(agent)}</span> },
    {
      title: t('fields.actions'),
      width: 118,
      render: (_, agent) => (
        <Space size={4}>
          <Tooltip title={t('display.details')}>
            <Button
              type="text"
              size="small"
              className="aw-op-btn"
              icon={<AwStrokeIcon name="eye" />}
              aria-label={t('display.viewDetails', { name: agent.name })}
              onClick={() => onView(agent)}
            />
          </Tooltip>
          <Tooltip title={t('display.edit')}>
            <Button
              type="text"
              size="small"
              className="aw-op-btn"
              icon={<AwStrokeIcon name="edit" />}
              aria-label={t('display.editNamed', { name: agent.name })}
              onClick={() => onEdit(agent)}
            />
          </Tooltip>
          {/* 与详情页同规则：使用中或系统平台智能体不可删除。 */}
          {isAgentDeletable(agent) && (
            <Popconfirm
              title={t('display.confirmDelete')}
              okText={t('display.deleteButton')}
              okButtonProps={{ danger: true }}
              cancelText={t('actions.cancel')}
              onConfirm={() => onDelete(agent)}
            >
              <Tooltip title={t('display.delete')}>
                <Button
                  type="text"
                  size="small"
                  className="aw-op-btn aw-op-btn--del"
                  icon={<AwStrokeIcon name="trash" />}
                  aria-label={t('display.deleteNamed', { name: agent.name })}
                />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];
}

function AgentTagsCell({ agent, canEdit }: { agent: Agent; canEdit: boolean }) {
  const { t } = useTranslation('agent');
  const [open, setOpen] = useState(false);
  const platform = agent.kind === 'PLATFORM';
  const readOnly = !canEdit || platform;
  const tags = <AgentTagList systemTags={agent.systemTags} customTags={agent.customTags} maxVisible={2} />;

  // The popover opens from the explicit cell handler below; closing on an outside mousedown keeps
  // the draft local without depending on the trigger's own toggle wiring.
  useEffect(() => {
    if (!open) return undefined;
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.agent-tags-cell') || target?.closest('.agent-tags-editor')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, [open]);

  if (readOnly) {
    const cell = (
      <div className="agent-tags-cell is-readonly" data-testid={`agent-tags-cell-${agent.id}`}>{tags}</div>
    );
    // Platform tags are locked server-side; every other read-only member simply has no entry point.
    return platform ? <Tooltip title={t('tags.platformReadOnly')}>{cell}</Tooltip> : cell;
  }

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomLeft"
      destroyOnHidden
      content={open ? <AgentTagsEditor agent={agent} onClose={() => setOpen(false)} /> : null}
    >
      <div
        className="agent-tags-cell is-editable"
        role="button"
        tabIndex={0}
        aria-label={t('tags.editNamed', { name: agent.name })}
        data-testid={`agent-tags-cell-${agent.id}`}
        onClick={() => setOpen((previous) => !previous)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {tags}
      </div>
    </Popover>
  );
}

function AgentCard({ agent, sdlc }: { agent: Agent; sdlc: string | null }) {
  const { t } = useTranslation('agent');
  const navigate = useNavigate();
  const hasTags = (agent.systemTags?.length ?? 0) + (agent.customTags?.length ?? 0) > 0;
  return (
    <article className="agent-person-card">
      <Link
        className="agent-card-detail-link"
        to={`/agents/${agent.id}`}
        aria-label={t('display.viewDetails', { name: agent.name })}
      />
      <div className="agent-card-content">
        <div className="agent-card-head">
          {agent.avatarUrl ? (
            <img className="agent-card-avatar" src={agent.avatarUrl} alt={agent.name} />
          ) : (
            <span className="agent-card-avatar" aria-hidden>{(agent.name || '?').slice(0, 1)}</span>
          )}
          <div className="agent-card-title-area">
            <div className="agent-card-title">{agent.name}</div>
            <div className="agent-card-role">{getAgentRoleLabel(agent.roleCode, agent.roleName) || versionText(agent)}</div>
          </div>
          <div className="agent-card-status">
            <AgentStatusTag status={agent.status} />
            {agent.kind === 'PLATFORM' && <Tag color="gold">{t('display.platform')}</Tag>}
          </div>
        </div>
        <ExecutorState agent={agent} />
        <div className="agent-card-sdlc">
          <span className="agent-card-sdlc-k">{t('display.sdlcShort')}</span>
          {sdlc && agent.sdlcId != null
            ? (
              <Link className="agent-card-sdlc-v agent-text-link" to={`/sdlcs/${agent.sdlcId}`} title={sdlc}>
                {sdlc}
              </Link>
            )
            : <span className="agent-card-sdlc-v agent-sdlc-unbound">{t('display.notBound')}</span>}
        </div>
        {hasTags && (
          // Card tags are read-only but still need hover tooltips, so clicks route to the detail link.
          <div className="agent-card-tags" onClick={() => navigate(`/agents/${agent.id}`)}>
            <AgentTagList systemTags={agent.systemTags} customTags={agent.customTags} maxVisible={3} testId="agent-card-tags" />
          </div>
        )}
        <div className="agent-card-meta">
          <span>{versionText(agent)}</span>
          <span>ID {agent.id}</span>
          <span>{formatDate(agent.gmtCreate)}</span>
        </div>
        <div className="agent-card-metrics">
          <Metric label={t('display.skills')} value={agent.skillCount ?? 0} />
          <Metric label={t('display.memories')} value={agent.memoryCount ?? 0} />
          <Metric label={t('fields.repository')} value={agent.repoPermCount ?? 0} />
        </div>
      </div>
    </article>
  );
}

function SummaryBadge({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'amber' }) {
  return (
    <span className={`agent-summary-badge${tone ? ` agent-summary-badge--${tone}` : ''}`}>
      {label}<b>{value}</b>
    </span>
  );
}

function agentSdlcText(agent: Agent, nameById: ReadonlyMap<number, string>): string | null {
  if (agent.sdlcId == null) return null;
  return nameById.get(agent.sdlcId) ?? `#${agent.sdlcId}`;
}

function SquadLinks({ squadIds, squadNames }: Pick<Agent, 'squadIds' | 'squadNames'>) {
  const { t } = useTranslation('squad');
  const ids = squadIds ?? [];
  if (ids.length === 0) return <span className="agent-sdlc-unbound">{t('ungrouped')}</span>;
  const names = ids.map((id, index) => squadNames?.[index] ?? t('squadFallback', { id }));
  return (
    <Tooltip title={names.map((name, index) => <div key={ids[index]}>{name}</div>)}>
      <div className="agent-squad-links">
        {ids.map((id, index) => (
          <Link key={id} className="agent-text-link" to={`/squads?squadId=${id}`}>{names[index]}</Link>
        ))}
      </div>
    </Tooltip>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="agent-card-metric">
      <span className="agent-card-metric-k">{label}</span>
      <strong className="agent-card-metric-v">{value}</strong>
    </div>
  );
}

function NumPill({ value, highlight = false }: { value: number; highlight?: boolean }) {
  return <span className={`agent-num-pill${highlight && value > 0 ? ' is-on' : ''}`}>{value}</span>;
}

function AgentStatusTag({ status }: { status: string }) {
  const colorKey = Object.prototype.hasOwnProperty.call(statusColorMap, status) ? statusColorMap[status] : 'gray';
  return <StatusTag dot size="sm" colorKey={colorKey} label={statusLabel(status)} />;
}

function ExecutorState({ agent, short = false }: { agent: Agent; short?: boolean }) {
  const online = (agent.executorOnlineCount ?? 0) > 0;
  return (
    <div className="agent-exec-state">
      <span className={`agent-exec-dot${online ? ' is-online' : ''}`} aria-hidden />
      <span>{executorText(agent, short)}</span>
    </div>
  );
}

function isAgentDeletable(agent: Agent) {
  return agent.status !== 'ONLINE' && agent.kind !== 'PLATFORM';
}

function statusLabel(status: string) {
  return status === 'ONLINE' ? i18n.t('display.inUse', { ns: 'agent' })
    : status === 'OFFLINE' ? i18n.t('display.notEnabled', { ns: 'agent' }) : getAgentStatusLabel(status);
}

function executorText(agent: Agent, short = false) {
  const online = agent.executorOnlineCount ?? 0;
  const total = agent.executorTotalCount ?? 0;
  if (total <= 1) {
    return short ? getAgentStatusLabel(online > 0 ? 'ONLINE' : 'OFFLINE')
      : i18n.t(online > 0 ? 'display.executorOnline' : 'display.executorOffline', { ns: 'agent' });
  }
  return i18n.t('display.onlineRatio', { ns: 'agent', online, total });
}

function versionText(agent: Agent) {
  return agent.latestVersionNo ? `v${agent.latestVersionNo}` : '-';
}

function formatDate(value: string) {
  return formatDateTime(value, { dateStyle: 'medium' });
}
