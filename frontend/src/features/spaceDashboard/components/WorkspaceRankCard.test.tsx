import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceRankCard, RANK_DISPLAY_LIMIT, type RankEntry } from './WorkspaceRankCard';

const entries: RankEntry[] = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  name: `空间${index + 1}`,
  value: '0',
}));

function renderCard(props: Partial<Parameters<typeof WorkspaceRankCard>[0]> = {}) {
  const onSelect = vi.fn();
  const view = render(
    <WorkspaceRankCard
      testId="rank"
      title="已完成工单最多的空间"
      entries={entries}
      total={entries.length}
      emptyText="暂无数据"
      onSelect={onSelect}
      {...props}
    />,
  );
  return { onSelect, ...view };
}

describe('WorkspaceRankCard', () => {
  it('shows the first ten tied workspaces and summarises the rest', async () => {
    renderCard();

    expect(screen.getAllByTestId(/^rank-item-/)).toHaveLength(RANK_DISPLAY_LIMIT);
    expect(screen.queryByTestId('rank-item-11')).toBeNull();
    expect(screen.getByTestId('rank-more')).toHaveTextContent('等 12 个空间');

    await userEvent.hover(screen.getByTestId('rank-more'));
    const tooltip = await screen.findByText(/并列共 12 个空间/);
    expect(tooltip).toHaveTextContent('空间1');
    expect(tooltip).toHaveTextContent('空间12');
  });

  it('prefers the backend tie total over the rendered rows', () => {
    renderCard({ entries: entries.slice(0, 2), total: 7 });

    expect(screen.getAllByTestId(/^rank-item-/)).toHaveLength(2);
    expect(screen.getByTestId('rank-more')).toHaveTextContent('等 7 个空间');
  });

  it('drills into the workspace on click', async () => {
    const { onSelect } = renderCard();

    await userEvent.click(screen.getByTestId('rank-item-3'));

    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('renders the empty text and no summary when nothing ties', () => {
    renderCard({ entries: [], total: 0 });

    expect(screen.getByText('暂无数据')).toBeInTheDocument();
    expect(screen.queryByTestId('rank-more')).toBeNull();
  });

  it('formats each chip as name plus value', () => {
    renderCard({ entries: [{ id: 9, name: '数据中台', value: '1,234' }], total: 1 });

    const chip = screen.getByTestId('rank-item-9');
    expect(within(chip).getByText('数据中台')).toBeInTheDocument();
    expect(within(chip).getByText('1,234')).toBeInTheDocument();
  });

  it('exposes the complete long raw name and numeric value in titles and the tooltip', async () => {
    const name = 'Long workspace <script>original</script> 名称'.repeat(4);
    const value = '123,456,789,012,345.67';
    renderCard({ entries: [{ id: 9, name, value }], total: 1 });
    const chip = screen.getByTestId('rank-item-9');
    expect(within(chip).getByText(name)).toHaveAttribute('title', name);
    expect(within(chip).getByText(value)).toHaveAttribute('title', value);
    expect(chip).toHaveAccessibleName(`${name} ${value}`);
    expect(chip.querySelector('script')).toBeNull();
    await userEvent.hover(chip);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(name);
    expect(tooltip).toHaveTextContent(value);
  });

  it('retains all zero ties and the full backend total in the summary tooltip', async () => {
    renderCard();
    for (const chip of screen.getAllByTestId(/^rank-item-/)) {
      expect(chip.querySelector('.space-dashboard-rank-value')).toHaveTextContent(/^0$/);
    }
    await userEvent.hover(screen.getByTestId('rank-more'));
    const tooltip = await screen.findByRole('tooltip');
    for (const entry of entries) expect(tooltip).toHaveTextContent(entry.name);
    expect(tooltip).toHaveTextContent('并列共 12 个空间，仅展示前 10 个');
  });

  it('scales bar widths against the largest value in the card', () => {
    renderCard({
      entries: [
        { id: 1, name: '空间一', value: '100', num: 100 },
        { id: 2, name: '空间二', value: '25', num: 25 },
        { id: 3, name: '空间三', value: '0', num: 0 },
      ],
      total: 3,
    });

    const widths = screen.getAllByTestId(/^rank-item-/).map(
      row => row.querySelector<HTMLElement>('.space-dashboard-rank-fill')?.style.width,
    );
    expect(widths[0]).toBe('100%');
    expect(widths[1]).toBe('25%');
    expect(widths[2]).toBe('0%');
  });

  it('keeps every bar at zero width when all tied values are zero or missing', () => {
    renderCard({ entries: [{ id: 1, name: '空间一', value: '0' }, { id: 2, name: '空间二', value: '0', num: 0 }], total: 2 });

    for (const row of screen.getAllByTestId(/^rank-item-/)) {
      expect(row.querySelector<HTMLElement>('.space-dashboard-rank-fill')?.style.width).toBe('0%');
    }
  });

  it('marks the bottom-rank card with the low tone for the neutral bar colour', () => {
    renderCard({ entries: [{ id: 9, name: '数据中台', value: '1,234', num: 1234 }], total: 1, tone: 'low' });

    expect(screen.getByTestId('rank').closest('.space-dashboard-rank--low')).not.toBeNull();
  });
});
