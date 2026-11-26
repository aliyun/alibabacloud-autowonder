import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '@/test/mocks/server';
import { PrdSharedReviewPage } from './PrdSharedReviewPage';

vi.mock('@/shared/i18n/LanguageSwitch', () => ({ LanguageSwitch: () => null }));
vi.mock('./components/PrdDesignBrowser', () => ({ PrdDesignBrowser: ({ remote }: { remote: { context: { comments: { comment: { commentText: string } }[] }; entry: { status: string } | null; reconnect: () => void } }) =>
  <div><p>{remote.context.comments[0]?.comment.commentText}</p><output>{remote.entry?.status}</output><button onClick={remote.reconnect}>重试</button></div> }));
const ok = (data: unknown) => HttpResponse.json({ success: true, code: '0', data });

describe('shared live design review', () => {
  it('keeps comments readable offline and obtains a new preview session after recovery', async () => {
    let online = false;
    const entries = vi.fn();
    server.use(
      http.get('/api/design-reviews/token', () => ok({ title: 'Shared product design', workitemId: 10, viewerId: 9, runtime: {}, sourceKey: 'source', canManage: false,
        comments: [{ comment: { commentText: 'Persisted review feedback' } }] })),
      http.get('/api/design-reviews/token/preview-status', () => ok({ status: online ? 'READY' : 'OFFLINE', origin: online ? 'https://design.preview.example.com' : null })),
      http.post('/api/design-reviews/token/preview-session', () => { entries(); return ok({ status: 'READY', origin: 'https://design.preview.example.com', code: 'entry', expiresAt: null }); }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/design-reviews/token?route=%2Fsettings%3Fq%3D1%23save']}><Routes>
      <Route path="/design-reviews/:token" element={<PrdSharedReviewPage />} />
    </Routes></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('Persisted review feedback')).toBeInTheDocument();
    expect(await screen.findByText('OFFLINE')).toBeInTheDocument(); expect(entries).not.toHaveBeenCalled();
    online = true; await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(screen.getByText('READY')).toBeInTheDocument()); expect(entries).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Persisted review feedback')).toBeInTheDocument();
    expect(screen.queryByText('需求文档')).not.toBeInTheDocument();
    expect(screen.queryByText('Shared product design')).not.toBeInTheDocument();
    expect(view.container.querySelector('.prd-design-surface')).toBeNull();
    view.unmount(); client.clear();
  });
});
