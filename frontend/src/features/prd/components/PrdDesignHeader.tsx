import type { ReactNode } from 'react';
import { LinkOutlined } from '@ant-design/icons';
import { Alert, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import type { PrdDesignVersion } from '../api';
import { type DesignReview, passingReview } from '../handoff';
import { PrdHandoffStatus } from './PrdHandoffStatus';

interface Props {
  workitemId: string;
  agentId?: number;
  version: PrdDesignVersion | null;
  review?: DesignReview | null;
  canSubmit: boolean;
  tabs: ReactNode;
  versionActions: ReactNode;
  repositoryRequired: boolean;
  onReadDocument: (versionId: number) => void;
}

export function PrdDesignHeader({
  workitemId, agentId, version, review, canSubmit, tabs, versionActions, repositoryRequired, onReadDocument,
}: Props) {
  const { t } = useTranslation('prd');
  const status = review?.status;
  const submission = canSubmit && agentId && version && status !== 'IN_REVIEW' && !passingReview(status)
    ? { agentId, version } : undefined;

  return <>
    <div className="prd-design-header">
      {tabs}
      <div className="prd-design-version-actions">
        <PrdHandoffStatus workitemId={workitemId} review={review} submission={submission} onReadDocument={onReadDocument} />
        {versionActions}
      </div>
    </div>
    <div className="prd-design-notices">
      {repositoryRequired && <Alert type="info" showIcon message={t('handoff.repositoryRequired')} />}
    </div>
  </>;
}

export function PrdDesignDocumentLink({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('prd');
  return <Button type="link" size="small" icon={<LinkOutlined />} onClick={onClick}>{t('handoff.readDocument')}</Button>;
}
