import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { waitFor, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { notification } from 'antd';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import { apiClient, leaveDeletedWorkspace, recoverWorkspaceSession } from './client';

const failure = (code = '11005', status = 403) => HttpResponse.json({ success: false, code, message: code }, { status });
const ok = (accessToken = 'unbound-access') => HttpResponse.json({ success: true, code: '0', data: { accessToken } });
function bind(id = 7, token = 'bound-access') {
  useAuthStore.getState().setTokens(token, 'refresh-session');
  useAuthStore.getState().setWorkspaceSession(token, { id, name: 'workspace', description: '' }, 'ADMIN');
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  useAuthStore.getState().clear();
  window.history.replaceState({}, '', '/workspaces/branding');
});
afterEach(() => { notification.destroy(); useAuthStore.getState().clear(); window.history.replaceState({}, '', '/'); });

describe('workspace session recovery', () => {
  it('leaves a deleted current workspace using a background unbound refresh without signing out', async () => {
    bind();
    let payload: unknown;
    let calls = 0;
    server.use(http.post('/api/auth/refresh', async ({ request }) => { calls++; payload = await request.json(); return ok(); }));
    await leaveDeletedWorkspace(8);
    expect(calls).toBe(0);
    expect(useAuthStore.getState().currentWorkspace?.id).toBe(7);
    await leaveDeletedWorkspace(7);
    expect(payload).toEqual({ refreshToken: 'refresh-session', workspaceId: null, userActivity: false });
    expect(useAuthStore.getState().accessToken).toBe('unbound-access');
    expect(useAuthStore.getState().refreshToken).toBe('refresh-session');
    expect(useAuthStore.getState().currentWorkspace).toBeNull();
    expect(window.location.pathname).toBe('/workspaces/branding');
  });

  it.each([200, 403])('recovers concurrent %s failures once and never replays the failed write', async status => {
    bind();
    let refreshes = 0;
    let writes = 0;
    server.use(http.get('/api/recovery-read', () => failure('11005', status)),
      http.delete('/api/recovery-write', () => { writes++; return failure('11005', status); }),
      http.post('/api/auth/refresh', () => { refreshes++; return ok(); }));
    const results = await Promise.allSettled([apiClient.get('/api/recovery-read'), apiClient.delete('/api/recovery-write')]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(refreshes).toBe(1);
    expect(writes).toBe(1);
    expect(useAuthStore.getState().accessToken).toBe('unbound-access');
  });

  it('recovers a legacy null local workspace when the JWT still belongs to a deleted workspace', async () => {
    bind(); useAuthStore.getState().clearCurrentWorkspace();
    let refreshes = 0;
    server.use(http.get('/api/recovery-read', () => failure()), http.post('/api/auth/refresh', () => { refreshes++; return ok(); }));
    await expect(apiClient.get('/api/recovery-read')).rejects.toMatchObject({ code: '11005' });
    expect(refreshes).toBe(1);
    expect(useAuthStore.getState().accessToken).toBe('unbound-access');
  });

  it('does not let a late 11005 overwrite another tab before its storage event arrives', async () => {
    bind(); const arrived = deferred(); const release = deferred(); let refreshes = 0;
    server.use(http.get('/api/recovery-read', async () => { arrived.resolve(); await release.promise; return failure(); }),
      http.post('/api/auth/refresh', () => { refreshes++; return ok(); }));
    const request = apiClient.get('/api/recovery-read').catch(error => error);
    await arrived.promise;
    const stored = JSON.parse(localStorage.getItem('aw-auth')!);
    stored.state.accessToken = 'new-space-access'; stored.state.currentWorkspace.id = 8;
    localStorage.setItem('aw-auth', JSON.stringify(stored));
    release.resolve(); await request;
    expect(refreshes).toBe(0);
    expect(useAuthStore.getState().currentWorkspace?.id).toBe(8);
    expect(useAuthStore.getState().accessToken).toBe('new-space-access');
    expect(JSON.parse(localStorage.getItem('aw-auth')!).state.currentWorkspace.id).toBe(8);
  });

  it('does not apply an old recovery token after another tab switches workspace', async () => {
    bind(); const arrived = deferred(); const release = deferred();
    server.use(http.post('/api/auth/refresh', async () => { arrived.resolve(); await release.promise; return ok(); }));
    const recovery = recoverWorkspaceSession(); await arrived.promise;
    const stored = JSON.parse(localStorage.getItem('aw-auth')!);
    stored.state.accessToken = 'space-b-token'; stored.state.currentWorkspace = { id: 8, name: 'B' };
    localStorage.setItem('aw-auth', JSON.stringify(stored));
    release.resolve(); await recovery;
    expect(useAuthStore.getState().currentWorkspace?.id).toBe(8);
    expect(useAuthStore.getState().accessToken).toBe('space-b-token');
  });

  it('keeps the session on a transient refresh failure and offers an explicit retry', async () => {
    bind(); let calls = 0;
    server.use(http.post('/api/auth/refresh', () => ++calls === 1 ? HttpResponse.json({}, { status: 503 }) : ok()));
    await recoverWorkspaceSession();
    expect(useAuthStore.getState().accessToken).toBe('bound-access');
    expect(useAuthStore.getState().refreshToken).toBe('refresh-session');
    await userEvent.click(await screen.findByRole('button', { name: '重试恢复会话' }));
    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('unbound-access'));
    expect(calls).toBe(2);
  });

  it('handles an expired token whose first refresh reports a deleted workspace without replaying its write', async () => {
    bind(); let writes = 0; const payloads: unknown[] = [];
    server.use(http.delete('/api/recovery-write', () => { writes++; return failure('10401', 401); }),
      http.post('/api/auth/refresh', async ({ request }) => { payloads.push(await request.json()); return payloads.length === 1 ? failure() : ok(); }));
    await expect(apiClient.delete('/api/recovery-write')).rejects.toBeDefined();
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toEqual({ refreshToken: 'refresh-session', workspaceId: null, userActivity: false });
    expect(writes).toBe(1);
    expect(useAuthStore.getState().currentWorkspace).toBeNull();
    expect(useAuthStore.getState().accessToken).toBe('unbound-access');
  });

  it('synchronizes a different tab from the latest storage instead of the event payload', () => {
    bind(); const stored = JSON.parse(localStorage.getItem('aw-auth')!);
    stored.state.accessToken = 'new-tab-token'; stored.state.currentWorkspace = { id: 9, name: 'C' };
    localStorage.setItem('aw-auth', JSON.stringify(stored));
    window.dispatchEvent(new StorageEvent('storage', { key: 'aw-auth', newValue: 'stale-event' }));
    expect(useAuthStore.getState().accessToken).toBe('new-tab-token');
    expect(useAuthStore.getState().currentWorkspace?.id).toBe(9);
  });

  it('only signs out when the refresh endpoint confirms the session is invalid', async () => {
    bind();
    server.use(http.post('/api/auth/refresh', () => failure('10401', 401)));
    await recoverWorkspaceSession();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();
    expect(useAuthStore.getState().currentWorkspace).toBeNull();
  });
});
