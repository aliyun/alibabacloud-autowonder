import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { message } from 'antd';
import { server } from '@/test/mocks/server';
import { useAuthStore } from '@/shared/auth/store';
import {
  AgentTagsEditor,
  normalizeAgentTagValues,
  splitAgentTagValues,
  validateAgentTagValues,
} from './AgentTagsEditor';
import type { Agent } from '../api';

function ok(data: unknown) {
  return HttpResponse.json({ success: true, code: '0', message: '', traceId: null, data });
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 1,
    name: 'Alpha',
    avatarUrl: null,
    status: 'ONLINE',
    onlineVersionId: null,
    editingVersionId: null,
    version: 1,
    latestVersionNo: 1,
    gmtCreate: '2026-07-01',
    systemTags: [],
    customTags: [],
    ...overrides,
  };
}

function renderEditor(agent: Agent = makeAgent()) {
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AgentTagsEditor agent={agent} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

const saveButton = () => screen.getByRole('button', { name: /保\s*存/ });

describe('AgentTagsEditor', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'O', description: '' }, 'READ_WRITE');
    vi.restoreAllMocks();
    server.use(http.get('/api/agents/tag-options', () => ok(['报表'])));
  });

  it('offers system tags and workspace custom tag suggestions', async () => {
    renderEditor();

    expect(await screen.findByText('报表', { selector: '.ant-select-item-option-content' })).toBeInTheDocument();
    expect(screen.getByText('需求澄清', { selector: '.ant-select-item-option-content' })).toBeInTheDocument();
    expect(screen.getByText('原型设计', { selector: '.ant-select-item-option-content' })).toBeInTheDocument();
  });

  it('submits split system and custom tags then closes', async () => {
    const success = vi.spyOn(message, 'success').mockImplementation(
      () => undefined as unknown as ReturnType<typeof message.success>,
    );
    const payloads: unknown[] = [];
    server.use(http.put('/api/agents/1/tags', async ({ request }) => {
      payloads.push(await request.json());
      return ok(makeAgent({ systemTags: ['REQ_CLARIFY'], customTags: ['报表'] }));
    }));
    const { onClose } = renderEditor(makeAgent({ systemTags: ['REQ_CLARIFY'], customTags: ['报表'] }));

    await userEvent.click(saveButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(payloads).toEqual([{ systemTags: ['REQ_CLARIFY'], customTags: ['报表'] }]);
    expect(success).toHaveBeenCalledWith('标签已保存');
  });

  it('preserves exact custom names loaded from the API when saving', async () => {
    const customTags = ['报表,测试', 'REQ_CLARIFY', 'Ops', 'ops'];
    const payloads: unknown[] = [];
    server.use(http.put('/api/agents/1/tags', async ({ request }) => {
      payloads.push(await request.json());
      return ok(makeAgent({ systemTags: ['REQ_CLARIFY'], customTags }));
    }));
    const { onClose } = renderEditor(makeAgent({ systemTags: ['REQ_CLARIFY'], customTags }));

    await userEvent.click(saveButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(payloads).toEqual([{ systemTags: ['REQ_CLARIFY'], customTags }]);
  });

  it('disables save and explains why a tag is too long', () => {
    renderEditor(makeAgent({ customTags: ['x'.repeat(65)] }));

    expect(screen.getByRole('alert')).toHaveTextContent('单个标签最长 64 个字符');
    expect(saveButton()).toBeDisabled();
  });

  it('disables save when more than fifty tags are selected', () => {
    renderEditor(makeAgent({ customTags: Array.from({ length: 51 }, (_, index) => `tag-${index}`) }));

    expect(screen.getByRole('alert')).toHaveTextContent('最多 50 个标签');
    expect(saveButton()).toBeDisabled();
  });

  it('rejects a custom tag that collides with a localized system tag name', () => {
    renderEditor(makeAgent({ customTags: ['Requirement Clarification'] }));

    expect(screen.getByRole('alert')).toHaveTextContent('该名称与系统标签重名，请直接选用系统标签');
    expect(saveButton()).toBeDisabled();
  });

  it('keeps the draft and the editor open when saving fails', async () => {
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(
      () => undefined as unknown as ReturnType<typeof message.error>,
    );
    server.use(http.put('/api/agents/1/tags', () =>
      HttpResponse.json({ success: false, code: '14016', message: 'tag save failed', traceId: null }, { status: 400 })));
    const { onClose } = renderEditor(makeAgent({ customTags: ['报表'] }));

    await userEvent.click(saveButton());

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('tag save failed'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('agent-tags-editor')).toBeInTheDocument();
    expect(screen.getByText('报表', { selector: '.ant-select-selection-item-content' })).toBeInTheDocument();
  });

  it('closes on cancel and on Escape without saving', async () => {
    const put = vi.fn();
    server.use(http.put('/api/agents/1/tags', () => {
      put();
      return ok(makeAgent());
    }));
    const { onClose } = renderEditor();

    await userEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(put).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps Save/Cancel above the always-open select so the dropdown cannot cover them', () => {
    renderEditor();
    const editor = screen.getByTestId('agent-tags-editor');
    const bar = editor.querySelector('.agent-tags-editor-bar');

    expect(bar).not.toBeNull();
    expect(bar).toContainElement(saveButton());
    expect(bar).toContainElement(screen.getByRole('button', { name: /取\s*消/ }));
    // The buttons precede the select in document order; the dropdown only expands downwards.
    const combobox = screen.getByRole('combobox');
    expect((bar as Element).compareDocumentPosition(combobox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('closes on Escape even when the focused select swallows the bubbling keydown', () => {
    const { onClose } = renderEditor();
    const combobox = screen.getByRole('combobox');
    const swallow = (event: KeyboardEvent) => event.stopPropagation();
    // Mimics rc-select stopping the bubbling Escape before it reaches the document.
    combobox.addEventListener('keydown', swallow);

    fireEvent.keyDown(combobox, { key: 'Escape', keyCode: 27 });

    combobox.removeEventListener('keydown', swallow);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('agent tag value helpers', () => {
  it('trims, splits on both comma separators and dedupes exact values', () => {
    expect(normalizeAgentTagValues([' a,b，c ', 'a', '', '   '])).toEqual(['a', 'b', 'c']);
  });

  it('separates system codes in declaration order from custom names', () => {
    expect(splitAgentTagValues(['PROTOTYPE_DESIGN', 'custom', 'REQ_CLARIFY'])).toEqual({
      systemTags: ['REQ_CLARIFY', 'PROTOTYPE_DESIGN'],
      customTags: ['custom'],
    });
  });

  it('accepts a valid draft', () => {
    expect(validateAgentTagValues(['REQ_CLARIFY', '报表'])).toBeNull();
  });

  it('flags a Chinese system tag collision case-insensitively after trim', () => {
    expect(validateAgentTagValues(['  原型设计 '])).not.toBeNull();
  });
});
