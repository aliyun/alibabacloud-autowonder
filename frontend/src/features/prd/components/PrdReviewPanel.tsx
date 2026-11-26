import { AimOutlined, CloseOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Alert, Avatar, Button, Checkbox, Input, Popconfirm } from 'antd';
import { Segmented } from 'antd';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/i18n/format';
import { REVIEW_STATUS, commentReference, type CommentReference, type ReviewCommentView } from '../review';

export function PrdReviewPanel({ comments, loading, error, viewerId, onClose, onLocate, onUpdate, onDelete, onReferences, canSend }: {
  comments: ReviewCommentView[]; loading: boolean; error: boolean; viewerId?: number; onClose: () => void;
  onLocate: (comment: ReviewCommentView) => void;
  onUpdate: (comment: ReviewCommentView, input: { commentText?: string; status?: 'open' | 'resolved' }) => Promise<unknown>;
  onDelete: (comment: ReviewCommentView) => Promise<unknown>;
  onReferences?: (comments: CommentReference[]) => void; canSend: boolean;
}) {
  const { t } = useTranslation('prd');
  const [filter, setFilter] = useState('open');
  const [mine, setMine] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [failure, setFailure] = useState('');
  const visible = comments.filter(view => (filter === 'all' || view.comment.status === filter) && (!mine || String(view.comment.creatorId) === String(viewerId)));
  const selectedViews = comments.filter(view => selected.includes(view.comment.id) && !view.earlierSource);
  const timeFormat: Intl.DateTimeFormatOptions = { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  async function mutate(view: ReviewCommentView, action: () => Promise<unknown>) {
    setBusy(view.comment.id); setFailure('');
    try { await action(); setEditing(null); setSelected(ids => ids.filter(id => id !== view.comment.id)); }
    catch (error) { setFailure(error instanceof Error ? error.message : t('reviewComments.failed')); }
    finally { setBusy(null); }
  }
  return <aside className="prd-review-panel" aria-label={t('reviewComments.title')}>
    <header><div><strong>{t('reviewComments.title')}</strong><span>{t('reviewComments.count', { count: comments.filter(view => view.comment.status === 'open').length })}</span></div>
      <Button type="text" size="small" aria-label={t('runtime.cancel')} icon={<CloseOutlined />} onClick={onClose} /></header>
    <div className="prd-review-filters"><Segmented size="small" value={filter} onChange={value => setFilter(String(value))} options={[
      { value: 'all', label: t('reviewComments.all') }, { value: 'open', label: t('reviewComments.open') }, { value: 'resolved', label: t('reviewComments.resolved') },
    ]} /><Checkbox checked={mine} onChange={event => setMine(event.target.checked)}>{t('reviewComments.mine')}</Checkbox></div>
    {(error || failure) && <Alert type="error" message={failure || t('reviewComments.failed')} />}
    <div className="prd-review-comment-list" aria-busy={loading}>
      {visible.length === 0 && <div className="prd-review-empty">{loading ? t('reviewComments.loading') : t('reviewComments.empty')}</div>}
      {visible.map(view => { const comment = view.comment; const pending = busy === comment.id; return <article key={comment.id} className="prd-review-card" data-resolved={comment.status === 'resolved'}>
        <div className="prd-review-card-author"><Avatar size={24} src={view.authorAvatar}>{view.authorName.slice(0, 1)}</Avatar><strong>{view.authorName}</strong>
          <time title={formatDateTime(comment.gmtCreate)}>{formatDateTime(comment.gmtCreate, timeFormat)}</time>
          {onReferences && <Checkbox aria-label={t('reviewComments.select', { id: comment.id })} disabled={!canSend || view.earlierSource} checked={selected.includes(comment.id)}
            onChange={event => setSelected(ids => event.target.checked ? [...ids, comment.id] : ids.filter(id => id !== comment.id))} />}</div>
        {editing === comment.id ? <div className="prd-review-edit"><Input.TextArea value={draft} maxLength={10000} autoFocus rows={3} onChange={event => setDraft(event.target.value)} aria-label={t('reviewComments.editText')} />
          <Button size="small" onClick={() => setEditing(null)}>{t('runtime.cancel')}</Button><Button size="small" type="primary" loading={pending} disabled={!draft.trim()} onClick={() => void mutate(view, () => onUpdate(view, { commentText: draft }))}>{t('reviewComments.save')}</Button></div>
          : <p className="prd-review-card-text">{comment.commentText}</p>}
        <Button type="text" size="small" className="prd-review-location" title={comment.selector} disabled={view.earlierSource} onClick={() => onLocate(view)}><AimOutlined /><code>{comment.routePath}</code><span>{comment.selector}</span></Button>
        {view.earlierSource && <small>{t('reviewComments.earlierSource')}</small>}
        {comment.lastSentTurnId && <small>{t('reviewComments.sent')}</small>}
        {!view.earlierSource && <div className="prd-review-card-actions">
          {view.canUpdateStatus && <Button type="text" size="small" disabled={pending} onClick={() => void mutate(view, () => onUpdate(view, { status: comment.status === REVIEW_STATUS.OPEN ? REVIEW_STATUS.RESOLVED : REVIEW_STATUS.OPEN }))}>{comment.status === REVIEW_STATUS.OPEN ? t('reviewComments.resolve') : t('reviewComments.reopen')}</Button>}
          {view.canEdit && <Button type="text" size="small" disabled={pending} onClick={() => { setEditing(comment.id); setDraft(comment.commentText); }}>{t('reviewComments.edit')}</Button>}
          {view.canDelete && <Popconfirm title={t('reviewComments.deleteConfirm')} onConfirm={() => mutate(view, () => onDelete(view))} okText={t('reviewComments.delete')} cancelText={t('runtime.cancel')}><Button type="text" size="small" disabled={pending}>{t('reviewComments.delete')}</Button></Popconfirm>}
        </div>}
      </article>; })}
    </div>
    {onReferences && <footer><Button block type="primary" disabled={!canSend || selectedViews.length === 0} onClick={() => { onReferences(selectedViews.map(commentReference)); setSelected([]); }}>{t('reviewComments.addReferences', { count: selectedViews.length })}</Button></footer>}
  </aside>;
}
