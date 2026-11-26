import { message } from 'antd';
import { statusCategoryOf } from '../constants';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { within, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/shared/auth/store';
import { WorkitemKanban } from './WorkitemKanban';
import type { Workitem } from '@/shared/types/workitem';

function mk(partial: Partial<Workitem>): Workitem {
  return {
    id: 1,
    workType: 'REQ',
    title: 't',
    contentMd: '',
    templateId: null,
    statusNodeId: null,
    statusName: '开发中',
    statusCategory: 'NEW',
    sdlcId: null,
    sdlcName: null,
    assigneeType: 'HUMAN',
    assigneeRef: null,
    assigneeName: null,
    assigneeDisplayName: null,
    creatorId: null,
    creatorName: null,
    creatorDisplayName: null,
    priority: 3,
    version: 1,
    gmtCreate: '',
    gmtModified: '',
    ...partial,
  } as Workitem;
}

function renderKanban(props: React.ComponentProps<typeof WorkitemKanban>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkitemKanban {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WorkitemKanban 待决策列展示', () => {
  it('renders pending-decision cards flat without assignee grouping headers', () => {
    const items = [
      mk({ id: 1, statusCategory: 'PENDING_DECISION', assigneeType: 'HUMAN', assigneeRef: 10, assigneeDisplayName: '张三', title: '决策A' }),
      mk({ id: 2, statusCategory: 'PENDING_DECISION', assigneeType: 'HUMAN', assigneeRef: 10, assigneeName: '张三', title: '决策B' }),
      mk({ id: 3, statusCategory: 'PENDING_DECISION', assigneeType: 'HUMAN', assigneeRef: 20, assigneeDisplayName: '李四', title: '决策C' }),
    ];
    renderKanban({ items, pendingDecisionSummary: { name: '张三', count: 52 } });

    // 三个待决策工单标题都在
    expect(screen.getByText('决策A')).toBeInTheDocument();
    expect(screen.getByText('决策B')).toBeInTheDocument();
    expect(screen.getByText('决策C')).toBeInTheDocument();
    // 列头徽标只显示「我的待决策 + 服务端计数」
    const summary = screen.getByLabelText('决策人汇总');
    expect(summary).toHaveTextContent('我的待决策 52');
    expect(summary.parentElement).toContainElement(screen.getByText('待决策'));
    // 待决策列与其他泳道一致平铺，不再按决策人分组（验收返修 8/11）
    expect(document.querySelectorAll('.aw-kb-group')).toHaveLength(0);
  });

  it('filters to only mine when onlyMine is set', () => {
    const items = [
      mk({ id: 1, statusCategory: 'PENDING_DECISION', assigneeType: 'HUMAN', assigneeRef: 42, assigneeDisplayName: '张三', title: '我的决策' }),
      mk({ id: 2, statusCategory: 'PENDING_DECISION', assigneeType: 'HUMAN', assigneeRef: 99, assigneeDisplayName: '李四', title: '别人的决策' }),
    ];
    renderKanban({ items, onlyMine: true, currentUserId: 42, pendingDecisionSummary: { name: '张三', count: 1 } });
    expect(screen.queryByLabelText('决策人汇总')).not.toBeInTheDocument();

    expect(screen.getByText('我的决策')).toBeInTheDocument();
    expect(screen.queryByText('别人的决策')).not.toBeInTheDocument();
    // 别的决策人不应出现
    expect(screen.queryByText('李四')).not.toBeInTheDocument();
  });

  it('renders a single decision owner with a count-only summary badge', () => {
    const name = '需要完整悬停展示的超长决策人姓名';
    renderKanban({ pendingDecisionSummary: { name, count: 1 }, items: [mk({ id: 1, statusCategory: 'PENDING_DECISION', assigneeType: 'HUMAN', assigneeRef: 42, assigneeDisplayName: name })] });
    expect(screen.getByLabelText('决策人汇总')).toHaveTextContent('我的待决策 1');
    // 决策人姓名只在卡片脚的指派人出现一次（列头徽标只显示计数，无组头）
    expect(document.querySelectorAll('.aw-kb-group')).toHaveLength(0);
    expect(screen.getAllByText(name)).toHaveLength(1);
  });

  it('shows dedicated empty hint when onlyMine yields nothing', () => {
    const items = [
      mk({ id: 1, statusCategory: 'PENDING_DECISION', assigneeType: 'HUMAN', assigneeRef: 99, assigneeDisplayName: '李四', title: '别人的决策' }),
    ];
    renderKanban({ items, onlyMine: true, currentUserId: 42, pendingDecisionSummary: { name: '张三', count: 1 } });
    expect(screen.queryByLabelText('决策人汇总')).not.toBeInTheDocument();

    expect(screen.getByText('暂无需要您决策的工单')).toBeInTheDocument();
    expect(screen.queryByText('别人的决策')).not.toBeInTheDocument();
  });

  it('leaves non-pending columns flat (no grouping headers)', () => {
    const items = [
      mk({ id: 1, pendingDecision: false, statusName: '待处理', assigneeType: 'HUMAN', assigneeRef: 10, assigneeDisplayName: '张三', title: '普通任务' }),
    ];
    renderKanban({ items });

    expect(screen.getByText('普通任务')).toBeInTheDocument();
    expect(document.querySelectorAll('.aw-kb-group')).toHaveLength(0);
  });

  it('labels imported workitems and shows the external reporter', () => {
    renderKanban({ items: [mk({
      id: 10,
      title: '来源需求',
      statusName: '待处理',
      sourceType: 'EXTERNAL',
      sourceProvider: 'AONE',
      sourceUrl: 'https://aone.example.com/v2/project/2087214/req/84877007',
      creatorDisplayName: '导入人（10009）',
      sourceCreator: {
        id: 20001, provider: 'AONE', subjectId: '440501', subjectType: 'USER',
        displayName: '煊童', mappedUserId: null,
      },
    })] });

    const sourceLink = screen.getByRole('link', { name: /来自 Aone/ });
    expect(sourceLink).toHaveAttribute(
      'href',
      'https://aone.example.com/v2/project/2087214/req/84877007',
    );
    expect(sourceLink).toHaveAttribute('target', '_blank');
    expect(screen.getByText('来源提出人: 煊童')).toBeInTheDocument();
    expect(screen.queryByText(/440501/)).not.toBeInTheDocument();
    expect(screen.queryByText('创建者: 导入人（10009）')).not.toBeInTheDocument();
  });

  it('does not add a source tag to locally created workitems', () => {
    renderKanban({ items: [mk({ id: 11, title: '本地创建', sourceType: 'NATIVE' })] });

    expect(screen.queryByText(/来自 Aone/)).not.toBeInTheDocument();
  });
});

describe('WorkitemKanban 优先级与姓名展示', () => {
  it('renders the priority as an outline tag beside the work type tag', () => {
    renderKanban({ items: [mk({ id: 1, priority: 0, title: '紧急工单' })] });
    const row = screen.getByText('紧急').closest('div')!;
    expect(row).toContainElement(screen.getByText('需求'));
    expect(row).toHaveStyle({ flexWrap: 'wrap' });
  });

  it('shows 未知优先级 for unknown priority values without treating them as low', () => {
    renderKanban({ items: [mk({ id: 1, priority: 7, title: '未知优先级工单' })] });
    expect(screen.getByText('未知优先级')).toBeInTheDocument();
  });

  it('strips id suffixes from assignee names and drops the creator line', () => {
    renderKanban({ items: [mk({
      id: 1,
      title: '姓名工单',
      assigneeType: 'AGENT',
      assigneeRef: 40013,
      assigneeName: 'agent-40013',
      assigneeDisplayName: 'AW全栈开发(40013)',
      creatorDisplayName: '蔡何（10000）',
    })] });

    expect(screen.getByTitle('当前处理人: AW全栈开发')).toHaveTextContent('AW全栈开发');
    expect(screen.queryByText(/创建者/)).not.toBeInTheDocument();
    expect(screen.queryByText(/40013/)).not.toBeInTheDocument();
    expect(screen.queryByText(/10000/)).not.toBeInTheDocument();
  });

  it('preserves the full long assignee name in the hover title', () => {
    const assignee = '负责前端验收的超长数字员工名称';
    renderKanban({ items: [mk({ id: 1, assigneeType: 'AGENT', assigneeDisplayName: assignee })] });
    const field = screen.getByTitle(`当前处理人: ${assignee}`);
    expect(field).toHaveTextContent(assignee);
  });

  it('shows 未指派 for unassigned cards', () => {
    renderKanban({ items: [mk({ id: 1, title: '无人工单', assigneeName: null, assigneeDisplayName: null })] });
    expect(screen.getByTitle('当前处理人: 未指派')).toHaveTextContent('未指派');
  });

  it('falls back to 未返回 for external cards without a reporter', () => {
    renderKanban({ items: [mk({ id: 1, title: '无提出人工单', sourceType: 'EXTERNAL', sourceCreator: undefined })] });
    expect(screen.getByText('来源提出人: 未返回')).toBeInTheDocument();
  });

  it('shows the card id in mono style beside the assignee', () => {
    renderKanban({ items: [mk({ id: 57123, title: '编号工单' })] });
    const idSpan = screen.getByText('57123');
    expect(idSpan.getAttribute('style')).toContain('var(--aw-font-mono)');
    const foot = idSpan.closest('div')!;
    expect(foot).toContainElement(screen.getByTitle('当前处理人: 未指派'));
  });
});

describe('WorkitemKanban 人工处理与异常标记', () => {
  it('shows the assignee without a duplicate human-intervention tag', () => {
    const items = [
      mk({ id: 1, statusCategory: 'PENDING_DECISION', statusName: '开发中', assigneeType: 'HUMAN', assigneeRef: 10000, assigneeDisplayName: '蔡何', title: '人工工单' }),
    ];
    renderKanban({ items });

    expect(screen.queryByText('需要人工')).not.toBeInTheDocument();
    expect(screen.getByTitle('当前处理人: 蔡何')).toBeInTheDocument();
  });

  it('does not show 需人工 tag for agent-assigned pending-decision cards', () => {
    const items = [
      mk({ id: 1, statusCategory: 'PENDING_DECISION', statusName: '开发中', assigneeType: 'AGENT', assigneeRef: 40013, assigneeName: 'Coder-01', title: '机器工单' }),
    ];
    renderKanban({ items });

    expect(screen.getByText('机器工单')).toBeInTheDocument();
    expect(screen.queryByText(/需人工/)).not.toBeInTheDocument();
  });

  it('does not show 需人工 tag when no human is explicitly assigned', () => {
    const items = [
      mk({ id: 1, statusCategory: 'PENDING_DECISION', statusName: '待处理', assigneeType: 'HUMAN', assigneeRef: null, assigneeName: null, title: '未指派工单' }),
    ];
    renderKanban({ items });

    expect(screen.getByText('未指派工单')).toBeInTheDocument();
    expect(screen.queryByText(/需人工/)).not.toBeInTheDocument();
  });

  it('places the abnormal tag in the tag row without a duplicate assignee', () => {
    const items = [
      mk({
        id: 1, statusCategory: 'PENDING_DECISION', statusName: '开发中', assigneeType: 'HUMAN', assigneeRef: 10000, assigneeDisplayName: '蔡何',
        health: 'STUCK', healthReason: '执行超时', title: '又卡又需人工',
      }),
    ];
    renderKanban({ items });

    expect(screen.queryByText('需要人工')).not.toBeInTheDocument();
    expect(screen.getByTitle('当前处理人: 蔡何')).toBeInTheDocument();
    const tagRow = screen.getByText('异常').closest('div')!;
    expect(tagRow).toContainElement(screen.getByText('需求'));
    expect(tagRow).toContainElement(screen.getByText('低'));
    expect(tagRow).toHaveStyle({ flexWrap: 'wrap' });
  });

  it('does not show 需人工 tag merely because a human is assigned outside pending decision', () => {
    const items = [
      mk({
        id: 1, statusCategory: 'NEW', statusName: '待决策复核', assigneeType: 'HUMAN',
        assigneeRef: 10000, assigneeDisplayName: '蔡何', title: '新建人工工单',
      }),
    ];
    renderKanban({ items });

    expect(screen.getByText('新建人工工单')).toBeInTheDocument();
    expect(screen.queryByText(/需人工/)).not.toBeInTheDocument();
  });
});

describe('WorkitemKanban 定时执行标识', () => {
  it('shows 定时执行 icon only for scheduled workitems', () => {
    const items = [
      mk({ id: 1, statusName: '待处理', assigneeType: 'AGENT', assigneeRef: 5, title: '定时工单', scheduledStartAt: '2026-09-01T02:00:00Z' }),
      mk({ id: 2, statusName: '待处理', assigneeType: 'HUMAN', assigneeRef: null, title: '普通工单' }),
    ];
    renderKanban({ items });

    expect(screen.getByText('定时工单')).toBeInTheDocument();
    expect(screen.getByText('普通工单')).toBeInTheDocument();
    expect(screen.getByLabelText('定时执行')).toBeInTheDocument();
  });

  it('renders no 定时执行 icon when no workitem is scheduled', () => {
    renderKanban({ items: [mk({ id: 1, statusName: '待处理', title: '普通工单' })] });

    expect(screen.getByText('普通工单')).toBeInTheDocument();
    expect(screen.queryByLabelText('定时执行')).not.toBeInTheDocument();
  });
});


describe('WorkitemKanban 拖拽', () => {
  function drag(id: number, column: string) {
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(screen.getByTestId(`workitem-card-${id}`), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId(`kanban-column-${column}`), { dataTransfer });
    fireEvent.drop(screen.getByTestId(`kanban-column-${column}`), { dataTransfer });
  }

  it('marks the dragged card and the hovered column as the drop target', () => {
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    renderKanban({ items: [mk({ id: 1, statusName: '待处理' })], onMove: vi.fn() });
    const card = screen.getByTestId('workitem-card-1');
    fireEvent.dragStart(card, { dataTransfer });
    expect(card).toHaveClass('dragging');
    const column = screen.getByTestId('kanban-column-IN_PROGRESS');
    fireEvent.dragOver(column, { dataTransfer });
    expect(column).toHaveClass('drop-target');
    fireEvent.drop(column, { dataTransfer });
    expect(card).not.toHaveClass('dragging');
    expect(column).not.toHaveClass('drop-target');
  });

  it('requests a move without optimistically relocating the card', () => {
    const item = mk({ id: 1, statusName: '待处理' });
    const onMove = vi.fn();
    renderKanban({ items: [item], onMove });
    drag(1, 'IN_PROGRESS');
    expect(onMove).toHaveBeenCalledWith(item, 'IN_PROGRESS');
    expect(screen.getByTestId('kanban-column-NEW')).toContainElement(screen.getByTestId('workitem-card-1'));
    fireEvent.drop(screen.getByTestId('kanban-column-DONE'));
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('ignores same-column and external drops', () => {
    const onMove = vi.fn();
    renderKanban({ items: [mk({ id: 1, statusName: '待处理' })], onMove });
    drag(1, 'NEW');
    fireEvent.drop(screen.getByTestId('kanban-column-DONE'));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('supports cards in the pending-decision column', () => {
    const item = mk({ id: 1, statusCategory: 'PENDING_DECISION' });
    const onMove = vi.fn();
    renderKanban({ items: [item], onMove });
    drag(1, 'DONE');
    expect(onMove).toHaveBeenCalledWith(item, 'DONE');
  });

  it('disables dragging while a transition is being checked or saved', () => {
    const onMove = vi.fn();
    renderKanban({ items: [mk({ id: 1, statusName: '待处理' })], onMove, transitionBusy: true });
    expect(screen.getByTestId('workitem-card-1')).toHaveAttribute('draggable', 'false');
    drag(1, 'DONE');
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('WorkitemKanban counts', () => {
  it('shows full server totals above 99 even when only part of the column is loaded', () => {
    const { container } = renderKanban({
      items: [], columnKeys: ['NEW'], columnTotals: { NEW: 12345 },
    });
    expect(container.querySelector('.aw-kb-count')).toHaveTextContent('12345');
    expect(screen.queryByText('99+')).not.toBeInTheDocument();
  });
});

describe('WorkitemKanban 状态与高亮 Tag（原型 04b ⑤ / 04c）', () => {
  it('shows the queued tag for pending executions outside DONE', () => {
    renderKanban({ items: [mk({ id: 1, title: '排队工单', executionStatus: 'PENDING' })] });
    expect(screen.getByText('排队中')).toBeInTheDocument();
  });

  it('shows the healthy tag for idle NEW workitems with health OK', () => {
    renderKanban({ items: [mk({ id: 1, title: '健康工单', health: 'OK' })] });
    expect(screen.getByText('健康')).toBeInTheDocument();
  });

  it('hides the healthy tag once the workitem starts queuing', () => {
    renderKanban({ items: [mk({ id: 1, title: '排队工单', health: 'OK', executionStatus: 'PENDING' })] });
    expect(screen.getByText('排队中')).toBeInTheDocument();
    expect(screen.queryByText('健康')).not.toBeInTheDocument();
  });

  it('dims DONE cards', () => {
    renderKanban({ items: [mk({ id: 1, title: '完成工单', statusCategory: 'DONE' })] });
    expect(screen.getByTestId('workitem-card-1')).toHaveStyle({ opacity: '0.82' });
  });

  it('tints the pending column and my pending cards when I have pending decisions', () => {
    renderKanban({
      items: [
        mk({ id: 1, title: '我的决策', statusCategory: 'PENDING_DECISION', assigneeType: 'HUMAN', assigneeRef: 42, assigneeDisplayName: '我' }),
        mk({ id: 2, title: '别人的决策', statusCategory: 'PENDING_DECISION', assigneeType: 'HUMAN', assigneeRef: 99, assigneeDisplayName: '同事' }),
      ],
      currentUserId: 42,
      pendingDecisionSummary: { name: '我', count: 1 },
    });
    expect(screen.getByTestId('kanban-column-PENDING_DECISION')).toHaveClass('hot');
    expect(screen.getByTestId('workitem-card-1')).toHaveClass('hot');
    expect(screen.getByTestId('workitem-card-2')).not.toHaveClass('hot');
  });

  it('leaves the pending column plain without my pending decisions', () => {
    renderKanban({
      items: [mk({ id: 1, title: '别人的决策', statusCategory: 'PENDING_DECISION', assigneeType: 'HUMAN', assigneeRef: 99, assigneeDisplayName: '同事' })],
      currentUserId: 42,
      pendingDecisionSummary: { name: '我', count: 0 },
    });
    expect(screen.getByTestId('kanban-column-PENDING_DECISION')).not.toHaveClass('hot');
    expect(screen.getByTestId('workitem-card-1')).not.toHaveClass('hot');
    expect(screen.queryByText('我的待决策 0')).not.toBeInTheDocument();
  });
});


describe('WorkitemKanban 列归属（规格 3.1）', () => {
  it('groups cards strictly by the server-provided statusCategory, never by status name', () => {
    const items = [
      mk({ id: 1, title: '执行卡片', statusName: '待处理', statusCategory: 'IN_PROGRESS' }),
      mk({ id: 2, title: '名称像执行的新卡片', statusName: '开发中', statusCategory: 'NEW' }),
    ];
    renderKanban({ items });

    expect(screen.getByTestId('kanban-column-IN_PROGRESS')).toContainElement(screen.getByTestId('workitem-card-1'));
    expect(screen.getByTestId('kanban-column-NEW')).toContainElement(screen.getByTestId('workitem-card-2'));
  });

  it('hides CANCELED workitems from the board（优先级 0：看板不展示）', () => {
    renderKanban({ items: [mk({ id: 1, title: '已取消工单', statusCategory: 'CANCELED' })] });
    expect(screen.queryByText('已取消工单')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workitem-card-1')).not.toBeInTheDocument();
  });

  it('renders the CANCELED column only when the filter explicitly selects it', () => {
    renderKanban({
      items: [mk({ id: 1, title: '已取消工单', statusCategory: 'CANCELED' })],
      columnKeys: ['CANCELED'],
      columnTotals: { CANCELED: 1 },
    });
    expect(screen.getAllByTestId(/^kanban-column-/)).toHaveLength(1);
    expect(screen.getByTestId('kanban-column-CANCELED')).toContainElement(screen.getByTestId('workitem-card-1'));
    expect(screen.getByText('已取消')).toBeInTheDocument();
  });

  it('falls back to the NEW column when the server category is missing', () => {
    renderKanban({ items: [mk({ id: 1, title: '兜底卡片', statusCategory: null })] });
    expect(screen.getByTestId('kanban-column-NEW')).toContainElement(screen.getByTestId('workitem-card-1'));
  });
});

describe('WorkitemKanban 排队标记', () => {
  it('shows pending execution in the original in-progress column and clears it after dispatch', () => {
    const item = mk({ id: 91, title: '等待执行器', statusName: '开发中', statusCategory: 'IN_PROGRESS', executionStatus: 'PENDING' });
    const { rerender } = renderKanban({ items: [item] });
    const card = screen.getByTestId('workitem-card-91');
    expect(within(card).getByText('排队中')).toBeInTheDocument();
    expect(statusCategoryOf(item)).toBe('IN_PROGRESS');
    expect(screen.getByTestId('kanban-column-IN_PROGRESS')).toContainElement(card);
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><WorkitemKanban items={[{ ...item, executionStatus: 'RUNNING' }]} /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByText('排队中')).not.toBeInTheDocument();
  });

  it('does not mark completed workitems as queued from an old dispatch', () => {
    renderKanban({ items: [mk({ statusName: '已完成', statusCategory: 'DONE', executionStatus: 'PENDING' })] });
    expect(screen.queryByText('排队中')).not.toBeInTheDocument();
  });
});

it('styles kanban columns through the aw-kb-col class (surface via CSS vars, verified in browser)', () => {
  render(<MemoryRouter><WorkitemKanban items={[]} /></MemoryRouter>);
  expect(screen.getByTestId('kanban-column-NEW')).toHaveClass('aw-kb-col');
});

describe('WorkitemKanban 看板横向自适应', () => {
  it('lets multi-column boards share the full row width without a per-column cap', () => {
    renderKanban({ items: [] });

    const columns = ['NEW', 'IN_PROGRESS', 'PENDING_DECISION', 'DONE']
      .map(key => screen.getByTestId(`kanban-column-${key}`));
    columns.forEach(column => {
      expect(column.style.maxWidth).toBe('');
      expect(column.style.minWidth).toBe('260px');
    });

    const row = screen.getByTestId('kanban-column-NEW').parentElement!;
    expect(row.style.display).toBe('flex');
    expect(row.style.overflowX).toBe('auto');
    expect(row.style.flexWrap).not.toBe('wrap');
  });

  it('keeps the single filtered column at the 360px cap without centering it', () => {
    renderKanban({ items: [], columnKeys: ['NEW'] });

    expect(screen.queryAllByTestId(/^kanban-column-/)).toHaveLength(1);
    const column = screen.getByTestId('kanban-column-NEW');
    expect(column.style.maxWidth).toBe('360px');
    expect(column.style.minWidth).toBe('260px');
    expect(column.parentElement!.style.justifyContent).not.toBe('center');
  });
});

describe('WorkitemKanban 标签', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessLevel: 'READ_WRITE', readOnlyDomains: [] });
  });

  afterEach(() => {
    message.destroy();
    useAuthStore.getState().clear();
  });

  it('shows the tags of a workitem below its title and collapses the overflow', () => {
    renderKanban({ items: [mk({ id: 7, title: '看板标题', tags: ['发布', '线上', '后端'] })] });

    const card = screen.getByTestId('workitem-card-7');
    expect(within(card).getByText('发布')).toBeInTheDocument();
    expect(within(card).getByText('线上')).toBeInTheDocument();
    expect(within(card).getByTestId('workitem-tags-overflow')).toHaveTextContent('+1');
    expect(within(card).getByRole('button', { name: '编辑标签' })).toBeInTheDocument();
    const title = within(card).getByText('看板标题');
    const tags = within(card).getByTestId('workitem-tags-cell-7');
    expect(title.compareDocumentPosition(tags) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps read-only members away from the writable tag editor', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ accessLevel: 'READ_ONLY' });
    renderKanban({ items: [mk({ id: 8, title: '只读看板', tags: ['发布'] })] });

    const card = screen.getByTestId('workitem-card-8');
    expect(within(card).queryByRole('button', { name: '编辑标签' })).not.toBeInTheDocument();

    await user.click(within(card).getByText('发布'));

    expect(await screen.findByText(/编辑标签需要读写权限/)).toBeInTheDocument();
    expect(screen.queryByTestId('workitem-tags-editor')).not.toBeInTheDocument();
  });
});

describe('WorkitemKanban 卡片关注', () => {
  function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location-probe">{location.pathname}</div>;
  }

  function renderWithProbe(props: React.ComponentProps<typeof WorkitemKanban>) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/workitems']}>
          <WorkitemKanban {...props} />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  afterEach(() => {
    useAuthStore.getState().clear();
  });

  it('shows the watch state and toggles without opening the detail page', async () => {
    const onToggleWatch = vi.fn();
    renderWithProbe({ items: [mk({ id: 71, title: '关注卡片', watched: false })], onToggleWatch });

    const toggle = screen.getByTestId('workitem-card-watch-71');
    expect(toggle).toHaveAccessibleName('关注工单');
    expect(toggle.querySelector('.anticon-star')).not.toHaveClass('aw-watch-active');

    await userEvent.click(toggle);
    expect(onToggleWatch).toHaveBeenCalledWith(expect.objectContaining({ id: 71 }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent(/^\/workitems$/);

    // 正对照：点击卡片其他区域仍会打开详情
    await userEvent.click(screen.getByText('关注卡片'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent(/^\/workitems\/71$/);
  });

  it('marks watched cards and never navigates when no watch handler is provided', async () => {
    renderWithProbe({ items: [mk({ id: 72, title: '已关注卡片', watched: true })] });

    const toggle = screen.getByTestId('workitem-card-watch-72');
    expect(toggle).toHaveAccessibleName('取消关注工单');
    expect(toggle.querySelector('.anticon-star')).toHaveClass('aw-watch-active');

    await userEvent.click(toggle);
    expect(screen.getByTestId('location-probe')).toHaveTextContent(/^\/workitems$/);
  });

  it('shows loading only on the card that is submitting a watch change', () => {
    renderWithProbe({
      items: [mk({ id: 73, title: '加载卡片A' }), mk({ id: 74, title: '加载卡片B' })],
      watchBusyId: 73,
      onToggleWatch: vi.fn(),
    });

    expect(screen.getByTestId('workitem-card-watch-73').querySelector('.ant-btn-loading-icon')).not.toBeNull();
    expect(screen.getByTestId('workitem-card-watch-74').querySelector('.ant-btn-loading-icon')).toBeNull();
  });
});
