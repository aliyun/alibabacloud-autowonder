import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '@/shared/i18n';
import { WorkitemMeta } from './components/WorkitemMeta';

const baseProps = {
  workType: 'TASK',
  priority: 2,
  assigneeName: null,
  assigneeType: 'HUMAN' as const,
  creatorDisplayName: null,
  sdlcName: null,
};

describe('workitem status system label', () => {
  afterEach(async () => { await i18n.changeLanguage('zh-CN'); });

  it('renders seeded status through the system label key and follows language switches', async () => {
    render(<WorkitemMeta {...baseProps} statusName="进行中" statusLabelKey="statusNode.TASK.doing" />);
    expect(screen.getByText('进行中')).toBeInTheDocument();
    await i18n.changeLanguage('en-US');
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    await i18n.changeLanguage('zh-CN');
    expect(screen.getByText('进行中')).toBeInTheDocument();
  });

  it('keeps authored or unknown status names verbatim', async () => {
    const { rerender } = render(<WorkitemMeta {...baseProps} statusName="自定义状态" statusLabelKey={null} />);
    await i18n.changeLanguage('en-US');
    expect(screen.getByText('自定义状态')).toBeInTheDocument();
    rerender(<WorkitemMeta {...baseProps} statusName="自定义状态" statusLabelKey="statusNode.REQ.unknown" />);
    expect(screen.getByText('自定义状态')).toBeInTheDocument();
  });
});
