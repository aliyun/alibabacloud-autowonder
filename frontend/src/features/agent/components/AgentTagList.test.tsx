import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentTagList } from './AgentTagList';

describe('AgentTagList', () => {
  it('renders system tags before custom tags and folds overflow into a +N chip', async () => {
    render(
      <AgentTagList
        systemTags={['REQ_CLARIFY', 'PROTOTYPE_DESIGN']}
        customTags={['报表', 'React']}
        maxVisible={3}
      />,
    );

    expect(screen.getByText('需求澄清')).toBeInTheDocument();
    expect(screen.getByText('原型设计')).toBeInTheDocument();
    expect(screen.getByText('报表')).toBeInTheDocument();
    expect(screen.queryByText('React')).not.toBeInTheDocument();

    await userEvent.hover(screen.getByText('+1'));
    expect(await screen.findByText('React')).toBeInTheDocument();
  });

  it('shows every tag when maxVisible is null', () => {
    render(<AgentTagList systemTags={['REQ_CLARIFY']} customTags={['a', 'b', 'c']} maxVisible={null} />);

    for (const label of ['需求澄清', 'a', 'b', 'c']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it('collapses every tag into the overflow chip when maxVisible is zero', () => {
    render(<AgentTagList customTags={['a', 'b']} maxVisible={0} />);

    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.queryByText('a')).not.toBeInTheDocument();
  });

  it('renders the default dash for an untagged worker', () => {
    render(<AgentTagList />);

    expect(screen.getByTestId('agent-tags')).toHaveTextContent('—');
  });

  it('uses the provided empty text for the detail page', () => {
    render(<AgentTagList emptyText="暂无标签" testId="detail-tags" />);

    expect(screen.getByTestId('detail-tags')).toHaveTextContent('暂无标签');
  });

  it('falls back to the raw code for an unknown system tag', () => {
    render(<AgentTagList systemTags={['LEGACY_CODE']} />);

    expect(screen.getByText('LEGACY_CODE')).toBeInTheDocument();
  });
});
