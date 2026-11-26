import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { formatDateTime } from '@/shared/i18n/format';
import { useState } from 'react';
import { Alert, Button, Space, Modal, Input, message, Spin, Empty, Result, Popconfirm, Tooltip } from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import { TableCard } from '@/shared/ui/TableCard';
import { Toolbar } from '@/shared/ui/Toolbar';
import { useQueryClient } from '@tanstack/react-query';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useNavigate } from 'react-router-dom';
import {
  PENDING_REVIEW_COUNT_QUERY_KEY,
  PENDING_REVIEWS_QUERY_KEY,
  usePendingReviews,
  useApproveAgent,
  useRejectAgent,
  useAgentVersion,
  useAgentVersions,
  useAgentSdlcOptions,
} from './hooks';
import type { Agent } from './api';
import { ApiError } from '@/shared/types/common';
import type { ColumnsType } from 'antd/es/table';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { useAuthStore } from '@/shared/auth/store';
import { AgentVersionDiff } from './components/AgentVersionDiff';

function reviewErrorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function AgentReviewPage() {
  const { t } = useTranslation('agent');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: pendingAgents = [], isLoading, isFetching, refetch } = usePendingReviews();
  const approveAgent = useApproveAgent();
  const rejectAgent = useRejectAgent();
  const accessCommand = useAccessCommand();
  const canWrite = useAuthStore((state) => state.hasAccess('READ_WRITE'));

  const [previewAgent, setPreviewAgent] = useState<Agent | null>(null);
  const [rejectModalAgent, setRejectModalAgent] = useState<Agent | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'approved' | 'rejected'; name: string } | null>(null);

  const invalidatePendingReviews = () => {
    queryClient.invalidateQueries({ queryKey: PENDING_REVIEWS_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: PENDING_REVIEW_COUNT_QUERY_KEY });
  };

  const handleApprove = (agent: Agent, closePreview = false) => {
    accessCommand('READ_WRITE', t('display.approveAction'), () => {
      approveAgent.mutate({ agentId: agent.id }, {
        onSuccess: () => {
          message.success(i18n.t('display.approvedName', { ns: 'agent', name: agent.name }));
          setFeedback({ kind: 'approved', name: agent.name });
          if (closePreview) setPreviewAgent(null);
        },
        onError: (err) => {
          message.error(reviewErrorText(err, i18n.t('display.approveError', { ns: 'agent' })));
          invalidatePendingReviews();
        },
      });
    });
  };

  const handleReject = () => {
    if (!rejectModalAgent || !rejectComment.trim()) return;
    const target = rejectModalAgent;
    const comment = rejectComment;
    accessCommand('READ_WRITE', t('display.rejectAction'), () => {
      rejectAgent.mutate({ agentId: target.id, comment }, {
        onSuccess: () => {
          message.success(i18n.t('display.rejectedName', { ns: 'agent', name: target.name }));
          setFeedback({ kind: 'rejected', name: target.name });
          setRejectModalAgent(null);
          setRejectComment('');
          setPreviewAgent(null);
        },
        onError: (err) => {
          message.error(reviewErrorText(err, i18n.t('display.rejectError', { ns: 'agent' })));
          invalidatePendingReviews();
        },
      });
    });
  };

  const columns: ColumnsType<Agent> = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    {
      title: t('fields.name'), dataIndex: 'name', align: 'left',
      render: (name: string, record: Agent) => <a onClick={() => navigate(`/agents/${record.id}`)}>{name}</a>,
    },
    { title: t('display.latestVersion'), dataIndex: 'latestVersionNo', width: 90, render: (v: number | null) => v ? `v${v}` : '-' },
    { title: t('display.submittedAt'), key: 'submittedAt', width: 160, render: (_: unknown, record: Agent) => <ReviewSubmittedAt agent={record} /> },
    {
      title: t('fields.actions'), width: 170,
      render: (_: unknown, record: Agent) => (
        <Space size={2} className="agent-review-ops">
          <Button type="link" size="small" onClick={() => setPreviewAgent(record)}>
            {t('display.viewDiff')}
          </Button>
          <Button type="link" size="small"
            onClick={() => handleApprove(record)}
            loading={approveAgent.isPending && approveAgent.variables?.agentId === record.id}>
            {t('display.approve')}
          </Button>
          <Button type="link" size="small" danger
            onClick={() => accessCommand('READ_WRITE', t('display.rejectAction'), () => setRejectModalAgent(record))}>
            {t('display.reject')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="agent-review-page">
      {feedback && (
        <Alert
          showIcon
          type="success"
          message={t(feedback.kind === 'approved' ? 'display.approvedName' : 'display.rejectedName', { name: feedback.name })}
          description={t(feedback.kind === 'approved' ? 'display.approvedHint' : 'display.rejectedHint')}
          style={{ marginBottom: 16 }}
        />
      )}

      <Toolbar
        left={isLoading ? null : (
          <span className="agent-summary-badge agent-summary-badge--amber">
            {t('display.status.PENDING_REVIEW')}<b>{pendingAgents.length}</b>
          </span>
        )}
        right={(
          <div className="agent-toolbar-actions">
            <Button icon={<AwStrokeIcon name="refresh" />} loading={isFetching && !isLoading} onClick={() => { void refetch(); }}>
              {t('display.refresh')}
            </Button>
          </div>
        )}
      />

      {/* 原型 06 版本审核 Tab：表格直接挂在内容框内（flush），加载态居中 Spin、空态 Empty。 */}
      <TableCard flush>
        {isLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
        ) : pendingAgents.length === 0 ? (
          <Empty description={t('display.emptyReviews')} />
        ) : (
          <Table rowKey="id" columns={columns} dataSource={pendingAgents} pagination={false} />
        )}
      </TableCard>

      <Modal
        title={previewAgent ? t('diff.title', { name: previewAgent.name }) : ''}
        open={!!previewAgent}
        closable={{ 'aria-label': t('display.close') }}
        onCancel={() => setPreviewAgent(null)}
        footer={null}
        destroyOnClose
        width={1180}
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflow: 'auto' } }}
      >
        {previewAgent && (
          <ReviewDiffModal
            agent={previewAgent}
            canWrite={canWrite}
            approving={approveAgent.isPending}
            onApprove={() => handleApprove(previewAgent, true)}
            onReject={() => accessCommand('READ_WRITE', t('display.rejectAction'), () => setRejectModalAgent(previewAgent))}
          />
        )}
      </Modal>

      {/* Reject Modal */}
      <Modal title={t('display.rejectTitle', { name: rejectModalAgent?.name ?? '' })} open={!!rejectModalAgent} closable={{ 'aria-label': t('display.close') }}
        onOk={handleReject} onCancel={() => { setRejectModalAgent(null); setRejectComment(''); }}
        cancelText={t('actions.cancel')} okText={t('display.confirmReject')} okButtonProps={{ danger: true, disabled: !rejectComment.trim() }}>
        <Input.TextArea rows={3} aria-label={t('display.rejectReason')} placeholder={t('display.rejectReason')}
          value={rejectComment} onChange={e => setRejectComment(e.target.value)} />
      </Modal>
    </div>
  );
}

// 待审核版本的创建时间即提交时间（与变更弹窗头部一致），agent.gmtCreate 是员工创建时间。
function ReviewSubmittedAt({ agent }: { agent: Agent }) {
  useTranslation('agent');
  const { data: versions } = useAgentVersions(agent.id);
  const pending = versions?.find((version) => version.versionNo === agent.latestVersionNo);
  return <>{pending ? formatDateTime(pending.gmtCreate) : '-'}</>;
}

function ReviewDiffModal({
  agent,
  canWrite,
  approving,
  onApprove,
  onReject,
}: {
  agent: Agent;
  canWrite: boolean;
  approving: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation('agent');
  const { data: versions, isLoading: versionsLoading } = useAgentVersions(agent.id);
  const { options: sdlcOptions } = useAgentSdlcOptions();
  const sdlcNameOf = (sdlcId: number) => sdlcOptions.find((option) => option.value === sdlcId)?.name;
  const onlineVersionNo = agent.onlineVersionId == null
    ? null
    : versions?.find((version) => version.id === agent.onlineVersionId)?.versionNo ?? null;
  const targetQuery = useAgentVersion(agent.id, agent.latestVersionNo ?? 0);
  const baselineQuery = useAgentVersion(agent.id, onlineVersionNo ?? 0);
  const baselineUnavailable = agent.onlineVersionId != null
    && !versionsLoading
    && (onlineVersionNo == null || baselineQuery.isError);

  if (targetQuery.isError) {
    return (
      <Result
        status="warning"
        title={t('diff.error.loadFailed')}
        extra={<Button onClick={() => targetQuery.refetch()}>{t('diff.error.retry')}</Button>}
      />
    );
  }
  if (targetQuery.isLoading || versionsLoading || baselineQuery.isLoading) {
    return <Spin style={{ display: 'block', margin: '48px auto' }} />;
  }
  const target = targetQuery.data;
  if (!target) {
    return <Empty description={t('diff.error.loadFailed')} />;
  }

  return (
    <div>
      <AgentVersionDiff
        base={baselineQuery.data ?? null}
        target={target}
        variant="modal"
        baselineUnavailable={baselineUnavailable}
        sdlcNameOf={sdlcNameOf}
      />
      <div className="awdiff-modal-footer">
        <div className="awdiff-footer-hint">
          <span className="awdiff-footer-icon" aria-hidden />
          <span>{t('diff.notice.nonVersioned')}</span>
        </div>
        <div className="awdiff-footer-actions">
          <Tooltip title={canWrite ? undefined : t('display.readOnlyHint')}>
            <Button disabled={!canWrite} onClick={onReject}>{t('display.rejectChange')}</Button>
          </Tooltip>
          <Popconfirm
            title={t('diff.confirmApprove', { version: target.versionNo })}
            okText={t('diff.confirmApproveOk')}
            cancelText={t('actions.cancel')}
            onConfirm={onApprove}
            disabled={!canWrite}
          >
            <Tooltip title={canWrite ? undefined : t('display.readOnlyHint')}>
              <Button type="primary" disabled={!canWrite} loading={approving}>
                {t('display.approveAndOnline')}
              </Button>
            </Tooltip>
          </Popconfirm>
        </div>
      </div>
    </div>
  );
}
