import { useQuery } from '@tanstack/react-query';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { designPreviewPath } from '../handoff';
import { designReviewLink, reviewClient, reviewEndpoint } from '../review';

export function PrdReviewPreviewLink({ workitemId }: { workitemId: string }) {
  const { t } = useTranslation('prd');
  const client = reviewClient(reviewEndpoint(workitemId));
  const share = useQuery({
    queryKey: ['prd-review-share', 'workitem', workitemId],
    queryFn: client.share,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
  if (share.isPending) return null;

  const link = share.isSuccess && share.data.share?.enabled === 1
    ? designReviewLink(share.data.preferredIdentifier || share.data.share.token)
    : null;
  return (
    <Button type="link" size="small" href={link ?? designPreviewPath(workitemId)}
      target="_blank" rel="noopener noreferrer" icon={<AwStrokeIcon name="ext" size={13} />}>
      {link ? t('entry.previewInteraction') : t('entry.open')}
    </Button>
  );
}
