import { beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import { BasicProfilePanel } from './BasicProfilePanel';
import { EMAIL_VERIFICATION_POLICY_QUERY_KEY } from '@/features/auth/emailVerificationApi';

function ok<T>(data: T) {
  return { success: true, code: '0', message: '', traceId: null, data };
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    username: 'alice',
    nickname: '爱丽丝',
    email: 'alice@example.com',
    phone: '+86 138-0000-0000',
    emailVerified: false,
    emailVerifiedAt: null,
    ...overrides,
  };
}

function enabledPolicy() {
  return {
    verificationEnabled: true,
    suffixRestrictionEnabled: false,
    allowedSuffixes: [],
    codeLength: 6,
    codeTtlSeconds: 600,
    resendIntervalSeconds: 60,
    maxAttempts: 5,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <BasicProfilePanel />
    </QueryClientProvider>,
  ) };
}

describe('BasicProfilePanel email verification', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setTokens('access', 'refresh');
    useAuthStore.getState().setUser({ id: 1, username: 'alice', nickname: '爱丽丝', email: 'alice@example.com' });
  });

  it('verifies an unverified current email before saving', async () => {
    let putBody: Record<string, unknown> | null = null;
    server.use(
      http.get('/api/auth/email-verification/policy', () => HttpResponse.json(ok(enabledPolicy()))),
      http.get('/api/users/me/profile', () => HttpResponse.json(ok(profile()))),
      http.post('/api/auth/email-verification/codes', () => HttpResponse.json(
        ok({ challengeId: 'challenge-1', resendAt: '', expiresAt: '' }))),
      http.post('/api/auth/email-verification/verify', () => HttpResponse.json(
        ok({ proof: 'awevp_profile', session: null }))),
      http.put('/api/users/me/profile', async ({ request }) => {
        putBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json(ok(profile({ emailVerified: true })));
      }),
    );

    renderPanel();
    expect(await screen.findByDisplayValue('alice@example.com')).toBeInTheDocument();
    expect(await screen.findByLabelText('新邮箱验证码')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '发送验证码' }));
    await screen.findByRole('button', { name: /秒后重发/ });
    await userEvent.type(screen.getByLabelText('新邮箱验证码'), '123456');
    await userEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody).toMatchObject({
      email: 'alice@example.com',
      emailVerificationProof: 'awevp_profile',
    });
  });

  it.each([true, false])('keeps suffix hints independent of verification status and controls (verified=%s)', async emailVerified => {
    let verificationEnabled = true;
    let suffixRestrictionEnabled = true;
    server.use(
      http.get('/api/auth/email-verification/policy', () => HttpResponse.json(ok({
        ...enabledPolicy(), verificationEnabled, suffixRestrictionEnabled,
        allowedSuffixes: ['example.com', '@gmail.com'],
      }))),
      http.get('/api/users/me/profile', () => HttpResponse.json(ok(profile({ emailVerified })))),
    );
    const { queryClient } = renderPanel();
    await screen.findByDisplayValue('alice@example.com');
    const hint = await screen.findByTestId('email-suffix-hint');
    expect(within(hint).getByText('@example.com')).toBeInTheDocument();
    expect(within(hint).getByText('@gmail.com')).toBeInTheDocument();
    expect(screen.getByTestId('profile-email-verification-status')).toHaveTextContent(emailVerified ? '已验证' : '待验证');
    const status = screen.getByTestId('profile-email-verification-status');
    expect(status.closest('.ant-form-item-label')).not.toBeNull();
    expect(status.closest('.ant-form-item-extra')).toBeNull();
    expect(status.closest('label')?.htmlFor).toBe(screen.getByLabelText('邮箱').id);

    verificationEnabled = false;
    await act(async () => { await queryClient.invalidateQueries({ queryKey: EMAIL_VERIFICATION_POLICY_QUERY_KEY }); });
    expect(await screen.findByTestId('email-suffix-hint')).toHaveTextContent('@example.com');
    await waitFor(() => expect(screen.queryByTestId('profile-email-verification-status')).toBeNull());
    await waitFor(() => expect(screen.queryByLabelText('新邮箱验证码')).toBeNull());
    expect(screen.getByTestId('email-suffix-hint')).toHaveTextContent('@gmail.com');
    expect(screen.getByLabelText('邮箱')).toHaveValue('alice@example.com');

    suffixRestrictionEnabled = false;
    await act(async () => { await queryClient.invalidateQueries({ queryKey: EMAIL_VERIFICATION_POLICY_QUERY_KEY }); });
    await waitFor(() => expect(screen.queryByTestId('email-suffix-hint')).toBeNull());
  });

  it('requests a proof when the email changes', async () => {
    server.use(
      http.get('/api/auth/email-verification/policy', () => HttpResponse.json(ok(enabledPolicy()))),
      http.get('/api/users/me/profile', () => HttpResponse.json(ok(profile({ emailVerified: true })))),
    );

    renderPanel();
    const email = await screen.findByDisplayValue('alice@example.com');
    expect(screen.queryByLabelText('新邮箱验证码')).not.toBeInTheDocument();

    await userEvent.clear(email);
    await userEvent.type(email, 'new@example.com');

    expect(await screen.findByLabelText('新邮箱验证码')).toBeInTheDocument();
    expect(screen.getByText('待验证')).toBeInTheDocument();
  });

  it('hides the code entry when the email is verified and unchanged', async () => {
    server.use(
      http.get('/api/auth/email-verification/policy', () => HttpResponse.json(ok(enabledPolicy()))),
      http.get('/api/users/me/profile', () => HttpResponse.json(ok(profile({ emailVerified: true })))),
    );

    renderPanel();
    expect(await screen.findByDisplayValue('alice@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('新邮箱验证码')).not.toBeInTheDocument();
    expect(screen.getByText('已验证')).toBeInTheDocument();
  });

  it('reports a failed code send without changing the saved email', async () => {
    server.use(
      http.get('/api/auth/email-verification/policy', () => HttpResponse.json(ok(enabledPolicy()))),
      http.get('/api/users/me/profile', () => HttpResponse.json(ok(profile()))),
      http.post('/api/auth/email-verification/codes', () => HttpResponse.json(
        { success: false, code: '10000', message: 'boom', traceId: null, data: null }, { status: 500 })),
    );

    renderPanel();
    await screen.findByLabelText('新邮箱验证码');
    await userEvent.click(screen.getByRole('button', { name: '发送验证码' }));

    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱')).toHaveValue('alice@example.com');
  });

  it('requires a requested code before saving a pending email', async () => {
    server.use(
      http.get('/api/auth/email-verification/policy', () => HttpResponse.json(ok(enabledPolicy()))),
      http.get('/api/users/me/profile', () => HttpResponse.json(ok(profile()))),
    );

    renderPanel();
    await screen.findByLabelText('新邮箱验证码');
    await userEvent.type(screen.getByLabelText('新邮箱验证码'), '123456');
    await userEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByText('请先发送验证码并填写')).toBeInTheDocument();
  });

  it('clears the sent challenge when the target email changes again', async () => {
    server.use(
      http.get('/api/auth/email-verification/policy', () => HttpResponse.json(ok(enabledPolicy()))),
      http.get('/api/users/me/profile', () => HttpResponse.json(ok(profile()))),
      http.post('/api/auth/email-verification/codes', () => HttpResponse.json(
        ok({ challengeId: 'challenge-1', resendAt: '', expiresAt: '' }))),
    );

    renderPanel();
    const email = await screen.findByLabelText('邮箱');
    await screen.findByLabelText('新邮箱验证码');
    await userEvent.click(screen.getByRole('button', { name: '发送验证码' }));
    expect(await screen.findByRole('button', { name: /秒后重发/ })).toBeInTheDocument();

    await userEvent.clear(email);
    await userEvent.type(email, 'other@example.com');

    expect(await screen.findByRole('button', { name: '发送验证码' })).toBeInTheDocument();
  });
});
