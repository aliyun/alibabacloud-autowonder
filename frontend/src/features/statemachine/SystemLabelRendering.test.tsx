import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import { i18n } from '@/shared/i18n';
import { StatusTemplatePage } from './StatusTemplatePage';

const ok = (data: unknown) => HttpResponse.json({ success: true, code: '0', message: '', traceId: null, data });

const template = {
  id: 1, workType: 'REQ', name: '需求默认流程', systemLabelKey: 'statusTemplate.REQ',
  isDefault: true, gmtCreate: '2026-07-01', gmtModified: '2026-07-01',
};

const detail = {
  ...template,
  nodes: [
    { id: 10, templateId: 1, code: 'new', name: '新建', systemLabelKey: 'statusNode.REQ.new', category: 'INIT', sort: 0, gmtCreate: '2026-07-01' },
    { id: 11, templateId: 1, code: 'developing', name: '开发中', systemLabelKey: 'statusNode.REQ.developing', category: 'IN_PROGRESS', sort: 1, gmtCreate: '2026-07-01' },
    { id: 12, templateId: 1, code: 'released', name: '已发布', systemLabelKey: null, category: 'DONE', sort: 2, gmtCreate: '2026-07-01' },
  ],
  transitions: [
    { id: 100, templateId: 1, fromNodeId: 10, toNodeId: 11, name: '前进', systemLabelKey: 'statusTransition.forward', gmtCreate: '2026-07-01' },
    { id: 101, templateId: 1, fromNodeId: 11, toNodeId: 12, name: '自定义流转', systemLabelKey: null, gmtCreate: '2026-07-01' },
    { id: 102, templateId: 1, fromNodeId: 11, toNodeId: 12, name: null, systemLabelKey: null, gmtCreate: '2026-07-01' },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <StatusTemplatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('status template system labels', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'O', description: '' }, 'READ_ONLY');
    server.use(
      http.get('/api/status-templates', () => ok([template])),
      http.get('/api/status-templates/1', () => ok(detail)),
    );
  });
  afterEach(async () => { await i18n.changeLanguage('zh-CN'); });

  it('translates seeded template, node and transition names while keeping authored names', async () => {
    renderPage();
    expect(await screen.findByText('新建')).toBeInTheDocument();
    expect(screen.getByText('开发中')).toBeInTheDocument();
    expect(screen.getByText('已发布')).toBeInTheDocument();
    expect(screen.getByText('前进')).toBeInTheDocument();
    expect(screen.getByText('自定义流转')).toBeInTheDocument();

    await act(async () => { await i18n.changeLanguage('en-US'); });

    expect(await screen.findByText('New')).toBeInTheDocument();
    expect(screen.getByText('In Development')).toBeInTheDocument();
    expect(screen.getByText('Advance')).toBeInTheDocument();
    // 选中项文案为「名称 · 默认」，系统标签翻译后仍包含英文名
    expect(screen.getByText(/Requirement Default Flow/)).toBeInTheDocument();
    // 无来源键的名称与用户自建流转保持原文
    expect(screen.getByText('已发布')).toBeInTheDocument();
    expect(screen.getByText('自定义流转')).toBeInTheDocument();
  });
});
