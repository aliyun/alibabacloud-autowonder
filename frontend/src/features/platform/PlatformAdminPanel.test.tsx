import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { message } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { ApiError } from '@/shared/types/common';
import { i18n } from '@/shared/i18n';
import { useAuthStore } from '@/shared/auth/store';
import * as adminApi from './adminApi';
import { PlatformAdminPanel } from './PlatformAdminPanel';

const ALICE = {
  userId: 10000,
  username: 'alice',
  nickname: '爱丽丝',
  email: 'alice@example.com',
  active: true,
  self: true,
  removable: false,
  removeDisabledReason: '平台管理员不可移除自己',
};

const BOB = {
  userId: 10001,
  username: 'bob',
  nickname: '鲍勃',
  email: 'bob@example.com',
  active: true,
  self: false,
  removable: true,
  removeDisabledReason: null,
};

const CAROL = {
  userId: 10002,
  username: 'carol',
  nickname: '卡罗',
  email: 'carol@example.com',
  active: true,
  self: false,
  removable: true,
  removeDisabledReason: null,
};

function ok<T>(data: T) {
  return HttpResponse.json({ success: true, code: '0', message: '', traceId: null, data });
}

function roster(admins: unknown[], canManage = true) {
  return ok({ admins, canManage });
}

const clients: QueryClient[] = [];
function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(queryClient);
  return { queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <PlatformAdminPanel />
    </QueryClientProvider>,
  ) };
}

const DAVE = { ...CAROL, userId: 10003, username: 'dave', nickname: '戴夫', email: null };
const ERIN = { ...CAROL, userId: 10004, username: 'erin', nickname: '艾琳', email: null };
const labelOf = (candidate: typeof CAROL | typeof DAVE) => `${candidate.nickname}${candidate.email ? ` (${candidate.email})` : ''}`;
const list = (admins: adminApi.PlatformAdmin[] = [ALICE, BOB], canManage = true) => ({ admins, canManage });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function openPicker() {
  await rowOf('爱丽丝');
  await userEvent.click(screen.getByRole('button', { name: '添加管理员' }));
  return screen.getByRole('combobox', { name: '搜索可添加的用户' });
}
async function choose(...candidates: (typeof CAROL | typeof DAVE)[]) {
  const picker = await openPicker();
  await userEvent.click(picker);
  for (const candidate of candidates) {
    await userEvent.click(await screen.findByText(labelOf(candidate), { selector: '.ant-select-item-option-content' }));
  }
  return picker;
}
function itemResult(label: string) {
  const results = screen.getByRole('list', { name: i18n.t('platform:adminAddResults') });
  return within(results).getByText(label).closest('li')!;
}
async function language(locale: string) {
  await act(async () => { await i18n.changeLanguage(locale); });
}

async function rowOf(text: string) {
  const row = (await screen.findByText(text)).closest('tr');
  expect(row).not.toBeNull();
  return row!;
}

function spyOnMessage(kind: 'success' | 'error') {
  return vi.spyOn(message, kind).mockImplementation(
    () => undefined as unknown as ReturnType<typeof message.success>,
  );
}

describe('PlatformAdminPanel', () => {
  afterEach(async () => {
    cleanup();
    clients.splice(0).forEach((client) => client.clear());
    vi.restoreAllMocks();
    message.destroy();
    await i18n.changeLanguage('zh-CN');
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    spyOnMessage('success');
    spyOnMessage('error');
    await i18n.changeLanguage('zh-CN');
    useAuthStore.getState().clear();
    server.use(
      http.get('/api/platform/admins', () => roster([ALICE, BOB])),
      http.get('/api/platform/admins/candidates', () => ok([])),
    );
  });

  it('shows administrator identity details in dedicated columns', async () => {
    const { container } = renderPanel();

    await rowOf('爱丽丝');

    expect(screen.getByRole('columnheader', { name: '管理员' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '登录账号' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '联系邮箱' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '账号状态' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '操作' })).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('colgroup col')).map((column) => (
      (column as HTMLElement).style.width
    ))).toEqual(['24%', '20%', '32%', '12%', '12%']);

    const aliceRow = await rowOf('爱丽丝');
    expect(Array.from(aliceRow.children).every((cell) => (
      (cell as HTMLElement).style.textAlign === ''
    ))).toBe(true);
    expect(within(aliceRow).getByText('alice')).toBeInTheDocument();
    expect(within(aliceRow).getByText('alice@example.com')).toBeInTheDocument();
    expect(within(aliceRow).getByText('正常')).toBeInTheDocument();
  });

  it('renders the roster with the caller and a deactivated admin flagged', async () => {
    server.use(
      http.get('/api/platform/admins', () => roster([
        ALICE,
        { ...BOB, active: false, email: null },
      ])),
    );

    renderPanel();

    const aliceRow = await rowOf('爱丽丝');
    expect(within(aliceRow).getByText('我')).toBeInTheDocument();
    expect(within(aliceRow).getByText('alice@example.com')).toBeInTheDocument();
    expect(within(aliceRow).queryByText('已停用')).not.toBeInTheDocument();

    const bobRow = await rowOf('鲍勃');
    expect(within(bobRow).getByText('已停用')).toBeInTheDocument();
    expect(within(bobRow).queryByText('我')).not.toBeInTheDocument();
    // A deactivated admin keeps the seat, so the panel still has to name them rather than drop
    // the row and silently disagree with the backend admin count.
    expect(within(bobRow).getByText('-')).toBeInTheDocument();
  });

  it('disables removing yourself and explains why', async () => {
    const user = userEvent.setup();
    renderPanel();

    const aliceRow = await rowOf('爱丽丝');
    const selfRemove = within(aliceRow).getByRole('button', { name: '移除' });
    expect(selfRemove).toBeDisabled();

    await user.hover(selfRemove.parentElement!);
    expect(await screen.findByText('平台管理员不可移除自己')).toBeInTheDocument();

    const bobRow = await rowOf('鲍勃');
    expect(within(bobRow).getByRole('button', { name: '移除' })).toBeEnabled();
  });

  it('disables the only removal left and explains the one-admin rule', async () => {
    const user = userEvent.setup();
    server.use(http.get('/api/platform/admins', () => roster([{
      ...BOB,
      removable: false,
      removeDisabledReason: '平台管理员至少保留一名，无法移除最后一名',
    }])));

    renderPanel();

    const bobRow = await rowOf('鲍勃');
    const removeButton = within(bobRow).getByRole('button', { name: '移除' });
    expect(removeButton).toBeDisabled();

    await user.hover(removeButton.parentElement!);
    expect(await screen.findByText('平台管理员至少保留一名，无法移除最后一名')).toBeInTheDocument();
  });

  it('removes another admin after confirmation and reuses the roster the write returned', async () => {
    const user = userEvent.setup();
    const success = spyOnMessage('success');
    let deletedPath = '';
    server.use(
      http.delete('/api/platform/admins/:userId', ({ request }) => {
        deletedPath = new URL(request.url).pathname;
        // The write response already carries the refreshed roster, so no second GET is needed.
        return roster([ALICE]);
      }),
    );

    renderPanel();

    const bobRow = await rowOf('鲍勃');
    await user.click(within(bobRow).getByRole('button', { name: '移除' }));
    await user.click(await screen.findByRole('button', { name: '确定移除' }));

    await waitFor(() => expect(deletedPath).toBe('/api/platform/admins/10001'));
    await waitFor(() => expect(success).toHaveBeenCalledWith('已移除平台管理员'));
    await waitFor(() => expect(screen.queryByText('鲍勃')).not.toBeInTheDocument());
    expect(await rowOf('爱丽丝')).not.toBeNull();
  });

  it('searches candidates and adds the selected user', async () => {
    const user = userEvent.setup();
    const success = spyOnMessage('success');
    const keywords: string[] = [];
    let addedBody: unknown = null;
    server.use(
      http.get('/api/platform/admins/candidates', ({ request }) => {
        const keyword = new URL(request.url).searchParams.get('keyword') ?? '';
        keywords.push(keyword);
        return ok(keyword === 'carol' ? [CAROL] : []);
      }),
      http.post('/api/platform/admins', async ({ request }) => {
        addedBody = await request.json();
        return roster([ALICE, BOB, CAROL]);
      }),
    );

    renderPanel();

    await rowOf('爱丽丝');
    await user.click(screen.getByRole('button', { name: '添加管理员' }));
    await user.type(screen.getByRole('combobox', { name: '搜索可添加的用户' }), 'carol');
    await user.click(await screen.findByText('卡罗 (carol@example.com)'));
    await user.click(screen.getByRole('button', { name: '添加 1 人' }));

    await waitFor(() => expect(addedBody).toEqual({ userId: 10002 }));
    expect(keywords).toContain('carol');
    await waitFor(() => expect(success).toHaveBeenCalledWith('已添加平台管理员'));
    // The Select option in the portal also renders 卡罗 while it is still open, so only matches
    // inside a table row count as the roster actually gaining the new admin.
    await waitFor(() => {
      const rows = screen.getAllByText('卡罗').map((node) => node.closest('tr')).filter(Boolean);
      expect(rows.length).toBe(1);
    });
  });

  it('enables the entry but disables empty confirmation and gates candidate reads on the modal', async () => {
    let reads = 0;
    server.use(http.get('/api/platform/admins/candidates', () => { reads++; return ok([]); }));
    renderPanel();
    await rowOf('爱丽丝');
    expect(screen.getByRole('button', { name: '添加管理员' })).toBeEnabled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(reads).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: '添加管理员' }));
    expect(await screen.findByRole('dialog', { name: '添加管理员' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加 0 人' })).toBeDisabled();
    const picker = screen.getByRole('combobox', { name: '搜索可添加的用户' });
    expect(picker).toBeEnabled();
    await waitFor(() => expect(picker).toHaveFocus());
    await waitFor(() => expect(reads).toBe(1));
  });

  it('keeps every control disabled for a caller who is not a platform admin', async () => {
    const user = userEvent.setup();
    let candidateRequests = 0;
    const writeHandler = vi.fn();
    server.use(
      http.get('/api/platform/admins', () => roster([ALICE, BOB], false)),
      http.get('/api/platform/admins/candidates', () => {
        candidateRequests += 1;
        return ok([CAROL]);
      }),
      http.post('/api/platform/admins', writeHandler),
      http.delete('/api/platform/admins/:userId', writeHandler),
    );

    renderPanel();

    const bobRow = await rowOf('鲍勃');
    const removeButton = within(bobRow).getByRole('button', { name: '移除' });
    const addButton = screen.getByRole('button', { name: '添加管理员' });

    expect(removeButton).toBeDisabled();
    expect(addButton).toBeDisabled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    await user.hover(removeButton.parentElement!);
    expect(await screen.findByText('仅平台管理员可操作')).toBeInTheDocument();

    await user.click(removeButton);
    await user.click(addButton);
    expect(writeHandler).not.toHaveBeenCalled();
    // Searching promotable users is pointless for a caller who may not promote anybody, and the
    // endpoint would answer with a permission error they cannot act on.
    expect(candidateRequests).toBe(0);
  });

  it('reports the backend refusal when a removal loses the race', async () => {
    const user = userEvent.setup();
    const error = spyOnMessage('error');
    server.use(http.delete('/api/platform/admins/:userId', () => HttpResponse.json({
      success: false,
      code: '31004',
      message: '平台管理员至少保留一名，无法移除最后一名',
      traceId: null,
      data: null,
    })));

    renderPanel();

    const bobRow = await rowOf('鲍勃');
    await user.click(within(bobRow).getByRole('button', { name: '移除' }));
    await user.click(await screen.findByRole('button', { name: '确定移除' }));

    // The roster the operator is looking at can be stale, so the guard on the server stays
    // authoritative and its wording has to reach the operator unchanged.
    await waitFor(() => expect(error).toHaveBeenCalledWith('平台管理员至少保留一名，无法移除最后一名'));
    expect(await rowOf('鲍勃')).not.toBeNull();
  });

  it('shows an error panel when the roster cannot be loaded', async () => {
    server.use(http.get('/api/platform/admins', () => HttpResponse.json({
      success: false,
      code: '10500',
      message: '平台管理员名册读取失败',
      traceId: null,
      data: null,
    })));

    renderPanel();

    expect(await screen.findByText('平台管理员加载失败')).toBeInTheDocument();
    expect(screen.getByText('平台管理员名册读取失败')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加管理员' })).not.toBeInTheDocument();
  });

  it('retains original labels across keywords and exposes keyboard tag removal and clear', async () => {
    server.use(http.get('/api/platform/admins/candidates', ({ request }) => {
      const keyword = new URL(request.url).searchParams.get('keyword');
      return ok(keyword === 'carol' ? [CAROL] : keyword === 'dave' ? [DAVE] : []);
    }));
    renderPanel();
    const picker = await openPicker();
    await userEvent.type(picker, 'carol');
    await userEvent.click(await screen.findByText(labelOf(CAROL), { selector: '.ant-select-item-option-content' }));
    await userEvent.clear(picker);
    await userEvent.type(picker, 'dave');
    await userEvent.click(await screen.findByText(labelOf(DAVE), { selector: '.ant-select-item-option-content' }));
    expect(screen.getByRole('button', { name: `取消选择 ${labelOf(CAROL)}` })).toBeEnabled();
    expect(screen.getByRole('button', { name: '添加 2 人' })).toBeEnabled();
    screen.getByRole('button', { name: `取消选择 ${labelOf(CAROL)}` }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: `取消选择 ${labelOf(CAROL)}` })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加 1 人' })).toBeEnabled();
    screen.getByRole('button', { name: '清除用户选择和搜索' }).focus();
    await userEvent.keyboard(' ');
    expect(picker).toHaveValue('');
    expect(screen.getByRole('button', { name: '添加 0 人' })).toBeDisabled();
  });

  it.each(['cancel', 'close', 'escape', 'mask'])('cancels via %s without any POST, resets and restores entry focus', async (method) => {
    const post = vi.spyOn(adminApi, 'addPlatformAdmin');
    server.use(http.get('/api/platform/admins/candidates', () => ok([CAROL])));
    renderPanel();
    const picker = await choose(CAROL);
    await userEvent.keyboard('{Escape}');
    if (method === 'cancel') await userEvent.click(screen.getByRole('button', { name: '取消' }));
    if (method === 'close') await userEvent.click(screen.getByRole('button', { name: '关闭添加管理员弹窗' }));
    if (method === 'escape') fireEvent.keyDown(document.querySelector('.ant-modal-wrap')!, { key: 'Escape', keyCode: 27 });
    if (method === 'mask') fireEvent.click(document.querySelector('.ant-modal-wrap')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(post).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: '添加管理员' })).toHaveFocus());
    await userEvent.click(screen.getByRole('button', { name: '添加管理员' }));
    expect(screen.getByRole('button', { name: '添加 0 人' })).toBeDisabled();
    expect(screen.getByRole('combobox')).not.toBe(picker);
  });

  it('serializes single-person writes, guards same-frame confirm and immediately adopts each full roster', async () => {
    const first = deferred<adminApi.PlatformAdminList>();
    const second = deferred<adminApi.PlatformAdminList>();
    const add = vi.spyOn(adminApi, 'addPlatformAdmin').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const get = vi.spyOn(adminApi, 'getPlatformAdmins');
    server.use(http.get('/api/platform/admins/candidates', () => ok([CAROL, DAVE])));
    const { queryClient } = renderPanel();
    const picker = await choose(CAROL, DAVE);
    const confirm = screen.getByRole('button', { name: '添加 2 人' });
    const cancel = screen.getByRole('button', { name: '取消' });
    const closeButton = screen.getByRole('button', { name: '关闭添加管理员弹窗' });
    const clear = screen.getByRole('button', { name: '清除用户选择和搜索' });
    const removeTag = screen.getByRole('button', { name: `取消选择 ${labelOf(CAROL)}` });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      fireEvent.click(cancel);
      fireEvent.click(closeButton);
      fireEvent.click(clear);
      fireEvent.click(removeTag);
      fireEvent.keyDown(picker, { key: 'Backspace', keyCode: 8 });
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenNthCalledWith(1, CAROL.userId);
    expect(picker).toBeDisabled();
    expect(screen.getByRole('button', { name: `取消选择 ${labelOf(CAROL)}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: '清除用户选择和搜索' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '关闭添加管理员弹窗' })).not.toBeInTheDocument();
    fireEvent.keyDown(document.querySelector('.ant-modal-wrap')!, { key: 'Escape', keyCode: 27 });
    fireEvent.click(document.querySelector('.ant-modal-wrap')!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const authoritativeFirst = list([{ ...ALICE, nickname: '权威爱丽丝' }, CAROL]);
    await act(async () => { first.resolve(authoritativeFirst); });
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add).toHaveBeenNthCalledWith(2, DAVE.userId);
    expect(queryClient.getQueryData(adminApi.PLATFORM_ADMINS_QUERY_KEY)).toEqual(authoritativeFirst);
    expect(screen.queryByRole('button', { name: `取消选择 ${labelOf(CAROL)}` })).not.toBeInTheDocument();
    expect(await rowOf('权威爱丽丝')).not.toBeNull();
    expect(screen.queryByText('鲍勃')).not.toBeInTheDocument();
    const authoritativeLast = list([ALICE, CAROL, DAVE]);
    await act(async () => { second.resolve(authoritativeLast); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(queryClient.getQueryData(adminApi.PLATFORM_ADMINS_QUERY_KEY)).toEqual(authoritativeLast);
    expect(get).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState([...adminApi.PLATFORM_ADMIN_CANDIDATES_QUERY_KEY, ''])?.isInvalidated).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '添加管理员' }));
    expect(screen.getByRole('button', { name: '添加 0 人' })).toBeDisabled();
  });

  it('continues only explicit 31002 failures and retries a new snapshot containing just failed items', async () => {
    const raw = new ApiError('31002', 'original target denial <b>原文</b>', 'trace-target');
    const add = vi.spyOn(adminApi, 'addPlatformAdmin')
      .mockResolvedValueOnce(list([ALICE, CAROL]))
      .mockRejectedValueOnce(raw)
      .mockResolvedValueOnce(list([ALICE, CAROL, ERIN]))
      .mockResolvedValueOnce(list([ALICE, CAROL, ERIN, DAVE]));
    const get = vi.spyOn(adminApi, 'getPlatformAdmins');
    server.use(http.get('/api/platform/admins/candidates', () => ok([CAROL, DAVE, ERIN])));
    const { container } = renderPanel();
    await choose(CAROL, DAVE, ERIN);
    await userEvent.click(screen.getByRole('button', { name: '添加 3 人' }));
    await waitFor(() => expect(itemResult(labelOf(ERIN))).toHaveAttribute('data-result', 'success'));
    expect(add.mock.calls.map(([id]) => id)).toEqual([CAROL.userId, DAVE.userId, ERIN.userId]);
    expect(itemResult(labelOf(DAVE))).toHaveTextContent(raw.message);
    expect(itemResult(labelOf(DAVE))).toHaveAttribute('data-result', 'failed');
    expect(screen.getByText('本次已成功添加 2 人')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加 1 人' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: `取消选择 ${labelOf(CAROL)}` })).not.toBeInTheDocument();
    expect(document.querySelector('.aw-admin-add-results b')).toBeNull();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '添加 1 人' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(4));
    expect(add).toHaveBeenLastCalledWith(DAVE.userId);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it.each(['99999', '10401', '10403'])('stops after unknown/auth refusal %s and preserves failed and unattempted identities', async (code) => {
    const raw = new ApiError(code, `raw ${code} 原始拒绝`, 'raw-trace');
    const add = vi.spyOn(adminApi, 'addPlatformAdmin').mockRejectedValue(raw);
    const get = vi.spyOn(adminApi, 'getPlatformAdmins');
    server.use(http.get('/api/platform/admins/candidates', () => ok([CAROL, DAVE])));
    renderPanel();
    await choose(CAROL, DAVE);
    await userEvent.click(screen.getByRole('button', { name: '添加 2 人' }));
    await waitFor(() => expect(itemResult(labelOf(CAROL))).toHaveAttribute('data-result', 'failed'));
    expect(itemResult(labelOf(CAROL))).toHaveTextContent(raw.message);
    expect(itemResult(labelOf(DAVE))).toHaveAttribute('data-result', 'unattempted');
    expect(screen.getByRole('button', { name: '添加 2 人' })).toBeEnabled();
    expect(add).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('stops subsequent writes and locks controls when an authoritative response loses canManage', async () => {
    const add = vi.spyOn(adminApi, 'addPlatformAdmin').mockResolvedValue(list([ALICE, CAROL], false));
    server.use(http.get('/api/platform/admins/candidates', () => ok([CAROL, DAVE])));
    const { queryClient } = renderPanel();
    await choose(CAROL, DAVE);
    await userEvent.click(screen.getByRole('button', { name: '添加 2 人' }));
    await waitFor(() => expect(itemResult(labelOf(DAVE))).toHaveAttribute('data-result', 'unattempted'));
    expect(add).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(adminApi.PLATFORM_ADMINS_QUERY_KEY)).toEqual(list([ALICE, CAROL], false));
    expect(screen.getByRole('button', { name: '添加 1 人' })).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('button', { name: `取消选择 ${labelOf(DAVE)}` })).toBeDisabled();
    expect(screen.getByText('仅平台管理员可操作')).toBeInTheDocument();
  });

  it('reconciles one possibly committed network write by GET, removes the committed item and does not continue or rePOST', async () => {
    const raw = new ApiError('10000', 'Network Error 原文', null);
    const add = vi.spyOn(adminApi, 'addPlatformAdmin').mockRejectedValue(raw);
    const get = vi.spyOn(adminApi, 'getPlatformAdmins');
    server.use(http.get('/api/platform/admins/candidates', () => ok([CAROL, DAVE])));
    const { queryClient } = renderPanel();
    await choose(CAROL, DAVE);
    get.mockResolvedValue(list([ALICE, CAROL]));
    await userEvent.click(screen.getByRole('button', { name: '添加 2 人' }));
    await waitFor(() => expect(itemResult(labelOf(CAROL))).toHaveAttribute('data-result', 'success'));
    expect(itemResult(labelOf(CAROL))).toHaveTextContent(raw.message);
    expect(itemResult(labelOf(DAVE))).toHaveAttribute('data-result', 'unattempted');
    expect(screen.queryByRole('button', { name: `取消选择 ${labelOf(CAROL)}` })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加 1 人' })).toBeEnabled();
    expect(queryClient.getQueryData(adminApi.PLATFORM_ADMINS_QUERY_KEY)).toEqual(list([ALICE, CAROL]));
    expect(get).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('preserves a network item absent from readback as uncertain until explicit confirmation', async () => {
    const add = vi.spyOn(adminApi, 'addPlatformAdmin').mockRejectedValueOnce(new ApiError('10000', 'timeout raw', null))
      .mockResolvedValueOnce(list([ALICE, CAROL]));
    const get = vi.spyOn(adminApi, 'getPlatformAdmins');
    server.use(http.get('/api/platform/admins/candidates', () => ok([CAROL])));
    renderPanel();
    await choose(CAROL);
    await userEvent.click(screen.getByRole('button', { name: '添加 1 人' }));
    await waitFor(() => expect(itemResult(labelOf(CAROL))).toHaveAttribute('data-result', 'uncertain'));
    expect(itemResult(labelOf(CAROL))).toHaveTextContent('timeout raw');
    expect(get).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '添加 1 人' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '添加 1 人' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it.each([true, false])('locks unknown read failure across reopen and only explicit read retry resolves it (committed=%s)', async (committed) => {
    const add = vi.spyOn(adminApi, 'addPlatformAdmin').mockRejectedValue(new ApiError('10000', 'original network <i>raw</i>', null));
    const get = vi.spyOn(adminApi, 'getPlatformAdmins');
    server.use(http.get('/api/platform/admins/candidates', () => ok([CAROL, DAVE])));
    renderPanel();
    await choose(CAROL, DAVE);
    get.mockRejectedValueOnce(new ApiError('10500', 'original read failure', 'read-trace'));
    await userEvent.click(screen.getByRole('button', { name: '添加 2 人' }));
    await screen.findByText('original read failure');
    expect(itemResult(labelOf(CAROL))).toHaveAttribute('data-result', 'unknown');
    expect(itemResult(labelOf(CAROL))).toHaveTextContent('original network <i>raw</i>');
    expect(screen.getByRole('button', { name: '添加 2 人' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: '添加管理员' }));
    expect(screen.getByRole('button', { name: '添加 2 人' })).toBeDisabled();
    expect(get).toHaveBeenCalledTimes(2);
    const retry = deferred<adminApi.PlatformAdminList>();
    get.mockReturnValueOnce(retry.promise);
    const retryButton = screen.getByRole('button', { name: '重试读取管理员名册' });
    act(() => { fireEvent.click(retryButton); fireEvent.click(retryButton); });
    expect(get).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    await act(async () => { retry.resolve(list(committed ? [ALICE, CAROL] : [ALICE, BOB])); });
    await waitFor(() => expect(screen.queryByText('original read failure')).not.toBeInTheDocument());
    expect(itemResult(labelOf(CAROL))).toHaveAttribute('data-result', committed ? 'success' : 'uncertain');
    expect(screen.getByRole('button', { name: committed ? '添加 1 人' : '添加 2 人' })).toBeEnabled();
    expect(add).toHaveBeenCalledTimes(1);
    expect(itemResult(labelOf(DAVE))).toHaveAttribute('data-result', 'unattempted');
  });

  it('shows candidate errors and explicit Retry without a false empty result, loading or automatic retry', async () => {
    const read = deferred<adminApi.PlatformAdminCandidate[]>();
    const search = vi.spyOn(adminApi, 'searchPlatformAdminCandidates').mockReturnValueOnce(read.promise).mockResolvedValueOnce([CAROL]);
    renderPanel();
    const picker = await openPicker();
    await userEvent.click(picker);
    expect(screen.getByText('正在读取可添加的用户…')).toBeInTheDocument();
    expect(screen.queryByText('暂无可添加的用户')).not.toBeInTheDocument();
    await act(async () => { read.reject(new ApiError('10500', 'candidate raw <b>error</b>', 'candidate-trace')); });
    expect(await screen.findByText('可添加的用户读取失败')).toBeInTheDocument();
    expect(screen.getByText('candidate raw <b>error</b>')).toBeInTheDocument();
    expect(screen.queryByText('暂无可添加的用户')).not.toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '重试读取候选用户' }));
    await userEvent.click(picker);
    expect(await screen.findByText(labelOf(CAROL), { selector: '.ant-select-item-option-content' })).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('可添加的用户读取失败')).not.toBeInTheDocument();
  });

  it('isolates late candidate responses by keyword and never substitutes stale options for a new search', async () => {
    const old = deferred<adminApi.PlatformAdminCandidate[]>();
    vi.spyOn(adminApi, 'searchPlatformAdminCandidates').mockImplementation(async (keyword) => {
      if (keyword === 'a') return old.promise;
      return keyword === 'ab' ? [DAVE] : [];
    });
    renderPanel();
    const picker = await openPicker();
    await userEvent.type(picker, 'a');
    expect(screen.queryByText('暂无可添加的用户')).not.toBeInTheDocument();
    await userEvent.type(picker, 'b');
    await screen.findByText(labelOf(DAVE), { selector: '.ant-select-item-option-content' });
    await act(async () => { old.resolve([CAROL]); });
    expect(screen.queryByText(labelOf(CAROL), { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText(labelOf(DAVE), { selector: '.ant-select-item-option-content' }));
    expect(screen.getByRole('button', { name: `取消选择 ${labelOf(DAVE)}` })).toBeInTheDocument();
  });

  it.each(['add', 'remove'])('guards same-frame mutually exclusive writes when %s starts first', async (first) => {
    const addition = deferred<adminApi.PlatformAdminList>();
    const removal = deferred<adminApi.PlatformAdminList>();
    const add = vi.spyOn(adminApi, 'addPlatformAdmin').mockReturnValue(addition.promise);
    const remove = vi.spyOn(adminApi, 'removePlatformAdmin').mockReturnValue(removal.promise);
    server.use(http.get('/api/platform/admins/candidates', () => ok([CAROL])));
    renderPanel();
    await choose(CAROL);
    const bobRow = await rowOf('鲍勃');
    fireEvent.click(within(bobRow).getByRole('button', { name: '移除' }));
    const removeConfirm = await screen.findByRole('button', { name: '确定移除' });
    const addConfirm = screen.getByRole('button', { name: '添加 1 人' });
    act(() => {
      fireEvent.click(first === 'add' ? addConfirm : removeConfirm);
      fireEvent.click(first === 'add' ? removeConfirm : addConfirm);
      fireEvent.click(first === 'add' ? addConfirm : removeConfirm);
    });
    await waitFor(() => expect(first === 'add' ? add : remove).toHaveBeenCalledTimes(1));
    expect(first === 'add' ? remove : add).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '添加管理员' })).toBeDisabled();
    expect(within(bobRow).getByRole('button', { name: '移除' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    await act(async () => {
      if (first === 'add') addition.resolve(list([ALICE, BOB, CAROL]));
      else removal.resolve(list([ALICE]));
    });
  });

  it('keeps custom removable denial raw and does not impose workspace access gates', async () => {
    server.use(http.get('/api/platform/admins', () => roster([ALICE, { ...BOB, removable: false, removeDisabledReason: 'backend original custom denial' }, { ...DAVE, active: false }])));
    useAuthStore.getState().setCurrentWorkspace({ id: 5, name: 'readonly', description: '', accessLevel: 'READ_ONLY' }, 'READ_ONLY');
    renderPanel();
    const bob = await rowOf('鲍勃');
    const denied = within(bob).getByRole('button', { name: '移除' });
    expect(denied).toBeDisabled();
    await userEvent.hover(denied.parentElement!);
    expect(await screen.findByText('backend original custom denial')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加管理员' })).toBeEnabled();
    expect(within(await rowOf('戴夫')).getByRole('button', { name: '移除' })).toBeEnabled();
  });

  it('retains numeric selection, raw XSS names and errors while semantic results change language', async () => {
    const rawCandidate = { ...CAROL, nickname: '名字<img src=x onerror=alert(1)>', email: '<svg onload=alert(1)>@example.com' };
    const raw = new ApiError('31002', 'raw denial <b>不翻译</b>', 'trace');
    const add = vi.spyOn(adminApi, 'addPlatformAdmin').mockRejectedValueOnce(raw).mockResolvedValueOnce(list([ALICE, rawCandidate]));
    server.use(http.get('/api/platform/admins/candidates', () => ok([rawCandidate])));
    const { container } = renderPanel();
    const picker = await choose(rawCandidate);
    await userEvent.click(screen.getByRole('button', { name: '添加 1 人' }));
    await waitFor(() => expect(itemResult(labelOf(rawCandidate))).toHaveAttribute('data-result', 'failed'));
    await language('en-US');
    expect(screen.getByRole('combobox', { name: 'Search users to add' })).toBe(picker);
    expect(itemResult(labelOf(rawCandidate))).toHaveTextContent('Failed to add');
    expect(itemResult(labelOf(rawCandidate))).toHaveTextContent(raw.message);
    expect(screen.getByRole('button', { name: `Deselect ${labelOf(rawCandidate)}` })).toBeEnabled();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('svg[onload]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add 1 person' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add.mock.calls).toEqual([[CAROL.userId], [CAROL.userId]]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('retains the first selected label when another keyword returns new text for the same numeric identity', async () => {
    server.use(http.get('/api/platform/admins/candidates', ({ request }) => ok(
      new URL(request.url).searchParams.get('keyword') === 'new'
        ? [{ ...CAROL, nickname: 'renamed candidate', email: 'new@example.com' }, DAVE]
        : [CAROL],
    )));
    renderPanel();
    const picker = await choose(CAROL);
    await userEvent.type(picker, 'new');
    await screen.findByText(labelOf(DAVE), { selector: '.ant-select-item-option-content' });
    expect(screen.getByRole('button', { name: `取消选择 ${labelOf(CAROL)}` })).toBeInTheDocument();
    expect(screen.queryByText('renamed candidate (new@example.com)')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加 1 人' })).toBeEnabled();
  });

  it('closes and clears a lone unknown item only after explicit read retry confirms it committed', async () => {
    const add = vi.spyOn(adminApi, 'addPlatformAdmin').mockRejectedValue(new ApiError('10000', 'network raw', null));
    const get = vi.spyOn(adminApi, 'getPlatformAdmins');
    server.use(http.get('/api/platform/admins/candidates', () => ok([CAROL])));
    renderPanel();
    await choose(CAROL);
    get.mockRejectedValueOnce(new Error('read raw')).mockResolvedValueOnce(list([ALICE, CAROL]));
    await userEvent.click(screen.getByRole('button', { name: '添加 1 人' }));
    await screen.findByText('read raw');
    expect(screen.getByRole('button', { name: '添加 1 人' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '重试读取管理员名册' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(add).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(3);
    await userEvent.click(screen.getByRole('button', { name: '添加管理员' }));
    expect(screen.getByRole('button', { name: '添加 0 人' })).toBeDisabled();
  });

  it('uses the current singleton language for completion after a delayed confirmation', async () => {
    const completion = deferred<adminApi.PlatformAdminList>();
    vi.spyOn(adminApi, 'addPlatformAdmin').mockReturnValue(completion.promise);
    const success = spyOnMessage('success');
    server.use(http.get('/api/platform/admins/candidates', () => ok([CAROL])));
    renderPanel();
    await choose(CAROL);
    await userEvent.click(screen.getByRole('button', { name: '添加 1 人' }));
    await language('en-US');
    await act(async () => { completion.resolve(list([ALICE, CAROL])); });
    await waitFor(() => expect(success).toHaveBeenCalledWith('Platform administrator added'));
  });
});
