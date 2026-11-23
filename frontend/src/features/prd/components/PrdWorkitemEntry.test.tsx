import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PrdContextPreview } from './PrdContextPreview';
import { PrdWorkitemEntry } from './PrdWorkitemEntry';

vi.mock('../hooks', () => ({
  usePrdVersions: () => ({ data: [{ id: 7, versionNo: 1 }] }),
  usePrdVersion: () => ({ data: undefined }),
}));

describe('PrdWorkitemEntry', () => {
  it('retains clarification while hiding PRD design in Community workitems', async () => {
    const onClarify = vi.fn();
    render(<MemoryRouter><PrdWorkitemEntry onClarify={onClarify} /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: '需求与设计' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /PRD 设计/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /AI 需求澄清/ }));
    expect(onClarify).toHaveBeenCalledOnce();
    expect(screen.queryByText('交付模式')).not.toBeInTheDocument();
  });
  it('renders no tools when clarification is disabled', () => {
    render(<MemoryRouter><PrdWorkitemEntry /></MemoryRouter>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});

describe('PrdContextPreview', () => {
  it('shows the saved design preview without a design editing link', () => {
    const { container } = render(<MemoryRouter><PrdContextPreview workitemId="42" /></MemoryRouter>);
    expect(container.querySelector('summary')).toBeInTheDocument();
    expect(container.querySelector('a[href="/workitems/42/design"]')).toBeNull();
  });
});
