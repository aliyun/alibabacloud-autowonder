import { DownloadOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Space, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { MarkdownView } from '@/shared/ui/MarkdownView';
import { useDesignDocument } from '../handoff';

export function PrdRequirementsDocument({ workitemId, versionId }: { workitemId: string; versionId: number | null }) {
  const { t } = useTranslation('prd');
  const documentQuery = useDesignDocument(workitemId, versionId);
  const document = documentQuery.data;
  if (!versionId) return <Empty description={t('handoff.noDocument')} />;
  if (documentQuery.isPending) return <Spin />;
  if (!document) return <Alert type="error" showIcon message={t('handoff.documentError')} />;

  const download = () => {
    const url = URL.createObjectURL(new Blob([document.markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = document.fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <Space direction="vertical" size="middle" style={{ display: 'flex', padding: 20 }}>
    <Button aria-label={t('handoff.download')} icon={<DownloadOutlined />} onClick={download}>{t('handoff.download')}</Button>
    <MarkdownView content={document.markdown} />
  </Space>;
}
