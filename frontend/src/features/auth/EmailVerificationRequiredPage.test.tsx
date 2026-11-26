import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import { EmailVerificationRequiredPage } from './EmailVerificationRequiredPage';
import { LoginPage } from './LoginPage';
import { i18n } from '@/shared/i18n';
import { EMAIL_VERIFICATION_POLICY_QUERY_KEY } from './emailVerificationApi';

function ok<T>(data: T) {
  return { success: true, code: '0', message: '', traceId: null, data };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/email-verification']}>
        <Routes>
          <Route path="/email-verification" element={<EmailVerificationRequiredPage />} />
          <Route path="/login" element={<div>login-page</div>} />
          <Route path="/workspaces" element={<div>workspaces-page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe('EmailVerificationRequiredPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
  });

  afterEach(async () => { await act(async () => { await i18n.changeLanguage('zh-CN'); }); });

  it('keeps the login identity and existing disallowed email when login redirects to verification', async () => {
    server.use(
      http.get('/api/auth/sso/config', () => HttpResponse.json(ok({ registrationEnabled: true, defaultProviderId: null }))),
      http.get('/api/auth/sso/providers', () => HttpResponse.json(ok([]))),
      http.post('/api/auth/login', () => HttpResponse.json(ok({
        userId: 1, accessToken: null, refreshToken: null,
        sessionPurpose: 'EMAIL_VERIFICATION', restrictedToken: 'awev_identity',
        user: { id: 1, username: 'alice', nickname: 'Alice', email: 'alice@old.invalid' },
      }))),
      http.get('/api/auth/email-verification/policy', () => HttpResponse.json(ok({
        verificationEnabled: true, suffixRestrictionEnabled: true,
        allowedSuffixes: ['corp.example', 'team.example'], resendIntervalSeconds: 60,
      }))),
    );
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/login?local=1']}><Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/email-verification" element={<EmailVerificationRequiredPage />} />
      </Routes></MemoryRouter>
    </QueryClientProvider>);
    await userEvent.type(await screen.findByLabelText(/^用户名/), 'alice');
    await userEvent.type(screen.getByLabelText(/^密码/, { selector: 'input' }), 'test-password');
    await userEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
    const username = await screen.findByLabelText('登录用户名');
    expect(username).toHaveValue('alice');
    expect(username).toHaveAttribute('readonly');
    expect(screen.getByLabelText('邮箱')).toHaveValue('alice@old.invalid');
    const suffixes = await screen.findByTestId('email-suffix-hint');
    expect(within(suffixes).getByText('@corp.example')).toBeInTheDocument();
    expect(within(suffixes).getByText('@team.example')).toBeInTheDocument();
    expect(suffixes.querySelectorAll('.ant-tag-close-icon')).toHaveLength(0);
    expect(useAuthStore.getState().restrictedToken).toBe('awev_identity');
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();
  });

  it('fills asynchronously available identity without overwriting an edited or cleared email', async () => {
    useAuthStore.getState().setRestrictedToken('awev_identity');
    renderPage();
    const email = await screen.findByLabelText('邮箱');
    expect(email).toHaveValue('');
    act(() => useAuthStore.getState().setUser({ id: 1, username: 'alice', nickname: 'Alice', email: 'alice@old.invalid' }));
    await waitFor(() => expect(email).toHaveValue('alice@old.invalid'));
    await userEvent.clear(email);
    act(() => useAuthStore.getState().setUser({ id: 1, username: 'alice', nickname: 'Alice', email: 'alice@updated.invalid' }));
    expect(email).toHaveValue('');
    await userEvent.type(email, 'alice@corp.example');
    act(() => useAuthStore.getState().setUser({ id: 1, username: 'alice', nickname: 'Alice', email: 'alice@third.invalid' }));
    expect(email).toHaveValue('alice@corp.example');
  });

  it('renders the domain policy in English and retries a failed policy request', async () => {
    await act(async () => { await i18n.changeLanguage('en-US'); });
    useAuthStore.getState().setRestrictedToken('awev_identity');
    useAuthStore.getState().setUser({ id: 1, username: 'alice', nickname: 'Alice', email: 'alice@old.invalid' });
    let requests = 0;
    server.use(http.get('/api/auth/email-verification/policy', () => {
      requests += 1;
      return requests === 1
        ? HttpResponse.json({ success: false, code: '10000', message: 'temporary error' }, { status: 503 })
        : HttpResponse.json(ok({ verificationEnabled: true, suffixRestrictionEnabled: true,
          allowedSuffixes: ['corp.example', 'team.example'], resendIntervalSeconds: 60 }));
    }));
    renderPage();
    expect(screen.getByLabelText('Login username')).toHaveValue('alice');
    expect(screen.getByLabelText('Login username')).toHaveAttribute('readonly');
    expect(await screen.findByText('Unable to load the email domain policy. Retry to view allowed domains.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('group', { name: 'Allowed email domains' })).toHaveTextContent('Supported domains:');
    expect(screen.getByText('@team.example')).toBeInTheDocument();
    expect(screen.queryByText('Unable to load the email domain policy. Retry to view allowed domains.')).toBeNull();
  });

  it.each([
    { verificationEnabled: true, suffixRestrictionEnabled: false },
    { verificationEnabled: false, suffixRestrictionEnabled: true },
    { verificationEnabled: true, suffixRestrictionEnabled: true },
    { verificationEnabled: false, suffixRestrictionEnabled: false },
  ])('shows domain restrictions only according to the suffix switch: %j', async flags => {
    useAuthStore.getState().setRestrictedToken('awev_identity');
    server.use(http.get('/api/auth/email-verification/policy', () => HttpResponse.json(ok({
      ...flags, allowedSuffixes: ['corp.example'], resendIntervalSeconds: 60,
    }))));
    const { queryClient } = renderPage();
    await screen.findByLabelText('邮箱');
    await waitFor(() => expect(queryClient.getQueryState(EMAIL_VERIFICATION_POLICY_QUERY_KEY)?.status).toBe('success'));
    if (flags.suffixRestrictionEnabled) {
      expect(screen.getByTestId('email-suffix-hint')).toHaveTextContent('@corp.example');
    } else {
      expect(screen.queryByTestId('email-suffix-hint')).toBeNull();
    }
  });

  it('redirects to login without a restricted credential', async () => {
    renderPage();
    expect(await screen.findByText('login-page')).toBeInTheDocument();
  });

  it('sends a code, verifies it and stores the fresh normal session', async () => {
    useAuthStore.getState().setRestrictedToken('awev_test');
    useAuthStore.getState().setUser({ id: 1, username: 'alice', nickname: 'Alice', email: 'alice@example.com' });

    let sentAuthorization = '';
    server.use(
      http.post('/api/auth/email-verification/codes', ({ request }) => {
        sentAuthorization = request.headers.get('Authorization') ?? '';
        return HttpResponse.json(ok({ challengeId: 'challenge-1', resendAt: '', expiresAt: '' }));
      }),
      http.post('/api/auth/email-verification/verify', () => HttpResponse.json(ok({
        proof: null,
        session: {
          userId: 1,
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          user: { id: 1, username: 'alice', nickname: 'Alice', email: 'alice@example.com' },
        },
      }))),
    );

    renderPage();
    const email = await screen.findByLabelText('邮箱');
    expect(email).toHaveValue('alice@example.com');

    await userEvent.click(screen.getByRole('button', { name: '发送验证码' }));
    expect(await screen.findByRole('button', { name: /秒后重发/ })).toBeDisabled();
    expect(sentAuthorization).toBe('Bearer awev_test');

    await userEvent.type(screen.getByLabelText('邮箱验证码'), '123456');
    await userEvent.click(screen.getByRole('button', { name: '验证并继续' }));

    expect(await screen.findByText('workspaces-page')).toBeInTheDocument();
    expect(useAuthStore.getState().accessToken).toBe('access-token');
    expect(useAuthStore.getState().restrictedToken).toBeNull();
  });

  it('signs out locally even when the server call fails', async () => {
    useAuthStore.getState().setRestrictedToken('awev_test');
    server.use(
      http.post('/api/auth/email-verification/sign-out', () => HttpResponse.json(
        { success: false, code: '10000', message: 'boom', traceId: null, data: null }, { status: 500 })),
    );

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '退出登录' }));

    expect(await screen.findByText('login-page')).toBeInTheDocument();
    expect(useAuthStore.getState().restrictedToken).toBeNull();
  });

  it('rejects an invalid email before requesting a code', async () => {
    useAuthStore.getState().setRestrictedToken('awev_test');
    renderPage();

    const email = await screen.findByLabelText('邮箱');
    await userEvent.clear(email);
    await userEvent.click(screen.getByRole('button', { name: '发送验证码' }));

    expect(await screen.findByText('请先填写有效邮箱')).toBeInTheDocument();
  });

  it('reports a failed code send', async () => {
    useAuthStore.getState().setRestrictedToken('awev_test');
    useAuthStore.getState().setUser({ id: 1, username: 'alice', nickname: 'Alice', email: 'alice@example.com' });
    server.use(
      http.post('/api/auth/email-verification/codes', () => HttpResponse.json(
        { success: false, code: '10000', message: 'boom', traceId: null, data: null }, { status: 500 })),
    );
    renderPage();

    await screen.findByLabelText('邮箱');
    await userEvent.click(screen.getByRole('button', { name: '发送验证码' }));

    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('clears the previous domain error when the email is corrected and preserves a later ownership error', async () => {
    useAuthStore.getState().setRestrictedToken('awev_test');
    server.use(http.post('/api/auth/email-verification/codes', async ({ request }) => {
      const { email } = await request.json() as { email: string };
      return email.endsWith('@gmaill.com')
        ? HttpResponse.json({ success: false, code: '51006', message: '该邮箱后缀不在允许范围内' })
        : HttpResponse.json(ok({ challengeId: 'challenge-corrected', resendAt: '', expiresAt: '' }));
    }), http.post('/api/auth/email-verification/verify', () => HttpResponse.json({
      success: false, code: '10409', message: '邮箱已被使用',
    })));
    renderPage();
    const email = await screen.findByLabelText('邮箱');
    await userEvent.type(email, 'alice@gmaill.com');
    await userEvent.click(screen.getByRole('button', { name: '发送验证码' }));
    expect(await screen.findByText('该邮箱后缀不在允许范围内')).toBeInTheDocument();
    await userEvent.clear(email);
    await userEvent.type(email, 'alice@gmail.com');
    expect(screen.queryByText('该邮箱后缀不在允许范围内')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '发送验证码' }));
    await userEvent.type(screen.getByLabelText('邮箱验证码'), '123456');
    await userEvent.click(screen.getByRole('button', { name: '验证并继续' }));
    expect(await screen.findByText('邮箱已被使用')).toBeInTheDocument();
    expect(useAuthStore.getState().restrictedToken).toBe('awev_test');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('requires a requested challenge before verifying', async () => {
    useAuthStore.getState().setRestrictedToken('awev_test');
    useAuthStore.getState().setUser({ id: 1, username: 'alice', nickname: 'Alice', email: 'alice@example.com' });
    renderPage();

    await screen.findByLabelText('邮箱');
    await userEvent.type(screen.getByLabelText('邮箱验证码'), '123456');
    await userEvent.click(screen.getByRole('button', { name: '验证并继续' }));

    expect(await screen.findByText('请先发送验证码并填写')).toBeInTheDocument();
  });

  it('reports a verification response without a session', async () => {
    useAuthStore.getState().setRestrictedToken('awev_test');
    useAuthStore.getState().setUser({ id: 1, username: 'alice', nickname: 'Alice', email: 'alice@example.com' });
    server.use(
      http.post('/api/auth/email-verification/codes', () => HttpResponse.json(
        ok({ challengeId: 'challenge-1', resendAt: '', expiresAt: '' }))),
      http.post('/api/auth/email-verification/verify', () => HttpResponse.json(
        ok({ proof: null, session: null }))),
    );
    renderPage();

    await screen.findByLabelText('邮箱');
    await userEvent.click(screen.getByRole('button', { name: '发送验证码' }));
    await screen.findByRole('button', { name: /秒后重发/ });
    await userEvent.type(screen.getByLabelText('邮箱验证码'), '123456');
    await userEvent.click(screen.getByRole('button', { name: '验证并继续' }));

    expect(await screen.findByText('验证码无效或已过期')).toBeInTheDocument();
  });
});
