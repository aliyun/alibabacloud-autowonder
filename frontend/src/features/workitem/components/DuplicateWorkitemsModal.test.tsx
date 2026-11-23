import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { i18n } from '@/shared/i18n';
import { DuplicateWorkitemsModal } from './DuplicateWorkitemsModal';
import type { DuplicateMatch } from '../api';

const MATCHES: DuplicateMatch[] = [
  {
    id: 101,
    title: '新增工单重复检测',
    statusName: '新建',
    statusCategory: 'NEW',
    url: 'https://aw.example.com/workitems/101',
    matchType: 'EXACT_TITLE',
  },
  {
    id: 102,
    title: '为工单增加相似需求提醒',
    statusName: '开发中',
    statusCategory: 'IN_PROGRESS',
    url: null,
    matchType: 'SAME_INTENT',
  },
];

describe('DuplicateWorkitemsModal', () => {
  afterEach(async () => { await i18n.changeLanguage('zh-CN'); });

  it('lists matches with new-tab links and a fallback id', async () => {
    render(<DuplicateWorkitemsModal open matches={MATCHES} onDismiss={() => undefined} />);

    expect(screen.getByText('新增工单重复检测')).toBeInTheDocument();
    // 命中类型必须可见：同名与同意图在同一份列表里可区分。
    expect(screen.getByText('同名')).toBeInTheDocument();
    expect(screen.getByText('同意图')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: '在新标签页查看' });
    expect(link).toHaveAttribute('href', 'https://aw.example.com/workitems/101');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // 没有可信地址时只展示 ID，不伪造链接。
    expect(screen.getByText('ID：102')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('dismisses without clearing anything', async () => {
    const onDismiss = vi.fn();
    render(<DuplicateWorkitemsModal open matches={MATCHES} onDismiss={onDismiss} />);

    await userEvent.click(screen.getByRole('button', { name: /忽\s*略/ }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows truncation and partial warning text', () => {
    render(<DuplicateWorkitemsModal open matches={MATCHES} truncated partial onDismiss={() => undefined} />);

    expect(screen.getByText('同名工单过多，仅展示部分结果。')).toBeInTheDocument();
    expect(screen.getByText('重复意图检测未覆盖全部候选工单。')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<DuplicateWorkitemsModal open={false} matches={MATCHES} onDismiss={() => undefined} />);

    expect(screen.queryByText('新增工单重复检测')).not.toBeInTheDocument();
  });

  it('localizes seeded system status and keeps authored names', async () => {
    const matches: DuplicateMatch[] = [
      { id: 201, title: '带来源键', statusName: '进行中', statusLabelKey: 'statusNode.TASK.doing', statusCategory: 'IN_PROGRESS', matchType: 'EXACT_TITLE' },
      { id: 202, title: '无来源键', statusName: '自定义状态', statusLabelKey: null, statusCategory: 'IN_PROGRESS', matchType: 'EXACT_TITLE' },
    ];
    render(<DuplicateWorkitemsModal open matches={matches} onDismiss={() => undefined} />);

    expect(screen.getByText('进行中')).toBeInTheDocument();
    expect(screen.getByText('自定义状态')).toBeInTheDocument();

    await act(async () => { await i18n.changeLanguage('en-US'); });

    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('自定义状态')).toBeInTheDocument();
  });
});
