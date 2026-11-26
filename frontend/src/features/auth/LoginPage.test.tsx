import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { i18n } from '@/shared/i18n';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { LoginPage } from './LoginPage';
import { useAuthStore } from '@/shared/auth/store';
import { AUTH_RETURN_PATH_KEY } from '@/shared/auth/returnPath';
import { LocaleProvider } from '@/shared/i18n/LocaleProvider';
import { AppearanceProvider } from '@/shared/theme/AppearanceProvider';
import { APPEARANCE_KEY } from '@/shared/theme/appearance';

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="login-target">{location.pathname}{location.search}</span>;
}

function renderLogin(initialEntry: string | { pathname: string; state?: unknown } = '/login') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LoginPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function loginSuccess(accessToken: string) {
  return http.post('/api/auth/login', () => HttpResponse.json({
    success: true,
    code: '0',
    message: '',
    data: {
      userId: 1,
      accessToken,
      refreshToken: `${accessToken}-refresh`,
      user: { id: 1, username: 'alice', nickname: '爱丽丝', email: 'alice@example.com' },
    },
    traceId: null,
  }));
}

async function submitLogin() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/用户名/), 'alice');
  await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'pass123');
  await user.click(screen.getByRole('button', { name: /登\s*录/ }));
}

describe('LoginPage', () => {
  afterEach(async () => { vi.restoreAllMocks(); await act(async () => { await i18n.changeLanguage('zh-CN'); }); });
  beforeEach(() => {
    useAuthStore.getState().clear();
    window.sessionStorage.clear();
  });

  it('renders login form with the restored help and preference header', async () => {
    renderLogin();
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('login-topbar');
    await waitFor(() => expect(within(header).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/workspaces', '/help']));
    expect(within(header).getByRole('link', { name: '帮助中心' })).toHaveAttribute('target', '_blank');
    expect(within(header).getByRole('button', { name: '切换语言' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: '切换外观' })).toBeInTheDocument();
    expect(within(header).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByLabelText(/用户名/)).toBeInTheDocument();
    expect(screen.getByLabelText(/密码/, { selector: 'input' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '去注册' })).toHaveAttribute('href', '/register');
    expect(screen.getByText('没有账号？')).toBeInTheDocument();
  });

  it('renders login form', () => {
    renderLogin();
    expect(screen.getAllByRole('button', { name: '切换外观' })).toHaveLength(1);
    expect(screen.getByLabelText(/用户名/)).toBeInTheDocument();
    expect(screen.getByLabelText(/密码/, { selector: 'input' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
  });

  it('opens the pending review dialog with administrator contacts without signing in', async () => {
    server.use(http.post('/api/auth/login', () => HttpResponse.json({
      success: false,
      code: '37012',
      message: '新用户注册请联系管理员审核后登录',
      data: {
        administratorContacts: [{ nickname: '周宁', email: 'zhou@example.com' }],
      },
      traceId: null,
    })));

    renderLogin();
    await submitLogin();

    expect(await screen.findByText('待审核')).toBeInTheDocument();
    expect(screen.getByText('zhou@example.com')).toBeInTheDocument();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(screen.getByTestId('login-target')).toHaveTextContent('/login');
  });

  it('returns to the guarded in-site page after a successful login', async () => {
    server.use(loginSuccess('acc-return'));

    renderLogin({
      pathname: '/login',
      state: { from: { pathname: '/workitems/53006', search: '?tab=discussion', hash: '' } },
    });
    await submitLogin();

    await waitFor(() => {
      expect(screen.getByTestId('login-target')).toHaveTextContent('/workitems/53006?tab=discussion');
    });
  });

  it('rejects a cross-site return path and lands on the workspace select page', async () => {
    window.sessionStorage.setItem(AUTH_RETURN_PATH_KEY, '//evil.example.com/steal');
    server.use(loginSuccess('acc-safe'));

    renderLogin();
    await submitLogin();

    await waitFor(() => {
      expect(screen.getByTestId('login-target')).toHaveTextContent('/workspaces');
    });
    expect(window.sessionStorage.getItem(AUTH_RETURN_PATH_KEY)).toBeNull();
  });

  it.each(['zh-CN', 'en-US'])('renders trailing required marks and separates the registration prompt from its link in %s', async locale => {
    await act(async () => { await i18n.changeLanguage(locale); });
    renderLogin();
    const chinese = locale === 'zh-CN';
    for (const name of chinese ? ['用户名', '密码'] : ['Username', 'Password']) {
      const input = screen.getByLabelText(new RegExp(`^${name}\\*?$`));
      expect(input).toHaveAccessibleName(name);
      const label = input.closest('.ant-form-item')!.querySelector('label')!;
      const mark = label.querySelector('.auth-login-required');
      expect(mark).toHaveTextContent('*');
      expect(mark).toHaveAttribute('aria-hidden', 'true');
      expect(label.firstChild?.textContent).toBe(name);
      expect(input).toHaveAttribute('aria-required', 'true');
    }
    const link = screen.getByRole('link', { name: chinese ? '去注册' : 'Sign up' });
    expect(link).toHaveAttribute('href', '/register');
    expect(link.parentElement).toHaveTextContent(chinese ? '没有账号？去注册' : 'No account? Sign up');
    expect(link.previousSibling?.textContent).toBe(chinese ? '没有账号？' : 'No account? ');
    expect(screen.getByRole('heading', { name: chinese ? '登录' : 'Sign in' }).closest('.ant-card')).toHaveClass('ant-card-bordered');
  });

  it('keeps the prototype card, hint spacing, required mark and footer rules stronger than Ant Design defaults', () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'AuthEntryShell.css'), 'utf8');
    expect(css).toContain('.login-entry-form .auth-entry-card { border: 1px solid var(--aw-border); box-shadow: var(--aw-shadow-modal); }');
    expect(css).toContain('.auth-entry-card .auth-login-form { margin-top: 20px; }');
    expect(css).toContain('.auth-login-form .auth-login-required { margin-left: 2px; color: var(--aw-error); font-family: inherit; font-size: 12px; line-height: 20px; }');
    expect(css).toContain('.auth-login-form .auth-entry-link { color: var(--aw-text-3); font-size: 12px; line-height: 20px; }');
  });

  it('declares a 400px flex basis and shrinkable full-width card in the shared shell CSS', () => {
    // CSS contract only: jsdom cannot verify rendered width or viewport overflow.
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'AuthEntryShell.css'), 'utf8');
    const form = css.match(/\.login-entry-form\s*\{([^}]+)\}/)?.[1];
    const card = css.match(/\.auth-entry-card\s*\{([^}]+)\}/)?.[1];
    expect(form).toMatch(/(?:^|;)\s*flex:\s*0\s+1\s+400px\s*;/);
    expect(form).toMatch(/(?:^|;)\s*width:\s*400px\s*;/);
    expect(form).toMatch(/(?:^|;)\s*max-width:\s*100%\s*;/);
    expect(form).toMatch(/(?:^|;)\s*min-width:\s*0\s*;/);
    expect(card).toMatch(/(?:^|;)\s*width:\s*100%\s*;/);
    const subtitle = css.match(/\.auth-entry-subtitle\s*\{([^}]+)\}/)?.[1];
    expect(subtitle).toMatch(/(?:^|;)\s*margin:\s*0\s+0\s+22px\s*;/);
    expect(css).toContain('.login-topbar-right { margin-left: auto; display: flex; align-items: center; gap: 2px; flex-shrink: 0; }');
    expect(css).toContain('.login-topbar-right .ant-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; color: var(--aw-text-3); font-size: 16px; }');
    expect(css).toContain('.login-topbar-right .ant-btn:hover { background: var(--aw-gray-bg); color: var(--aw-text); }');
  });

  it.each(['zh-CN', 'en-US'])('keeps only the original help, language and appearance controls in header order in %s', async locale => {
    await act(async () => { await i18n.changeLanguage(locale); });
    renderLogin();
    const header = screen.getByRole('banner');
    const actions = header.querySelector('.login-topbar-right');
    expect(actions).toBeInTheDocument();
    expect(Array.from(actions!.children).map(element => element.getAttribute('aria-label'))).toEqual([
      i18n.t('shared:help'), i18n.t('common:language.switch'), i18n.t('common:appearance.switch'),
    ]);
    const help = within(header).getByRole('link', { name: i18n.t('shared:help') });
    expect(help).toHaveAttribute('href', '/help');
    expect(help).toHaveAttribute('target', '_blank');
    expect(help).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(header).getAllByRole('button')).toHaveLength(2);
  });

  it('switches language and all appearance modes from the unauthenticated header without losing drafts or writing business data', async () => {
    const saved = ['aw.locale', APPEARANCE_KEY].map(key => [key, localStorage.getItem(key)] as const);
    const businessWrite = vi.fn(() => HttpResponse.json({ success: true, data: null }));
    server.use(http.post('/api/auth/login', businessWrite), http.put('*', businessWrite));
    localStorage.setItem('aw.locale', 'zh-CN');
    localStorage.setItem(APPEARANCE_KEY, 'light');
    try {
      render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LocaleProvider><AppearanceProvider accent="#0064C8"><MemoryRouter><LoginPage /></MemoryRouter></AppearanceProvider></LocaleProvider>
      </QueryClientProvider>);
      const user = userEvent.setup();
      const username = screen.getByLabelText(/^用户名\*?$/);
      const password = screen.getByLabelText(/^密码\*?$/);
      await user.type(username, '<raw draft>');
      await user.type(password, '<raw secret>');
      const header = screen.getByRole('banner');
      await user.click(within(header).getByRole('button', { name: '切换语言' }));
      await user.click(await screen.findByRole('menuitem', { name: 'English' }));
      await waitFor(() => expect(within(header).getByRole('button', { name: 'Switch language' })).toBeInTheDocument());
      expect(document.documentElement.lang).toBe('en-US');
      expect(localStorage.getItem('aw.locale')).toBe('en-US');
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
      for (const mode of ['dark', 'light', 'system'] as const) {
        await user.click(within(header).getByRole('button', { name: i18n.t('common:appearance.switch') }));
        await user.click(await screen.findByRole('menuitem', { name: i18n.t(`common:appearance.${mode}`) }));
        await waitFor(() => expect(localStorage.getItem(APPEARANCE_KEY)).toBe(mode));
        expect(document.documentElement.dataset.appearance).toBe(mode === 'dark' ? 'dark' : 'light');
      }
      await user.click(within(header).getByRole('button', { name: 'Switch language' }));
      await user.click(await screen.findByRole('menuitem', { name: '中文' }));
      await waitFor(() => expect(within(header).getByRole('button', { name: '切换语言' })).toBeInTheDocument());
      expect(localStorage.getItem('aw.locale')).toBe('zh-CN');
      expect(username).toHaveValue('<raw draft>');
      expect(password).toHaveValue('<raw secret>');
      expect(businessWrite).not.toHaveBeenCalled();
    } finally {
      for (const [key, value] of saved) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    }
  });

  it('lets the reduced-motion rule override the animated track selector', () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'AuthEntryShell.css'), 'utf8');
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.login-flow\s+\.flow-track\s+\.flow-track-current\s*\{\s*animation:\s*none;\s*stroke-dasharray:\s*none;/);
  });

  it('scopes the 6px help and 24px field spacing without relying on the footer element type', () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'AuthEntryShell.css'), 'utf8');
    expect(css).toContain('.auth-login-form .ant-form-item { margin-bottom: 24px; }');
    expect(css).toContain('.auth-login-form .ant-form-item-label { padding-bottom: 6px; }');
    expect(css).toContain('.auth-login-form .ant-form-item-with-help .ant-form-item-explain { margin-top: 6px; }');
    expect(css).toContain('.auth-login-form .ant-form-item-explain-error { font-size: 12px; line-height: 20px; }');
    expect(css).toContain('.auth-login-form .auth-login-submit { margin-bottom: 16px; }');
    expect(css).not.toContain('.ant-form-item:last-of-type');
    renderLogin();
    expect(screen.getByRole('button', { name: /登\s*录/ }).closest('.ant-form-item')).toHaveClass('auth-login-submit');
  });

  it.each(['zh-CN', 'en-US'])('keeps empty-submit errors and raw drafts local through a locale change from %s', async locale => {
    const loginRequest = vi.fn(() => HttpResponse.json({ success: false, code: '10401', data: null }));
    server.use(http.post('/api/auth/login', loginRequest));
    await act(async () => { await i18n.changeLanguage(locale); });
    renderLogin();
    const user = userEvent.setup();
    const chinese = locale === 'zh-CN';
    const title = screen.getByRole('heading', { name: chinese ? '登录' : 'Sign in' });
    // 没有企业连接时，本地账号表单不需要分组标签，卡片标题直接衔接表单。
    expect(title.closest('.auth-entry-card')?.querySelector('.auth-login-form')).toBeInTheDocument();
    expect(screen.queryByText(chinese ? '使用 AutoWonder 账号登录' : 'Sign in with an AutoWonder account')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: chinese ? '登录' : 'Sign in' }));
    expect(await screen.findByText(chinese ? '请输入用户名' : 'Enter your username')).toBeInTheDocument();
    expect(await screen.findByText(chinese ? '请输入密码' : 'Enter your password')).toBeInTheDocument();
    await user.type(screen.getByLabelText(chinese ? /^用户名\*?$/ : /^Username\*?$/), '<raw draft>');
    await waitFor(() => expect(screen.queryByText(chinese ? '请输入用户名' : 'Enter your username')).not.toBeInTheDocument());
    expect(screen.getByText(chinese ? '请输入密码' : 'Enter your password')).toBeInTheDocument();
    await act(async () => { await i18n.changeLanguage(chinese ? 'en-US' : 'zh-CN'); });
    expect(await screen.findByText(chinese ? 'Enter your password' : '请输入密码')).toBeInTheDocument();
    expect(screen.getByLabelText(chinese ? /^Username\*?$/ : /^用户名\*?$/)).toHaveValue('<raw draft>');
    await user.type(screen.getByLabelText(chinese ? /^Password\*?$/ : /^密码\*?$/), '<raw secret>');
    await waitFor(() => expect(screen.queryByText(chinese ? 'Enter your password' : '请输入密码')).not.toBeInTheDocument());
    expect(screen.getByLabelText(chinese ? /^Password\*?$/ : /^密码\*?$/)).toHaveValue('<raw secret>');
    expect(loginRequest).not.toHaveBeenCalled();
  });

  it('keeps the pending submit action localized and raw failure readable through an in-flight language change', async () => {
    let release!: () => void; let started = false;
    const pending = new Promise<void>(resolve => { release = resolve; });
    server.use(http.post('/api/auth/login', async () => { started = true; await pending; return HttpResponse.json({ success: false, code: '10401', message: '<raw 登录错误>', data: null }); }));
    renderLogin(); const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^用户名\*?$/), 'raw user');
    await user.type(screen.getByLabelText(/^密码\*?$/), 'raw secret');
    await user.click(screen.getByRole('button', { name: /登\s*录/ }));
    await waitFor(() => expect(started).toBe(true));
    // Finish the fake request even when a pending-state assertion fails.
    try {
      expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: 'loading' })).not.toBeInTheDocument();
      await act(async () => { await i18n.changeLanguage('en-US'); });
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
      expect(screen.getByLabelText(/^Password\*?$/)).toHaveValue('raw secret');
    } finally { await act(async () => { release(); }); }
    expect(await screen.findByText('<raw 登录错误>')).toBeInTheDocument();
  });

  it.each(['zh-CN', 'en-US'])('keeps the raw password and keyboard toggle through live locale changes from %s', async locale => {
    const errors = vi.spyOn(console, 'error');
    await act(async () => { await i18n.changeLanguage(locale); });
    renderLogin(); const user = userEvent.setup();
    const password = screen.getByLabelText(locale === 'zh-CN' ? /^密码\*?$/ : /^Password\*?$/);
    await act(async () => { await user.type(password, '<raw secret>'); });
    await act(async () => { await user.tab(); });
    const show = screen.getByRole('button', { name: locale === 'zh-CN' ? '显示密码' : 'Show password' });
    expect(show).toHaveFocus();
    await act(async () => { await user.keyboard('{Enter}'); });
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('<raw secret>');
    expect(password).toHaveFocus();
    await act(async () => { await i18n.changeLanguage(locale === 'zh-CN' ? 'en-US' : 'zh-CN'); });
    expect(screen.getByLabelText(locale === 'zh-CN' ? /^Password\*?$/ : /^密码\*?$/)).toBe(password);
    const hide = screen.getByRole('button', { name: locale === 'zh-CN' ? 'Hide password' : '隐藏密码' });
    expect(password).toHaveFocus();
    await act(async () => { await user.tab(); });
    expect(hide).toHaveFocus();
    await act(async () => { await user.keyboard('{Enter}'); });
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('<raw secret>');
    expect(screen.queryByRole('img', { name: /eye|user|lock/ })).not.toBeInTheDocument();
    expect(errors.mock.calls.filter(args => args.some(value => typeof value === 'string' && (value.includes('not wrapped in act') || value.includes('not configured to support act'))))).toHaveLength(0);
  });

  it('shows the platform introduction and delivery diagram', () => {
    renderLogin();
    expect(screen.getByText('AI Native SDLC Platform')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /软件产品\s*自动交付平台/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByText('数字员工小队按 SDLC 流程接力交付：需求澄清、开发、验证到发布，门禁与审计全程可追溯。')).toBeInTheDocument();
    expect(screen.queryByText('继续推进你的自主交付工作台')).not.toBeInTheDocument();
    expect(screen.queryByText('上手步骤')).not.toBeInTheDocument();
    const diagram = screen.getByRole('figure', { name: /软件自动交付流程示意/ });
    expect(within(diagram).queryAllByRole('img')).toHaveLength(0);
    const nodes = within(diagram).getAllByRole('listitem');
    expect(nodes.map((item) => item.querySelector('.flow-label')!.textContent)).toEqual([
      '需求澄清', '启动', '开发', '验证', '评审', '部署', '测试', '交付',
    ]);
    expect(nodes.map(item => item.classList.contains('flow-node--hot'))).toEqual([
      false, false, true, true, true, true, true, false,
    ]);
    expect(nodes.map(item => [item.style.gridColumn, item.style.gridRow])).toEqual([
      ['1', '1'], ['2', '1'], ['3', '1'], ['4', '1'], ['4', '2'], ['3', '2'], ['2', '2'], ['1', '2'],
    ]);
    const base = diagram.querySelector('.flow-track-base');
    const current = diagram.querySelector('.flow-track-current');
    expect(base?.getAttribute('d')).toMatch(/ Z$/);
    expect(current).toHaveAttribute('d', base!.getAttribute('d'));
    expect(current).toHaveAttribute('pathLength', '100');
    expect(diagram.querySelector('.flow-arrow')).not.toBeInTheDocument();
    expect(within(diagram).getByText('持续迭代')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '暂停流程动画' })).not.toBeInTheDocument();
  });

  it('calls login API and stores authenticated user on success', async () => {
    server.use(
      http.post('/api/auth/login', () => {
        return HttpResponse.json({
          success: true,
          code: '0',
          message: '',
          data: {
            userId: 1,
            accessToken: 'acc-1',
            refreshToken: 'ref-1',
            user: {
              id: 1,
              username: 'caihe',
              nickname: '蔡何',
              email: 'caihe@example.com',
            },
          },
          traceId: null,
        });
      }),
    );

    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/用户名/), 'alice');
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'pass123');
    await user.click(screen.getByRole('button', { name: /登\s*录/ }));

    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBe('acc-1');
    });
    expect(useAuthStore.getState().user).toEqual({
      id: 1,
      username: 'caihe',
      nickname: '蔡何',
      email: 'caihe@example.com',
    });
  });

  it('shows error message on login failure', async () => {
    server.use(
      http.post('/api/auth/login', () => {
        return HttpResponse.json({
          success: false,
          code: '10401',
          message: '用户名或密码错误',
          data: null,
          traceId: 'trace-x',
        });
      }),
    );

    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/用户名/), 'bob');
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'wrong');
    await user.click(screen.getByRole('button', { name: /登\s*录/ }));

    await waitFor(() => {
      expect(screen.getByText(/用户名或密码错误/)).toBeInTheDocument();
    });
  });

  it('shows backend message when login fails with HTTP 401', async () => {
    server.use(
      http.post('/api/auth/login', () => {
        return HttpResponse.json({
          success: false,
          code: '10401',
          message: '用户名或密码错误',
          data: null,
          traceId: 'trace-y',
        }, { status: 401 });
      }),
    );

    renderLogin();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/用户名/), 'bob');
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'wrong');
    await user.click(screen.getByRole('button', { name: /登\s*录/ }));

    await waitFor(() => {
      expect(screen.getByText(/用户名或密码错误/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/未登录或登录已失效/)).not.toBeInTheDocument();
  });

  it('lists enabled enterprise connections as link entries above the local form', async () => {
    server.use(
      http.get('/api/auth/sso/providers', () => {
        return HttpResponse.json({
          success: true,
          code: '0',
          message: '',
          traceId: null,
          data: [
            { providerId: 3, name: '企业 ADFS', protocol: 'SAML2', idpName: 'adfs.corp.example' },
            { providerId: 5, name: 'Contoso', protocol: 'OIDC', idpName: 'entra.example' },
          ],
        });
      }),
    );

    renderLogin();

    const first = await screen.findByRole('link', { name: '使用企业 ADFS登录' });
    expect(first.closest('.auth-entry-card')?.parentElement).toHaveClass('login-entry-form');
    expect(first).toHaveAttribute('href', '/api/auth/sso/3/start');
    expect(screen.getByRole('link', { name: '使用Contoso登录' })).toHaveAttribute('href', '/api/auth/sso/5/start');
    expect(screen.getByText('选择公司的身份系统登录 AutoWonder')).toBeInTheDocument();
    expect(screen.getByText('或')).toBeInTheDocument();
    // 本地账号标签与表单是一组：位于「或」分隔线之后、紧贴表单，而不是卡片标题下。
    expect(screen.getAllByText('使用 AutoWonder 账号登录')).toHaveLength(1);
    const localHint = screen.getByText('使用 AutoWonder 账号登录');
    expect(localHint).toHaveClass('auth-entry-hint');
    expect(localHint).toHaveClass('auth-local-hint');
    expect(localHint.previousElementSibling?.lastElementChild).toHaveClass('auth-divider-or');
    expect(localHint.nextElementSibling).toHaveClass('auth-login-form');
    expect(screen.queryByRole('heading', { name: '使用 AutoWonder 账号登录' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByLabelText(/用户名/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
  });

  it('hides the enterprise section and keeps the local form when no connection is enabled', async () => {
    let providersFetched = false;
    let loginCalled = false;
    server.use(
      http.get('/api/auth/sso/providers', () => {
        providersFetched = true;
        return HttpResponse.json({ success: true, code: '0', message: '', traceId: null, data: [] });
      }),
      http.post('/api/auth/login', () => {
        loginCalled = true;
        return HttpResponse.json({
          success: true,
          code: '0',
          message: '',
          traceId: null,
          data: {
            userId: 1,
            accessToken: 'acc-2',
            refreshToken: 'ref-2',
            user: { id: 1, username: 'bob', nickname: '鲍勃', email: 'bob@example.com' },
          },
        });
      }),
    );

    renderLogin();

    expect(await screen.findByLabelText(/用户名/)).toBeInTheDocument();
    await waitFor(() => expect(providersFetched).toBe(true));
    expect(screen.getByLabelText(/用户名/).closest('.auth-entry-card')?.parentElement).toHaveClass('login-entry-form');
    expect(screen.queryByText('选择公司的身份系统登录 AutoWonder')).not.toBeInTheDocument();
    // 无企业连接时连本地账号标签一起隐藏，避免标题与表单之间出现多余说明。
    expect(screen.queryByText('使用 AutoWonder 账号登录')).not.toBeInTheDocument();
    expect(screen.queryByText('或')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/用户名/), 'bob');
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'pass123');
    await user.click(screen.getByRole('button', { name: /登\s*录/ }));

    await waitFor(() => expect(loginCalled).toBe(true));
    expect(useAuthStore.getState().accessToken).toBe('acc-2');
  });

  it('keeps the local login usable when the enabled connections cannot be loaded', async () => {
    let providersFetched = false;
    let loginCalled = false;
    server.use(
      http.get('/api/auth/sso/providers', () => {
        providersFetched = true;
        return HttpResponse.json(
          { success: false, code: '10002', message: '服务暂时不可用', data: null, traceId: null },
          { status: 500 },
        );
      }),
      http.post('/api/auth/login', () => {
        loginCalled = true;
        return HttpResponse.json({
          success: true,
          code: '0',
          message: '',
          traceId: null,
          data: {
            userId: 1,
            accessToken: 'acc-3',
            refreshToken: 'ref-3',
            user: { id: 1, username: 'bob', nickname: '鲍勃', email: 'bob@example.com' },
          },
        });
      }),
    );

    renderLogin();

    await waitFor(() => expect(providersFetched).toBe(true));
    expect(screen.queryByText('选择公司的身份系统登录 AutoWonder')).not.toBeInTheDocument();
    expect(screen.queryByText('服务暂时不可用')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/用户名/), 'bob');
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'pass123');
    await user.click(screen.getByRole('button', { name: /登\s*录/ }));

    await waitFor(() => expect(loginCalled).toBe(true));
    expect(useAuthStore.getState().accessToken).toBe('acc-3');
  });
});
