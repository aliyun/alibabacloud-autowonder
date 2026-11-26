import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { formatDateTime } from '@/shared/i18n/format';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { NoticeTip } from '@/shared/ui/NoticeTip';
import { Alert, Button, Collapse, Form, Input, message, Modal, Segmented, Space, Tag, Typography } from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import type { ColumnsType } from 'antd/es/table';
import {
  BRANDING_QUERY_KEY,
  getPublicBranding,
} from '@/features/platform/brandingApi';
import {
  createMcpToken,
  listMcpTokens,
  listMcpTools,
  revokeMcpToken,
  type McpToken,
  type McpTool,
} from './api';
import { copyTextToClipboard } from '@/shared/lib/clipboard';

const { Text } = Typography;

const TOKEN_PLACEHOLDER = '<MCP_TOKEN>';
const MISSING_VALUE = '—';
const INPUT_SCHEMA_TEST_ID = 'mcp-input-schema-table';
const OUTPUT_SCHEMA_TEST_ID = 'mcp-output-schema-table';

export function getMcpPermissionHint() {
  return i18n.t('mcp:permissionHint');
}

type CapabilityMeta = {
  key: string;
  title: string;
  description: string;
  color: string;
  match: (toolName: string) => boolean;
};

type SchemaRow = {
  key: string;
  label: string;
  depth: number;
  type: string;
  required: boolean;
  description: string;
};

type SchemaProperty = {
  type?: unknown;
  description?: unknown;
  properties?: Record<string, SchemaProperty>;
  required?: unknown;
  items?: SchemaProperty;
};

const CAPABILITIES: CapabilityMeta[] = [
  {
    key: 'workitem',
    get title() { return i18n.t('mcp:capabilities.workitem.title'); },
    get description() { return i18n.t('mcp:capabilities.workitem.description'); },
    color: 'blue',
    match: (name) => name.includes('workitem') || name.includes('comment') || name.includes('pause') || name.includes('resume') || name.includes('transition'),
  },
  {
    key: 'sdlc',
    get title() { return i18n.t('mcp:capabilities.sdlc.title'); },
    get description() { return i18n.t('mcp:capabilities.sdlc.description'); },
    color: 'purple',
    match: (name) => name.includes('sdlc') || name.includes('status_template'),
  },
  {
    key: 'agent',
    get title() { return i18n.t('mcp:capabilities.agent.title'); },
    get description() { return i18n.t('mcp:capabilities.agent.description'); },
    color: 'cyan',
    match: (name) => name.includes('agent'),
  },
  {
    key: 'executor',
    get title() { return i18n.t('mcp:capabilities.executor.title'); },
    get description() { return i18n.t('mcp:capabilities.executor.description'); },
    color: 'geekblue',
    match: (name) => name.includes('executor'),
  },
  {
    key: 'skill',
    get title() { return i18n.t('mcp:capabilities.skill.title'); },
    get description() { return i18n.t('mcp:capabilities.skill.description'); },
    color: 'orange',
    match: (name) => name.includes('skill') || name.includes('platform_skill'),
  },
  {
    key: 'memory',
    get title() { return i18n.t('mcp:capabilities.memory.title'); },
    get description() { return i18n.t('mcp:capabilities.memory.description'); },
    color: 'magenta',
    match: (name) => name.includes('memor'),
  },
  {
    key: 'project',
    get title() { return i18n.t('mcp:capabilities.project.title'); },
    get description() { return i18n.t('mcp:capabilities.project.description'); },
    color: 'green',
    match: (name) => name.includes('project'),
  },
];

function capabilityFor(toolName: string) {
  return CAPABILITIES.find((capability) => capability.match(toolName)) ?? {
    key: 'other',
    get title() { return i18n.t('mcp:capabilities.other.title'); },
    get description() { return i18n.t('mcp:capabilities.other.description'); },
    color: 'default',
    match: () => false,
  };
}

function schemaType(config: SchemaProperty): string {
  const raw = config?.type;
  const types = (Array.isArray(raw) ? raw : raw ? [raw] : ['object']).map(String);
  const base = types.filter((type) => type !== 'null')[0] ?? 'object';
  const label = base === 'array' ? `array<${config.items ? schemaType(config.items) : 'any'}>` : base;
  return types.includes('null') ? `${label} | null` : label;
}

function schemaRows(schema?: SchemaProperty, prefix = '', depth = 0): SchemaRow[] {
  const properties = schema?.properties;
  if (!properties || typeof properties !== 'object') {
    return [];
  }
  const required = new Set(Array.isArray(schema?.required) ? schema.required.map(String) : []);
  return Object.entries(properties).flatMap(([name, config]) => {
    const key = prefix ? `${prefix}.${name}` : name;
    const type = schemaType(config);
    const row = {
      key,
      label: name,
      depth,
      type,
      required: required.has(name),
      description: String(config?.description ?? ''),
    };
    const baseType = String(Array.isArray(config?.type) ? config.type.filter((item) => item !== 'null')[0] : config?.type ?? 'object');
    if (baseType === 'array') {
      return [row, ...schemaRows(config.items, key, depth + 1)];
    }
    if (baseType === 'object') {
      return [row, ...schemaRows(config, key, depth + 1)];
    }
    return [row];
  });
}

function groupedTools(tools: McpTool[]) {
  const groups = new Map<string, { meta: ReturnType<typeof capabilityFor>; tools: McpTool[] }>();
  tools.forEach((tool) => {
    const meta = capabilityFor(tool.name);
    const current = groups.get(meta.key) ?? { meta, tools: [] };
    current.tools.push(tool);
    groups.set(meta.key, current);
  });
  return Array.from(groups.values()).sort((a, b) => a.meta.title.localeCompare(b.meta.title));
}

function mcpUrl(mcpEndpoint: string, token: string) {
  const tokenSegment = token === TOKEN_PLACEHOLDER ? token : encodeURIComponent(token);
  return `${mcpEndpoint.replace(/\/+$/, '')}/${tokenSegment}/`;
}

function clientSnippets(mcpEndpoint: string, token: string) {
  const endpoint = mcpUrl(mcpEndpoint, token);
  const jsonConfig = `{
  "mcpServers": {
    "autowonder": {
      "url": "${endpoint}"
    }
  }
}`;

  return [
    {
      key: 'codex',
      label: 'Codex',
      command: `${i18n.t('mcp:codexComment')}
[mcp_servers.autowonder]
url = "${endpoint}"`,
    },
    {
      key: 'claude',
      label: 'Claude',
      command: `claude mcp add --transport http autowonder "${endpoint}"`,
    },
    {
      key: 'qoder',
      label: 'Qoder',
      command: jsonConfig,
    },
    {
      key: 'cursor',
      label: 'Cursor',
      command: jsonConfig,
    },
  ];
}

export function McpTokenSettingsPanel() {
  const { t } = useTranslation('mcp');
  const queryClient = useQueryClient();
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [mcpView, setMcpView] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const toggleGroup = (key: string) => {
    setExpandedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const [form] = Form.useForm<{ name: string }>();
  const tokenName = Form.useWatch('name', form) ?? 'MCP Token';

  const tokensQuery = useQuery({ queryKey: ['mcp-tokens'], queryFn: listMcpTokens });
  const toolsQuery = useQuery({ queryKey: ['mcp-tools'], queryFn: listMcpTools });
  const brandingQuery = useQuery({
    queryKey: BRANDING_QUERY_KEY,
    queryFn: getPublicBranding,
  });
  const mcpEndpoint = brandingQuery.data?.mcpBaseUrl?.trim() || null;
  const isCommunityEdition = brandingQuery.data?.communityEdition === true;
  useLocalizedValidation(form, tokenModalOpen && !(issuedToken && mcpEndpoint));

  const createTokenMutation = useMutation({
    mutationFn: createMcpToken,
    onSuccess: (token) => {
      setIssuedToken(token.token);
      queryClient.invalidateQueries({ queryKey: ['mcp-tokens'] });
    },
    onError: (error: Error) => message.error(error.message),
  });

  const revokeTokenMutation = useMutation({
    mutationFn: revokeMcpToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-tokens'] });
      message.success(i18n.t('mcp:revokedNotice'));
    },
  });

  const tools = useMemo(() => toolsQuery.data ?? [], [toolsQuery.data]);
  const toolGroups = useMemo(() => groupedTools(tools), [tools, t]);
  const activeTokens = useMemo(
    () => (tokensQuery.data ?? []).filter((token) => !token.revokedAt).length,
    [tokensQuery.data],
  );

  const copyText = async (text: string) => {
    const copied = await copyTextToClipboard(text);
    if (copied) {
      message.success(i18n.t('mcp:copied'));
    } else {
      message.warning(i18n.t('mcp:copyFailed'));
    }
  };

  const submitToken = async () => {
    if (!mcpEndpoint) {
      message.error(i18n.t('mcp:endpointUnavailable'));
      return;
    }
    const values = await form.validateFields().catch(() => null);
    if (values) createTokenMutation.mutate({ name: values.name });
  };

  const closeTokenModal = () => {
    setTokenModalOpen(false);
    setIssuedToken(null);
    form.resetFields();
  };

  const tokenColumns: ColumnsType<McpToken> = [
    { title: t('name'), dataIndex: 'name' },
    { title: t('prefix'), dataIndex: 'tokenPrefix', render: (value: string) => <Text code>{value}</Text> },
    { title: t('created'), dataIndex: 'gmtCreate', render: (value?: string | null) => value ? formatDateTime(value) : '-' },
    { title: t('lastUsed'), dataIndex: 'lastUsedAt', render: (value?: string | null) => value ? formatDateTime(value) : '-' },
    {
      title: t('status'),
      render: (_, record) => record.revokedAt ? <Tag>{t('revoked')}</Tag> : <Tag color="green">{t('active')}</Tag>,
    },
    {
      title: t('actions'),
      fixed: 'right',
      width: 90,
      render: (_, record) => (
        <Button
          danger
          type="text"
          icon={<AwStrokeIcon name="trash" />}
          disabled={Boolean(record.revokedAt)}
          onClick={() => revokeTokenMutation.mutate(record.id)}
          aria-label={t('revokeNamed', { name: record.name })}
        />
      ),
    },
  ];

  const renderSchemaSection = (title: string, rows: SchemaRow[], emptyText: string, testId: string) => (
    <div className="mcp-schema-section" data-testid={testId}>
      <div className="mcp-schema-head">
        <b>{title}</b>
        <span>{t('fieldCount', { count: rows.length })}</span>
      </div>
      {rows.length === 0 ? (
        <div className="mcp-schema-empty">{emptyText}</div>
      ) : (
        <div className="mcp-schema-table" role="table" aria-label={title}>
          <div className="mcp-schema-row mcp-schema-row-head" role="row">
            <span role="columnheader">{t('field')}</span>
            <span role="columnheader">{t('type')}</span>
            <span role="columnheader">{t('required')}</span>
            <span role="columnheader">{t('description')}</span>
          </div>
          {rows.map((row) => (
            <div className="mcp-schema-row" role="row" key={row.key}>
              <span
                className="mcp-schema-field"
                role="cell"
                style={{ paddingLeft: row.depth * 14 }}
                title={row.key}
              >
                {row.depth > 0 ? <i className="mcp-schema-branch" aria-hidden="true" /> : null}
                {row.label}
              </span>
              <span className="mcp-schema-type" role="cell" title={row.type}>{row.type}</span>
              <span className="mcp-schema-req" role="cell">
                {row.required ? <i className="mcp-schema-req-dot" aria-label={t('required')} title={t('required')} /> : null}
              </span>
              <span className="mcp-schema-desc" role="cell">{row.description || MISSING_VALUE}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderToolDetail = (tool: McpTool) => (
    <div className="mcp-tool-detail">
      {renderSchemaSection(t('input'), schemaRows(tool.inputSchema), t('noInput'), INPUT_SCHEMA_TEST_ID)}
      {renderSchemaSection(t('output'), schemaRows(tool.outputSchema), t('result'), OUTPUT_SCHEMA_TEST_ID)}
    </div>
  );

  const toolColumns: ColumnsType<McpTool> = [
    { title: t('tools'), dataIndex: 'name', align: 'left', width: 260, render: (value: string) => <span className="mcp-tool-name" title={value}>{value}</span> },
    { title: t('description'), dataIndex: 'description', align: 'left' },
  ];

  const endpointUnavailableText = brandingQuery.isLoading
    ? t('endpointLoading')
    : t('endpointFailed');
  const displayMcpUrl = mcpEndpoint
    ? mcpUrl(mcpEndpoint, issuedToken ?? TOKEN_PLACEHOLDER)
    : endpointUnavailableText;
  const installCards = mcpEndpoint
    ? clientSnippets(mcpEndpoint, issuedToken ?? TOKEN_PLACEHOLDER)
    : [];
  const issuedSnippets = mcpEndpoint && issuedToken ? clientSnippets(mcpEndpoint, issuedToken) : [];
  const qoderSnippet = issuedSnippets.find((client) => client.key === 'qoder');
  const otherClientSnippets = issuedSnippets.filter((client) => client.key !== 'qoder');

  const snippetCollapseItem = (client: { key: string; label: string; command: string }) => ({
    key: client.key,
    label: t('clientConfig', { client: client.label }),
    children: <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{client.command}</pre>,
    extra: <Button aria-label={t('copy')} size="small" icon={<AwStrokeIcon name="copy" />} onClick={(event) => {
      event.stopPropagation();
      copyText(client.command);
    }}>{t('copy')}</Button>,
  });

  return (
    <section className="aw-card prof-panel" aria-label={t('title')}>
      <div className="prof-sec-head">
        <div className="prof-sec-head-text">
          <b>{t('title')}</b>
          <div className="prof-sec-desc">{getMcpPermissionHint()}</div>
        </div>
        <div className="prof-sec-extra">
          <Button aria-label={t('refresh')} size="small" icon={<AwStrokeIcon name="refresh" />} onClick={() => {
            tokensQuery.refetch();
            toolsQuery.refetch();
            brandingQuery.refetch();
          }}>{t('refresh')}</Button>
          <Button aria-label={t('newToken')}
            size="small"
            type="primary"
            icon={<AwStrokeIcon name="plus" />}
            loading={brandingQuery.isLoading}
            disabled={!mcpEndpoint}
            onClick={() => setTokenModalOpen(true)}
          >{t('newToken')}</Button>
        </div>
      </div>
      <div className="prof-sec-body">
        <Segmented
          value={mcpView}
          onChange={(value) => setMcpView(Number(value))}
          options={[
            { label: t('overview'), value: 0 },
            { label: t('tools'), value: 1 },
            { label: t('install'), value: 2 },
          ]}
          style={{ marginBottom: 14 }}
        />

        {mcpView === 0 ? (
          <>
            <div className="prof-stats">
              <div className="prof-stat">
                <div className="prof-stat-label"><AwStrokeIcon name="key" size={13} />{t('activeTokens')}</div>
                <div className="prof-stat-value">{activeTokens}</div>
              </div>
              <div className="prof-stat">
                <div className="prof-stat-label"><AwStrokeIcon name="api" size={13} />{t('openTools')}</div>
                <div className="prof-stat-value">{tools.length}</div>
              </div>
              <div className="prof-stat">
                <div className="prof-stat-label"><AwStrokeIcon name="appstore" size={13} />{t('capabilityGroups')}</div>
                <div className="prof-stat-value">{toolGroups.length}</div>
              </div>
            </div>

            <div className="prof-block">
              <div className="prof-block-head">
                <b>{t('endpoint')}</b>
                <span className="prof-block-extra"><Tag>{t('readOnly')}</Tag></span>
              </div>
              <Space.Compact style={{ width: '100%' }}>
                <Input aria-label={t('endpoint')} readOnly value={displayMcpUrl} />
                <Button
                  icon={<AwStrokeIcon name="copy" />}
                  disabled={!mcpEndpoint}
                  onClick={() => copyText(displayMcpUrl)}
                  aria-label={t('copyEndpoint')}
                />
              </Space.Compact>
              <div className="prof-foot-hint" style={{ marginTop: 8 }}>{t('oneTimeUrl')}</div>
            </div>

            <div className="prof-block">
              <div className="prof-block-head">
                <b>{t('tokens')}</b>
                <span className="prof-block-extra prof-foot-hint">
                  {t('tokenSummary', { total: tokensQuery.data?.length ?? 0, active: activeTokens })}
                </span>
              </div>
              <Table
                rowKey="id"
                size="small"
                columns={tokenColumns}
                dataSource={tokensQuery.data ?? []}
                loading={tokensQuery.isLoading}
                pagination={false}
                scroll={{ x: 720 }}
              />
            </div>
          </>
        ) : null}

        {mcpView === 1 ? (
          <>
            <NoticeTip
              kind="info"
              title={t('toolsSummary', { groups: toolGroups.length, tools: tools.length })}
              style={{ marginBottom: 12 }}
            />
            {toolGroups.map((group) => (
              <div className="prof-block" key={group.meta.key}>
                <button
                  type="button"
                  className="prof-block-head mcp-group-toggle"
                  aria-expanded={expandedGroups.has(group.meta.key)}
                  onClick={() => toggleGroup(group.meta.key)}
                >
                  <span className="mcp-group-chevron" aria-hidden="true" data-open={expandedGroups.has(group.meta.key)}>
                    <AwStrokeIcon name="chev-r" size={14} />
                  </span>
                  <Tag color={group.meta.color}>{group.meta.title}</Tag>
                  <b>{t('toolCount', { count: group.tools.length })}</b>
                  <span className="prof-block-extra prof-foot-hint">{group.meta.description}</span>
                </button>
                {expandedGroups.has(group.meta.key) ? (
                  <Table
                    className="mcp-tools-table"
                    rowKey="name"
                    size="small"
                    tableLayout="fixed"
                    columns={toolColumns}
                    locale={{ expand: t('expandRow'), collapse: t('collapseRow') }}
                    dataSource={group.tools}
                    loading={toolsQuery.isLoading}
                    pagination={false}
                    expandable={{ expandedRowRender: renderToolDetail }}
                    data-testid="mcp-tools-table"
                  />
                ) : null}
              </div>
            ))}
          </>
        ) : null}

        {mcpView === 2 ? (
          <>
            <NoticeTip
              kind={mcpEndpoint ? 'info' : 'error'}
              title={mcpEndpoint ? t('installHint') : endpointUnavailableText}
              style={{ marginBottom: 12 }}
            />
            <div className="prof-install-grid">
              {installCards.map((client) => (
                <div className="prof-block" key={client.key} style={{ marginBottom: 0 }}>
                  <div className="prof-block-head">
                    <b><AwStrokeIcon name="rocket" size={14} />{client.label}</b>
                    <span className="prof-block-extra">
                      <Button aria-label={t('copy')} size="small" icon={<AwStrokeIcon name="copy" />} onClick={() => copyText(client.command)} />
                    </span>
                  </div>
                  <pre className="prof-code">{client.command}</pre>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <Modal
        closable={{ closeIcon: <AwStrokeIcon name="x" size={14} />, 'aria-label': t('close') }}
        cancelText={t('cancel')}
        okButtonProps={{
          'aria-label': issuedToken ? t('done') : t('create'),
          disabled: !issuedToken && !tokenName.trim(),
        }}
        title={t('newTitle')}
        open={tokenModalOpen}
        onOk={issuedToken ? closeTokenModal : submitToken}
        okText={issuedToken ? t('done') : t('create')}
        confirmLoading={createTokenMutation.isPending}
        onCancel={closeTokenModal}
        width={760}
      >
        {issuedToken && mcpEndpoint ? (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Alert type="warning" showIcon message={t('oneTimeToken')} />
            <Space.Compact style={{ width: '100%' }}>
              <Input aria-label={t('tokenLabel')} readOnly value={issuedToken} />
              <Button icon={<AwStrokeIcon name="copy" />} onClick={() => copyText(issuedToken)} aria-label={t('copyToken')} />
            </Space.Compact>
            <Space.Compact style={{ width: '100%' }}>
              <Input aria-label={t('urlLabel')} readOnly value={mcpUrl(mcpEndpoint, issuedToken)} />
              <Button icon={<AwStrokeIcon name="copy" />} onClick={() =>
                copyText(mcpUrl(mcpEndpoint, issuedToken))} aria-label={t('copyUrl')} />
            </Space.Compact>
            <Collapse
              expandIcon={({ isActive }) => <span aria-hidden="true" style={{ display: 'inline-flex', transform: `rotate(${isActive ? 90 : 0}deg)` }}><AwStrokeIcon name="chev-r" size={14} /></span>}
              size="small"
              defaultActiveKey={['qoder']}
              items={[
                ...(qoderSnippet ? [snippetCollapseItem(qoderSnippet)] : []),
                ...(isCommunityEdition ? [] : [{
                  key: 'more-clients',
                  label: t('moreClients'),
                  children: (
                    <Collapse expandIcon={({ isActive }) => <span aria-hidden="true" style={{ display: 'inline-flex', transform: `rotate(${isActive ? 90 : 0}deg)` }}><AwStrokeIcon name="chev-r" size={14} /></span>} size="small" items={otherClientSnippets.map(snippetCollapseItem)} />
                  ),
                }]),
              ]}
            />
          </Space>
        ) : (
          <Form form={form} layout="vertical" initialValues={{ name: 'MCP Token' }}>
            <Form.Item name="name" label={t('name')} rules={[{ required: true, message: t('nameRequired') }]}>
              <Input maxLength={80} />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </section>
  );
}
