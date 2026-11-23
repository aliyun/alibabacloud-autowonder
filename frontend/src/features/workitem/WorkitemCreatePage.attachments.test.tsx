import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { message } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import { WorkitemCreatePage } from './WorkitemCreatePage';

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: '0', message: '', traceId: null, data });
}

function createdWorkitem(id: number) {
  return {
    id,
    workType: 'REQ',
    title: '带图片的工单',
    contentMd: '粘贴截图',
    priority: 2,
    assigneeType: 'HUMAN',
    assigneeRef: 10000,
    version: 0,
    gmtCreate: '2026-11-16T10:00:00Z',
    gmtModified: '2026-11-16T10:00:00Z',
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/workitems/new']}>
        <Routes>
          <Route path="/workitems/new" element={<WorkitemCreatePage />} />
          <Route path="/workitems/:id" element={<div>工单详情</div>} />
          <Route path="/workitems" element={<div>工单列表</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function clipboardWith(files: File[]) {
  return { files, items: [], getData: () => '' };
}

async function fillForm() {
  await userEvent.type(screen.getByLabelText('标题'), '带图片的工单');
  await userEvent.type(screen.getByLabelText('描述'), '粘贴截图');
}

describe('WorkitemCreatePage attachments', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.getState().clear();
    useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'O', description: '' }, 'READ_WRITE');
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });

  it('uploads a pasted screenshot to the created work item before leaving the page', async () => {
    const appendSpy = vi.spyOn(FormData.prototype, 'append');
    let uploadCalls = 0;
    server.use(
      http.post('/api/workitems', () => ok(createdWorkitem(88))),
      http.post('/api/workitems/88/requirement-documents', () => {
        uploadCalls += 1;
        return ok([]);
      }),
    );
    renderPage();

    await fillForm();
    fireEvent.paste(screen.getByLabelText('描述'), {
      clipboardData: clipboardWith([new File([new Uint8Array(8)], 'image.png', { type: 'image/png' })]),
    });

    expect(await screen.findByText(/^粘贴-.*\.png$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    expect(await screen.findByText('工单详情')).toBeInTheDocument();
    expect(uploadCalls).toBe(1);
    expect(appendSpy).toHaveBeenCalledWith('files', expect.objectContaining({
      name: expect.stringMatching(/^粘贴-.*\.png$/),
    }));
  });

  it('keeps pasting plain text when the clipboard carries no files', async () => {
    renderPage();
    const description = screen.getByLabelText('描述') as HTMLTextAreaElement;
    fireEvent.change(description, { target: { value: '纯文本内容' } });

    fireEvent.paste(description, {
      clipboardData: { files: [], items: [], getData: () => '纯文本内容' },
    });

    expect(description).toHaveValue('纯文本内容');
    expect(screen.queryByRole('button', { name: /移除附件/ })).not.toBeInTheDocument();
  });

  it('stages a pasted screenshot even when the clipboard also has text', async () => {
    renderPage();

    fireEvent.paste(screen.getByLabelText('描述'), {
      clipboardData: {
        files: [new File([new Uint8Array(8)], 'rich.png', { type: 'image/png' })],
        items: [],
        getData: () => 'rich text',
      },
    });

    expect(await screen.findByText(/^粘贴-.*\.png$/)).toBeInTheDocument();
  });

  it('rejects an oversized pasted image without staging it', async () => {
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(
      () => undefined as unknown as ReturnType<typeof message.error>,
    );
    renderPage();
    await fillForm();

    fireEvent.paste(screen.getByLabelText('描述'), {
      clipboardData: clipboardWith([
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' }),
      ]),
    });

    expect(screen.queryByText(/^粘贴-.*\.png$/)).not.toBeInTheDocument();
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('单个附件大小不能超过 5 MB'));
  });

  it('still opens the created work item when the attachment upload fails', async () => {
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(
      () => undefined as unknown as ReturnType<typeof message.error>,
    );
    let uploadCalls = 0;
    server.use(
      http.post('/api/workitems', () => ok(createdWorkitem(89))),
      http.post('/api/workitems/89/requirement-documents', () => {
        uploadCalls += 1;
        return HttpResponse.json({ success: false, code: '50000', message: 'storage down', traceId: null }, { status: 500 });
      }),
    );
    renderPage();

    await fillForm();
    fireEvent.paste(screen.getByLabelText('描述'), {
      clipboardData: clipboardWith([new File([new Uint8Array(8)], 'shot.png', { type: 'image/png' })]),
    });
    await screen.findByText(/^粘贴-.*\.png$/);
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    expect(await screen.findByText('工单详情')).toBeInTheDocument();
    expect(uploadCalls).toBe(1);
    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('附件上传失败，工单已创建，请在详情页重新上传。'));
  });

  it('submits without uploading after the staged file is removed', async () => {
    let uploadCalls = 0;
    server.use(
      http.post('/api/workitems', () => ok(createdWorkitem(90))),
      http.post('/api/workitems/90/requirement-documents', () => {
        uploadCalls += 1;
        return ok([]);
      }),
    );
    renderPage();

    await fillForm();
    fireEvent.change(screen.getByTestId('workitem-create-file-input'), {
      target: { files: [new File([new Uint8Array(8)], 'plain.png', { type: 'image/png' })] },
    });
    expect(await screen.findByText('plain.png')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '移除附件 plain.png' }));

    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    expect(await screen.findByText('工单详情')).toBeInTheDocument();
    expect(uploadCalls).toBe(0);
  });
});
