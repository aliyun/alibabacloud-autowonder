import { i18n } from '@/shared/i18n';
import { formatDateTime, formatNumber } from '@/shared/i18n/format';
import { useTranslation } from 'react-i18next';
import { PageHead } from '@/shared/ui/PageHead';
import { SectionCard } from '@/shared/ui/SectionCard';
import { EmptyState } from '@/shared/ui/EmptyState';
import { usePageSizePreference } from '@/shared/lib/usePageSizePreference';
import { Alert, Button, List, message, Modal, Popconfirm, Spin, Tabs, Tag, Typography } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/shared/auth/store';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import type { MemoryDocument, MemoryMutation, MemoryOwner, MemoryTopicInput } from './api';
import { createMemoryTopic, deleteMemoryTopic, updateMemoryTopic } from './api';
import { useMemoryDirectory, useMemoryDocuments, useMemoryHistory, useMemoryMutation } from './hooks';
import { MemoryDocumentEditor } from './MemoryDocumentEditor';
import { MemoryTopicEditor, memoryTypeLabels, memoryOwnerName } from './MemoryTopicEditor';
import { MemoryAclPanel } from './MemoryAclPanel';
import { MemoryImportSourcesPanel } from './MemoryImportSourcesPanel';
import { MarkdownView } from '@/shared/ui/MarkdownView';
import './MemoryListPage.css';

const ownerKey = (owner: MemoryOwner) => `${owner.scope}:${owner.ownerRef}`;
const PROJECT_SCOPE = 'ORG';
/* 原型归属者头像：项目固定石板灰、小队用主色、数字员工三色循环。 */
const OWNER_AVATAR_COLORS: Record<string, string[]> = {
  ORG: ['#7A8599'],
  SQUAD: ['var(--aw-primary)'],
  AGENT: ['var(--aw-ai)', '#B45309', '#0E7490'],
};
const ownerAvatarColor = (owner: MemoryOwner, index: number) => {
  const palette = OWNER_AVATAR_COLORS[owner.scope];
  return palette[index % palette.length];
};

const OPERATION_TAG_COLOR: Record<string, string> = { CREATE: 'green', UPDATE: 'blue', DELETE: 'red' };
const METADATA_PARSE_WARNING = 'METADATA_PARSE_WARNING';

export function MemoryListPage() {
  const { t } = useTranslation('memory');
  const operationLabels = { CREATE: t('operations.CREATE'), UPDATE: t('operations.UPDATE'), DELETE: t('operations.DELETE') };
  const ownerDescription = (item: MemoryOwner) => item.scope === PROJECT_SCOPE ? t('owner.project')
    : item.scope === 'SQUAD' ? t('owner.squad', { ownerRef: item.ownerRef })
    : t('owner.agent', { squads: item.squadNames?.length ? item.squadNames.join(t('owner.squadSeparator')) + ' · ' : '', ownerRef: item.ownerRef });
  const description = (document: MemoryDocument) => document.descriptionKind === METADATA_PARSE_WARNING ? t('document.metadataParseWarning') : document.description ?? '';
  const sizeLabel = (bytes: number) => bytes < 1024
    ? t('counts.bytes', { count: bytes, value: formatNumber(bytes) })
    : t('counts.kilobytes', { value: formatNumber(bytes / 1024, { maximumFractionDigits: 1 }) });
  const { data: directory, isLoading, isError } = useMemoryDirectory();
  const owners = directory?.owners ?? [];
  const [ownerFilter, setOwnerFilter] = useState('');
  const ownerGroups = [
    { key: 'ORG', label: t('page.groupProject'), items: owners.filter(item => item.scope === 'ORG') },
    { key: 'SQUAD', label: t('page.groupSquad'), items: owners.filter(item => item.scope === 'SQUAD') },
    { key: 'AGENT', label: t('page.groupAgent'), items: owners.filter(item => item.scope === 'AGENT') },
  ];
  const ownerQuery = ownerFilter.trim().toLowerCase();
  const filteredGroups = ownerGroups.map(group => ({
    ...group,
    visibleItems: group.items.filter(item => !ownerQuery
      || `${memoryOwnerName(item)} ${ownerDescription(item)}`.toLowerCase().includes(ownerQuery)),
  }));
  const noMatchingOwners = owners.length > 0 && filteredGroups.every(group => group.visibleItems.length === 0);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const toggleOwnerGroup = (key: string) => setCollapsedGroups(prev => prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key]);
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<MemoryDocument | null>();
  const [editingIndex, setEditingIndex] = useState<MemoryDocument>();
  const [viewing, setViewing] = useState<MemoryDocument>();
  const accessLevel = useAuthStore(state => state.accessLevel);
  const workspaceId = useAuthStore(state => state.currentWorkspace?.id);
  const client = useQueryClient();
  const runWithAccess = useAccessCommand();
  useEffect(() => { setSelected(undefined); setEditing(undefined); setEditingIndex(undefined); setViewing(undefined); }, [workspaceId]);
  const owner = owners.find(item => ownerKey(item) === selected) ?? owners.find(item => item.storeId != null) ?? owners[0];
  const isAgentOwner = owner?.scope === 'AGENT';
  const storeId = owner?.storeId ?? undefined;
  const { data: documents = [], isLoading: documentsLoading } = useMemoryDocuments(storeId);
  const { data: history = [] } = useMemoryHistory(storeId);
  const indexMutation = useMemoryMutation(storeId);
  const writable = accessLevel !== 'READ_ONLY' && !!owner?.canCreate;
  const administrator = accessLevel === 'ADMIN';
  const topics = documents.filter(document => document.path !== 'MEMORY.md').sort((a, b) => a.path.localeCompare(b.path));
  const [docPage, setDocPage] = useState(1);
  const [docPageSize, setDocPageSize] = usePageSizePreference('autowonder.memory.documents.pageSize', [10, 20, 50], 10);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = usePageSizePreference('autowonder.memory.history.pageSize', [10, 20, 50], 10);
  useEffect(() => { setDocPage(1); setHistoryPage(1); }, [storeId, workspaceId]);
  const index = documents.find(document => document.path === 'MEMORY.md');
  const invalidate = () => client.invalidateQueries({ queryKey: ['memory-stores'] });
  const saveTopic = useMutation({ mutationFn: async ({ target, topic }: { target: MemoryOwner; topic: MemoryTopicInput }) =>
    editing ? updateMemoryTopic(target.storeId!, topic) : createMemoryTopic(target, topic), onSuccess: invalidate });
  const removeTopic = useMutation({ mutationFn: (document: MemoryDocument) => deleteMemoryTopic(storeId!, document, `delete-${document.id}-${document.version}`), onSuccess: invalidate });
  const save = async (target: MemoryOwner, topic: MemoryTopicInput) => {
    await runWithAccess('READ_WRITE', t('commands.saveMemory'), async () => {
      await saveTopic.mutateAsync({ target, topic }); setSelected(ownerKey(target)); setEditing(undefined); message.success(i18n.t('memory:messages.memorySaved'));
    });
  };
  const saveIndex = async (request: MemoryMutation) => { await runWithAccess('READ_WRITE', t('commands.saveIndex'), async () => { await indexMutation.mutateAsync(request); setEditingIndex(undefined); message.success(i18n.t('memory:messages.indexSaved')); }); };
  const loadingNote = <div className="mem-loading"><Spin /><span>{t('page.loading')}</span></div>;
  const viewerMeta = [
    t('document.viewer', { path: viewing?.path ?? '', version: viewing ? formatNumber(viewing.version) : '—' }),
    viewing?.memoryType ? (Object.prototype.hasOwnProperty.call(memoryTypeLabels, viewing.memoryType) ? memoryTypeLabels[viewing.memoryType as keyof typeof memoryTypeLabels] : viewing.memoryType) : '',
    viewing?.modifiedAt ? t('document.updatedAt', { time: formatDateTime(viewing.modifiedAt) }) : '',
  ].filter(Boolean).join(t('document.metaSeparator'));
  if (isLoading) return loadingNote;
  if (isError) return <Alert type="error" showIcon message={t('page.loadError')} />;
  return <div className="memory-page">
    <PageHead title={t('page.title')} description={t('page.description')} actions={<Button type="primary" icon={<AwStrokeIcon name="plus" />} disabled={!writable} onClick={() => runWithAccess('READ_WRITE', t('page.create'), () => setEditing(null))}>{t('page.create')}</Button>} />
    {directory?.migration && <div className={directory.migration.pending ? 'mem-note is-warning' : 'mem-note'}>
      <AwStrokeIcon name="bulb" className="mem-note-icon" size={14} />
      <span>{t('migration.note', {
        summary: t('migration.summary', { migrated: t('migration.migrated', { count: directory.migration.migrated }), pending: t('migration.pending', { count: directory.migration.pending }) }),
        hint: t('migration.hint'),
      })}</span>
    </div>}
    <div className="mem-layout">
      <SectionCard className="mem-owners" title={t('page.owners')} flush>
        <div className="mem-owners-filter">
          <AwStrokeIcon name="search" className="mem-owners-filter-icon" size={13} />
          <input type="search" value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)}
            placeholder={t('page.filterOwners')} aria-label={t('page.filterOwners')} />
        </div>
        <div className="mem-owners-body">
          {owners.length === 0 ? <div className="mem-owners-empty">{t('page.noOwners')}</div> : <>
            {noMatchingOwners && <div className="mem-owners-empty">{t('page.noMatchingOwners')}</div>}
            {filteredGroups.map(group => {
              // 搜索时强制展开，避免命中项被折叠态挡住
              const collapsed = !ownerQuery && collapsedGroups.includes(group.key);
              return group.visibleItems.length === 0 ? null : <div className="mem-owner-group" key={group.key}>
                <button type="button" className={collapsed ? 'mem-owner-group-head is-collapsed' : 'mem-owner-group-head'}
                  aria-expanded={!collapsed} aria-controls={`mem-owner-group-${group.key}`} onClick={() => toggleOwnerGroup(group.key)}>
                  <AwStrokeIcon name="chev-d" size={12} className="mem-owner-group-chevron" />
                  <span>{group.label}</span>
                  {group.key !== PROJECT_SCOPE && <span className="mem-owner-group-count">{formatNumber(group.items.length)}</span>}
                </button>
                {!collapsed && <List id={`mem-owner-group-${group.key}`} dataSource={group.visibleItems} split={false} renderItem={item => <List.Item className={owner && ownerKey(item) === ownerKey(owner) ? 'mem-owner-item is-active' : 'mem-owner-item'} onClick={() => setSelected(ownerKey(item))}>
                  <span className="mem-owner-mark" style={{ background: ownerAvatarColor(item, group.items.indexOf(item)) }} aria-hidden="true">{memoryOwnerName(item).slice(0, 1)}</span>
                  <div className="mem-owner-copy">
                    <div className="mem-owner-name" title={memoryOwnerName(item)}>{memoryOwnerName(item)}</div>
                    <div className="mem-owner-sub" title={ownerDescription(item)}>{ownerDescription(item)}</div>
                  </div>
                </List.Item>} />}
              </div>;
            })}
          </>}
        </div>
      </SectionCard>
      <div className="mem-main">
        {!owner ? <EmptyState icon={<AwStrokeIcon name="book" />} title={t('page.selectOwner')} /> : storeId == null ?
        <EmptyState icon={<AwStrokeIcon name="book" />} title={writable ? t('page.noWritableMemory') : t('page.noReadableMemory')} /> : <>
        <div className="mem-tabs-row">
          <Tabs className="mem-tabs" items={[
          { key: 'topics', label: <span className="mem-tab-label">{t('page.topics')}<span className="mem-tab-count">{formatNumber(topics.length)}</span></span>, children: documentsLoading ? loadingNote : <>
            {index && <div className="mem-index-strip">
              <AwStrokeIcon name="book" className="mem-index-strip-icon" size={15} />
              <div className="mem-index-strip-copy">
                <div className="mem-index-strip-title">
                  <Button type="link" onClick={() => setViewing(index)}>MEMORY.md</Button>
                  <Tag className="mem-index-strip-tag">{t('page.index')}</Tag>
                </div>
                <div className="mem-index-strip-hint">{t('page.indexHint')}</div>
              </div>
              <Button type="link" className="mem-op-link" disabled={!writable} onClick={() => setEditingIndex(index)}>{t('page.editIndex')}</Button>
            </div>}
            <List className="mem-topic-list" dataSource={topics} locale={{ emptyText: t('page.noTopics') }} pagination={{
              current: docPage, pageSize: docPageSize, total: topics.length,
              showSizeChanger: true, showTotal: (count) => t('counts.total', { count }),
              onChange: (p, ps) => { setDocPage(p); if (ps !== docPageSize) setDocPageSize(ps); },
            }} renderItem={document => <List.Item actions={[
              <Button key="edit" type="link" className="mem-op-link" disabled={!writable} onClick={() => setEditing(document)}>{t('actions.edit')}</Button>,
              <Popconfirm okText={t('actions.delete')} cancelText={t('actions.cancel')} key="delete" title={t('page.deleteConfirm')} disabled={!writable} onConfirm={() => runWithAccess('READ_WRITE', t('commands.deleteMemory'), () => removeTopic.mutateAsync(document))}><Button type="link" danger className="mem-op-link" disabled={!writable}>{t('actions.delete')}</Button></Popconfirm>,
            ]}><List.Item.Meta title={<Button type="link" className="mem-topic-title" onClick={() => setViewing(document)}>{document.title ?? document.path}</Button>}
              description={t('document.summary', { description: description(document), size: sizeLabel(document.byteSize), version: t('document.version', { version: formatNumber(document.version) }) })} /></List.Item>} />
          </> },
          { key: 'history', label: t('page.history'), children: <List className="mem-history-list" dataSource={history} locale={{ emptyText: t('page.noHistory') }} pagination={{
            current: historyPage, pageSize: historyPageSize, total: history.length,
            showSizeChanger: true, showTotal: (count) => t('counts.total', { count }),
            onChange: (p, ps) => { setHistoryPage(p); if (ps !== historyPageSize) setHistoryPageSize(ps); },
          }} renderItem={change => <List.Item className="mem-hist-item">
            <Tag color={Object.prototype.hasOwnProperty.call(OPERATION_TAG_COLOR, change.operation) ? OPERATION_TAG_COLOR[change.operation as keyof typeof OPERATION_TAG_COLOR] : undefined}>{Object.prototype.hasOwnProperty.call(operationLabels, change.operation) ? operationLabels[change.operation as keyof typeof operationLabels] : change.operation}</Tag>
            <span className="mem-hist-path">{change.path}</span>
            <span className="mem-hist-rev">{t('page.revisionShort', { revision: formatNumber(change.storeRevision) })}</span>
          </List.Item>} /> },
          { key: 'acl', label: t('page.acl'), children: <div className="mem-panel"><MemoryAclPanel storeId={storeId} administrator={administrator} /></div> },
          { key: 'imports', label: t('page.imports'), children: <div className="mem-panel">{isAgentOwner ? <MemoryImportSourcesPanel administrator={administrator} agentId={owner.ownerRef} /> : <Alert type="info" message={t('page.agentImports')} />}</div> },
          ]} />
          <span className="mem-revision">{t('page.revision', { revision: formatNumber(owner.currentRevision ?? 0) })}</span>
        </div>
      </>}</div>
    </div>
    <MemoryTopicEditor open={editing !== undefined} owners={owners} initialOwner={owner} document={editing ?? undefined} saving={saveTopic.isPending} onCancel={() => setEditing(undefined)} onSave={save} />
    <MemoryDocumentEditor open={!!editingIndex} document={editingIndex} writable={writable} saving={indexMutation.isPending} onCancel={() => setEditingIndex(undefined)} onSave={saveIndex} />
    <Modal className="mem-viewer-modal" closable={{ 'aria-label': t('actions.close') }} title={<>
      <span className="mem-viewer-title">{viewing?.title ?? viewing?.path}</span>
      <Typography.Paragraph className="mem-viewer-meta" type="secondary">{viewerMeta}</Typography.Paragraph>
    </>} open={!!viewing} onCancel={() => setViewing(undefined)} footer={null} width={760}>
      {/* 解析失败时后端 body 仍是含 frontmatter 的原文，需要说明这一行不是正文损坏 */}
      {viewing?.descriptionKind === METADATA_PARSE_WARNING && <div className="mem-viewer-warn">
        <AwStrokeIcon name="alert-t" size={13} />
        <span>{t('document.metadataParseWarning')}</span>
      </div>}
      <div className="mem-viewer-body"><MarkdownView content={viewing?.body ?? viewing?.contentMd ?? ''} resolveRelativeLink={href => {
        // MEMORY.md 里的链接是同目录 .md，直接在本弹窗打开对应记忆；找不到就按纯文本渲染。
        const path = href.replace(/^\.\//, '');
        const target = documents.find(document => document.path === path);
        return target ? () => setViewing(target) : null;
      }} /></div>
    </Modal>
  </div>;
}
