import { useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Modal, Popover, Select, Typography, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useLinkClickHandler } from 'react-router-dom';
import { apiClient } from '@/shared/api/client';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { PrdDesignVersion } from '../api';
import { clarificationPath, designPreviewPath, handoffPath, type DesignReview, type ReviewStatus } from '../handoff';
import './PrdHandoffStatus.css';

type Decision = 'APPROVE' | 'RETURN' | 'WITHDRAW' | 'RETRY';
type Action = 'SUBMIT' | Decision;
type Dialog = { type: 'SUBMIT'; submission: Submission } | { type: Decision; reviewId: number };

interface Submission {
  agentId: number;
  version: PrdDesignVersion;
}

interface Props {
  workitemId: string;
  review?: DesignReview | null;
  submission?: Submission;
  openWorkbenchToSubmit?: boolean;
  onReadDocument: (versionId: number) => void;
}

const statusTone: Record<ReviewStatus, string> = {
  SNAPSHOTTING: 'working',
  SNAPSHOT_FAILED: 'attention',
  IN_REVIEW: 'working',
  RETURNED: 'attention',
  WITHDRAWN: 'neutral',
  PUSHING: 'working',
  PUSH_FAILED: 'attention',
  ATTACHING: 'working',
  ATTACHMENT_FAILED: 'attention',
  COMPLETED: 'success',
};

function CopyValue({ value, display = value }: { value: string; display?: string }) {
  return (
    <Typography.Text className="prd-handoff-value" copyable={{ text: value }}>
      <code>{display}</code>
    </Typography.Text>
  );
}

function HandoffPrimaryLink({ to, children, onFollow }: { to: string; children: string; onFollow: () => void }) {
  const follow = useLinkClickHandler<HTMLElement>(to);
  return <Button href={to} onClick={event => { follow(event); onFollow(); }} type="primary" size="small">{children}</Button>;
}

export function PrdHandoffStatus({ workitemId, review, submission, openWorkbenchToSubmit, onReadDocument }: Props) {
  const { t } = useTranslation('prd');
  const client = useQueryClient();
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>();
  const [reviewerIds, setReviewerIds] = useState<number[]>([]);
  const [reason, setReason] = useState('');
  const path = handoffPath(workitemId);
  const action = dialog?.type;
  const choosingReviewers = action === 'SUBMIT';
  const requestingChanges = action === 'RETURN';
  const approving = action === 'APPROVE';
  const withdrawing = action === 'WITHDRAW';
  const retrying = action === 'RETRY';
  const reviewers = useQuery({
    queryKey: ['prd-design-reviewers', workitemId],
    queryFn: async () => (await apiClient.get<{ id: number; name: string }[]>(`${path}/reviewers`)).data,
    enabled: choosingReviewers,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async (target: Dialog) => {
      if (target.type === 'SUBMIT') {
        await apiClient.post(path, {
          agentId: target.submission.agentId,
          versionId: target.submission.version.id,
          expectedDigest: target.submission.version.designSha256,
          reviewerIds,
        });
        return;
      }
      await apiClient.post(`${path}/${target.reviewId}/decision`, {
        action: target.type, reason: target.type === 'RETURN' ? reason.trim() : undefined,
      });
    },
    onSuccess: () => {
      setDialog(undefined);
      setReviewerIds([]);
      setReason('');
      void client.invalidateQueries({ queryKey: ['prd-design-handoff', workitemId] });
    },
    onError: (error: Error) => message.error(error.message || t('handoff.actionError')),
  });

  const start = (next: Action) => {
    const target = next === 'SUBMIT' ? submission && { type: next, submission } : review && { type: next, reviewId: review.id };
    if (!target) return;
    setOpen(false);
    setDialog(target);
  };
  const closeDetails = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const status = review?.status;
  const completed = status === 'COMPLETED';
  const showSubmit = !!submission && (!review || completed);
  const showResubmit = (status === 'SNAPSHOT_FAILED' || status === 'RETURNED' || status === 'WITHDRAWN')
    && (submission || openWorkbenchToSubmit);
  const showGitDetails = !!review && status !== 'SNAPSHOTTING' && status !== 'SNAPSHOT_FAILED';

  return <>
    {showSubmit && <Button type="primary" size="small" onClick={() => start('SUBMIT')}>{t('handoff.SUBMIT')}</Button>}
    {review && <Popover
      trigger="click"
      placement="bottomRight"
      align={{ overflow: { adjustY: true, shiftX: true } }}
      arrow={false}
      open={open}
      onOpenChange={setOpen}
      destroyOnHidden
      overlayClassName="prd-handoff-popover"
      content={
        <section className="prd-handoff-panel" id={panelId} role="dialog" aria-labelledby={`${panelId}-title`}
          onKeyDown={event => { if (event.key === 'Escape') closeDetails(); }}>
          <header className="prd-handoff-panel-head">
            <div>
              <div className="prd-handoff-panel-title" data-tone={statusTone[review.status]}>
                <span className="prd-handoff-dot" aria-hidden="true" />
                <h3 id={`${panelId}-title`}>{t(`handoff.label.${review.status}`)}</h3>
              </div>
              <p>{completed ? t('handoff.deliveredHint') : t(`handoff.status.${review.status}`)}</p>
              {review.decisionReason && <p className="prd-handoff-reason">{review.decisionReason}</p>}
            </div>
            <Button type="text" size="small" autoFocus aria-label={t('handoff.closeDetails')}
              icon={<AwStrokeIcon name="x" size={14} />} onClick={closeDetails} />
          </header>
          {showGitDetails && <dl className="prd-handoff-metadata">
            {review.repoUrl && <><dt>{t('handoff.repository')}</dt><dd><CopyValue value={review.repoUrl} /></dd></>}
            {review.branch && <><dt>{t('handoff.branch')}</dt><dd><CopyValue value={review.branch} /></dd></>}
            {review.commit && <><dt>{t('handoff.commit')}</dt><dd><CopyValue value={review.commit} display={review.commit.slice(0, 12)} /></dd></>}
          </dl>}
          <div className="prd-handoff-actions">
            <Button size="small" onClick={() => { setOpen(false); onReadDocument(review.versionId); }}>{t('handoff.readDocument')}</Button>
            {review.canWithdraw && <Button size="small" onClick={() => start('WITHDRAW')}>{t('handoff.WITHDRAW')}</Button>}
            {review.canDecide && <>
              <Button size="small" onClick={() => start('RETURN')}>{t('handoff.RETURN')}</Button>
              <Button size="small" type="primary" onClick={() => start('APPROVE')}>{t('handoff.APPROVE')}</Button>
            </>}
            {review.canRetry && <Button size="small" type="primary" onClick={() => start('RETRY')}>{t('handoff.RETRY')}</Button>}
            {showResubmit && (submission
              ? <Button size="small" type="primary" onClick={() => start('SUBMIT')}>{t('handoff.resubmit')}</Button>
              : <HandoffPrimaryLink to={designPreviewPath(workitemId)} onFollow={() => setOpen(false)}>{t('handoff.resubmit')}</HandoffPrimaryLink>)}
            {completed && <HandoffPrimaryLink to={clarificationPath(workitemId)} onFollow={() => setOpen(false)}>{t('handoff.clarify')}</HandoffPrimaryLink>}
          </div>
        </section>
      }
    >
      <Button ref={trigger} size="small" className="prd-handoff-trigger" data-tone={statusTone[review.status]}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
        onKeyDown={event => { if (open && event.key === 'Escape') closeDetails(); }}>
        <span className="prd-handoff-dot" aria-hidden="true" />
        <span>{t(`handoff.label.${review.status}`)}</span>
        <AwStrokeIcon name="chev-d" size={12} />
      </Button>
    </Popover>}
    <Modal
      open={dialog !== undefined}
      title={action && t(`handoff.${action}`)}
      okText={action && t(`handoff.${action}`)}
      confirmLoading={mutation.isPending}
      okButtonProps={{ disabled: choosingReviewers && !reviewerIds.length || requestingChanges && !reason.trim() }}
      onCancel={() => { setDialog(undefined); setReason(''); }}
      onOk={() => { if (dialog) mutation.mutate(dialog); }}
    >
      {choosingReviewers && (
        <Form layout="vertical">
          <p>{t('handoff.submitHint')}</p>
          <Form.Item label={t('handoff.reviewers')} htmlFor={`${panelId}-reviewers`}>
            <Select id={`${panelId}-reviewers`} mode="multiple" optionFilterProp="label"
              loading={reviewers.isLoading} value={reviewerIds} onChange={setReviewerIds}
              options={reviewers.data?.map(reviewer => ({ label: reviewer.name, value: reviewer.id }))} />
          </Form.Item>
          {reviewers.isError && <Alert type="error" message={t('handoff.reviewersError')} />}
        </Form>
      )}
      {requestingChanges && <Input.TextArea aria-label={t('handoff.reason')} placeholder={t('handoff.reason')}
        value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} autoSize={{ minRows: 3, maxRows: 8 }} />}
      {approving && <p>{t('handoff.approveHint')}</p>}
      {withdrawing && <p>{t('handoff.withdrawHint')}</p>}
      {retrying && <p>{t('handoff.retryHint')}</p>}
    </Modal>
  </>;
}
