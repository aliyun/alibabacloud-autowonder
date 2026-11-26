import { useState } from 'react';
import { Alert, Button, Input, Modal, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { designReviewLink, reviewClient, reviewEndpoint } from '../review';

const VALID_NAME = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export function PrdShareName({ workitemId, agentId }: { workitemId: string; agentId?: number }) {
  const { t } = useTranslation('prd');
  const queries = useQueryClient();
  const client = reviewClient(reviewEndpoint(workitemId, agentId));
  const key = ['prd-review-name', workitemId] as const;
  const name = useQuery({ queryKey: key, queryFn: client.shareName, retry: false });
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fixed = name.data?.slug;
  const valid = VALID_NAME.test(slug);

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await client.saveShareName(slug);
      queries.setQueryData(key, result);
      void queries.invalidateQueries({ queryKey: ['prd-review-share'] });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('reviewComments.failed'));
    } finally {
      setSaving(false);
    }
  }

  if (!fixed && !name.data?.canManage) return null;
  return <>
    <Button size="small" type="text" onClick={() => { setError(''); setOpen(true); }}>
      {fixed ?? t('reviewShare.englishName')}
    </Button>
    <Modal open={open} title={t('reviewShare.englishName')} onCancel={() => setOpen(false)}
      onOk={() => void save()} okButtonProps={{ disabled: !valid, hidden: !!fixed }}
      okText={t('reviewShare.saveName')} cancelText={t('runtime.cancel')} confirmLoading={saving}>
      {!fixed && <>
        <Typography.Paragraph>{t('reviewShare.nameHint')}</Typography.Paragraph>
        <Input value={slug} maxLength={40} aria-label={t('reviewShare.englishName')}
          onChange={event => { setSlug(event.target.value); setError(''); }} />
      </>}
      {(fixed || valid) && <Typography.Paragraph copyable>{designReviewLink(fixed ?? slug)}</Typography.Paragraph>}
      {error && <Alert type="error" role="alert" message={error} />}
    </Modal>
  </>;
}
