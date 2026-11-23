import { beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { server } from '@/test/mocks/server';
import { i18n } from '@/shared/i18n';
import { RegisterPage } from './RegisterPage';
import { EMAIL_VERIFICATION_POLICY_QUERY_KEY } from './emailVerificationApi';

function ok<T>(data: T) {
  return { success: true, code: '0', message: '', traceId: null, data };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  ) };
}

describe('RegisterPage email verification', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('verifies the email before submitting the registration proof', async () => {
    let registerBody: Record<string, unknown> | null = null;
    server.use(
      http.get('/api/auth/email-verification/policy', () => HttpResponse.json(ok({
        verificationEnabled: true,
        suffixRestrictionEnabled: false,
        allowedSuffixes: [],
        codeLength: 6,
        codeTtlSeconds: 600,
        resendIntervalSeconds: 60,
        maxAttempts: 5,
      }))),
      http.post('/api/auth/email-verification/codes', () => HttpResponse.json(
        ok({ challengeId: 'challenge-1', resendAt: '', expiresAt: '' }))),
      http.post('/api/auth/email-verification/verify', () => HttpResponse.json(
        ok({ proof: 'awevp_register', session: null }))),
      http.post('/api/auth/register', async ({ request }) => {
        registerBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json(ok({
          id: 21,
          username: 'carol',
          nickname: 'Carol',
          email: 'carol@example.com',
          reviewRequired: false,
          administratorContacts: null,
        }));
      }),
    );

    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/用户名/), 'carol');
    await user.type(screen.getByLabelText(/昵称/), 'Carol');
    await user.type(screen.getByLabelText(/^邮箱$/), 'carol@example.com');
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'secret1');

    const sendButton = await screen.findByRole('button', { name: '发送验证码' });
    await user.click(sendButton);
    expect(await screen.findByRole('button', { name: /秒后重发/ })).toBeDisabled();

    await user.type(screen.getByLabelText('邮箱验证码'), '123456');
    await user.click(screen.getByRole('button', { name: /注\s*册/ }));

    await waitFor(() => expect(registerBody).not.toBeNull());
    expect(registerBody).toMatchObject({
      username: 'carol',
      email: 'carol@example.com',
      emailVerificationProof: 'awevp_register',
    });
  });

  it('keeps the classic form when verification is disabled', async () => {
    renderPage();
    expect(screen.queryByLabelText('邮箱验证码')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /注\s*册/ })).toBeInTheDocument();
  });

  it('shows suffix restrictions independently of email verification', async () => {
    let enabled = true;
    let restricted = true;
    server.use(http.get('/api/auth/email-verification/policy', () => HttpResponse.json(ok({
      verificationEnabled: enabled, suffixRestrictionEnabled: restricted,
      allowedSuffixes: ['example.com', '@gmail.com'],
      codeLength: 6, codeTtlSeconds: 600, resendIntervalSeconds: 60, maxAttempts: 5,
    }))));
    const { queryClient } = renderPage();
    const hint = await screen.findByTestId('email-suffix-hint');
    expect(within(hint).getByText('@example.com')).toBeInTheDocument();
    expect(within(hint).getByText('@gmail.com')).toBeInTheDocument();
    expect(within(hint).queryByLabelText('close')).toBeNull();

    restricted = false;
    await act(async () => { await queryClient.invalidateQueries({ queryKey: EMAIL_VERIFICATION_POLICY_QUERY_KEY }); });
    await waitFor(() => expect(screen.queryByTestId('email-suffix-hint')).toBeNull());
    expect(screen.getByLabelText('邮箱验证码')).toBeInTheDocument();

    restricted = true; enabled = false;
    await act(async () => { await queryClient.invalidateQueries({ queryKey: EMAIL_VERIFICATION_POLICY_QUERY_KEY }); });
    expect(await screen.findByTestId('email-suffix-hint')).toHaveTextContent('@example.com');
    await waitFor(() => expect(screen.queryByLabelText('邮箱验证码')).toBeNull());
    expect(screen.getByTestId('email-suffix-hint')).toHaveTextContent('@gmail.com');
    expect(screen.queryByRole('button', { name: '发送验证码' })).toBeNull();

    restricted = false;
    await act(async () => { await queryClient.invalidateQueries({ queryKey: EMAIL_VERIFICATION_POLICY_QUERY_KEY }); });
    await waitFor(() => expect(screen.queryByTestId('email-suffix-hint')).toBeNull());
  });

  it('reports a failed code send', async () => {
    server.use(
      http.get('/api/auth/email-verification/policy', () => HttpResponse.json(ok({
        verificationEnabled: true,
        suffixRestrictionEnabled: false,
        allowedSuffixes: [],
        codeLength: 6,
        codeTtlSeconds: 600,
        resendIntervalSeconds: 60,
        maxAttempts: 5,
      }))),
      http.post('/api/auth/email-verification/codes', () => HttpResponse.json(
        { success: false, code: '10000', message: 'boom', traceId: null, data: null }, { status: 500 })),
    );

    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^邮箱$/), 'carol@example.com');
    await user.click(await screen.findByRole('button', { name: '发送验证码' }));

    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('requires a code before submitting when verification is enabled', async () => {
    server.use(
      http.get('/api/auth/email-verification/policy', () => HttpResponse.json(ok({
        verificationEnabled: true,
        suffixRestrictionEnabled: false,
        allowedSuffixes: [],
        codeLength: 6,
        codeTtlSeconds: 600,
        resendIntervalSeconds: 60,
        maxAttempts: 5,
      }))),
    );

    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/用户名/), 'carol');
    await user.type(screen.getByLabelText(/昵称/), 'Carol');
    await user.type(screen.getByLabelText(/^邮箱$/), 'carol@example.com');
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'secret1');
    await user.click(screen.getByRole('button', { name: /注\s*册/ }));

    expect(await screen.findByText('请先发送验证码并填写')).toBeInTheDocument();
  });
});
