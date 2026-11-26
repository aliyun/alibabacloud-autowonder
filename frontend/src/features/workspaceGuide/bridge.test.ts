import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openChiefPanel,
  prepareGuideSend,
  registerGuideSendPreparation,
  resetWorkspaceGuideBridge,
  subscribeChiefOpenPanel,
} from './bridge';

beforeEach(() => {
  resetWorkspaceGuideBridge();
});

afterEach(() => {
  resetWorkspaceGuideBridge();
});

describe('workspace guide bridge', () => {
  it('fails clearly when no Chief has registered the send preparation', async () => {
    await expect(prepareGuideSend(null)).rejects.toThrow(
      'Chief is not ready to prepare the initialization message',
    );
  });

  it('delegates to the registered preparation and passes the existing conversation through', async () => {
    const prepare = vi.fn(async (existingConversationId: number | null) => ({
      conversationId: existingConversationId ?? 88,
      clientMessageId: 'message-1',
    }));
    registerGuideSendPreparation(prepare);

    await expect(prepareGuideSend(null)).resolves.toEqual({ conversationId: 88, clientMessageId: 'message-1' });
    await expect(prepareGuideSend(55)).resolves.toEqual({ conversationId: 55, clientMessageId: 'message-1' });
    expect(prepare).toHaveBeenNthCalledWith(1, null);
    expect(prepare).toHaveBeenNthCalledWith(2, 55);
  });

  it('replays an open requested before Chief subscribes', () => {
    openChiefPanel({ source: 'guide', expanded: false });
    const listener = vi.fn();
    subscribeChiefOpenPanel(listener);

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      source: 'guide', expanded: false, prefill: null,
    }));
  });
});
