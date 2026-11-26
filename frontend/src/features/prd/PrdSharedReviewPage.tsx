import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { PrdDesignBrowser } from './components/PrdDesignBrowser';
import { hasUnsafePreviewUrlCharacter } from './designBrowser';
import { reviewClient, reviewEndpoint } from './review';
import { usePrdPreview } from './usePrdPreview';

/** Identity is required; workspace selection and membership are deliberately unnecessary. */
export function PrdSharedReviewPage() {
  const { t } = useTranslation('prd');
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const requested = params.get('route') || '/';
  const initialRoute = requested.startsWith('/') && !requested.startsWith('//') && !hasUnsafePreviewUrlCharacter(requested) ? requested : '/';
  const client = reviewClient(reviewEndpoint('', undefined, token));
  const context = useQuery({ queryKey: ['shared-design-review', token], queryFn: client.context, retry: false, refetchInterval: 3000 });
  const { entry, connecting, reconnect } = usePrdPreview(reviewEndpoint('', undefined, token), `share:${token}`, !!context.data && !context.isError);
  if (context.isPending) return <div className="prd-review-page-loading"><Spin size="large" /></div>;
  if (context.isError || !context.data) return <main className="prd-shared-review-page"><Alert type="warning" message={t('reviewShare.unavailable')} /><Button onClick={() => void context.refetch()}>{t('preview.retry')}</Button></main>;
  return <main className="prd-shared-review-page">
      <PrdDesignBrowser immersive workitemId={String(context.data.workitemId)} remote={{ token, context: context.data, entry, initialRoute, connecting, reconnect, refreshSession: () => { void context.refetch(); } }} />
  </main>;
}
