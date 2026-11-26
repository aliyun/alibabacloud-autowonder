import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Empty, Input, Modal, Popconfirm, Segmented } from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import type { ColumnsType } from 'antd/es/table';
import { formatDateTime } from '@/shared/i18n/format';
import { isWorkspaceAccessLevel } from '@/shared/auth/access';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { humanAvatarColor } from '@/shared/ui/AiIdentity';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { StatusTag, type StatusColorKey } from '@/shared/ui/StatusTag';
import { Toolbar } from '@/shared/ui/Toolbar';
import { workspaceRoleLabel } from './roles';
import { useAccessRequests, useApproveAccessRequest, useRejectAccessRequest } from './hooks';
import type { AccessRequestVO } from './api';
import './AccessRequestsPanel.css';

type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

const LEVEL_TAG: Record<string, { colorKey: StatusColorKey; dot?: boolean }> = {
  READ_ONLY: { colorKey: 'gray' },
  READ_WRITE: { colorKey: 'plain' },
  ADMIN: { colorKey: 'green', dot: true },
};

const MISSING = '—';

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };
const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

function roleLabel(level: string): string {
  return isWorkspaceAccessLevel(level)
    ? workspaceRoleLabel({ id: 0, code: level, name: null })
    : level;
}

function displayNameOf(request: AccessRequestVO): string {
  return request.requesterName || String(request.requesterId);
}

export function AccessRequestsPanel() {
  const { t } = useTranslation('settings');
  const accessCommand = useAccessCommand();
  const [status, setStatus] = useState<RequestStatus>('PENDING');
  const { data: requests = [], isLoading, isError, isFetching, refetch } = useAccessRequests(status);
  const approveMutation = useApproveAccessRequest();
  const rejectMutation = useRejectAccessRequest();
  const [rejectTarget, setRejectTarget] = useState<AccessRequestVO | null>(null);
  const [reason, setReason] = useState('');

  const handleApprove = (request: AccessRequestVO) => {
    accessCommand('ADMIN', t('approveRequest'), () => {
      approveMutation.mutate(request.id);
    });
  };

  const openReject = (request: AccessRequestVO) => {
    accessCommand('ADMIN', t('rejectRequest'), () => {
      setReason('');
      setRejectTarget(request);
    });
  };

  const handleRejectConfirm = () => {
    if (!rejectTarget) return;
    const trimmed = reason.trim();
    rejectMutation.mutate(
      { requestId: rejectTarget.id, reason: trimmed ? trimmed : undefined },
      { onSuccess: () => setRejectTarget(null) },
    );
  };

  const columns: ColumnsType<AccessRequestVO> = [
    {
      title: t('requester'),
      key: 'requester',
      width: 240,
      render: (_, request) => {
        const name = request.requesterName;
        if (!name) {
          return <span className="aw-request-uid">{String(request.requesterId)}</span>;
        }
        return (
          <div className="aw-request-user">
            <Avatar
              aria-hidden="true"
              size={20}
              style={{ backgroundColor: humanAvatarColor(name), flexShrink: 0, fontSize: 11 }}
            >
              {name.slice(0, 1)}
            </Avatar>
            <span className="aw-request-name">{name}</span>
          </div>
        );
      },
    },
    {
      title: t('requestedAccess'),
      dataIndex: 'requestedLevel',
      width: 140,
      render: (level: string) => {
        const tag = LEVEL_TAG[level];
        return <StatusTag size="sm" label={roleLabel(level)} colorKey={tag?.colorKey ?? 'plain'} dot={tag?.dot} />;
      },
    },
    {
      title: t('submittedAt'),
      dataIndex: 'gmtCreate',
      width: 160,
      render: (value: string) => value
        ? (
          <span className="aw-request-time">
            <span className="aw-request-date">{formatDateTime(value, DATE_OPTIONS)}</span>
            <span className="aw-request-clock">{formatDateTime(value, TIME_OPTIONS)}</span>
          </span>
        )
        : MISSING,
    },
    ...(status !== 'PENDING'
      ? [{
          title: t('reviewer'),
          key: 'reviewer',
          width: 140,
          render: (_, request: AccessRequestVO) => request.reviewerName
            || (request.reviewerId != null ? String(request.reviewerId) : MISSING),
        } as ColumnsType<AccessRequestVO>[number]]
      : []),
    ...(status === 'REJECTED'
      ? [{
          title: t('rejectReason'),
          dataIndex: 'rejectReason',
          render: (value: string | null) => (
            <span className={value ? 'aw-request-reason' : 'aw-request-reason is-none'} title={value ?? undefined}>
              {value || MISSING}
            </span>
          ),
        } as ColumnsType<AccessRequestVO>[number]]
      : []),
    ...(status === 'PENDING'
      ? [{
          title: t('actions'),
          key: 'action',
          width: 120,
          render: (_, request: AccessRequestVO) => (
            <div className="aw-request-ops">
              <Popconfirm
                title={t('approveConfirm', { name: displayNameOf(request), role: roleLabel(request.requestedLevel) })}
                description={t('approveConfirmHint')}
                okText={t('approveConfirmOk')}
                cancelText={t('cancel')}
                onConfirm={() => handleApprove(request)}
              >
                <Button type="link" size="small">{t('approve')}</Button>
              </Popconfirm>
              <Button type="link" size="small" danger onClick={() => openReject(request)}>
                {t('reject')}
              </Button>
            </div>
          ),
        } as ColumnsType<AccessRequestVO>[number]]
      : []),
  ];

  const emptyTitle = isError
    ? t('requestsLoadFailed')
    : status === 'PENDING' ? t('emptyPending') : status === 'APPROVED' ? t('emptyApproved') : t('emptyRejected');
  const emptyHint = isError
    ? t('requestsLoadHint')
    : status === 'PENDING' ? t('emptyPendingHint') : status === 'APPROVED' ? t('emptyApprovedHint') : t('emptyRejectedHint');

  const emptyNode = (
    <div className={isError ? 'aw-requests-empty is-error' : 'aw-requests-empty'}>
      <Empty
        image={(
          <span className="aw-requests-empty-icon">
            <AwStrokeIcon name={isError ? 'alert-c' : 'inbox'} size={20} />
          </span>
        )}
        styles={{ image: { height: 'auto', marginBottom: 10 } }}
        description={(
          <div className="aw-requests-empty-text">
            <div className="aw-requests-empty-title">{emptyTitle}</div>
            <div className="aw-requests-empty-sub">{emptyHint}</div>
          </div>
        )}
      />
      {isError && (
        <Button
          size="small"
          icon={<AwStrokeIcon name="refresh" size={13} />}
          loading={isFetching}
          onClick={() => { void refetch(); }}
        >
          {t('retry')}
        </Button>
      )}
    </div>
  );

  return (
    <div>
      <Toolbar
        left={(
          <Segmented
            aria-label={t('requestStatus')}
            value={status}
            onChange={(value) => setStatus(value as RequestStatus)}
            options={[
              { label: t('pending'), value: 'PENDING' },
              { label: t('approved'), value: 'APPROVED' },
              { label: t('rejected'), value: 'REJECTED' },
            ]}
          />
        )}
        right={<span className="aw-requests-hint">{t('reviewHint')}</span>}
      />
      <Table<AccessRequestVO>
        rowKey="id"
        columns={columns}
        dataSource={requests}
        loading={isLoading}
        pagination={false}
        scroll={{ x: 860 }}
        locale={{ emptyText: emptyNode }}
      />
      {requests.length > 0 && (
        <div className="aw-requests-footer">
          <span>{t('requestCount', { count: requests.length })}</span>
          <span>{t('sortNewest')}</span>
        </div>
      )}
      <Modal
        className="aw-request-reject-modal"
        closable={{ 'aria-label': t('close') }}
        title={t('rejectRequest')}
        width={420}
        open={rejectTarget !== null}
        onCancel={() => setRejectTarget(null)}
        onOk={handleRejectConfirm}
        confirmLoading={rejectMutation.isPending}
        okText={t('confirmReject')}
        cancelText={t('cancel')}
        okButtonProps={{ danger: true, 'aria-label': t('confirmReject') }}
      >
        <p className="aw-request-reject-desc">
          {t('rejectDescription', {
            name: rejectTarget ? displayNameOf(rejectTarget) : '',
            role: rejectTarget ? roleLabel(rejectTarget.requestedLevel) : '',
          })}
        </p>
        <div className="aw-request-reject-field">
          <span className="aw-request-reject-label">{t('rejectReasonLabel')}</span>
          <Input.TextArea
            aria-label={t('rejectReasonLabel')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('rejectReasonPlaceholder')}
            maxLength={512}
            showCount
            rows={3}
          />
        </div>
      </Modal>
    </div>
  );
}
