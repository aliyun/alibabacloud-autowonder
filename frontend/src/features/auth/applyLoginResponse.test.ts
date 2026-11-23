import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/shared/auth/store';
import { applyLoginResponse } from './applyLoginResponse';
import type { LoginResponse } from '@/shared/types/common';

const user = { id: 1, username: 'alice', nickname: 'Alice', email: 'alice@example.com' };

describe('applyLoginResponse', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
  });

  it('stores normal tokens for a regular session', () => {
    const response: LoginResponse = {
      userId: 1,
      accessToken: 'access',
      refreshToken: 'refresh',
      user,
    };

    expect(applyLoginResponse(response)).toBe(false);
    expect(useAuthStore.getState().accessToken).toBe('access');
    expect(useAuthStore.getState().refreshToken).toBe('refresh');
    expect(useAuthStore.getState().restrictedToken).toBeNull();
  });

  it('drops stale tokens before entering the restricted verification mode', () => {
    useAuthStore.getState().setTokens('stale-access', 'stale-refresh');
    useAuthStore.getState().setUser({ ...user, nickname: 'stale' });

    const restricted: LoginResponse = {
      userId: 1,
      accessToken: '',
      refreshToken: '',
      user,
      sessionPurpose: 'EMAIL_VERIFICATION',
      restrictedToken: 'awev_restricted',
    };

    expect(applyLoginResponse(restricted)).toBe(true);
    const state = useAuthStore.getState();
    expect(state.restrictedToken).toBe('awev_restricted');
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user?.nickname).toBe('Alice');
  });
});
