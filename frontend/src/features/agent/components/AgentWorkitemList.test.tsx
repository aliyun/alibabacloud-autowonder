import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { AgentWorkitemList, PRIORITY_TAG_COLOR } from './AgentWorkitemList';
import { priorityMap } from '@/features/workitem/constants';

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: '0', message: '', traceId: null, data });
}

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AgentWorkitemList agentId={1} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockWorkitems(list: Array<{ id: number; title: string; priority: number; statusCategory: string; statusName?: string | null }>) {
  server.use(
    http.get('/api/workitems', ({ request }) => {
      const url = new URL(request.url);
      const category = url.searchParams.get('statusCategory');
      const page = Number(url.searchParams.get('page') ?? '1');
      const size = Number(url.searchParams.get('size') ?? '20');
      const filtered = category ? list.filter(w => w.statusCategory === category) : list;
      return ok({
        list: filtered.slice((page - 1) * size, page * size).map(w => ({
          id: w.id, workType: 'REQ', title: w.title, contentMd: '', templateId: null,
          statusNodeId: null, statusName: w.statusName === undefined ? w.title : w.statusName, sdlcId: null, sdlcName: null,
          assigneeType: 'AGENT', assigneeRef: 1, assigneeName: 'A', priority: w.priority,
          version: 1, gmtCreate: '', gmtModified: '',
        })),
        total: filtered.length,
        pageNum: page,
        pageSize: size,
      });
    }),
  );
}

describe('AgentWorkitemList 优先级展示', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the shared Chinese priority labels with their colors', async () => {
    mockWorkitems([
      { id: 1, title: '紧急任务', priority: 0, statusCategory: 'IN_PROGRESS' },
      { id: 2, title: '低优任务', priority: 3, statusCategory: 'IN_PROGRESS' },
    ]);
    renderList();

    // jsdom drops var() inline styles, so assert the label text and the palette entry behind it.
    expect(await screen.findByText('紧急')).toBeInTheDocument();
    expect(screen.getByText('低')).toBeInTheDocument();
    expect(PRIORITY_TAG_COLOR[priorityMap[0].color]).toBe('red');
    expect(PRIORITY_TAG_COLOR[priorityMap[3].color]).toBe('gray');
  });

  it('shows 未知优先级 for unknown priority values', async () => {
    mockWorkitems([{ id: 1, title: '未知任务', priority: 9, statusCategory: 'IN_PROGRESS' }]);
    renderList();

    expect(await screen.findByText('未知优先级')).toBeInTheDocument();
  });

  it('renders a placeholder when the system status is absent', async () => {
    mockWorkitems([{ id: 3, title: '无状态任务', priority: 2, statusCategory: 'IN_PROGRESS', statusName: null }]);
    renderList();

    const row = await screen.findByRole('row', { name: /无状态任务/ });
    expect(within(row).getAllByText('-').length).toBeGreaterThan(0);
  });

  it('paginates against the server instead of truncating at a fixed cap', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1, title: `任务${i + 1}号`, priority: 3, statusCategory: 'IN_PROGRESS',
    }));
    let secondPageServed = false;
    server.use(
      http.get('/api/workitems', ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get('page') ?? '1');
        if (page === 2) secondPageServed = true;
        return ok({
          list: rows.slice((page - 1) * 20, page * 20).map(w => ({
            id: w.id, workType: 'REQ', title: w.title, contentMd: '', templateId: null,
            statusNodeId: null, statusName: '开发中', sdlcId: null, sdlcName: null,
            assigneeType: 'AGENT', assigneeRef: 1, assigneeName: 'A', priority: w.priority,
            version: 1, gmtCreate: '', gmtModified: '',
          })),
          total: rows.length,
          pageNum: page,
          pageSize: 20,
        });
      }),
    );
    renderList();

    expect(await screen.findByText('任务1号')).toBeInTheDocument();
    expect(screen.getByText(/共 25 条/)).toBeInTheDocument();
    // 第二页按钮可点且真的向服务端发起 page=2 请求
    fireEvent.click(document.querySelector('.ant-pagination .ant-pagination-item-2') as HTMLElement);
    expect(await screen.findByText('任务21号')).toBeInTheDocument();
    expect(secondPageServed).toBe(true);
  });
});
