import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PrdReviewPanel } from './PrdReviewPanel';
import { designReviewLink, type ReviewCommentView } from '../review';

const comment = (id: number, overrides: Partial<ReviewCommentView> = {}): ReviewCommentView => ({
  comment: { id, commentText: `Feedback ${id}`, selector: '#save', routePath: '/settings?q=1#save', creatorId: id,
    conversationId: 20, sourceKey: 'source', runtimeRevision: 3, status: 'open', version: 0, elementJson: '{}', gmtCreate: '2026-11-17T01:00:00Z', gmtModified: '2026-11-17T01:00:00Z' },
  authorName: `Reviewer ${id}`, canEdit: id === 1, canDelete: id === 1, canUpdateStatus: id === 1, earlierSource: false, ...overrides,
});
function setup(comments = [comment(1), comment(2)]) {
  const props = { comments, loading: false, error: false, viewerId: 1, onClose: vi.fn(), onLocate: vi.fn(),
    onUpdate: vi.fn().mockResolvedValue(undefined), onDelete: vi.fn().mockResolvedValue(undefined), onReferences: vi.fn(), canSend: true };
  return { ...render(<PrdReviewPanel {...props} />), props };
}
describe('design review panel', () => {
  it('filters mine, selects references, and locates the exact route', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('checkbox', { name: '我的' }));
    expect(screen.queryByText('Feedback 2')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: '选取评论 1' }));
    await userEvent.click(screen.getByRole('button', { name: '将 1 条意见加入对话' }));
    expect(props.onReferences).toHaveBeenCalledWith([expect.objectContaining({ id: 1, selector: '#save' })]);
    await userEvent.click(screen.getByRole('button', { name: /settings/ }));
    expect(props.onLocate).toHaveBeenCalledWith(props.comments[0]);
  });
  it('keeps edited text after a failed save and sends the update separately from resolution', async () => {
    const { props } = setup([comment(1)]);
    props.onUpdate.mockRejectedValueOnce(new Error('version conflict'));
    await userEvent.click(screen.getByRole('button', { name: /编\s*辑/ }));
    await userEvent.clear(screen.getByRole('textbox', { name: '编辑评论内容' }));
    await userEvent.type(screen.getByRole('textbox', { name: '编辑评论内容' }), 'Updated feedback');
    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    expect(await screen.findByText('version conflict')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '编辑评论内容' })).toHaveValue('Updated feedback');
    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: '标记解决' }));
    expect(props.onUpdate).toHaveBeenLastCalledWith(props.comments[0], { status: 'resolved' });
  });
  it('retains old-source comments without allowing them into a new design', () => {
    setup([comment(1, { earlierSource: true })]);
    expect(screen.getByText('来自之前的工程，仅供查阅')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选取评论 1' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /编\s*辑/ })).not.toBeInTheDocument();
  });
  it('encodes path, query and hash as one review route', () => {
    const link = new URL(designReviewLink('token', '/settings?q=1#save', 'https://platform.example'));
    expect(link.pathname).toBe('/design-reviews/token');
    expect(link.searchParams.get('route')).toBe('/settings?q=1#save');
    expect(link.hash).toBe('');
  });
});
