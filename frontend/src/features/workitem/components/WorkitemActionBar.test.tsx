import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkitemActionBar } from './WorkitemActionBar';

const base = { workType: 'REQ', statusName: '开发中', priority: 1 };

describe('WorkitemActionBar watch toggle', () => {
  it('shows an unwatched "关注" entry when the user is not watching', () => {
    render(<WorkitemActionBar {...base} watched={false} />);

    const button = screen.getByTestId('workitem-watch-toggle');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAccessibleName('关注工单');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveTextContent('关注');
  });

  it('shows a watched "已关注" state when the user is already watching', () => {
    render(<WorkitemActionBar {...base} watched />);

    const button = screen.getByTestId('workitem-watch-toggle');
    expect(button).toHaveAccessibleName('取消关注工单');
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onToggleWatch when the watch button is clicked', async () => {
    const onToggleWatch = vi.fn();
    render(<WorkitemActionBar {...base} watched={false} onToggleWatch={onToggleWatch} />);

    await userEvent.click(screen.getByTestId('workitem-watch-toggle'));

    expect(onToggleWatch).toHaveBeenCalledTimes(1);
  });

  it.each([0, 9])('renders the shared priority mapping on the right for %s', (priority) => {
    render(<WorkitemActionBar {...base} priority={priority} />);
    const tags = within(screen.getByTestId('workitem-action-tags'));
    expect(tags.getByText('需求')).toBeInTheDocument();
    expect(tags.getByText('开发中')).toBeInTheDocument();
    if (priority === 0) expect(tags.getByText('紧急')).toBeInTheDocument();
    else expect(tags.getByText('未知优先级')).toBeInTheDocument();
  });

  it('keeps primary actions together and puts low-frequency actions in the following menu', async () => {
    const onStartDelivery = vi.fn();
    const onAddComment = vi.fn();
    render(<WorkitemActionBar {...base} hasSdlc onStartDelivery={onStartDelivery} onAddComment={onAddComment} />);
    const primary = screen.getByRole('button', { name: '再次交付' }).parentElement!;
    expect(within(primary).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '再次交付', '流转状态', '关注', '添加评论', '',
    ]);
    await userEvent.click(screen.getByRole('button', { name: '添加评论' }));
    expect(onAddComment).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '再次交付' }));
    expect(onStartDelivery).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '更多工单操作' }));
    const menu = await screen.findByRole('menu');
    expect(menu.querySelector('button')).toBeNull();
    await userEvent.click(within(menu).getByRole('menuitem', { name: '重新指派' }));
    expect(onStartDelivery).toHaveBeenCalledTimes(2);
  });

  it('offers start delivery as the primary action when no SDLC is bound', () => {
    render(<WorkitemActionBar {...base} />);

    expect(screen.getByRole('button', { name: '启动交付' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '再次交付' })).not.toBeInTheDocument();
  });

  it('keeps a disabled delivery reason focusable without activating the item', async () => {
    const invoke = vi.fn();
    render(<WorkitemActionBar {...base} hasSdlc deliveryControl={{
      label: '重新开启交付', danger: false, disabled: true,
      disabledReason: '请先结束未完成的取消操作', pending: false, invoke,
    }} />);

    await userEvent.click(screen.getByRole('button', { name: '更多工单操作' }));
    const menu = await screen.findByRole('menu');
    const disabled = within(menu).getAllByRole('menuitem').find((item) => item.textContent?.includes('重新开启交付'));
    const hint = disabled!.querySelector('span[tabindex="0"]') as HTMLElement;
    expect(hint).toHaveAttribute('aria-label', '请先结束未完成的取消操作');

    hint.focus();
    await userEvent.keyboard('{Enter}');

    expect(invoke).not.toHaveBeenCalled();
  });

  it('reflects the pending state while the toggle request is in flight', () => {
    render(<WorkitemActionBar {...base} watched={false} watchLoading />);

    const button = screen.getByTestId('workitem-watch-toggle');
    expect(button.querySelector('.ant-btn-loading-icon')).toBeInTheDocument();
  });
});
