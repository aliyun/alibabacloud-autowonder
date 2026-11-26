import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { message } from 'antd';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { server } from '@/test/mocks/server';
import { MailSettingsPanel } from './MailSettingsPanel';

function ok<T>(data: T) {
  return { success: true, code: '0', message: '', traceId: null, data };
}

function settings(overrides: Record<string, unknown> = {}) {
  return {
    host: 'smtp.example.com',
    port: 587,
    security: 'STARTTLS',
    fromAddress: 'noreply@example.com',
    fromName: 'AutoWonder',
    authMode: 'PASSWORD',
    username: 'noreply@example.com',
    secretConfigured: true,
    activeConfigured: true,
    draftVersion: 3,
    activeVersion: 2,
    tested: true,
    testSuccess: true,
    testedAt: '2026-11-11T10:00:00Z',
    testResult: null,
    activeTested: true,
    ...overrides,
  };
}

function policy(overrides: Record<string, unknown> = {}) {
  return {
    verificationEnabled: true,
    forceExistingEnabled: false,
    suffixRestrictionEnabled: false,
    allowedSuffixes: ['example.com'],
    verificationEnabledAt: '2026-11-01T00:00:00Z',
    version: 4,
    mailSettingsTested: true,
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MailSettingsPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MailSettingsPanel', () => {
  beforeEach(() => {
    message.destroy();
  });

  afterEach(() => {
    // antd message 的容器由 rc-notification 持有，直接清空 body 会让它在下次移除时
    // 找不到节点；统一用各库提供的销毁入口，避免卸载后残留异步 DOM 操作。
    cleanup();
    message.destroy();
  });

  it('loads and renders the current mail settings', async () => {
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
    );
    renderPanel();

    await waitFor(() => expect(screen.getByLabelText('SMTP 服务器')).toHaveValue('smtp.example.com'));
    expect(screen.getByLabelText('端口')).toHaveValue(587);
    expect(screen.getByLabelText('发件地址')).toHaveValue('noreply@example.com');
    expect(screen.getByText('生效配置已测试')).toBeInTheDocument();
  });

  it('hides credential fields when the relay needs no authentication', async () => {
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
    );
    renderPanel();
    await screen.findByDisplayValue('smtp.example.com');

    await userEvent.click(screen.getByText('无需认证（内部中继）'));

    await waitFor(() => expect(screen.queryByLabelText('认证账号')).not.toBeInTheDocument());
    expect(screen.getByText('密码／SMTP 授权码')).toBeInTheDocument();
  });

  it('warns about unencrypted relays', async () => {
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
    );
    renderPanel();
    await screen.findByDisplayValue('smtp.example.com');

    await userEvent.click(screen.getByText('不加密'));

    expect(await screen.findByText(/仅适用于可信内部网络/)).toBeInTheDocument();
  });

  it('saves the draft with the expected version', async () => {
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
      http.put('/api/platform/mail-settings', async ({ request }) => {
        const body = await request.json() as { expectedVersion?: number };
        return HttpResponse.json(ok(settings({ expectedVersion: body.expectedVersion })));
      }),
    );
    renderPanel();
    const host = await screen.findByDisplayValue('smtp.example.com');
    await userEvent.clear(host);
    const saveButton = screen.getByRole('button', { name: '保存配置' });
    await userEvent.click(saveButton);

    await waitFor(() => expect(screen.getByRole('button', { name: '保存配置' })).toBeEnabled());
  });

  it('asks for confirmation before disabling verification', async () => {
    let putBody: Record<string, unknown> | null = null;
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
      http.put('/api/platform/email-verification/policy', async ({ request }) => {
        putBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json(ok(policy({ verificationEnabled: false })));
      }),
    );
    renderPanel();

    const verificationSwitch = await screen.findByRole('switch', { name: '邮箱验证码' });
    await waitFor(() => expect(verificationSwitch).toBeChecked());
    await userEvent.click(verificationSwitch);

    expect(await screen.findByText('关闭邮箱验证？')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认关闭' })).toHaveClass('ant-btn-dangerous');
    await userEvent.click(screen.getByRole('button', { name: '确认关闭' }));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody).toMatchObject({
      verificationEnabled: false,
      confirmDisableVerification: true,
      expectedVersion: 4,
    });
  });

  it('requires verification before the existing-user switch can be enabled', async () => {
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy({
        verificationEnabled: false,
      })))),
    );
    renderPanel();

    const forceSwitch = await screen.findByRole('switch', { name: '强制存量用户验证邮箱' });
    expect(forceSwitch).toBeDisabled();
  });

  it('confirms before restricting unverified users immediately', async () => {
    let putBody: Record<string, unknown> | null = null;
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
      http.put('/api/platform/email-verification/policy', async ({ request }) => {
        putBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json(ok(policy({ forceExistingEnabled: true })));
      }),
    );
    renderPanel();

    const forceSwitch = await screen.findByRole('switch', { name: '强制存量用户验证邮箱' });
    await waitFor(() => expect(forceSwitch).toBeEnabled());
    await userEvent.click(forceSwitch);

    expect(await screen.findByText('确认立即限制所有未验证用户？')).toBeInTheDocument();
    expect(screen.getByText('此操作影响全部存量账号，请确认已通知相关用户并确认邮件通道可用。')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '确认开启，立即生效' }));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody).toMatchObject({ forceExistingEnabled: true, expectedVersion: 4 });
  });

  it('falls back to safe defaults when optional settings are empty', async () => {
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings({
        host: null,
        port: null,
        security: null,
        fromAddress: null,
        fromName: null,
        authMode: null,
        username: null,
      })))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
    );
    renderPanel();

    await waitFor(() => expect(screen.getByLabelText('端口')).toHaveValue(587));
    expect(screen.getByLabelText('SMTP 服务器')).toHaveValue('');
    expect(screen.getByLabelText('认证账号')).toHaveValue('');
    expect(screen.getByText('STARTTLS')).toBeInTheDocument();
  });

  it('reports a load failure for the settings card', async () => {
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(
        { success: false, code: '10000', message: 'boom', traceId: null, data: null }, { status: 500 })),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
    );
    renderPanel();

    expect(await screen.findByText('保存失败，请检查配置')).toBeInTheDocument();
  });

  it('sends a test email and shows the result', async () => {
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
      http.post('/api/platform/mail-settings/test', () => HttpResponse.json(ok({
        success: true,
        failureCode: null,
        fingerprint: 'fp',
        testedAt: '2026-11-12T00:00:00Z',
        settings: settings(),
      }))),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByLabelText('SMTP 服务器')).toHaveValue('smtp.example.com'));

    await userEvent.type(screen.getByLabelText('测试收件邮箱'), 'tester@example.com');
    await userEvent.click(screen.getByRole('button', { name: '发送测试邮件' }));

    expect(await screen.findByText('测试通过')).toBeInTheDocument();
  });

  it('activates a tested draft without resubmitting its already stored password', async () => {
    let current = settings({ activeConfigured: false, activeTested: false });
    const requests: Record<string, unknown>[] = [];
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(current))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy({ verificationEnabled: false })))),
      http.post('/api/platform/mail-settings/test', async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        expect(body.password).toBe('smtp-test-secret');
        return HttpResponse.json(ok({ success: true, settings: current }));
      }),
      http.put('/api/platform/mail-settings', async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        requests.push(body);
        current = settings({ draftVersion: 4, activeConfigured: !body.password, activeTested: !body.password });
        return HttpResponse.json(ok(current));
      }),
    );
    renderPanel();
    await screen.findByDisplayValue('smtp.example.com');
    await userEvent.type(screen.getByLabelText('密码／SMTP 授权码', { selector: 'input[type="password"]' }), 'smtp-test-secret');
    await userEvent.type(screen.getByLabelText('测试收件邮箱'), 'tester@example.com');
    await userEvent.click(screen.getByRole('button', { name: '发送测试邮件' }));
    await screen.findByText('测试通过');
    await waitFor(() => expect(screen.getByRole('button', { name: '保存配置' })).toBeEnabled());
    expect(screen.getByLabelText('密码／SMTP 授权码', { selector: 'input[type="password"]' })).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await screen.findByText('生效配置已测试');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ expectedVersion: 3 });
    expect(requests[0]).not.toHaveProperty('password');
  });

  it.each(['save', 'test'] as const)('preserves a newer password typed while %s is pending and prevents overlapping operations', async operation => {
    let finish!: () => void;
    let started = false;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
      http.put('/api/platform/mail-settings', async () => { started = true; await pending; return HttpResponse.json(ok(settings())); }),
      http.post('/api/platform/mail-settings/test', async () => { started = true; await pending; return HttpResponse.json(ok({ success: true, settings: settings() })); }),
    );
    renderPanel();
    await screen.findByDisplayValue('smtp.example.com');
    const password = screen.getByLabelText('密码／SMTP 授权码', { selector: 'input[type="password"]' });
    await userEvent.type(password, 'submitted-secret');
    await userEvent.type(screen.getByLabelText('测试收件邮箱'), 'tester@example.com');
    await userEvent.click(screen.getByRole('button', { name: operation === 'save' ? '保存配置' : '发送测试邮件' }));
    await waitFor(() => expect(started).toBe(true));
    expect(screen.getByRole('button', { name: operation === 'save' ? '发送测试邮件' : '保存配置' })).toBeDisabled();
    await userEvent.clear(password);
    await userEvent.type(password, 'new-unsent-secret');
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: '保存配置' })).toBeEnabled());
    expect(password).toHaveValue('new-unsent-secret');
  });

  it('clears a successfully saved password before a subsequent test', async () => {
    let testBody: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
      http.put('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.post('/api/platform/mail-settings/test', async ({ request }) => {
        testBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json(ok({ success: true, settings: settings() }));
      }),
    );
    renderPanel();
    await screen.findByDisplayValue('smtp.example.com');
    await userEvent.type(screen.getByLabelText('密码／SMTP 授权码', { selector: 'input[type="password"]' }), 'saved-secret');
    await userEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存配置' })).toBeEnabled());
    expect(screen.getByLabelText('密码／SMTP 授权码', { selector: 'input[type="password"]' })).toHaveValue('');
    await userEvent.type(screen.getByLabelText('测试收件邮箱'), 'tester@example.com');
    await userEvent.click(screen.getByRole('button', { name: '发送测试邮件' }));
    await waitFor(() => expect(testBody).toBeDefined());
    expect(testBody).not.toHaveProperty('password');
  });

  it('shows enabled suffix and existing-user states together', async () => {
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy({
        suffixRestrictionEnabled: true,
        forceExistingEnabled: true,
      })))),
    );
    renderPanel();

    const forceSwitch = await screen.findByRole('switch', { name: '强制存量用户验证邮箱' });
    await waitFor(() => expect(forceSwitch).toBeEnabled());
    expect(forceSwitch).toBeChecked();
    expect(screen.getAllByText('已开启').length).toBeGreaterThanOrEqual(3);
  });

  it('adds suffix tags with Enter and removes them without restoring a cleared list', async () => {
    let saved: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
      http.put('/api/platform/email-verification/policy', async ({ request }) => {
        saved = await request.json() as Record<string, unknown>;
        return HttpResponse.json(ok(policy()));
      }),
    );
    renderPanel();
    await screen.findByDisplayValue('smtp.example.com');
    const input = screen.getByRole('combobox', { name: '允许的邮箱后缀' });
    await userEvent.type(input, ' Gmail.COM');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, which: 13 });
    expect(screen.getByTitle('@gmail.com')).toBeInTheDocument();
    await userEvent.type(input, '@gmail.com');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, which: 13 });
    expect(screen.getAllByTitle('@gmail.com')).toHaveLength(1);
    await userEvent.click(within(screen.getByTitle('@example.com')).getByLabelText('close'));
    expect(screen.queryByTitle('@example.com')).toBeNull();
    expect(screen.getByTitle('@gmail.com')).toBeInTheDocument();
    await userEvent.click(within(screen.getByTitle('@gmail.com')).getByLabelText('close'));
    await userEvent.click(screen.getByRole('button', { name: '保存后缀' }));
    await waitFor(() => expect(saved).toMatchObject({ allowedSuffixes: [] }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存后缀' })).toBeEnabled());
    expect(screen.queryByTitle('@example.com')).toBeNull();
    expect(screen.queryByTitle('@gmail.com')).toBeNull();
  });

  it('uses card-style radio options for the connection security', async () => {
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
    );
    const { container } = renderPanel();
    await waitFor(() => expect(screen.getByLabelText('SMTP 服务器')).toHaveValue('smtp.example.com'));

    expect(container.querySelector('.mail-choice-group')).not.toBeNull();
    expect(screen.getByRole('radio', { name: /STARTTLS/ })).toBeChecked();
    expect(screen.getByText(/常用端口 587/)).toBeInTheDocument();
  });

  it('switches authentication to none when the relay is unencrypted', async () => {
    let putBody: Record<string, unknown> | null = null;
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
      http.put('/api/platform/mail-settings', async ({ request }) => {
        putBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json(ok(settings()));
      }),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByLabelText('SMTP 服务器')).toHaveValue('smtp.example.com'));

    await userEvent.click(screen.getByRole('radio', { name: /不加密/ }));

    // 不加密与密码认证互斥：认证方式自动切为免认证。
    expect(screen.getByRole('radio', { name: /无需认证/ })).toBeChecked();
    expect(screen.queryByLabelText('认证账号')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody).toMatchObject({ security: 'NONE', authMode: 'NONE' });
  });

  it('restores STARTTLS when password authentication is chosen', async () => {
    server.use(
      http.get('/api/platform/mail-settings', () => HttpResponse.json(ok(settings()))),
      http.get('/api/platform/email-verification/policy', () => HttpResponse.json(ok(policy()))),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByLabelText('SMTP 服务器')).toHaveValue('smtp.example.com'));

    await userEvent.click(screen.getByRole('radio', { name: /不加密/ }));
    expect(screen.getByText(/仅适用于可信内部网络/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: '密码／SMTP 授权码' }));

    expect(screen.getByRole('radio', { name: /STARTTLS/ })).toBeChecked();
    await waitFor(() => expect(screen.queryByText(/仅适用于可信内部网络/)).not.toBeInTheDocument());
  });
});
