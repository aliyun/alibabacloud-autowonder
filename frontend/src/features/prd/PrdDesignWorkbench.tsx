import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Button, Card, Drawer, Dropdown, Empty, List, Segmented, Space, Spin, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  EllipsisOutlined, HistoryOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getSquadMembers } from '@/features/squad/api';
import { createClientMessageId } from '@/features/workitem/clarification/api';
import { ApiError } from '@/shared/types/common';
import { PageBackButton } from '@/shared/ui/PageBackButton';
import { PrdConversation, type PrdConversationHandle } from './components/PrdConversation';
import { apiClient } from '@/shared/api/client';
import { type PrototypeElement } from './components/PrdPrototypePreview';
import { PrdDesignBrowser } from './components/PrdDesignBrowser';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { formatDateTime } from '@/shared/i18n/format';
import { PrdShareName } from './components/PrdShareName';
import {
  DELIVERY_MODE,
  PRD_VERSION_STATUS,
} from './api';
import {
  useCreatePrdDraft,
  usePrdDeliveryAcceptance,
  usePrdDeliveries,
  usePrdDesign,
  usePrdVersion,
  usePrdVersions,
} from './hooks';
import { PrdDesignDocumentLink, PrdDesignHeader } from './components/PrdDesignHeader';
import { PrdRequirementsDocument } from './components/PrdRequirementsDocument';
import { useDesignHandoff } from './handoff';
import { readLaunch, launchPath, designUrl, WorkitemLaunchModal } from '@/features/workitem/components/WorkitemLaunchModal';
import { getRepo } from '@/features/repo/api';
import { PrdAcceptancePanel } from './components/PrdAcceptancePanel';
import type { PrdDesignRuntime } from './designBrowser';

// Git represents an application at the repository root with an empty relative path.
const REPOSITORY_ROOT = '.';
const PREVIEW_MODE = { PROTOTYPE: 'prototype', DOCUMENT: 'document' } as const;

const { Text } = Typography;

/**
 * The PRD design workbench for one workitem: design conversation on the left, live preview and
 * document on the right, with project settings and version history available in drawers.
 *
 * <p>Three invariants shape this page. The document is shown only through a sandboxed iframe, so it
 * can never reach host state. Confirmation is a distinct action from starting a delivery — confirming
 * records acceptance of one exact version and never triggers coding, merge or release. And a version
 * once confirmed is immutable: editing produces a new draft instead of changing the confirmed one.
 *
 * <p>The route is a standalone URL keyed by the workitem, so the workbench survives a refresh and can
 * be linked directly; it owns no state that the server does not also hold.
 */
export function PrdDesignWorkbench() {
  const { t } = useTranslation(['prd', 'workitem']);
  const { workitemId } = useParams<{ workitemId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const documentParam = Number(searchParams.get('prdDocument'));
  const linkedVersion = Number.isSafeInteger(documentParam) && documentParam > 0 ? documentParam : null;
  const accessCommand = useAccessCommand();

  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const conversationRef = useRef<PrdConversationHandle>(null);
  const [previewMode, setPreviewMode] = useState<string>(linkedVersion ? PREVIEW_MODE.DOCUMENT : PREVIEW_MODE.PROTOTYPE);
  const [elementSelection, setElementSelection] = useState<PrototypeElement | null>(null);
  const [employeeOffline, setEmployeeOffline] = useState(false);
  const [conversationProcessing, setConversationProcessing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const launch = useQuery({
    queryKey: ['workitem-design-launch', workitemId],
    queryFn: () => readLaunch(workitemId!, 'design'), enabled: !!workitemId,
    refetchInterval: query => {
      const phase = query.state.data?.phase;
      return phase && phase !== 'NEW' && phase !== 'ACTIVE' && !phase.startsWith('FAILED') ? 1500 : false;
    },
  });
  const setup = launch.data;
  const sourceRepo = useQuery({ queryKey: ['repo', setup?.repoId], queryFn: () => getRepo(setup!.repoId!), enabled: !!setup?.repoId });
  useEffect(() => {
    setSelectedVersionId(null);
    setElementSelection(null);
    setEmployeeOffline(false);
    setConversationProcessing(false);
    setSettingsOpen(false);
  }, [workitemId]);
  const [acceptanceDispatchId, setAcceptanceDispatchId] = useState<number | null>(null);

  const hasDesign = !!setup && setup.phase !== 'NEW';
  const handoff = useDesignHandoff(workitemId ?? '', hasDesign && !!workitemId);
  const review = handoff.data?.review;
  const managedHandoff = handoff.data?.managed === true;
  const reviewLocked = !!review && ['SNAPSHOTTING', 'IN_REVIEW', 'PUSHING', 'ATTACHING', 'PUSH_FAILED', 'ATTACHMENT_FAILED'].includes(review.status);
  const designQuery = usePrdDesign(workitemId ?? '', hasDesign);
  const conversationSelectionQuery = useQuery({
    queryKey: ['prd-selection', workitemId],
    queryFn: async () => (await apiClient.get<{ agentId: number; squadId: number } | null>(
      `/api/workitems/${workitemId}/prd/conversation/selection`,
    )).data,
    enabled: hasDesign && !setup?.managed,
  });
  const selectedAgentId = setup?.managed ? setup.agentId ?? undefined
    : Number(searchParams.get('prdAgent')) || conversationSelectionQuery.data?.agentId;
  const selectedSquadId = setup?.managed ? setup.squadId ?? undefined
    : Number(searchParams.get('prdSquad')) || conversationSelectionQuery.data?.squadId || undefined;
  const selectedAgentQuery = useQuery({
    queryKey: ['squad-members', 'clarification', selectedSquadId],
    queryFn: () => getSquadMembers(selectedSquadId!),
    enabled: !!selectedAgentId && !!selectedSquadId,
    refetchInterval: 3000,
  });
  const selectedAgentName = selectedAgentQuery.data
    ?.find(member => member.agentId === selectedAgentId)?.agentName;
  const runtimeQuery = useQuery({
    queryKey: ['prd-design-runtime', workitemId, selectedAgentId],
    queryFn: async () => (await apiClient.get<PrdDesignRuntime | null>(
      `/api/workitems/${workitemId}/prd/runtime`,
      { params: selectedAgentId ? { agentId: selectedAgentId } : {}, backgroundActivity: true },
    )).data,
    enabled: !!workitemId && !!selectedAgentId,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
  });
  const versionsQuery = usePrdVersions(workitemId ?? '', hasDesign);
  const design = designQuery.data ?? null;

  const versions = useMemo(() => versionsQuery.data ?? [], [versionsQuery.data]);
  const activeVersionId = selectedVersionId
    ?? linkedVersion
    ?? versions[0]?.id
    ?? design?.confirmedVersionId
    ?? null;
  const activeVersionQuery = usePrdVersion(workitemId ?? '', activeVersionId);
  const activeVersion = activeVersionQuery.data ?? null;
  const setDocumentLink = (version: number | null) => {
    setSearchParams(params => {
      const next = new URLSearchParams(params);
      if (version !== null) next.set('prdDocument', String(version));
      else next.delete('prdDocument');
      return next;
    }, { replace: true });
  };
  const openDocument = (version: number) => {
    setSelectedVersionId(version);
    setPreviewMode(PREVIEW_MODE.DOCUMENT);
    setDocumentLink(version);
  };

  const deliveriesQuery = usePrdDeliveries(workitemId ?? '', design?.deliveryMode === DELIVERY_MODE.PRD_DRIVEN);
  const acceptanceQuery = usePrdDeliveryAcceptance(workitemId ?? '', acceptanceDispatchId);

  const createDraft = useCreatePrdDraft(workitemId ?? '');

  const parsed = useMemo(() => parseDesign(activeVersion?.designJson ?? null), [activeVersion?.designJson]);
  const preparing = !!setup?.managed && setup.phase !== 'ACTIVE';
  const projectReady = setup?.phase === 'ACTIVE';
  const prepareFailed = setup?.phase.startsWith('FAILED') ?? false;
  const showPreparation = preparing && (prepareFailed || runtimeQuery.data?.status !== 'READY');
  const prepareLabel = setup ? t(`workitem:launch.phase.${setup.phase}` as 'workitem:launch.phase.QUEUED') : '';
  useEffect(() => { if (employeeOffline) setSettingsOpen(true); }, [employeeOffline]);
  const isConfirmedVersion = activeVersion?.status === PRD_VERSION_STATUS.CONFIRMED;

  if (!workitemId) {
    return <PageError onBack={() => navigate('/workitems')} label={t('page.invalidId')} backLabel={t('page.back')} />;
  }
  if (launch.isLoading || (hasDesign && designQuery.isLoading)) {
    return <Spin size="large" style={{ display: 'block', margin: '120px auto' }} />;
  }
  if (launch.isError || !setup) {
    return <PageError onBack={() => navigate(-1)} label={t('page.loadFailed')} backLabel={t('page.back')} />;
  }

  if (setup.phase === 'NEW') return <WorkitemLaunchModal item={workitemId} activity="design" initialRepo={setup.repoId}
    onClose={() => navigate(`/workitems/${workitemId}`)}
    onEnter={state => { navigate(designUrl(workitemId,state),{replace:true}); void launch.refetch(); }} />;

  if (designQuery.isError || !design) {
    return <PageError onBack={() => navigate(-1)} label={t('page.loadFailed')} backLabel={t('page.back')} />;
  }

  const retryBootstrap = async () => {
    setRetrying(true);
    try { await apiClient.post(launchPath(workitemId,'design') + '/retry'); await launch.refetch(); }
    catch (err) { message.error(err instanceof Error ? err.message : t('workitem:launch.failed')); }
    finally { setRetrying(false); }
  };

  const handleRecoverPreview = async () => {
    if (conversationProcessing) return;
    const command = accessCommand(
      'READ_WRITE', t('runtime.recoverAction'),
      async () => {
        try {
          const conversation = conversationRef.current;
          if (!conversation) throw new Error(t('runtime.recoverUnavailable'));
          await conversation.startPreparation(t('runtime.recoverMessage'), createClientMessageId(), 'RECOVER');
          message.success(t('runtime.recoverRequested', {
            agent: selectedAgentName ?? t('runtime.selectedAgent'),
          }));
        } catch (err) {
          message.error(err instanceof Error ? err.message : t('runtime.recoverFailed'));
        }
      },
      'PRD',
    );
    await command;
  };

  const handleDeriveDraft = () => accessCommand(
    'READ_WRITE', t('review.derive'),
    async () => {
      if (!activeVersion) return;
      try {
        const draft = await createDraft.mutateAsync({ versionId: activeVersion.id });
        setSelectedVersionId(draft.id);
        message.success(t('review.derived'));
      } catch (err) {
        message.error(err instanceof ApiError ? err.message : t('review.deriveFailed'));
      }
    },
    'PRD',
  );

  return (
    <div className="prd-workbench">
      <div className="prd-workbench-grid">
        <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title={t('versions.historyAndIndex')} width={440}>
        {/* Left: versions + requirement index */}
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card size="small" title={t('versions.title')}>
            {versions.length === 0
              ? <Empty description={t('versions.empty')} />
              : (
                <List
                  size="small"
                  dataSource={versions}
                  renderItem={(version) => (
                    <List.Item
                      style={{ cursor: 'pointer', background: version.id === activeVersionId ? 'var(--aw-fill-tertiary, #fafafa)' : undefined }}
                      onClick={() => {
                        setSelectedVersionId(version.id);
                        if (previewMode === PREVIEW_MODE.DOCUMENT) setDocumentLink(version.id);
                      }}
                      actions={[
                        <VersionStatusTag key="status" status={version.status} />,
                      ]}
                    >
                      <Space direction="vertical" size={0}>
                        <Text strong>{t('versionLabel', { versionNo: version.versionNo })}</Text>
                        {version.gmtCreate && (
                          <Text type="secondary">{formatDateTime(version.gmtCreate)}</Text>
                        )}
                        {version.changeSummary && <Text type="secondary">{version.changeSummary}</Text>}
                      </Space>
                    </List.Item>
                  )}
                />
              )}
          </Card>

          <Card size="small" title={t('requirements.indexTitle')}>
            <Text type="secondary">{t('requirements.indexHint')}</Text>
            {parsed && parsed.requirements.length > 0 ? (
              <List
                size="small"
                dataSource={parsed.requirements}
                renderItem={(requirement) => (
                  <List.Item>
                    <Space direction="vertical" size={0}>
                      <Space size={6} wrap>
                        <Text strong>{requirement.key}</Text>
                        {requirement.priority && <Tag color="blue">{requirement.priority}</Tag>}
                        {requirement.excluded && <Tag>{t('requirements.excluded')}</Tag>}
                      </Space>
                      <Text>{requirement.title}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            ) : <Empty description={t('requirements.empty')} />}
          </Card>
        </Space>
        </Drawer>
        <section className="prd-workbench-conversation" aria-label={t('conversation.title')}>
          <header className="prd-conversation-heading" data-settings-open={settingsOpen}>
            <div className="prd-conversation-title">
              <PageBackButton to={`/workitems/${workitemId}`} label={t('page.back')} />
              <h2>{t('conversation.panelTitle')}</h2>
              <PrdShareName workitemId={workitemId} agentId={selectedAgentId} />
            </div>
            <div className="prd-conversation-heading-actions">
            <Button type="text" size="small" className="prd-settings-toggle" data-open={settingsOpen}
              aria-expanded={settingsOpen} onClick={() => {
                setSettingsOpen(open => !open);
              }}>
              {t('conversation.settings')}
            </Button>
            </div>
          </header>
          {preparing && !prepareFailed && <div className="prd-design-preparing" role="status">
            <Spin size="small" />
            <div className="prd-design-preparing-copy">
              <div className="prd-design-preparing-title">{t('workitem:launch.preparingTask')}</div>
              <div className="prd-design-preparing-description">{t('workitem:launch.preparingTaskDescription')}</div>
            </div>
          </div>}
          <PrdConversation ref={conversationRef} workitemId={String(workitemId)}
            element={elementSelection} onClearElement={() => setElementSelection(null)}
            ready={(projectReady || setup.phase === 'CONFIGURING') && !reviewLocked}
            documentLink={versions[0] && <PrdDesignDocumentLink onClick={() => openDocument(versions[0].id)} />}
            onEmployeeOfflineChange={setEmployeeOffline}
            onProcessingChange={setConversationProcessing}
            setupLocked={setup.managed || !!runtimeQuery.data}
            launchSelection={setup.managed && setup.agentId && setup.squadId
              ? { agentId: setup.agentId, squadId: setup.squadId } : undefined}
            settingsOpen={settingsOpen}
            setupExtra={<Text>{t('workitem:launch.sourceDisplay', { name: sourceRepo.data?.name ?? (setup.repoId ? String(setup.repoId) : t('workitem:launch.new')) })}</Text>}
            onStarted={() => {
              void conversationSelectionQuery.refetch();
              void runtimeQuery.refetch();
              void versionsQuery.refetch();
            }} />
        </section>

        {/* Center: HTML document + prototype viewport */}
        <section className="prd-design-surface" aria-label={t('preview.title')}>
          <PrdDesignHeader
            key={workitemId}
            workitemId={workitemId} version={activeVersion}
            agentId={selectedAgentId} review={review} onReadDocument={openDocument}
            canSubmit={(managedHandoff || !!review) && !!handoff.data?.canSubmit && projectReady && !conversationProcessing
              && activeVersion?.id === versions[0]?.id && activeVersion?.id !== handoff.data.completed?.versionId}
            repositoryRequired={handoff.isSuccess && !managedHandoff && !review && !!activeVersion}
            tabs={<Segmented className="prd-design-tabs" size="small" value={previewMode} onChange={value => {
              const documentSelected = value === PREVIEW_MODE.DOCUMENT;
              if (!documentSelected && linkedVersion) setSelectedVersionId(linkedVersion);
              setPreviewMode(String(value));
              setDocumentLink(documentSelected ? activeVersionId : null);
            }}
              options={[{ value: PREVIEW_MODE.PROTOTYPE, label: t('runtime.design') }, {
                value: PREVIEW_MODE.DOCUMENT,
                label: activeVersion?.versionNo
                  ? t('preview.documentVersion', { versionNo: activeVersion.versionNo })
                  : t('preview.document'),
              }]} />}
            versionActions={<>
              {activeVersion && !review && <VersionStatusTag status={activeVersion.status} />}
              {isConfirmedVersion && <Dropdown trigger={['click']} menu={{ items: [
                { key: 'derive', label: t('review.derive'), disabled: createDraft.isPending || reviewLocked, onClick: handleDeriveDraft },
              ] }}>
                <Button type="text" size="small" aria-label={t('review.more')} icon={<EllipsisOutlined />} />
              </Dropdown>}
              <Tooltip title={t('versions.historyAndIndex')}>
                <Button type="text" size="small" icon={<HistoryOutlined />} aria-label={t('versions.historyAndIndex')} onClick={() => setHistoryOpen(true)}>{t('versions.title')}</Button>
              </Tooltip>
            </>}
          />
            <div className="prd-design-prototype" hidden={previewMode !== PREVIEW_MODE.PROTOTYPE}>
              {showPreparation ? <div className="aw-design-prepare" role="status">
                {!prepareFailed && <Spin />}
                <p>{prepareLabel}</p>
                {prepareFailed && <Button loading={retrying} onClick={retryBootstrap}>{t('preview.retry')}</Button>}
              </div> : <PrdDesignBrowser workitemId={workitemId}
                agentName={selectedAgentName}
                processing={conversationProcessing}
                recoveryDisabled={conversationProcessing}
                onRecoverPreview={setup.managed ? undefined : handleRecoverPreview}
                onReferences={comments => conversationRef.current?.addComments(comments)} />}
            </div>
            {previewMode === PREVIEW_MODE.DOCUMENT
              && <div className="prd-design-document"><PrdRequirementsDocument workitemId={workitemId} versionId={activeVersionId} /></div>}
        </section>

      </div>
      {/* Deliveries + acceptance, only meaningful once PRD-driven */}
      {design.deliveryMode === DELIVERY_MODE.PRD_DRIVEN && <details className="prd-workbench-deliveries"><summary>{t('delivery.title')}</summary>
        <Card size="small">
          {(deliveriesQuery.data ?? []).length === 0 ? (
            <Empty description={t('delivery.empty')} />
          ) : (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <List
                size="small"
                dataSource={deliveriesQuery.data ?? []}
                renderItem={(delivery) => (
                  <List.Item
                    actions={[
                      <Button key="view" size="small" type="link" onClick={() => setAcceptanceDispatchId(delivery.dispatchId)}>
                        {t('delivery.viewAcceptance')}
                      </Button>,
                    ]}
                  >
                    <Space size={8} wrap>
                      <Text>{t('delivery.dispatchLabel', { dispatchId: delivery.dispatchId })}</Text>
                      <Tag>{t('versionLabel', { versionNo: delivery.versionNo })}</Tag>
                      {delivery.targetRepoId != null && <Text type="secondary">{delivery.targetAppRoot || REPOSITORY_ROOT}</Text>}
                      {delivery.gmtCreate && <Text type="secondary">{formatDateTime(delivery.gmtCreate)}</Text>}
                    </Space>
                  </List.Item>
                )}
              />
              {acceptanceDispatchId != null && (
                <PrdAcceptancePanel acceptance={acceptanceQuery.data ?? null} loading={acceptanceQuery.isLoading} />
              )}
            </Space>
          )}
        </Card>
      </details>}

    </div>
  );
}

function VersionStatusTag({ status }: { status: string }) {
  const { t } = useTranslation('prd');
  const color = status === PRD_VERSION_STATUS.CONFIRMED ? 'success'
    : status === PRD_VERSION_STATUS.PENDING_REVIEW ? 'processing'
      : 'default';
  const label = status === PRD_VERSION_STATUS.CONFIRMED ? t('status.confirmed')
    : status === PRD_VERSION_STATUS.PENDING_REVIEW ? t('status.pendingReview')
      : t('status.draft');
  return <Tag color={color}>{label}</Tag>;
}

function PageError({ onBack, label, backLabel }: { onBack: () => void; label: string; backLabel: string }) {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <Empty description={label}>
        <Button onClick={onBack}>{backLabel}</Button>
      </Empty>
    </div>
  );
}

/** Best-effort parse of a stored design payload for the read-only index; null when absent/invalid. */
function parseDesign(designJson: string | null): {
  title: string;
  requirements: { key: string; title: string; priority?: string; excluded?: boolean }[];
} | null {
  if (!designJson) return null;
  try {
    const obj = JSON.parse(designJson.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')) as Record<string, unknown>;
    const requirements = Array.isArray(obj.requirements)
      ? (obj.requirements as { key?: string; title?: string; priority?: string; excluded?: boolean }[])
          .filter((r) => typeof r?.key === 'string')
          .map((r) => ({ key: r.key as string, title: r.title ?? '', priority: r.priority, excluded: r.excluded }))
      : [];
    const title = typeof obj.title === 'string' ? obj.title : '';
    return { title, requirements };
  } catch {
    return null;
  }
}
