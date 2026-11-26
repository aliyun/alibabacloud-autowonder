import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { message } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { FeatureSwitchesPanel } from './FeatureSwitchesPanel';

afterEach(() => {
  message.destroy();
});

function renderPanel(canManage = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FeatureSwitchesPanel canManage={canManage} />
    </QueryClientProvider>,
  );
}

describe('FeatureSwitchesPanel', () => {
  it('gives each switch its own named settings section', async () => {
    renderPanel();

    for (const name of ['重复工单意图检测', '用户注册审核', '默认允许用户创建空间']) {
      const section = await screen.findByRole('region', { name });
      expect(within(section).getByRole('switch', { name: `切换${name}` })).toBeInTheDocument();
      expect(within(section).getAllByRole('switch')).toHaveLength(1);
    }
  });

  it('saves each new switch with its own version', async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.put('/api/platform/feature-switches', async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        bodies.push(body);
        return HttpResponse.json({
          success: true,
          code: '0',
          message: '',
          data: {
            duplicateWorkitemIntentEnabled: false,
            version: 0,
            userRegistrationReviewEnabled: body.userRegistrationReviewEnabled === true,
            userRegistrationReviewVersion: 1,
            workspaceCreationDefaultAllowed: body.workspaceCreationDefaultAllowed !== false,
            workspaceCreationDefaultAllowedVersion: 1,
          },
          traceId: 'trace-feature-switches-save-new',
        });
      }),
    );

    renderPanel();

    await userEvent.click(await screen.findByRole('switch', { name: '切换用户注册审核' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ userRegistrationReviewEnabled: true, userRegistrationReviewVersion: 0 });

    await userEvent.click(await screen.findByRole('switch', { name: '切换默认允许用户创建空间' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ workspaceCreationDefaultAllowed: false, workspaceCreationDefaultAllowedVersion: 1 });
  });

  it('reverts both new switches when saving fails', async () => {
    server.use(
      http.put('/api/platform/feature-switches', () => HttpResponse.json({
        success: false,
        code: '39001',
        message: '开关配置已被他人修改，请刷新后重试',
        data: null,
        traceId: 'trace-feature-switches-conflict-new',
      })),
    );

    renderPanel();

    const review = await screen.findByRole('switch', { name: '切换用户注册审核' });
    await userEvent.click(review);
    await waitFor(() => expect(review).toHaveAttribute('aria-checked', 'false'));

    const creation = await screen.findByRole('switch', { name: '切换默认允许用户创建空间' });
    await userEvent.click(creation);
    await waitFor(() => expect(creation).toHaveAttribute('aria-checked', 'true'));
  });

  it('loads the global switch state and saves a toggle', async () => {
    let savedBody: Record<string, unknown> | null = null;
    server.use(
      http.put('/api/platform/feature-switches', async ({ request }) => {
        savedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          code: '0',
          message: '',
          data: { duplicateWorkitemIntentEnabled: true, version: 1 },
          traceId: 'trace-feature-switches-save',
        });
      }),
    );

    renderPanel();

    const toggle = await screen.findByRole('switch', { name: '切换重复工单意图检测' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(toggle);

    await waitFor(() => expect(savedBody).not.toBeNull());
    expect(savedBody).toMatchObject({ duplicateWorkitemIntentEnabled: true, expectedVersion: 0 });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByText('已开启')).toBeInTheDocument();
  });

  it('reverts the toggle when saving fails', async () => {
    server.use(
      http.put('/api/platform/feature-switches', () => HttpResponse.json({
        success: false,
        code: '39001',
        message: '开关配置已被他人修改，请刷新后重试',
        data: null,
        traceId: 'trace-feature-switches-conflict',
      })),
    );

    renderPanel();

    const toggle = await screen.findByRole('switch', { name: '切换重复工单意图检测' });
    await userEvent.click(toggle);

    await waitFor(() => expect(screen.getByText('开关配置已被他人修改，请刷新后重试')).toBeInTheDocument());
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('disables editing for non administrators', async () => {
    renderPanel(false);

    const toggle = await screen.findByRole('switch', { name: '切换重复工单意图检测' });
    expect(toggle).toBeDisabled();
    expect(screen.getByText('仅平台管理员可以修改功能开关。')).toBeInTheDocument();
  });

  it('keeps a failed read unknown and performs no writes until an explicit retry succeeds', async () => {
    let reads = 0;
    let writes = 0;
    server.use(
      http.get('/api/platform/feature-switches', () => {
        reads += 1;
        return HttpResponse.json(reads === 1
          ? { success: false, code: '10500', message: 'feature read failed', data: null, traceId: null }
          : { success: true, code: '0', message: '', data: { duplicateWorkitemIntentEnabled: true, version: 7 }, traceId: null });
      }),
      http.put('/api/platform/feature-switches', () => {
        writes += 1;
        return HttpResponse.json({ success: true, code: '0', message: '', data: { duplicateWorkitemIntentEnabled: false, version: 8 }, traceId: null });
      }),
    );
    renderPanel();
    expect(await screen.findByText('开关配置加载失败')).toBeInTheDocument();
    expect(screen.getByText('状态未知')).toBeInTheDocument();
    expect(screen.queryByText('已关闭')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '切换重复工单意图检测' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /^重\s*试$/ }));
    expect(await screen.findByText('已开启')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: '切换重复工单意图检测' }));
    await waitFor(() => expect(writes).toBe(1));
    expect(reads).toBe(2);
  });

  it('does not present a loading switch as a real disabled value', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let writes = 0;
    server.use(
      http.get('/api/platform/feature-switches', async () => {
        await pending;
        return HttpResponse.json({ success: true, code: '0', message: '', data: { duplicateWorkitemIntentEnabled: true, version: 7 }, traceId: null });
      }),
      http.put('/api/platform/feature-switches', () => {
        writes++;
        return HttpResponse.json({ success: true, code: '0', message: '', data: { duplicateWorkitemIntentEnabled: false, version: 8 }, traceId: null });
      }),
    );
    renderPanel();
    try {
      expect(screen.queryByText('已关闭')).not.toBeInTheDocument();
      const toggle = screen.queryByRole('switch', { name: '切换重复工单意图检测' });
      if (toggle) expect(toggle).toBeDisabled();
      expect(writes).toBe(0);
    } finally {
      release();
      await screen.findByText('已开启');
    }
    expect(writes).toBe(0);
  });

  it('locks same-frame toggles and restores the last real enabled state after rejection', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const payloads: unknown[] = [];
    server.use(
      http.get('/api/platform/feature-switches', () => HttpResponse.json({ success: true, code: '0', message: '', data: { duplicateWorkitemIntentEnabled: true, version: 7 }, traceId: null })),
      http.put('/api/platform/feature-switches', async ({ request }) => {
        payloads.push(await request.json());
        await pending;
        return HttpResponse.json({ success: false, code: '39001', message: 'synthetic version conflict', data: null, traceId: null });
      }),
    );
    renderPanel();
    await screen.findByText('已开启');
    const toggle = screen.getByRole('switch', { name: '切换重复工单意图检测' });
    try {
      act(() => { fireEvent.click(toggle); fireEvent.click(toggle); });
      await waitFor(() => expect(payloads).toEqual([{ duplicateWorkitemIntentEnabled: false, expectedVersion: 7 }]));
      expect(toggle).toBeDisabled();
      await userEvent.click(toggle);
      expect(payloads).toHaveLength(1);
    } finally {
      release();
      await waitFor(() => expect(toggle).toBeEnabled());
    }
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('已开启')).toBeInTheDocument();
    expect(payloads).toHaveLength(1);
  });
});
