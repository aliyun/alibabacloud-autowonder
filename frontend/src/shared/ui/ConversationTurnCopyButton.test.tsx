import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { copyTextToClipboard } from '@/shared/lib/clipboard';
import {
  CONVERSATION_COPY_FEEDBACK_MS,
  ConversationTurnCopyButton,
} from './AutoConversationTurnContent';

vi.mock('@/shared/lib/clipboard', () => ({
  copyTextToClipboard: vi.fn(),
}));

const copyMock = vi.mocked(copyTextToClipboard);

describe('ConversationTurnCopyButton', () => {
  beforeEach(() => {
    copyMock.mockReset();
    copyMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a check for two seconds after a successful copy', async () => {
    vi.useFakeTimers();
    render(<ConversationTurnCopyButton
      base="/api/conversations/1"
      conversationId={1}
      turn={{ id: 2, content: '原始回复' }}
      label="复制回复"
    />);

    const button = screen.getByRole('button', { name: '复制回复' });
    expect(button).toHaveAttribute('data-copy-state', 'idle');
    expect(button.querySelector('.anticon-copy')).not.toBeNull();

    fireEvent.click(button);
    await act(async () => {});

    expect(copyMock).toHaveBeenCalledWith('原始回复');
    expect(button).toHaveAttribute('data-copy-state', 'copied');
    expect(button.querySelector('.anticon-check')).not.toBeNull();
    expect(button.querySelector('.anticon-copy')).toBeNull();

    act(() => { vi.advanceTimersByTime(CONVERSATION_COPY_FEEDBACK_MS - 1); });
    expect(button).toHaveAttribute('data-copy-state', 'copied');

    act(() => { vi.advanceTimersByTime(1); });
    expect(button).toHaveAttribute('data-copy-state', 'idle');
    expect(button.querySelector('.anticon-copy')).not.toBeNull();
  });
});
