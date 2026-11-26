import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { apiClient } from '@/shared/api/client';
import { useAuthStore } from '@/shared/auth/store';
import { ApiError } from '@/shared/types/common';
import {
  PLATFORM_ADMIN_CANDIDATES_QUERY_KEY,
  PLATFORM_ADMINS_QUERY_KEY,
  addPlatformAdmin,
  getPlatformAdmins,
  removePlatformAdmin,
  searchPlatformAdminCandidates,
} from './adminApi';

function ok<T>(data: T) {
  return HttpResponse.json({ success: true, code: '0', message: '', traceId: null, data });
}

const roster = {
  admins: [
    {
      userId: 10000,
      username: 'alice',
      nickname: '爱丽丝',
      email: 'alice@example.com',
      active: true,
      self: true,
      removable: false,
      removeDisabledReason: '平台管理员不可移除自己',
    },
    {
      userId: 10001,
      username: 'bob',
      nickname: null,
      email: null,
      active: false,
      self: false,
      removable: true,
      removeDisabledReason: null,
    },
  ],
  canManage: true,
};

describe('adminApi', () => {
  beforeEach(() => useAuthStore.getState().clear());
  afterEach(() => useAuthStore.getState().clear());

  it('pins the query keys the panel invalidates after a write', () => {
    // Both keys are shared with PlatformAdminPanel; a silent rename would leave a stale roster on
    // screen after adding or removing an admin.
    expect(PLATFORM_ADMINS_QUERY_KEY).toEqual(['platform-admins']);
    expect(PLATFORM_ADMIN_CANDIDATES_QUERY_KEY).toEqual(['platform-admin-candidates']);
  });

  it('unwraps the roster and the caller manage permission', async () => {
    let path = '';
    server.use(http.get('/api/platform/admins', ({ request }) => {
      path = new URL(request.url).pathname;
      return ok(roster);
    }));

    await expect(getPlatformAdmins()).resolves.toEqual(roster);
    expect(path).toBe('/api/platform/admins');
  });

  it('forwards the keyword as a query parameter when searching candidates', async () => {
    let search: string | null = null;
    server.use(http.get('/api/platform/admins/candidates', ({ request }) => {
      search = new URL(request.url).searchParams.get('keyword');
      return ok([{ userId: 10002, username: 'carol', nickname: '卡罗', email: 'carol@example.com' }]);
    }));

    const candidates = await searchPlatformAdminCandidates('carol');

    expect(search).toBe('carol');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].userId).toBe(10002);
  });

  it('sends an empty keyword so the backend returns the unfiltered candidate page', async () => {
    let search: string | null = null;
    server.use(http.get('/api/platform/admins/candidates', ({ request }) => {
      search = new URL(request.url).searchParams.get('keyword');
      return ok([]);
    }));

    await searchPlatformAdminCandidates('');

    expect(search).toBe('');
  });

  it('posts the selected user id and returns the refreshed roster', async () => {
    let method = '';
    let path = '';
    let body: unknown = null;
    server.use(http.post('/api/platform/admins', async ({ request }) => {
      method = request.method;
      path = new URL(request.url).pathname;
      body = await request.json();
      return ok(roster);
    }));

    await expect(addPlatformAdmin(10002)).resolves.toEqual(roster);
    expect(method).toBe('POST');
    expect(path).toBe('/api/platform/admins');
    expect(body).toEqual({ userId: 10002 });
  });

  it('deletes by path and returns the refreshed roster', async () => {
    let method = '';
    let path = '';
    server.use(http.delete('/api/platform/admins/:userId', ({ request }) => {
      method = request.method;
      path = new URL(request.url).pathname;
      return ok({ ...roster, admins: [roster.admins[0]] });
    }));

    const result = await removePlatformAdmin(10001);

    expect(method).toBe('DELETE');
    expect(path).toBe('/api/platform/admins/10001');
    expect(result.admins).toHaveLength(1);
  });

  it('surfaces the backend refusal message when removing the last admin', async () => {
    server.use(http.delete('/api/platform/admins/:userId', () => HttpResponse.json({
      success: false,
      code: '31004',
      message: '平台管理员至少保留一名，无法移除最后一名',
      traceId: 'trace-last-admin',
      data: null,
    })));

    // The panel shows this message verbatim, so it must survive the response interceptor rather
    // than being replaced by a generic HTTP error.
    await expect(removePlatformAdmin(10001)).rejects.toMatchObject({
      message: '平台管理员至少保留一名，无法移除最后一名',
    });
    await expect(removePlatformAdmin(10001)).rejects.toBeInstanceOf(ApiError);
  });

  it('preserves the explicit target-not-found code and original error without retrying the write', async () => {
    let writes = 0;
    server.use(http.post('/api/platform/admins', () => {
      writes++;
      return HttpResponse.json({ success: false, code: '31002', message: 'raw target denial <b>原文</b>', traceId: 'target-trace', data: null });
    }));
    const failure = await addPlatformAdmin(10002).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ code: '31002', message: 'raw target denial <b>原文</b>', traceId: 'target-trace' });
    expect(writes).toBe(1);
  });

  it('wraps a transport failure as ApiError 10000 and never automatically repeats that POST', async () => {
    let writes = 0;
    server.use(http.post('/api/platform/admins', () => { writes++; return HttpResponse.error(); }));
    const failure = await addPlatformAdmin(10002).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ code: '10000', message: 'Network Error', traceId: null });
    expect(writes).toBe(1);
  });

  it.each([200, 401])('does not refresh or replay an admin add after HTTP %i/code10401', async (status) => {
    let writes = 0;
    let refreshes = 0;
    useAuthStore.getState().setTokens('synthetic-expired-access', 'synthetic-valid-refresh');
    useAuthStore.getState().setUser({ id: 10000, username: 'alice', nickname: '', email: '', isAdmin: true });
    useAuthStore.getState().setCurrentWorkspace({ id: 7, name: 'Synthetic workspace', description: '' }, 'ADMIN');
    const authBefore = useAuthStore.getState();
    const queryClient = new QueryClient();
    queryClient.setQueryData(PLATFORM_ADMINS_QUERY_KEY, roster);
    const cachedRoster = queryClient.getQueryData(PLATFORM_ADMINS_QUERY_KEY);
    const denial = {
      code: '10401',
      message: 'raw session denial <b>原文</b>',
      traceId: `admin-add-auth-${status}`,
      data: { userId: 10002, reason: 'SYNTHETIC_SESSION_EXPIRED' },
    };
    server.use(
      http.post('/api/platform/admins', () => {
        writes++;
        // A replay would succeed and incorrectly replace the cached roster.
        return writes === 1
          ? HttpResponse.json({ success: false, ...denial }, { status })
          : ok({ ...roster, admins: [...roster.admins, { ...roster.admins[1], userId: 10002 }] });
      }),
      http.post('/api/auth/refresh', () => {
        refreshes++;
        return ok({ accessToken: 'synthetic-refreshed-access' });
      }),
    );

    try {
      const failure = await addPlatformAdmin(10002)
        .then((updatedRoster) => queryClient.setQueryData(PLATFORM_ADMINS_QUERY_KEY, updatedRoster))
        .catch((error: unknown) => error);

      expect({ writes, refreshes }).toEqual({ writes: 1, refreshes: 0 });
      expect(failure).toBeInstanceOf(ApiError);
      expect(failure).toMatchObject(denial);
      expect(queryClient.getQueryData(PLATFORM_ADMINS_QUERY_KEY)).toBe(cachedRoster);
      expect(useAuthStore.getState()).toBe(authBefore);
    } finally {
      queryClient.clear();
    }
  });

  it.each([200, 401])('still refreshes and replays an admin roster read after HTTP %i/code10401', async (status) => {
    let reads = 0;
    let refreshes = 0;
    useAuthStore.getState().setTokens('synthetic-expired-access', 'synthetic-valid-refresh');
    server.use(
      http.get('/api/platform/admins', () => {
        reads++;
        return reads === 1
          ? HttpResponse.json({ success: false, code: '10401', message: 'Synthetic expiry', traceId: null, data: null }, { status })
          : ok(roster);
      }),
      http.post('/api/auth/refresh', () => {
        refreshes++;
        return ok({ accessToken: 'synthetic-refreshed-access' });
      }),
    );

    await expect(getPlatformAdmins()).resolves.toEqual(roster);
    expect({ reads, refreshes }).toEqual({ reads: 2, refreshes: 1 });
    expect(useAuthStore.getState().accessToken).toBe('synthetic-refreshed-access');
  });

  it.each([200, 401])('still refreshes and replays an ordinary POST after HTTP %i/code10401', async (status) => {
    let writes = 0;
    let refreshes = 0;
    useAuthStore.getState().setTokens('synthetic-expired-access', 'synthetic-valid-refresh');
    server.use(
      http.post('/api/synthetic-write', () => {
        writes++;
        return writes === 1
          ? HttpResponse.json({ success: false, code: '10401', message: 'Synthetic expiry', traceId: null, data: null }, { status })
          : ok({ saved: true });
      }),
      http.post('/api/auth/refresh', () => {
        refreshes++;
        return ok({ accessToken: 'synthetic-refreshed-access' });
      }),
    );

    const response = await apiClient.post('/api/synthetic-write', { value: 'synthetic' });
    expect(response.data).toEqual({ saved: true });
    expect({ writes, refreshes }).toEqual({ writes: 2, refreshes: 1 });
    expect(useAuthStore.getState().accessToken).toBe('synthetic-refreshed-access');
  });
});
