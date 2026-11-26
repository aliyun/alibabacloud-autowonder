import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState, type ReactElement } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { i18n } from '@/shared/i18n';
import { server } from '@/test/mocks/server';
import { EMPTY_CREATED_TIME_RANGE, type CreatedTimeRangeDraft } from '../createdTimeFilter';
import { TAG_CONDITION_LIMIT, type WorkitemTagConditionDraft } from '../tagConditionFilter';
import {
  EMPTY_ADVANCED_FILTER,
  WorkitemAdvancedFilter,
  type WorkitemAdvancedFilterDraft,
  type WorkitemAdvancedFilterState,
} from './WorkitemAdvancedFilter';
import type { WorkitemStatusCategory } from '../api';

const MEMBERS = [
  {
    userId: 12, username: 'zhangsan', email: 'zhangsan@example.com', nickname: '张三',
    joinedAt: '2026-01-01', owner: false, accessLevel: 'READ_WRITE', identityTags: [],
    roleId: 12, roleCode: 'READ_WRITE', roleName: null, readOnlyDomains: [],
  },
  {
    userId: 34, username: 'lisi', email: 'lisi@example.com', nickname: '李四',
    joinedAt: '2026-01-02', owner: false, accessLevel: 'READ_WRITE', identityTags: [],
    roleId: 12, roleCode: 'READ_WRITE', roleName: null, readOnlyDomains: [],
  },
  {
    userId: 56, username: 'wangwu', email: 'wangwu@example.com', nickname: '王五',
    joinedAt: '2026-01-03', owner: false, accessLevel: 'READ_WRITE', identityTags: [],
    roleId: 12, roleCode: 'READ_WRITE', roleName: null, readOnlyDomains: [],
  },
];

function useMembersServer(members: unknown[] = MEMBERS) {
  server.use(http.get('/api/workspaces/current/members', () => HttpResponse.json({
    success: true, code: '0', message: '', data: members, traceId: null,
  })));
}

const TAG_OPTIONS = ['前端', '后端', 'P1', '废弃', '甲', '乙', '丙'];

function useTagOptionsServer(tags: string[] = TAG_OPTIONS) {
  server.use(http.get('/api/workitems/tag-options', () => HttpResponse.json({
    success: true, code: '0', message: '', data: tags, traceId: null,
  })));
}

const SQUADS = [
  { id: 11, name: '交付一队', description: '', memberCount: 1, gmtCreate: '2026-01-01' },
  { id: 12, name: '交付二队', description: '', memberCount: 1, gmtCreate: '2026-01-02' },
  { id: 13, name: '交付三队', description: '', memberCount: 1, gmtCreate: '2026-01-03' },
];

function useSquadsServer(squads: unknown[] = SQUADS) {
  server.use(http.get('/api/squads', () => HttpResponse.json({
    success: true, code: '0', message: '', data: squads, traceId: null,
  })));
}

function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function renderFilter(
  applied: WorkitemAdvancedFilterState = EMPTY_ADVANCED_FILTER,
  filters: { workType?: string; statusCategory?: WorkitemStatusCategory } = {},
) {
  const onApply = vi.fn();
  renderWithProviders(
    <WorkitemAdvancedFilter
      applied={applied}
      workType={filters.workType}
      statusCategory={filters.statusCategory}
      onApply={onApply}
    />,
  );
  return onApply;
}

async function openPanel() {
  await userEvent.click(screen.getByRole('button', { name: /高级筛选/ }));
  return screen.findByRole('dialog');
}

const dateInput = (dialog: HTMLElement, placeholder: string) => within(dialog).getByPlaceholderText(placeholder);

/** 日期录入按 antd 自身的用例写法：先打开面板，改输入值后回车提交，避免依赖日历单元格。 */
function typeDate(dialog: HTMLElement, placeholder: string, value: string) {
  const input = dateInput(dialog, placeholder);
  fireEvent.mouseDown(input);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
}

const dateValue = (dialog: HTMLElement, placeholder: string) => (dateInput(dialog, placeholder) as HTMLInputElement).value;

/** 下拉选项在隐藏无障碍列表里以 value 作为文本，这里点可见的选项内容节点。 */
async function pickCreatorOption(label: string) {
  const option = (await screen.findAllByText(label))
    .find((element) => element.classList.contains('ant-select-item-option-content'));
  expect(option).toBeTruthy();
  await userEvent.click(option!);
}

function creatorCombobox(dialog: HTMLElement) {
  return within(dialog).getByRole('combobox', { name: '创建者' });
}

describe('WorkitemAdvancedFilter', () => {
  beforeEach(() => {
    useMembersServer();
    useTagOptionsServer();
    useSquadsServer();
  });

  /** 下拉选项在隐藏无障碍列表里以 value 作为文本，这里只在当前可见的下拉中点选项内容节点。 */
  async function pickOption(label: string) {
    // 相邻的两个下拉在关闭动画期间可能同时留在 DOM 中，取最后打开的那个
    const dropdowns = Array.from(
      document.querySelectorAll<HTMLElement>('.ant-select-dropdown:not(.ant-select-dropdown-hidden)'),
    );
    const dropdown = dropdowns[dropdowns.length - 1];
    expect(dropdown).toBeTruthy();
    const option = (await within(dropdown!).findAllByText(label))
      .find((element) => element.classList.contains('ant-select-item-option-content'));
    expect(option).toBeTruthy();
    await userEvent.click(option!);
  }

  function tagConditionRow(dialog: HTMLElement, rowId: number) {
    return within(dialog).getByTestId(`workitem-tag-condition-row-${rowId}`);
  }

  async function pickConditionOp(dialog: HTMLElement, rowId: number, label: string) {
    await userEvent.click(within(tagConditionRow(dialog, rowId)).getAllByRole('combobox')[0]);
    await pickOption(label);
  }

  async function pickConditionTags(dialog: HTMLElement, rowId: number, tags: string[]) {
    await userEvent.click(within(tagConditionRow(dialog, rowId)).getAllByRole('combobox')[1]);
    for (const tag of tags) await pickOption(tag);
  }

  function withTagConditions(
    ...tagConditions: WorkitemAdvancedFilterState['tagConditions']
  ): WorkitemAdvancedFilterState {
    return { ...EMPTY_ADVANCED_FILTER, tagConditions };
  }

  it('opens the advanced panel and shows no applied tag by default', async () => {
    const onApply = renderFilter();

    expect(screen.queryByTestId('workitem-created-filter-tag')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workitem-creator-filter-tag')).not.toBeInTheDocument();

    const dialog = await openPanel();

    expect(within(dialog).getByText('创建时间')).toBeInTheDocument();
    expect(within(dialog).getByText('创建者')).toBeInTheDocument();
    expect(dateInput(dialog, '起始日期')).toBeInTheDocument();
    expect(dateInput(dialog, '结束日期')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /应\s*用/ })).toBeEnabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('edits the low-frequency type and status filters inside the panel and applies them together', async () => {
    const onApply = renderFilter();
    const dialog = await openPanel();

    await userEvent.click(within(dialog).getByRole('combobox', { name: '类型' }));
    await pickOption('缺陷');
    await userEvent.click(within(dialog).getByRole('combobox', { name: '状态' }));
    await pickOption('执行中');

    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0][0] as WorkitemAdvancedFilterDraft;
    expect(applied.workType).toBe('BUG');
    expect(applied.statusCategory).toBe('IN_PROGRESS');
    expect(applied.creatorIds).toEqual([]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows applied type and status as closable tags and restores them when reopening', async () => {
    renderFilter(EMPTY_ADVANCED_FILTER, { workType: 'BUG', statusCategory: 'DONE' });

    expect(screen.getByTestId('workitem-worktype-filter-tag').textContent).toBe('类型：缺陷');
    expect(screen.getByTestId('workitem-status-filter-tag').textContent).toBe('状态：已完成');

    const dialog = await openPanel();
    expect(within(dialog).getByText('缺陷')).toBeInTheDocument();
    expect(within(dialog).getByText('已完成')).toBeInTheDocument();
  });

  it('resets type and status back to empty in the draft', async () => {
    const onApply = renderFilter(EMPTY_ADVANCED_FILTER, { workType: 'BUG', statusCategory: 'DONE' });
    const dialog = await openPanel();
    expect(within(dialog).getByText('缺陷')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /重\s*置/ }));

    expect(onApply).toHaveBeenCalledWith(EMPTY_ADVANCED_FILTER);
    await waitFor(() => expect(within(dialog).queryByText('缺陷')).not.toBeInTheDocument());
    expect(within(dialog).queryByText('已完成')).not.toBeInTheDocument();
  });

  it('clears the type or status condition without touching the other applied filters', async () => {
    function DraftHarness() {
      const [draft, setDraft] = useState<WorkitemAdvancedFilterDraft>({
        ...EMPTY_ADVANCED_FILTER,
        creatorIds: [12],
        workType: 'BUG',
        statusCategory: 'DONE',
      });
      return (
        <WorkitemAdvancedFilter
          applied={draft}
          workType={draft.workType}
          statusCategory={draft.statusCategory}
          onApply={setDraft}
        />
      );
    }
    renderWithProviders(<DraftHarness />);

    await userEvent.click(screen.getByTestId('workitem-worktype-filter-clear'));
    await waitFor(() => expect(screen.queryByTestId('workitem-worktype-filter-tag')).not.toBeInTheDocument());
    expect(screen.getByTestId('workitem-status-filter-tag')).toBeInTheDocument();
    expect(screen.getByTestId('workitem-creator-filter-tag')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('workitem-status-filter-clear'));
    await waitFor(() => expect(screen.queryByTestId('workitem-status-filter-tag')).not.toBeInTheDocument());
    expect(screen.getByTestId('workitem-creator-filter-tag')).toBeInTheDocument();
  });

  it('falls back to the stored values when a filter value is not in the local catalog', () => {
    renderWithProviders(
      <WorkitemAdvancedFilter
        applied={EMPTY_ADVANCED_FILTER}
        workType="CUSTOM"
        statusCategory={'WEIRD' as WorkitemStatusCategory}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId('workitem-worktype-filter-tag').textContent).toBe('类型：CUSTOM');
    expect(screen.getByTestId('workitem-status-filter-tag').textContent).toBe('状态：WEIRD');
  });

  it('submits both bounds and closes the panel', async () => {
    const onApply = renderFilter();
    const dialog = await openPanel();

    typeDate(dialog, '起始日期', '2026-10-01');
    typeDate(dialog, '结束日期', '2026-10-10');
    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0][0] as WorkitemAdvancedFilterState;
    expect(applied.created.from?.format('YYYY-MM-DD')).toBe('2026-10-01');
    expect(applied.created.to?.format('YYYY-MM-DD')).toBe('2026-10-10');
    expect(applied.creatorIds).toEqual([]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('fills both bounds from the last-week preset in one click', async () => {
    const onApply = renderFilter();
    const dialog = await openPanel();
    const today = dayjs().startOf('day');

    await userEvent.click(within(dialog).getByRole('button', { name: '近一周' }));

    expect(dateValue(dialog, '起始日期')).toBe(today.subtract(6, 'day').format('YYYY-MM-DD'));
    expect(dateValue(dialog, '结束日期')).toBe(today.format('YYYY-MM-DD'));

    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0][0] as WorkitemAdvancedFilterState;
    expect(applied.created.from?.format('YYYY-MM-DD')).toBe(today.subtract(6, 'day').format('YYYY-MM-DD'));
    expect(applied.created.to?.format('YYYY-MM-DD')).toBe(today.format('YYYY-MM-DD'));
  });

  it('fills the last-month preset and lets the user adjust one bound before applying', async () => {
    const onApply = renderFilter();
    const dialog = await openPanel();
    const today = dayjs().startOf('day');

    await userEvent.click(within(dialog).getByRole('button', { name: '近一个月' }));

    expect(dateValue(dialog, '起始日期')).toBe(today.subtract(29, 'day').format('YYYY-MM-DD'));
    expect(dateValue(dialog, '结束日期')).toBe(today.format('YYYY-MM-DD'));

    const adjustedEnd = today.subtract(1, 'day').format('YYYY-MM-DD');
    typeDate(dialog, '结束日期', adjustedEnd);
    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    const applied = onApply.mock.calls[0][0] as WorkitemAdvancedFilterState;
    expect(applied.created.from?.format('YYYY-MM-DD')).toBe(today.subtract(29, 'day').format('YYYY-MM-DD'));
    expect(applied.created.to?.format('YYYY-MM-DD')).toBe(adjustedEnd);
  });

  it('warns and keeps the panel open when the start day is later than the end day', async () => {
    const onApply = renderFilter();
    const dialog = await openPanel();

    typeDate(dialog, '起始日期', '2026-10-10');
    typeDate(dialog, '结束日期', '2026-10-01');

    expect(within(dialog).getByRole('alert')).toHaveTextContent('起始日期不能晚于结束日期');
    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent('起始日期不能晚于结束日期');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('resets the draft and every applied condition', async () => {
    const onApply = renderFilter({ ...EMPTY_ADVANCED_FILTER, created: { from: dayjs('2026-10-01'), to: dayjs('2026-10-10') }, creatorIds: [12], tagConditions: [] });
    const dialog = await openPanel();
    expect(dateValue(dialog, '起始日期')).toBe('2026-10-01');

    await userEvent.click(within(dialog).getByRole('button', { name: /重\s*置/ }));

    expect(onApply).toHaveBeenCalledWith(EMPTY_ADVANCED_FILTER);
    await waitFor(() => expect(dateValue(dialog, '起始日期')).toBe(''));
  });

  it('starts from the applied condition each time the panel is reopened', async () => {
    renderFilter({ ...EMPTY_ADVANCED_FILTER, created: { from: dayjs('2026-10-01'), to: null }, creatorIds: [12], tagConditions: [] });
    let dialog = await openPanel();
    expect(dateValue(dialog, '起始日期')).toBe('2026-10-01');
    expect(dateValue(dialog, '结束日期')).toBe('');

    await userEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    dialog = await openPanel();
    expect(dateValue(dialog, '起始日期')).toBe('2026-10-01');
    expect(dateValue(dialog, '结束日期')).toBe('');
  });

  it('labels a start-only and an end-only condition separately', () => {
    const first = renderWithProviders(
      <WorkitemAdvancedFilter
        applied={{ ...EMPTY_ADVANCED_FILTER, created: { from: dayjs('2026-10-01'), to: null }, creatorIds: [], tagConditions: [] }}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId('workitem-created-filter-tag').textContent).toMatch(/^创建时间：.+ 起$/);
    first.unmount();

    renderWithProviders(
      <WorkitemAdvancedFilter
        applied={{ ...EMPTY_ADVANCED_FILTER, created: { from: null, to: dayjs('2026-10-10') }, creatorIds: [], tagConditions: [] }}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId('workitem-created-filter-tag').textContent).toMatch(/^创建时间：.+ 及之前$/);
  });

  it('keeps the applied range visible as a closable tag and clears it on demand', async () => {
    function Harness() {
      const [applied, setApplied] = useState<WorkitemAdvancedFilterState>(EMPTY_ADVANCED_FILTER);
      return <WorkitemAdvancedFilter applied={applied} onApply={setApplied} />;
    }
    renderWithProviders(<Harness />);
    const dialog = await openPanel();

    typeDate(dialog, '起始日期', '2026-10-01');
    typeDate(dialog, '结束日期', '2026-10-10');
    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    const tag = await screen.findByTestId('workitem-created-filter-tag');
    expect(tag.textContent).toMatch(/^创建时间：.+ 至 .+$/);

    await userEvent.click(screen.getByTestId('workitem-created-filter-clear'));

    await waitFor(() => expect(screen.queryByTestId('workitem-created-filter-tag')).not.toBeInTheDocument());
  });

  it('selects multiple creators through nickname, username and email search before applying', async () => {
    const onApply = renderFilter();
    const dialog = await openPanel();
    const combobox = creatorCombobox(dialog);

    await userEvent.type(combobox, 'zhangsan');
    await pickCreatorOption('张三');
    await userEvent.type(combobox, 'LISI@EXAMPLE.COM');
    await pickCreatorOption('李四');
    await userEvent.type(combobox, '王五');
    await pickCreatorOption('王五');

    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0][0] as WorkitemAdvancedFilterState;
    expect(applied.creatorIds).toEqual([12, 34, 56]);
    expect(applied.created).toEqual(EMPTY_CREATED_TIME_RANGE);
  });

  it('summarizes more than two creators and shows every name in a tooltip', async () => {
    renderFilter({ ...EMPTY_ADVANCED_FILTER, created: EMPTY_CREATED_TIME_RANGE, creatorIds: [12, 34, 56], tagConditions: [] });

    const tag = await screen.findByTestId('workitem-creator-filter-tag');
    await waitFor(() => expect(tag).toHaveTextContent('创建者：张三、李四（共 3 人）'));

    await userEvent.hover(tag);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('张三、李四、王五');
  });

  it('falls back to the username and then to the user id for unresolvable creators', async () => {
    useMembersServer([{ ...MEMBERS[0], userId: 77, username: 'zhaoliu', nickname: '' }]);
    renderFilter({ ...EMPTY_ADVANCED_FILTER, created: EMPTY_CREATED_TIME_RANGE, creatorIds: [77, 99], tagConditions: [] });

    const tag = await screen.findByTestId('workitem-creator-filter-tag');
    await waitFor(() => expect(tag).toHaveTextContent('创建者：zhaoliu、#99'));
  });

  it('clears only the creator condition from its own tag', async () => {
    const created: CreatedTimeRangeDraft = { from: dayjs('2026-10-01'), to: dayjs('2026-10-10') };
    const onApply = renderFilter({ ...EMPTY_ADVANCED_FILTER, created, creatorIds: [12], tagConditions: [] });
    await screen.findByTestId('workitem-creator-filter-tag');

    await userEvent.click(screen.getByTestId('workitem-creator-filter-clear'));

    expect(onApply).toHaveBeenCalledWith({ ...EMPTY_ADVANCED_FILTER, created, creatorIds: [], tagConditions: [] });
    expect(screen.getByTestId('workitem-created-filter-tag')).toBeInTheDocument();
  });

  it('clears only the created condition from its own tag', async () => {
    const onApply = renderFilter({ ...EMPTY_ADVANCED_FILTER, created: { from: dayjs('2026-10-01'), to: null }, creatorIds: [12], tagConditions: [] });
    await screen.findByTestId('workitem-creator-filter-tag');

    await userEvent.click(screen.getByTestId('workitem-created-filter-clear'));

    expect(onApply).toHaveBeenCalledWith({ ...EMPTY_ADVANCED_FILTER, created: EMPTY_CREATED_TIME_RANGE, creatorIds: [12], tagConditions: [] });
    expect(screen.getByTestId('workitem-creator-filter-tag')).toBeInTheDocument();
  });

  it('discards an unapplied creator selection when the panel is cancelled', async () => {
    const onApply = renderFilter();
    let dialog = await openPanel();
    await userEvent.type(creatorCombobox(dialog), '张三');
    await pickCreatorOption('张三');

    await userEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onApply).not.toHaveBeenCalled();

    dialog = await openPanel();
    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));
    expect(onApply).toHaveBeenCalledWith(EMPTY_ADVANCED_FILTER);
  });

  it('reports a member loading failure without blocking the created-time condition', async () => {
    server.use(http.get('/api/workspaces/current/members', () => HttpResponse.json(
      { success: false, code: '500', message: 'boom', data: null },
      { status: 500 },
    )));
    const onApply = renderFilter();
    const dialog = await openPanel();

    await userEvent.click(creatorCombobox(dialog));
    expect(await screen.findByText('成员列表加载失败')).toBeInTheDocument();

    typeDate(dialog, '起始日期', '2026-10-01');
    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0][0] as WorkitemAdvancedFilterState;
    expect(applied.created.from?.format('YYYY-MM-DD')).toBe('2026-10-01');
    expect(applied.creatorIds).toEqual([]);
  });

  it('shows the empty member state when the workspace has no members', async () => {
    useMembersServer([]);
    renderFilter();
    const dialog = await openPanel();

    await userEvent.click(creatorCombobox(dialog));

    expect(await screen.findByText('暂无成员')).toBeInTheDocument();
  });

  it('stays bilingual through the shared workitem namespace', async () => {
    renderFilter({ ...EMPTY_ADVANCED_FILTER, created: EMPTY_CREATED_TIME_RANGE, creatorIds: [12, 34], tagConditions: [] });
    expect(await screen.findByText('创建者：张三、李四')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: /高级筛选/ });

    await act(async () => { await i18n.changeLanguage('en-US'); });
    try {
      expect(screen.getByRole('button', { name: /Advanced filters/ })).toBe(trigger);
      expect(await screen.findByText('Creators: 张三, 李四')).toBeInTheDocument();
      // 语言切换后按钮名不再是中文，这里直接点击已定位的入口再按 role 取面板。
      await userEvent.click(trigger);
      const dialog = await screen.findByRole('dialog');
      expect(dateInput(dialog, 'Start date')).toBeInTheDocument();
      expect(dateInput(dialog, 'End date')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Reset' })).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Last 7 days' })).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Last 30 days' })).toBeInTheDocument();
      expect(within(dialog).getByRole('combobox', { name: 'Creator' })).toBeInTheDocument();
      expect(within(dialog).getByText('Tag conditions')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Add condition' })).toBeInTheDocument();
    } finally {
      await act(async () => { await i18n.changeLanguage('zh-CN'); });
    }
  });

  it('adds a tag condition with several tags and applies the selected operator', async () => {
    const onApply = renderFilter();
    const dialog = await openPanel();

    await userEvent.click(within(dialog).getByRole('button', { name: /添加条件/ }));
    await pickConditionTags(dialog, 1, ['前端', 'P1']);
    await pickConditionOp(dialog, 1, 'NOT（全部排除）');
    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0][0] as WorkitemAdvancedFilterState;
    expect(applied.tagConditions).toEqual([{ rowId: 1, op: 'NOT', tags: ['前端', 'P1'] }]);
    expect(applied.creatorIds).toEqual([]);
  });

  it('shows the incomplete-condition error only after apply is attempted', async () => {
    const onApply = renderFilter();
    const dialog = await openPanel();

    await userEvent.click(within(dialog).getByRole('button', { name: /添加条件/ }));

    // 新增空条件不预弹错误，等待用户输入
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent('每条标签条件至少选择一个标签');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('removes only the tag condition whose delete button was used', async () => {
    const onApply = renderFilter(withTagConditions(
      { rowId: 1, op: 'AND', tags: ['前端'] },
      { rowId: 2, op: 'OR', tags: ['后端'] },
    ));
    const dialog = await openPanel();

    await userEvent.click(within(tagConditionRow(dialog, 2)).getByRole('button', { name: '删除条件' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    const applied = onApply.mock.calls[0][0] as WorkitemAdvancedFilterState;
    expect(applied.tagConditions).toEqual([{ rowId: 1, op: 'AND', tags: ['前端'] }]);
  });

  it('disables adding more conditions at the limit and explains why', async () => {
    const conditions: WorkitemTagConditionDraft[] = Array.from(
      { length: TAG_CONDITION_LIMIT },
      (_, index) => ({ rowId: index + 1, op: 'AND', tags: ['前端'] }),
    );
    renderFilter(withTagConditions(...conditions));
    const dialog = await openPanel();

    expect(within(dialog).getByRole('button', { name: /添加条件/ })).toBeDisabled();
    expect(within(dialog).getByText('最多添加 30 条标签条件')).toBeInTheDocument();
  });

  it('blocks apply with an inline error when the serialized conditions exceed the URL budget', async () => {
    const conditions: WorkitemTagConditionDraft[] = Array.from(
      { length: TAG_CONDITION_LIMIT },
      (_, rowIndex) => ({
        rowId: rowIndex + 1,
        op: 'AND',
        tags: Array.from({ length: 40 }, (_, tagIndex) => `tag-${rowIndex}-${tagIndex}`.padEnd(16, 'x')),
      }),
    );
    const onApply = renderFilter(withTagConditions(...conditions));
    const dialog = await openPanel();

    expect(within(dialog).getByRole('alert')).toHaveTextContent('标签条件过长，请减少标签数量');
    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('resets every applied condition including tag conditions', async () => {
    const onApply = renderFilter({
      ...EMPTY_ADVANCED_FILTER,
      created: { from: dayjs('2026-10-01'), to: null },
      creatorIds: [12],
      tagConditions: [{ rowId: 1, op: 'AND', tags: ['前端'] }],
    });
    const dialog = await openPanel();
    expect(tagConditionRow(dialog, 1)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /重\s*置/ }));

    expect(onApply).toHaveBeenCalledWith(EMPTY_ADVANCED_FILTER);
    await waitFor(() => expect(within(dialog).queryByTestId('workitem-tag-condition-row-1')).not.toBeInTheDocument());
  });

  it('keeps applied tag conditions as closable summaries and clears only that condition', async () => {
    const onApply = renderFilter(withTagConditions(
      { rowId: 1, op: 'AND', tags: ['前端'] },
      { rowId: 2, op: 'OR', tags: ['后端'] },
    ));

    const summaries = await screen.findAllByTestId('workitem-tag-condition-tag');
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toHaveTextContent('标签条件：AND（同时包含） 前端');

    await userEvent.click(screen.getByTestId('workitem-tag-condition-clear-2'));

    expect(onApply).toHaveBeenCalledWith(withTagConditions({ rowId: 1, op: 'AND', tags: ['前端'] }));
  });

  it('folds more than two tags in the summary and shows all of them in a tooltip', async () => {
    renderFilter(withTagConditions({ rowId: 1, op: 'NOT', tags: ['甲', '乙', '丙'] }));

    const summary = await screen.findByTestId('workitem-tag-condition-tag');
    expect(summary).toHaveTextContent('标签条件：NOT（全部排除） 甲、乙…');

    await userEvent.hover(summary);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('标签条件：NOT（全部排除） 甲、乙、丙');
  });

  it('reports a tag option loading failure and keeps existing conditions removable', async () => {
    server.use(http.get('/api/workitems/tag-options', () => HttpResponse.json(
      { success: false, code: '500', message: 'boom', data: null },
      { status: 500 },
    )));
    const onApply = renderFilter(withTagConditions({ rowId: 1, op: 'AND', tags: ['前端'] }));
    const dialog = await openPanel();

    expect(await within(dialog).findByText('标签加载失败')).toBeInTheDocument();
    expect(within(tagConditionRow(dialog, 1)).getAllByRole('combobox')[1]).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /添加条件/ })).toBeDisabled();

    await userEvent.click(within(tagConditionRow(dialog, 1)).getByRole('button', { name: '删除条件' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    const applied = onApply.mock.calls[0][0] as WorkitemAdvancedFilterState;
    expect(applied.tagConditions).toEqual([]);
  });

  it('shows the empty tag state when the workspace has no tags', async () => {
    server.use(http.get('/api/workitems/tag-options', () => HttpResponse.json({
      success: true, code: '0', message: '', data: [], traceId: null,
    })));
    renderFilter();
    const dialog = await openPanel();

    await userEvent.click(within(dialog).getByRole('button', { name: /添加条件/ }));
    await userEvent.click(within(tagConditionRow(dialog, 1)).getAllByRole('combobox')[1]);

    expect(await screen.findByText('暂无可选标签')).toBeInTheDocument();
  });

  function squadCombobox(dialog: HTMLElement) {
    return within(dialog).getByRole('combobox', { name: '交付小队' });
  }

  it('lists workspace squads with an unassigned option in the squad filter', async () => {
    renderFilter();
    const dialog = await openPanel();

    expect(within(dialog).getByText('交付小队')).toBeInTheDocument();
    expect(squadCombobox(dialog).closest('.ant-select-selector')).toHaveTextContent('选择交付小队（可多选）');

    await userEvent.click(squadCombobox(dialog));

    for (const label of ['交付一队', '交付二队', '交付三队', '未归属小队']) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    }
  });

  it('applies the unassigned option and clears selected squads', async () => {
    const onApply = renderFilter();
    const dialog = await openPanel();

    await userEvent.click(squadCombobox(dialog));
    await pickOption('交付一队');
    await pickOption('未归属小队');
    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    const applied = onApply.mock.calls[0][0] as WorkitemAdvancedFilterState;
    expect(applied.squadIds).toEqual([]);
    expect(applied.unassignedSquad).toBe(true);
  });

  it('clears the unassigned option when a concrete squad is picked', async () => {
    const onApply = renderFilter({ ...EMPTY_ADVANCED_FILTER, unassignedSquad: true });
    const dialog = await openPanel();

    await userEvent.click(squadCombobox(dialog));
    await pickOption('交付一队');
    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    const applied = onApply.mock.calls[0][0] as WorkitemAdvancedFilterState;
    expect(applied.squadIds).toEqual([11]);
    expect(applied.unassignedSquad).toBe(false);
  });

  it('shows the applied squad tag and clears only that condition', async () => {
    const onApply = renderFilter({ ...EMPTY_ADVANCED_FILTER, squadIds: [11, 12] });
    const tag = await screen.findByTestId('workitem-squad-filter-tag');

    await waitFor(() => expect(tag).toHaveTextContent('交付小队：交付一队、交付二队'));

    await userEvent.click(within(tag).getByTestId('workitem-squad-filter-clear'));

    expect(onApply).toHaveBeenCalledWith({ ...EMPTY_ADVANCED_FILTER, squadIds: [], unassignedSquad: false });
  });

  it('summarizes three or more squads with the total count', async () => {
    renderFilter({ ...EMPTY_ADVANCED_FILTER, squadIds: [11, 12, 13] });

    const tag = await screen.findByTestId('workitem-squad-filter-tag');
    await waitFor(() => expect(tag).toHaveTextContent('交付小队：交付一队、交付二队（共 3 队）'));
  });

  it('shows the unassigned label in the applied squad tag', async () => {
    renderFilter({ ...EMPTY_ADVANCED_FILTER, unassignedSquad: true });

    const tag = await screen.findByTestId('workitem-squad-filter-tag');
    expect(tag).toHaveTextContent('交付小队：未归属小队');
  });

  it('warns when the squad list fails to load without blocking apply', async () => {
    server.use(http.get('/api/squads', () => HttpResponse.json(
      { success: false, code: '500', message: 'boom', data: null },
      { status: 500 },
    )));
    const onApply = renderFilter({ ...EMPTY_ADVANCED_FILTER, squadIds: [11] });
    const dialog = await openPanel();

    expect(await within(dialog).findByText('交付小队列表加载失败')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /应\s*用/ })).toBeEnabled();

    await userEvent.click(within(dialog).getByRole('button', { name: /应\s*用/ }));

    const applied = onApply.mock.calls[0][0] as WorkitemAdvancedFilterState;
    expect(applied.squadIds).toEqual([11]);
  });
});
