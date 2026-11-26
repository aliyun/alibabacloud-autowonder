import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import { NewWorkitemModal } from './NewWorkitemModal';

const { createMock, assignMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  assignMock: vi.fn(),
}));

vi.mock('@/features/workitem/hooks', () => ({
  useCreateWorkitem: () => ({ mutateAsync: createMock, isPending: false }),
  useAssignWorkitem: () => ({ mutateAsync: assignMock, isPending: false }),
}));

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: '0', message: '', data, traceId: null });
}

function renderModal(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/workbench']}>
        <Routes>
          <Route path="/workbench" element={<NewWorkitemModal open onClose={onClose} />} />
          <Route path="/workitems/:id" element={<div>工单详情页</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onClose, unmount: view.unmount };
}

const deliveryHandlers = [
  http.get('/api/squads', () => ok({
    list: [{ id: 1, name: 'AW交付组', description: '', memberCount: 1, gmtCreate: '' }],
    total: 1, pageNum: 1, pageSize: 100,
  })),
  http.get('/api/squads/:squadId/members', () => ok([
    { agentId: 77, agentName: 'Agent-77', roleCode: 'AW_FS_DEV' },
    { agentId: 88, agentName: 'Agent-88', roleCode: null },
  ])),
];

async function pickSquadAndAgent() {
  await userEvent.click(screen.getByLabelText(/交付小队/));
  await userEvent.click(await screen.findByText('AW交付组'));
  await userEvent.click(await screen.findByLabelText(/交付数字员工/));
  await userEvent.click(await screen.findByText('Agent-77 (AW_FS_DEV)'));
}

async function fillRequiredFields() {
  await userEvent.type(screen.getByLabelText('标题'), '工作台新建工单');
  await userEvent.type(screen.getByLabelText('描述'), '正文内容');
}

/** 在日期选择器里输入未来时间并回车/失焦确认（rc-picker 的文本输入路径）。 */
async function pickFutureTime(value: string) {
  const input = document.querySelector('.ant-picker-input input') as HTMLInputElement;
  fireEvent.mouseDown(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
  fireEvent.blur(input);
  await waitFor(() => expect(input).not.toHaveValue(''));
}

beforeEach(() => {
  useAuthStore.getState().clear();
  useAuthStore.getState().setUser({ id: 7, username: 'me', nickname: '我', email: 'me@example.com' });
  useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'W', description: '' }, 'READ_WRITE');
  createMock.mockReset();
  assignMock.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  server.use(...deliveryHandlers);
});

afterEach(() => {
  cleanup();
  useAuthStore.getState().clear();
});

describe('NewWorkitemModal', () => {
  it('keeps the native file input hidden inside the antd form', () => {
    renderModal();

    expect(screen.getByTestId('workitem-create-file-input')).toHaveStyle({ display: 'none' });
    expect(screen.getAllByRole('button', { name: /添加文件或图片/ })).toHaveLength(1);
    expect(document.querySelector('.ant-form input[type="file"]')).toHaveStyle({ display: 'none' });
  });

  it('creates without assignment params when no digital worker is selected', async () => {
    createMock.mockResolvedValue({ id: 100 });
    const { onClose } = renderModal();

    expect(screen.getByText('新建工单')).toBeInTheDocument();
    await fillRequiredFields();
    await userEvent.click(screen.getByRole('button', { name: '创建工单' }));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
        workType: 'REQ',
        priority: 2,
        title: '工作台新建工单',
        contentMd: '正文内容',
      }));
    });
    const payload = createMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.assigneeType).toBeUndefined();
    expect(payload.assigneeRef).toBeUndefined();
    expect(payload.scheduledStartAt).toBeUndefined();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await screen.findByText('工单详情页')).toBeInTheDocument();
  });

  it('creates and starts immediately with the selected digital worker and squad', async () => {
    createMock.mockResolvedValue({ id: 101 });
    renderModal();

    await fillRequiredFields();
    await pickSquadAndAgent();
    expect(await screen.findByText('立即启动')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '创建并启动' }));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
        assigneeType: 'AGENT',
        assigneeRef: 77,
        squadId: 1,
      }));
    });
    const payload = createMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.scheduledStartAt).toBeUndefined();
  });

  it('blocks a scheduled start without a future time', async () => {
    renderModal();
    await fillRequiredFields();
    await pickSquadAndAgent();

    await userEvent.click(screen.getByText('定时启动'));
    await userEvent.click(await screen.findByRole('button', { name: '创建并定时启动' }));

    await waitFor(() => {
      expect(screen.getByText('请选择未来的启动时间')).toBeInTheDocument();
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('keeps the form open when creation fails so the user can retry', async () => {
    createMock.mockRejectedValue(new Error('boom'));
    renderModal();

    await fillRequiredFields();
    await userEvent.click(screen.getByRole('button', { name: '创建工单' }));

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(screen.getByLabelText('标题')).toHaveValue('工作台新建工单');
    expect(screen.queryByText('工单详情页')).not.toBeInTheDocument();
  });

  /** QA-F2：定时模式下的成功提交必须带上未来时间，且与指派参数一次提交。 */
  it('creates and schedules with a future time in the request payload', async () => {
    createMock.mockResolvedValue({ id: 102 });
    renderModal();

    await fillRequiredFields();
    await pickSquadAndAgent();
    await userEvent.click(screen.getByText('定时启动'));
    await pickFutureTime('2030-01-01 10:00:00');
    await userEvent.click(screen.getByRole('button', { name: '创建并定时启动' }));

    await waitFor(() => {
      const payload = createMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload).toMatchObject({ assigneeType: 'AGENT', assigneeRef: 77, squadId: 1 });
      expect(payload.scheduledStartAt).toEqual(expect.any(String));
      // 与时区无关：提交的启动时间必须能解析且晚于当前。
      const scheduledAt = Date.parse(String(payload.scheduledStartAt));
      expect(Number.isNaN(scheduledAt)).toBe(false);
      expect(scheduledAt).toBeGreaterThan(Date.now());
    });
  });

  function clipboardWith(files: File[]) {
    return { files, items: [], getData: () => '' };
  }

  it('uploads pasted attachments before starting the selected digital worker', async () => {
    let uploadCalls = 0;
    createMock.mockResolvedValue({ id: 101 });
    assignMock.mockResolvedValue({ id: 101 });
    server.use(http.post('/api/workitems/101/requirement-documents', () => {
      uploadCalls += 1;
      return ok([]);
    }));
    renderModal();

    await fillRequiredFields();
    await pickSquadAndAgent();
    fireEvent.paste(screen.getByLabelText('描述'), {
      clipboardData: clipboardWith([new File([new Uint8Array(8)], 'image.png', { type: 'image/png' })]),
    });
    expect(await screen.findByText(/^粘贴-.*\.png$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '创建并启动' }));

    await waitFor(() => expect(assignMock).toHaveBeenCalled());
    expect(uploadCalls).toBe(1);
    const payload = createMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.assigneeType).toBeUndefined();
    expect(payload.assigneeRef).toBeUndefined();
    expect(assignMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 101,
      assigneeType: 'AGENT',
      assigneeRef: 77,
      squadId: 1,
    }));
    expect(await screen.findByText('工单详情页')).toBeInTheDocument();
  });

  it('keeps the creator assignment but still uploads attachments without a digital worker', async () => {
    let uploadCalls = 0;
    createMock.mockResolvedValue({ id: 104 });
    server.use(http.post('/api/workitems/104/requirement-documents', () => {
      uploadCalls += 1;
      return ok([]);
    }));
    renderModal();

    await fillRequiredFields();
    fireEvent.paste(screen.getByLabelText('描述'), {
      clipboardData: clipboardWith([new File(['notes'], 'shot.txt', { type: 'text/plain' })]),
    });
    expect(await screen.findByText('shot.txt')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '创建工单' }));

    await waitFor(() => expect(uploadCalls).toBe(1));
    const payload = createMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.assigneeType).toBeUndefined();
    expect(assignMock).not.toHaveBeenCalled();
    expect(await screen.findByText('工单详情页')).toBeInTheDocument();
  });

  it('skips assignment and opens the work item when the attachment upload fails', async () => {
    createMock.mockResolvedValue({ id: 102 });
    server.use(http.post('/api/workitems/102/requirement-documents', () => HttpResponse.json(
      { success: false, code: '50000', message: 'storage down', traceId: null },
      { status: 500 },
    )));
    renderModal();

    await fillRequiredFields();
    await pickSquadAndAgent();
    fireEvent.paste(screen.getByLabelText('描述'), {
      clipboardData: clipboardWith([new File([new Uint8Array(8)], 'image.png', { type: 'image/png' })]),
    });
    await screen.findByText(/^粘贴-.*\.png$/);
    await userEvent.click(screen.getByRole('button', { name: '创建并启动' }));

    expect(await screen.findByText('附件上传失败，工单已创建，请在详情页重新上传。')).toBeInTheDocument();
    expect(assignMock).not.toHaveBeenCalled();
    expect(await screen.findByText('工单详情页')).toBeInTheDocument();
  });

  it('opens the created work item when assigning the worker fails after upload', async () => {
    createMock.mockResolvedValue({ id: 103 });
    assignMock.mockRejectedValue(new Error('executor offline'));
    server.use(http.post('/api/workitems/103/requirement-documents', () => ok([])));
    renderModal();

    await fillRequiredFields();
    await pickSquadAndAgent();
    fireEvent.paste(screen.getByLabelText('描述'), {
      clipboardData: clipboardWith([new File([new Uint8Array(8)], 'image.png', { type: 'image/png' })]),
    });
    await screen.findByText(/^粘贴-.*\.png$/);
    await userEvent.click(screen.getByRole('button', { name: '创建并启动' }));

    expect(await screen.findByText('工单已创建，但分配数字员工失败，请在详情页重试。')).toBeInTheDocument();
    expect(assignMock).toHaveBeenCalledWith(expect.objectContaining({ id: 103, assigneeRef: 77 }));
    expect(await screen.findByText('工单详情页')).toBeInTheDocument();
  });
});
