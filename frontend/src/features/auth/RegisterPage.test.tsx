import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/i18n';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { RegisterPage } from './RegisterPage';

function ok<T>(data: T) {
  return { success: true, code: '0', message: '', traceId: null, data };
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="register-target">{location.pathname}</span>;
}

function renderRegister() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>
      <RegisterPage />
      <LocationProbe />
    </MemoryRouter></QueryClientProvider>,
  );
}

describe('RegisterPage', () => {
  afterEach(async () => { await act(async () => { await i18n.changeLanguage('zh-CN'); }); });
  it('renders registration form with the restored help and preference header', async () => {
    renderRegister();
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('login-topbar');
    await waitFor(() => expect(within(header).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/workspaces', '/help']));
    expect(within(header).getByRole('link', { name: '帮助中心' })).toHaveAttribute('target', '_blank');
    expect(within(header).getByRole('button', { name: '切换语言' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: '切换外观' })).toBeInTheDocument();
    expect(within(header).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('AI Native SDLC Platform')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /软件产品\s*自动交付平台/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '切换外观' })).toHaveLength(1);
    expect(screen.getByText('创建平台账号')).toBeInTheDocument();
    expect(screen.getByLabelText(/用户名/)).toBeInTheDocument();
    expect(screen.getByLabelText(/昵称/)).toBeInTheDocument();
    expect(screen.getByLabelText(/邮箱/)).toBeInTheDocument();
    expect(screen.getByLabelText(/密码/, { selector: 'input' })).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: /注\s*册/ });
    expect(submit).toBeInTheDocument();
    expect(submit.closest('.auth-entry-card')?.parentElement).toHaveClass('login-entry-form');
    expect(screen.getByRole('link', { name: '去登录' })).toHaveAttribute('href', '/login');
  });

  it('registers normally and opens the login page when review is disabled', async () => {
    server.use(http.post('/api/auth/register', () => HttpResponse.json(ok({
      id: 13,
      username: 'carol',
      nickname: '卡罗',
      email: 'carol@example.com',
      reviewRequired: false,
      administratorContacts: null,
    }))));
    renderRegister();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/用户名/), 'carol');
    await user.type(screen.getByLabelText(/昵称/), '卡罗');
    await user.type(screen.getByLabelText(/邮箱/), 'carol@example.com');
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'secret123');

    await user.click(screen.getByRole('button', { name: /注\s*册/ }));

    await waitFor(() => expect(screen.getByTestId('register-target')).toHaveTextContent('/login'));
    expect(screen.queryByText('注册成功，等待审核')).not.toBeInTheDocument();
  });

  it('falls back to the generic contact hint when a pending response has no contacts', async () => {
    server.use(http.post('/api/auth/register', () => HttpResponse.json(ok({
      id: 14,
      username: 'carol',
      nickname: '卡罗',
      email: 'carol@example.com',
      reviewRequired: true,
      administratorContacts: null,
    }))));
    renderRegister();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/用户名/), 'carol');
    await user.type(screen.getByLabelText(/昵称/), '卡罗');
    await user.type(screen.getByLabelText(/邮箱/), 'carol@example.com');
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'secret123');
    await user.click(screen.getByRole('button', { name: /注\s*册/ }));

    expect(await screen.findByText('注册成功，等待审核')).toBeInTheDocument();
    expect(screen.getByText('暂无可用平台管理员，请联系平台管理员处理。')).toBeInTheDocument();
  });

  it('shows administrator contacts for a pending registration and then opens the login page', async () => {
    server.use(http.post('/api/auth/register', () => HttpResponse.json(ok({
      id: 12,
      username: 'carol',
      nickname: '卡罗',
      email: 'carol@example.com',
      reviewRequired: true,
      administratorContacts: [{ nickname: '周宁', email: 'zhou@example.com' }],
    }))));
    renderRegister();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/用户名/), 'carol');
    await user.type(screen.getByLabelText(/昵称/), '卡罗');
    await user.type(screen.getByLabelText(/邮箱/), 'carol@example.com');
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'secret123');

    await user.click(screen.getByRole('button', { name: /注\s*册/ }));

    expect(await screen.findByText('注册成功，等待审核')).toBeInTheDocument();
    expect(screen.getAllByText('新用户注册请联系管理员审核后登录').length).toBeGreaterThan(0);
    expect(screen.getByText('zhou@example.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /确\s*定/ }));
    await waitFor(() => expect(screen.getByTestId('register-target')).toHaveTextContent('/login'));
  });

  it('replaces the form with a closed notice when self-registration is disabled', async () => {
    server.use(http.get('/api/auth/sso/config', () => HttpResponse.json(ok({
      registrationEnabled: false,
      defaultProviderId: null,
    }))));

    renderRegister();

    expect(await screen.findByText('平台已关闭自行注册')).toBeInTheDocument();
    expect(screen.getByText('如需开通账号，请联系平台管理员。')).toBeInTheDocument();
    expect(screen.queryByLabelText(/用户名/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回登录' })).toBeInTheDocument();
  });

  it.each([
    ['zh-CN', '已有账号？', '去登录'],
    ['en-US', 'Already have an account? ', 'Sign in'],
  ])('separates the registration footer prompt from its short login link in %s', async (locale, prompt, linkText) => {
    await act(async () => { await i18n.changeLanguage(locale); });
    renderRegister();
    const link = screen.getByRole('link', { name: linkText });
    expect(link).toHaveAttribute('href', '/login');
    expect(link).toHaveAccessibleName(linkText);
    expect(link.parentElement).toHaveClass('auth-entry-link');
    expect(link.previousSibling?.nodeType).toBe(Node.TEXT_NODE);
    expect(link.previousSibling?.textContent).toBe(prompt);
    expect(link.parentElement?.textContent).toBe(`${prompt}${linkText}`);
  });

  it('matches the login footer typography and submit spacing without changing field spacing', () => {
    renderRegister();
    expect(screen.getByRole('button', { name: /注\s*册/ }).closest('.ant-form-item')).toHaveClass('auth-register-submit');
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'AuthEntryShell.css'), 'utf8');
    expect(css).toContain('.auth-entry-link { text-align: center; }');
    expect(css).toContain('.auth-entry-link a { color: var(--aw-primary); font-weight: 500; }');
    expect(css).toContain('.auth-register-form .auth-entry-link { color: var(--aw-text-3); font-size: 12px; line-height: 20px; }');
    expect(css).toContain('.auth-register-form .auth-entry-link a { font-weight: 400; }');
    expect(css).toContain('.auth-register-form .auth-register-submit { margin-bottom: 16px; }');
    expect(css).toContain('.auth-register-form .ant-form-item { margin-bottom: 24px; }');
  });

  it('scopes natural-flow help and consistent field spacing to the registration form', () => {
    renderRegister();
    expect(screen.getByRole('button', { name: /注\s*册/ }).closest('form')).toHaveClass('auth-register-form');
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'AuthEntryShell.css'), 'utf8');
    expect(css).toContain('.auth-register-form .ant-form-item { margin-bottom: 24px; }');
    expect(css).toContain('.auth-register-form .ant-form-item-label { padding-bottom: 6px; }');
    expect(css).toContain('.auth-register-form .ant-form-item-label > label { height: 20px; font-size: 12px; line-height: 20px; }');
    expect(css).toContain('.auth-register-form .ant-form-item-additional { min-height: 0 !important; }');
    expect(css).toContain('.auth-register-form .ant-form-item-margin-offset { display: none; }');
    expect(css).toContain('.auth-register-form .ant-form-item-with-help .ant-form-item-explain { margin-top: 6px; }');
    expect(css).toContain('.auth-register-form .ant-form-item-explain-error { font-size: 12px; line-height: 20px; }');
    expect(css).toContain('.auth-entry-card .auth-register-form .ant-btn-primary { margin-top: 0; }');
  });

  it.each(['zh-CN', 'en-US'])('keeps registration errors independent and raw drafts local through a locale change from %s', async locale => {
    const registerRequest = vi.fn(() => HttpResponse.json({ success: false, code: '10401', data: null }));
    server.use(http.post('/api/auth/register', registerRequest));
    await act(async () => { await i18n.changeLanguage(locale); });
    renderRegister();
    const user = userEvent.setup();
    const errorKeys = ['fields.usernameRequired', 'fields.nicknameRequired', 'fields.emailRequired', 'fields.passwordLength'] as const;
    await user.click(screen.getByRole('button', { name: i18n.t('register.submit', { ns: 'auth' }) }));
    for (const key of errorKeys) {
      expect(await screen.findByText(i18n.t(key, { ns: 'auth' }))).toBeInTheDocument();
    }
    const username = screen.getByLabelText(i18n.t('fields.username', { ns: 'auth' }));
    await user.type(username, '<raw username>');
    await waitFor(() => expect(screen.queryByText(i18n.t('fields.usernameRequired', { ns: 'auth' }))).not.toBeInTheDocument());
    await act(async () => { await i18n.changeLanguage(locale === 'zh-CN' ? 'en-US' : 'zh-CN'); });
    for (const key of errorKeys.slice(1)) {
      expect(await screen.findByText(i18n.t(key, { ns: 'auth' }))).toBeInTheDocument();
    }
    expect(username).toHaveValue('<raw username>');
    const email = screen.getByLabelText(i18n.t('fields.email', { ns: 'auth' }));
    await user.type(email, '<invalid email>');
    expect(screen.getByText(i18n.t('fields.emailRequired', { ns: 'auth' }))).toBeInTheDocument();
    const password = screen.getByLabelText(i18n.t('fields.password', { ns: 'auth' }));
    await user.type(password, '<raw secret>');
    await waitFor(() => expect(screen.queryByText(i18n.t('fields.passwordLength', { ns: 'auth' }))).not.toBeInTheDocument());
    expect(password).toHaveValue('<raw secret>');
    expect(email).toHaveValue('<invalid email>');
    expect(screen.getByText(i18n.t('fields.nicknameRequired', { ns: 'auth' }))).toBeInTheDocument();
    expect(registerRequest).not.toHaveBeenCalled();
  });

  it.each(['zh-CN', 'en-US'])('keeps the registration password raw with a keyboard toggle from %s', async locale => {
    await act(async () => { await i18n.changeLanguage(locale); });
    renderRegister(); const user = userEvent.setup();
    const password = screen.getByLabelText(locale === 'zh-CN' ? '密码' : 'Password');
    await user.type(password, '<raw secret>'); await user.tab();
    expect(screen.getByRole('button', { name: locale === 'zh-CN' ? '显示密码' : 'Show password' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveFocus();
    await act(async () => { await i18n.changeLanguage(locale === 'zh-CN' ? 'en-US' : 'zh-CN'); });
    expect(password).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: locale === 'zh-CN' ? 'Hide password' : '隐藏密码' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('<raw secret>');
    expect(screen.queryByRole('img', { name: /eye/ })).not.toBeInTheDocument();
  });
});
