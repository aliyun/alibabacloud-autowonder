import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import { AccessRequestsPanel } from './AccessRequestsPanel';

const mockRequests = [
  {
    id: 101,
    tenantId: 7,
    requesterId: 2,
    requesterName: '张三',
    requestedLevel: 'READ_WRITE',
    status: 'PENDING',
    reviewerId: null,
    reviewerName: null,
    rejectReason: null,
    gmtCreate: '2026-08-20T10:30:00',
  },
  {
    id: 102,
    tenantId: 7,
    requesterId: 3,
    requesterName: null,
    requestedLevel: 'ADMIN',
    status: 'PENDING',
    reviewerId: null,
    reviewerName: null,
    rejectReason: null,
    gmtCreate: '2026-08-21T09:00:00',
  },
];

let listRequests = 0;

beforeEach(() => {
  listRequests = 0;
  useAuthStore.getState().clear();
  useAuthStore.getState().setUser({
    id: 1, username: 'admin', email: 'admin@co.com', nickname: '管理员',
  });
  useAuthStore.getState().setCurrentWorkspace(
    { id: 7, name: '测试工作空间', description: '' },
    'ADMIN',
  );
  server.use(
    http.get('/api/workspaces/current/access-requests', ({ request }) => {
      listRequests += 1;
      const status = new URL(request.url).searchParams.get('status');
      return HttpResponse.json({
        success: true, code: '0', message: '',
        data: mockRequests.map((r) => ({ ...r, status: status ?? 'PENDING' })),
        traceId: null,
      });
    }),
  );
});

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AccessRequestsPanel />
    </QueryClientProvider>,
  );
}

describe('AccessRequestsPanel', () => {
  it('renders pending requests with requester, level label and submit time', async () => {
    renderPanel();

    expect(await screen.findByText('张三')).toBeInTheDocument();
    expect(screen.getByText('读写者')).toBeInTheDocument();
    expect(screen.getByText('管理员')).toBeInTheDocument();
    expect(screen.getByText('2026/8/20')).toBeInTheDocument();
    expect(screen.getByText('10:30')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '通过' }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: '拒绝' }).length).toBe(2);
    expect(screen.getByText('共 2 条申请')).toBeInTheDocument();
    expect(screen.getByText('按提交时间从新到旧')).toBeInTheDocument();
    expect(screen.getByText('通过后立即生效；拒绝可说明原因，申请人保留当前角色。')).toBeInTheDocument();
  });

  it('falls back to the numeric id when requesterName is null', async () => {
    renderPanel();

    expect(await screen.findByText('张三')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows an empty state when there are no requests', async () => {
    server.use(
      http.get('/api/workspaces/current/access-requests', () => HttpResponse.json({
        success: true, code: '0', message: '', data: [], traceId: null,
      })),
    );
    renderPanel();

    expect(await screen.findByText('暂无待审批的申请')).toBeInTheDocument();
    expect(screen.getByText('有新的加入或权限提升申请时会出现在这里。')).toBeInTheDocument();
  });

  it('approves a request after the admin gate passes', async () => {
    const user = userEvent.setup();
    const approveHandler = vi.fn();
    server.use(
      http.post('/api/workspaces/current/access-requests/101/approve', () => {
        approveHandler();
        return HttpResponse.json({ success: true, code: '0', message: '', data: null, traceId: null });
      }),
    );
    renderPanel();

    const row = (await screen.findByText('张三')).closest('tr');
    await user.click(within(row!).getByRole('button', { name: '通过' }));

    expect(await screen.findByText('通过 张三 的「读写者」申请？')).toBeInTheDocument();
    expect(screen.getByText('确认后申请人立即获得该角色。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认通过' }));

    await waitFor(() => expect(approveHandler).toHaveBeenCalledTimes(1));
  });

  it('shows the numeric requester id in the reject dialog when the name is null', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/workspaces/current/access-requests', () => HttpResponse.json({
        success: true, code: '0', message: '', data: [
          { ...mockRequests[1] },
        ], traceId: null,
      })),
    );
    renderPanel();

    const row = (await screen.findByText('3')).closest('tr');
    await user.click(within(row!).getByRole('button', { name: '拒绝' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/3 的「管理员」申请/)).toBeInTheDocument();
    expect(within(dialog).getByText('拒绝原因（选填）', { selector: 'span' })).toBeInTheDocument();
  });

  it('rejects with the typed reason', async () => {
    const user = userEvent.setup();
    const rejectHandler = vi.fn();
    server.use(
      http.post('/api/workspaces/current/access-requests/101/reject', async ({ request }) => {
        rejectHandler(await request.json().catch(() => null));
        return HttpResponse.json({ success: true, code: '0', message: '', data: null, traceId: null });
      }),
    );
    renderPanel();

    const row = (await screen.findByText('张三')).closest('tr');
    await user.click(within(row!).getByRole('button', { name: '拒绝' }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), '该空间仅限团队内部成员');
    await user.click(within(dialog).getByRole('button', { name: /确认拒绝/ }));

    await waitFor(() => expect(rejectHandler).toHaveBeenCalledWith({
      reason: '该空间仅限团队内部成员',
    }));
  });

  it('rejects without a reason when the input is left empty', async () => {
    const user = userEvent.setup();
    const rejectHandler = vi.fn();
    server.use(
      http.post('/api/workspaces/current/access-requests/101/reject', async ({ request }) => {
        rejectHandler(await request.json().catch(() => null));
        return HttpResponse.json({ success: true, code: '0', message: '', data: null, traceId: null });
      }),
    );
    renderPanel();

    const row = (await screen.findByText('张三')).closest('tr');
    await user.click(within(row!).getByRole('button', { name: '拒绝' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /确认拒绝/ }));

    await waitFor(() => expect(rejectHandler).toHaveBeenCalledWith({}));
  });

  it('keeps review actions visible and lets the access command gate non-admin clicks', async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setCurrentWorkspace(
      { id: 7, name: '测试工作空间', description: '' },
      'READ_WRITE',
    );
    const approveHandler = vi.fn();
    server.use(
      http.post('/api/workspaces/current/access-requests/101/approve', approveHandler),
      http.post('/api/workspaces/current/access-requests/101/reject', approveHandler),
    );
    renderPanel();

    expect(await screen.findByText('张三')).toBeInTheDocument();
    const row = screen.getByText('张三').closest('tr')!;
    expect(within(row).getByRole('button', { name: '通过' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '拒绝' })).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: '拒绝' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(approveHandler).not.toHaveBeenCalled();
  });

  it('shows a load-failure empty state and retries the list request', async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setCurrentWorkspace(
      { id: 7, name: '测试工作空间', description: '' },
      'READ_WRITE',
    );
    server.use(
      http.get('/api/workspaces/current/access-requests', () => {
        listRequests += 1;
        return HttpResponse.json(
          {
            success: false,
            code: '12008',
            message: '工作空间访问级别不足',
            data: null,
            traceId: null,
          },
          { status: 403 },
        );
      }),
    );
    renderPanel();

    expect(await screen.findByText('权限申请加载失败，请稍后重试')).toBeInTheDocument();
    expect(screen.getByText('检查网络后重试；持续失败请联系管理员。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(listRequests).toBe(2));
  });

  it('switches the status filter and refetches', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText('张三')).toBeInTheDocument();
    expect(listRequests).toBe(1);

    await user.click(screen.getByRole('radio', { name: '已通过' }).closest('label')!);

    await waitFor(() => expect(listRequests).toBe(2));
  });

  it('shows reviewer and reject reason for reviewed requests', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/workspaces/current/access-requests', ({ request }) => {
        const status = new URL(request.url).searchParams.get('status');
        const base = mockRequests[0];
        const data = status === 'REJECTED'
          ? [{ ...base, status: 'REJECTED', reviewerId: 1, reviewerName: '管理员', rejectReason: '内部空间' }]
          : [];
        return HttpResponse.json({ success: true, code: '0', message: '', data, traceId: null });
      }),
    );
    renderPanel();

    expect(await screen.findByText('暂无待审批的申请')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '已拒绝' }).closest('label')!);

    expect(await screen.findByText('管理员')).toBeInTheDocument();
    expect(screen.getByText('内部空间')).toBeInTheDocument();
  });
});
