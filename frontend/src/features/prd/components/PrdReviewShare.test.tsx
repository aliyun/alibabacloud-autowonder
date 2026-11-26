import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrdReviewShare } from './PrdReviewShare';
import type { reviewClient } from '../review';

afterEach(() => { vi.restoreAllMocks(); });

function setup({ enabled = true, canManage = true, configured = true } = {}) {
  const result = { share: enabled ? { id: 1, token: 'review-token', enabled: 1, version: 1 } : null, configured };
  const client = {
    share: vi.fn().mockResolvedValue(result),
    enable: vi.fn().mockResolvedValue({ ...result, share: { id: 1, token: 'new-token', enabled: 1, version: 1 } }),
    revoke: vi.fn(),
  };
  const tab = { opener: {}, location: { replace: vi.fn() }, close: vi.fn() };
  const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><PrdReviewShare client={client as unknown as ReturnType<typeof reviewClient>}
    identity="design" route="/settings?q=1#save" canManage={canManage} /></QueryClientProvider>);
  return { client, open, tab };
}

describe('design review sharing', () => {
  it('opens the current route in a new tab directly without a confirmation step', async () => {
    const { client, open, tab } = setup();
    await userEvent.click(screen.getByRole('button', { name: '分享设计评审' }));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(`${window.location.origin}/design-reviews/review-token?route=%2Fsettings%3Fq%3D1%23save`));
    expect(open).toHaveBeenCalledTimes(1);
    expect(tab.opener).toBeNull();
    expect(client.enable).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '设计评审链接' })).not.toBeInTheDocument();
  });

  it('opens the tab during the click and enables sharing before navigating', async () => {
    const { client, open, tab } = setup({ enabled: false });
    let resolve!: (value: unknown) => void;
    client.enable.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await userEvent.click(screen.getByRole('button', { name: '分享设计评审' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(client.enable).toHaveBeenCalledTimes(1);
    expect(tab.location.replace).not.toHaveBeenCalled();
    resolve({ configured: true, share: { id: 1, token: 'created', enabled: 1, version: 1 } });
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(expect.stringContaining('/design-reviews/created')));
  });

  it('closes the temporary tab when preview is unconfigured', async () => {
    const { client, tab } = setup({ enabled: false, configured: false });
    await userEvent.click(screen.getByRole('button', { name: '分享设计评审' }));
    await waitFor(() => expect(tab.close).toHaveBeenCalledTimes(1));
    expect(client.enable).not.toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });

  it('does not enable a share for a reader or when the browser blocks the tab', async () => {
    const { client, open, tab } = setup({ enabled: false, canManage: false });
    await userEvent.click(screen.getByRole('button', { name: '分享设计评审' }));
    await waitFor(() => expect(tab.close).toHaveBeenCalledTimes(1));
    expect(client.enable).not.toHaveBeenCalled();
    open.mockReturnValueOnce(null);
    await userEvent.click(screen.getByRole('button', { name: '分享设计评审' }));
    expect(client.enable).not.toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });
});
