import { MoreOutlined } from '@ant-design/icons';
import { useRef, useState } from 'react';
import { Button, Dropdown, Modal, message } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { copyTextToClipboard } from '@/shared/lib/clipboard';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { designReviewLink, type ReviewShareResult, type reviewClient } from '../review';

export function PrdReviewShare({ client, identity, route, canManage }: { client: ReturnType<typeof reviewClient>; identity: string; route: string; canManage: boolean }) {
  const { t } = useTranslation('prd');
  const queryClient = useQueryClient();
  const opening = useRef(false);
  const [busy, setBusy] = useState(false);
  const share = useQuery({ queryKey: ['prd-review-share', identity], queryFn: client.share, staleTime: 0 });
  const enabled = share.data?.share?.enabled === 1;
  const link = enabled && share.data?.share
    ? designReviewLink(share.data.preferredIdentifier ?? share.data.share.token, route || '/') : '';
  const restoresName = (result?: ReviewShareResult) => !!result?.nameWasShared && result.preferredIdentifier !== result.slug;
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    try { await action(); await share.refetch(); }
    catch (error) { void message.error(error instanceof Error ? error.message : t('reviewComments.failed')); }
    finally { setBusy(false); }
  }
  async function openReview(confirmed = false) {
    if (opening.current || busy) return;
    if (canManage && !confirmed && restoresName(share.data)) {
      Modal.confirm({ title: t('reviewShare.restoreNamedLink'),
        onOk: () => openReview(true), cancelText: t('runtime.cancel') });
      return;
    }
    // Open synchronously during the click so enabling a share cannot trigger popup blocking.
    const tab = window.open('about:blank', '_blank');
    if (!tab) { void message.error(t('reviewShare.popupBlocked')); return; }
    tab.opener = null;
    opening.current = true; setBusy(true);
    try {
      let result = await client.share();
      if (!result.configured) throw new Error(t('reviewShare.unconfigured'));
      if (result.share?.enabled !== 1 && !canManage) throw new Error(t('reviewShare.unavailable'));
      if (canManage && (result.share?.enabled !== 1 || (result.slug && result.preferredIdentifier !== result.slug))) {
        if (!confirmed && restoresName(result)) {
          tab.close();
          Modal.confirm({ title: t('reviewShare.restoreNamedLink'),
            onOk: () => openReview(true), cancelText: t('runtime.cancel') });
          return;
        }
        result = confirmed ? await client.enable(false, true) : await client.enable();
      }
      if (!result.share || result.share.enabled !== 1) throw new Error(t('reviewShare.unavailable'));
      queryClient.setQueryData(['prd-review-share', identity], result);
      tab.location.replace(designReviewLink(result.preferredIdentifier ?? result.share.token, route || '/'));
    } catch (error) {
      tab.close();
      void message.error(error instanceof Error ? error.message : t('reviewComments.failed'));
    } finally { opening.current = false; setBusy(false); }
  }
  return <>
    <Button type="text" size="small" loading={busy} className="prd-browser-text-button prd-browser-share-button" aria-label={t('reviewShare.title')} onClick={() => void openReview()}><AwStrokeIcon name="ext" size={15} /><span>{t('reviewShare.trigger')}</span></Button>
    {enabled && <Dropdown trigger={['click']} menu={{ items: [
      { key: 'copy', label: t('reviewShare.copy'), onClick: async () => {
        if (await copyTextToClipboard(link)) void message.success(t('reviewShare.copied'));
        else void message.error(t('reviewShare.copyFailed'));
      } },
      ...(canManage ? [
        { key: 'rotate', label: t('reviewShare.rotate'), disabled: busy, onClick: () => { Modal.confirm({ title: t('reviewShare.rotateConfirm'), okText: t('reviewShare.rotate'), cancelText: t('runtime.cancel'), onOk: () => mutate(() => client.enable(true)) }); } },
        { key: 'disable', label: t('reviewShare.disable'), disabled: busy, onClick: () => { void mutate(client.revoke); } },
      ] : []),
    ] }}><Button type="text" size="small" aria-label={t('reviewShare.manage')} icon={<MoreOutlined />} /></Dropdown>}
  </>;
}
