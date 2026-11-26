import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/shared/auth/store';
import { i18n } from '@/shared/i18n';
import { OfficePage } from './OfficePage';
import { loadOffice } from './api';
import type { OfficeSnapshot } from './model';
import type { VisualState } from './scene/visual';

let animator: VisualState;
let tick: (() => void) | undefined;
vi.mock('./OfficeScene', () => ({ OfficeScene: (props: { visual: VisualState; onTick?: () => void }) => {
  animator = props.visual; tick = props.onTick; return null;
} }));
vi.mock('./api', () => ({ loadOffice: vi.fn(), COMPLETION_DAYS: 30 }));
vi.mock('./insights', () => ({ useOfficeInsights: () => ({ metrics: {}, activities: [
  { id: 'real-event', title: 'Real activity', status: 'running', occurredAt: 0, employee: 'Real employee' },
], refresh: vi.fn() }) }));

afterEach(() => { useAuthStore.getState().clear(); vi.clearAllMocks(); });

it('updates the board from simulated claims and deliveries, then restores the refreshed real totals and feed', async () => {
  await i18n.changeLanguage('zh-CN');
  useAuthStore.setState({ currentWorkspace: { id: 1, name: 'Workspace', description: '' } });
  const source: OfficeSnapshot = {
    counts: { pending: 91, active: 82, done: 73 }, tasks: { pending: [], active: [], done: [] },
    updatedAt: '', partialFailure: false, events: [],
    members: [1, 2, 3].map(id => ({ id, name: `Person ${id}`, group: 'engineering', role: '', chief: false,
      state: 'idle', runningTasks: 0, heartbeat: null, squads: [], workitemIds: [] })),
  };
  vi.mocked(loadOffice).mockResolvedValue(source);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container, unmount } = render(<QueryClientProvider client={client}><MemoryRouter><OfficePage /></MemoryRouter></QueryClientProvider>);
  const values = () => [...container.querySelectorAll('.awo-metric .awo-number')].map(node => node.getAttribute('aria-label'));
  await waitFor(() => expect(values()).toEqual(['91', '82', '73']));
  fireEvent.click(screen.getByRole('button', { name: '模拟工作' }));
  await waitFor(() => expect(values()).toEqual(['3', '2', '0']));
  expect(screen.queryByText('Real activity')).not.toBeInTheDocument();
  act(() => { for (let i = 0; i < 1200; i++) animator.advance(.1); tick?.(); });
  expect(Number(values()[2])).toBeGreaterThan(0);
  expect(container.querySelectorAll('[data-event-id]').length).toBeGreaterThan(0);
  expect(container.querySelector('[data-event-id] a')).toBeNull();
  act(() => client.setQueryData(['office', 1], { ...source, counts: { pending: 90, active: 83, done: 74 } }));
  await waitFor(() => expect(values()).not.toEqual(['90', '83', '74']));
  fireEvent.click(screen.getByRole('button', { name: '结束模拟' }));
  await waitFor(() => expect(values()).toEqual(['90', '83', '74']));
  expect(screen.getByText('Real activity')).toBeInTheDocument();
  expect(source.counts).toEqual({ pending: 91, active: 82, done: 73 });
  unmount(); client.clear();
});
