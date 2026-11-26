import { Fragment, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Modal, Select, Tag, Tooltip } from 'antd';
import { CloseCircleFilled } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { Dayjs } from 'dayjs';
import { formatDateTime } from '@/shared/i18n/format';
import { useAuthStore } from '@/shared/auth/store';
import { useMembers } from '@/features/settings/hooks';
import { listAllSquads } from '@/features/squad/api';
import { useWorkitemTagOptions } from '../hooks';
import { STATUS_FILTER_COLUMNS, workTypeMap } from '../constants';
import type { WorkitemStatusCategory } from '../api';
import '../workitemFilters.css';
import {
  EMPTY_CREATED_TIME_RANGE,
  buildCreatedTimeRangePreset,
  hasCreatedTimeRange,
  isCreatedTimeRangeInvalid,
  type CreatedTimeRangeDraft,
} from '../createdTimeFilter';
import {
  TAG_CONDITION_LIMIT,
  TAG_CONDITION_OPS,
  createEmptyTagCondition,
  hasIncompleteTagCondition,
  isTagConditionsTooLong,
  type WorkitemTagConditionDraft,
  type WorkitemTagConditionOp,
} from '../tagConditionFilter';

/** 高级筛选的完整条件：创建时间、创建者（本地用户 ID，多选之间为 OR）、标签逻辑条件（条件之间为 AND）
 *  与交付小队（多选之间为 OR；未归属小队与具体小队互斥）。 */
export interface WorkitemAdvancedFilterState {
  created: CreatedTimeRangeDraft;
  creatorIds: number[];
  tagConditions: WorkitemTagConditionDraft[];
  squadIds: number[];
  unassignedSquad: boolean;
}

export const EMPTY_ADVANCED_FILTER: WorkitemAdvancedFilterState = {
  created: EMPTY_CREATED_TIME_RANGE,
  creatorIds: [],
  tagConditions: [],
  squadIds: [],
  unassignedSquad: false,
};

/** 高级筛选弹窗的完整草稿：类型与状态同属低频条件，在弹窗内与其它条件一并编辑、一并应用。 */
export interface WorkitemAdvancedFilterDraft extends WorkitemAdvancedFilterState {
  workType?: string;
  statusCategory?: WorkitemStatusCategory;
}

/** 「未归属小队」选项的哨兵值，提交前转换为 unassignedSquad=true。 */
export const UNASSIGNED_SQUAD_ID = -1;

const TAG_OP_LABEL_KEYS = {
  AND: 'list.tagConditionOpAnd',
  OR: 'list.tagConditionOpOr',
  IN: 'list.tagConditionOpIn',
  NOT: 'list.tagConditionOpNot',
} as const;

const TAG_MORE_SUFFIX = '…';

interface WorkitemAdvancedFilterProps {
  applied: WorkitemAdvancedFilterState;
  /** 已应用的类型筛选（workType），与状态筛选一起在弹窗内编辑。 */
  workType?: string;
  /** 已应用的状态分类筛选（statusCategory）。 */
  statusCategory?: WorkitemStatusCategory;
  onApply: (next: WorkitemAdvancedFilterDraft) => void;
}

function formatBound(value: Dayjs): string {
  return formatDateTime(value.toDate(), { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 状态分类在弹窗下拉与回显标签中统一用看板列文案，未知值原样展示。 */
function statusFilterTitle(key: WorkitemStatusCategory): string {
  const column = STATUS_FILTER_COLUMNS.find((item) => item.key === key);
  return column ? column.title : key;
}

/** 类型/状态从主工具栏移入弹窗后，回显标签的关闭入口保持原生按钮语义，键盘可操作。
 *  必须返回宿主元素：antd Tag 通过 cloneElement 在 closeIcon 上挂 onClick 与 className，
 *  自定义组件会吞掉这些 props 导致关闭失效。 */
function tagCloseIcon(testId: string, ariaLabel: string) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', display: 'inline-flex' }}
    >
      <CloseCircleFilled aria-hidden="true" />
    </button>
  );
}

/** 成员姓名缺失时回退到用户名，再回退到用户 ID，保证筛选条件始终可读。 */
function creatorName(member: { nickname: string; username: string } | undefined, id: number): string {
  if (!member) return `#${id}`;
  return member.nickname || member.username || `#${id}`;
}

/**
 * 工单页「高级筛选」入口（原型 03/03c）：按钮不换行，已应用条件以 chips 另起一行回显；
 * Modal 内按行式布局（60px 标签列 + 条件控件），底部重置/取消/应用。
 * 创建时间条件支持两侧独立设置与快捷段；创建者条件从当前工作空间成员中多选；
 * 标签条件逐行编辑运算符与标签，条件之间为 AND。
 * 校验错误为一行红字、左缘与条件内容区对齐；条件未补全不预弹错误，
 * 点「应用」才提示且不提交；时间范围与超长错误随数据即时显示。
 * 各条件的清除互不影响，「重置」同时清空。
 */
export function WorkitemAdvancedFilter({ applied, workType, statusCategory, onApply }: WorkitemAdvancedFilterProps) {
  const { t, i18n } = useTranslation('workitem');
  const workspaceId = useAuthStore((state) => state.currentWorkspace?.id);
  const membersQuery = useMembers();
  const tagOptionsQuery = useWorkitemTagOptions();
  const squadsQuery = useQuery({
    queryKey: ['workitem-advanced-filter-squads', workspaceId],
    queryFn: () => listAllSquads(),
    staleTime: 60_000,
  });
  const [open, setOpen] = useState(false);
  // 清除回显标签时以已应用条件（含类型与状态）为基准，避免连带清掉其它筛选
  const appliedDraft: WorkitemAdvancedFilterDraft = { ...applied, workType, statusCategory };
  const [draft, setDraft] = useState<WorkitemAdvancedFilterDraft>(appliedDraft);
  const [applyAttempted, setApplyAttempted] = useState(false);
  const rowIdRef = useRef(1);

  const createdInvalid = isCreatedTimeRangeInvalid(draft.created);
  const tagConditionsIncomplete = hasIncompleteTagCondition(draft.tagConditions);
  const tagConditionsTooLong = isTagConditionsTooLong(draft.tagConditions);
  const invalid = createdInvalid || tagConditionsIncomplete || tagConditionsTooLong;
  const tagConditionLimitReached = draft.tagConditions.length >= TAG_CONDITION_LIMIT;
  const tagOptionsFailed = tagOptionsQuery.isError;
  const tagOptions = (tagOptionsQuery.data ?? []).map((tag) => ({ value: tag, label: tag }));

  const members = membersQuery.data ?? [];
  const memberOptions = members.map((member) => ({
    value: member.userId,
    label: creatorName(member, member.userId),
    searchText: [member.nickname, member.username, member.email].filter(Boolean).join(' '),
  }));

  const creatorNames = applied.creatorIds.map((id) => creatorName(members.find((item) => item.userId === id), id));
  const nameSeparator = i18n.language.startsWith('zh') ? '、' : ', ';
  const displayedNames = creatorNames.slice(0, 2).join(nameSeparator);
  const creatorTagText = creatorNames.length > 2
    ? t('list.creatorFilterMore', { names: displayedNames, total: creatorNames.length })
    : t('list.creatorFilterNames', { names: displayedNames });

  const squadsFailed = squadsQuery.isError;
  const squads = squadsQuery.data ?? [];
  const squadOptions = [
    ...squads.map((squad) => ({ value: squad.id, label: squad.name })),
    { value: UNASSIGNED_SQUAD_ID, label: t('list.squadUnassigned') },
  ];
  const squadFilterNames = applied.unassignedSquad
    ? [t('list.squadUnassigned')]
    : applied.squadIds.map((id) => squads.find((squad) => squad.id === id)?.name ?? `#${id}`);
  const displayedSquadNames = squadFilterNames.slice(0, 2).join(nameSeparator);
  const squadTagText = squadFilterNames.length > 2
    ? t('list.squadFilterMore', { names: displayedSquadNames, total: squadFilterNames.length })
    : t('list.squadFilterNames', { names: displayedSquadNames });

  // 每次打开都从已应用条件起步，避免上次未提交的草稿残留
  const openPanel = () => {
    rowIdRef.current = applied.tagConditions.reduce((max, condition) => Math.max(max, condition.rowId), 0) + 1;
    setDraft(appliedDraft);
    setApplyAttempted(false);
    setOpen(true);
  };

  const nextRowId = () => {
    const id = rowIdRef.current;
    rowIdRef.current += 1;
    return id;
  };

  const updateTagCondition = (
    rowId: number,
    patch: Partial<Pick<WorkitemTagConditionDraft, 'op' | 'tags'>>,
  ) => {
    setDraft((prev) => ({
      ...prev,
      tagConditions: prev.tagConditions.map((condition) => (
        condition.rowId === rowId ? { ...condition, ...patch } : condition
      )),
    }));
  };

  const removeTagCondition = (rowId: number) => {
    setDraft((prev) => ({
      ...prev,
      tagConditions: prev.tagConditions.filter((condition) => condition.rowId !== rowId),
    }));
  };

  const addTagCondition = () => {
    setDraft((prev) => (
      prev.tagConditions.length >= TAG_CONDITION_LIMIT
        ? prev
        : { ...prev, tagConditions: [...prev.tagConditions, createEmptyTagCondition(nextRowId())] }
    ));
  };

  const creatorTag = applied.creatorIds.length > 0 ? (
    <Tag
      data-testid="workitem-creator-filter-tag"
      closable
      closeIcon={<CloseCircleFilled data-testid="workitem-creator-filter-clear" aria-label={t('list.clearCreatorFilter')} />}
      onClose={() => onApply({ ...appliedDraft, creatorIds: [] })}
    >
      {creatorTagText}
    </Tag>
  ) : null;

  const workTypeTag = workType ? (
    <Tag
      data-testid="workitem-worktype-filter-tag"
      closable
      closeIcon={tagCloseIcon('workitem-worktype-filter-clear', t('list.clearType'))}
      onClose={() => onApply({ ...appliedDraft, workType: undefined })}
    >
      {t('list.workTypeFilterTag', { name: workTypeMap[workType]?.label ?? workType })}
    </Tag>
  ) : null;

  const statusTag = statusCategory ? (
    <Tag
      data-testid="workitem-status-filter-tag"
      closable
      closeIcon={tagCloseIcon('workitem-status-filter-clear', t('list.clearStatus'))}
      onClose={() => onApply({ ...appliedDraft, statusCategory: undefined })}
    >
      {t('list.statusFilterTag', { name: statusFilterTitle(statusCategory) })}
    </Tag>
  ) : null;

  const squadTag = squadFilterNames.length > 0 ? (
    <Tooltip title={squadFilterNames.length > 2 ? squadFilterNames.join(nameSeparator) : undefined}>
      <Tag
        data-testid="workitem-squad-filter-tag"
        closable
        closeIcon={<CloseCircleFilled data-testid="workitem-squad-filter-clear" aria-label={t('list.clearSquadFilter')} />}
        onClose={() => onApply({ ...appliedDraft, squadIds: [], unassignedSquad: false })}
      >
        {squadTagText}
      </Tag>
    </Tooltip>
  ) : null;

  const createdChip = hasCreatedTimeRange(applied.created) ? (
    <Tag
      data-testid="workitem-created-filter-tag"
      closable
      closeIcon={<CloseCircleFilled data-testid="workitem-created-filter-clear" aria-label={t('list.clearCreatedFilter')} />}
      onClose={() => onApply({ ...appliedDraft, created: EMPTY_CREATED_TIME_RANGE })}
    >
      {applied.created.from && applied.created.to
        ? t('list.createdFilterRange', { from: formatBound(applied.created.from), to: formatBound(applied.created.to) })
        : applied.created.from
          ? t('list.createdFilterFrom', { from: formatBound(applied.created.from) })
          : t('list.createdFilterTo', { to: formatBound(applied.created.to!) })}
    </Tag>
  ) : null;

  const tagConditionChips = applied.tagConditions.map((condition) => {
    const opLabel = t(TAG_OP_LABEL_KEYS[condition.op]);
    const visibleTags = condition.tags.slice(0, 2).join(nameSeparator);
    const summary = t('list.tagConditionSummary', {
      op: opLabel,
      tags: condition.tags.length > 2 ? `${visibleTags}${TAG_MORE_SUFFIX}` : visibleTags,
    });
    const tag = (
      <Tag
        data-testid="workitem-tag-condition-tag"
        closable
        closeIcon={<CloseCircleFilled data-testid={`workitem-tag-condition-clear-${condition.rowId}`} aria-label={t('list.clearTagCondition')} />}
        onClose={() => onApply({
          ...appliedDraft,
          tagConditions: applied.tagConditions.filter((item) => item.rowId !== condition.rowId),
        })}
      >
        {summary}
      </Tag>
    );
    return condition.tags.length > 2 ? (
      <Tooltip
        key={condition.rowId}
        title={t('list.tagConditionSummary', { op: opLabel, tags: condition.tags.join(nameSeparator) })}
      >
        {tag}
      </Tooltip>
    ) : <Fragment key={condition.rowId}>{tag}</Fragment>;
  });

  const hasAppliedChips = hasCreatedTimeRange(applied.created) || applied.creatorIds.length > 0
    || applied.tagConditions.length > 0 || applied.squadIds.length > 0 || applied.unassignedSquad
    || !!workType || !!statusCategory;

  return (
    <>
      <Button className="aw-adv-filter-btn" icon={<AwStrokeIcon name="filter" />} onClick={openPanel}>
        {t('list.advancedFilter')}
      </Button>
      {hasAppliedChips ? (
        <div className="aw-adv-filter-chips">
          {workTypeTag}
          {statusTag}
          {createdChip}
          {creatorNames.length > 2
            ? <Tooltip title={creatorNames.join(nameSeparator)}>{creatorTag}</Tooltip>
            : creatorTag}
          {squadTag}
          {tagConditionChips}
        </div>
      ) : null}
      <Modal
        className="aw-adv-filter-modal"
        title={t('list.advancedFilter')}
        open={open}
        onCancel={() => setOpen(false)}
        destroyOnHidden
        width="min(480px, 92vw)"
        styles={{ body: { padding: '14px 18px' }, footer: { padding: '12px 18px 16px' } }}
        footer={(
          <div className="aw-af-foot">
            <Button key="reset" onClick={() => { setDraft(EMPTY_ADVANCED_FILTER); setApplyAttempted(false); onApply(EMPTY_ADVANCED_FILTER); }}>
              {t('list.resetAdvancedFilter')}
            </Button>
            <Button key="cancel" onClick={() => setOpen(false)}>{t('list.cancel')}</Button>
            <Button
              key="apply"
              type="primary"
              onClick={() => {
                if (invalid) { setApplyAttempted(true); return; }
                onApply(draft);
                setOpen(false);
              }}
            >
              {t('list.applyAdvancedFilter')}
            </Button>
          </div>
        )}
      >
        <div className="aw-af-row">
          <span className="aw-af-label">{t('list.workTypeLabel')}</span>
          <Select
            allowClear
            style={{ flex: '1 1 200px', minWidth: 0 }}
            placeholder={t('list.typeFilter')}
            aria-label={t('list.workTypeLabel')}
            value={draft.workType}
            onChange={(value?: string) => setDraft((prev) => ({ ...prev, workType: value }))}
            options={Object.entries(workTypeMap).map(([value, meta]) => ({ value, label: meta.label }))}
          />
        </div>
        <div className="aw-af-row">
          <span className="aw-af-label">{t('list.statusLabel')}</span>
          <Select<WorkitemStatusCategory>
            allowClear
            style={{ flex: '1 1 200px', minWidth: 0 }}
            placeholder={t('list.statusFilter')}
            aria-label={t('list.statusLabel')}
            value={draft.statusCategory}
            onChange={(value?: WorkitemStatusCategory) => setDraft((prev) => ({ ...prev, statusCategory: value }))}
            options={STATUS_FILTER_COLUMNS.map((column) => ({
              value: column.key as WorkitemStatusCategory,
              label: column.title,
            }))}
          />
        </div>
        <div className="aw-af-row">
          <span className="aw-af-label">{t('list.createdTimeLabel')}</span>
          <Button className="aw-af-chip" onClick={() => setDraft((prev) => ({ ...prev, created: buildCreatedTimeRangePreset('lastWeek') }))}>
            {t('list.createdPresetLastWeek')}
          </Button>
          <Button className="aw-af-chip" onClick={() => setDraft((prev) => ({ ...prev, created: buildCreatedTimeRangePreset('lastMonth') }))}>
            {t('list.createdPresetLastMonth')}
          </Button>
        </div>
        <div className="aw-af-row">
          <span className="aw-af-label" aria-hidden="true" />
          <DatePicker
            format="YYYY-MM-DD"
            allowClear
            style={{ width: 140 }}
            value={draft.created.from}
            placeholder={t('list.createdFromPlaceholder')}
            onChange={(value) => setDraft((prev) => ({ ...prev, created: { ...prev.created, from: value } }))}
          />
          <span className="aw-af-sep">{t('list.createdRangeSeparator')}</span>
          <DatePicker
            format="YYYY-MM-DD"
            allowClear
            style={{ width: 140 }}
            value={draft.created.to}
            placeholder={t('list.createdToPlaceholder')}
            onChange={(value) => setDraft((prev) => ({ ...prev, created: { ...prev.created, to: value } }))}
          />
        </div>
        {createdInvalid ? <div className="aw-af-error" role="alert">{t('list.createdRangeInvalid')}</div> : null}
        <div className="aw-af-row">
          <span className="aw-af-label">{t('list.creatorLabel')}</span>
          <Select
            mode="multiple"
            showSearch
            allowClear
            maxTagCount="responsive"
            style={{ flex: '1 1 200px', minWidth: 0 }}
            placeholder={t('list.creatorPlaceholder')}
            aria-label={t('list.creatorLabel')}
            loading={membersQuery.isLoading}
            value={draft.creatorIds}
            onChange={(values: number[]) => setDraft((prev) => ({ ...prev, creatorIds: values }))}
            options={memberOptions}
            filterOption={(input, option) => String(option?.searchText ?? '')
              .toLowerCase()
              .includes(input.trim().toLowerCase())}
            notFoundContent={membersQuery.isError ? t('list.creatorLoadFailed') : t('list.creatorNoData')}
          />
        </div>
        <div className="aw-af-row">
          <span className="aw-af-label">{t('list.tagConditionLabel')}</span>
          <span className="aw-af-hint">{t('list.tagConditionOpOrInHint')}</span>
        </div>
        {tagOptionsFailed ? <Alert type="warning" showIcon message={t('list.tagConditionOptionsLoadFailed')} /> : null}
        {draft.tagConditions.map((condition) => (
          <div
            key={condition.rowId}
            className="aw-af-row"
            data-testid={`workitem-tag-condition-row-${condition.rowId}`}
          >
            <span className="aw-af-label" aria-hidden="true" />
            <div className="aw-af-cond">
              <Select<WorkitemTagConditionOp>
                style={{ width: 150 }}
                aria-label={t('list.tagConditionLabel')}
                value={condition.op}
                onChange={(op) => updateTagCondition(condition.rowId, { op })}
                options={TAG_CONDITION_OPS.map((op) => ({ value: op, label: t(TAG_OP_LABEL_KEYS[op]) }))}
              />
              <Select
                mode="multiple"
                showSearch
                allowClear
                maxTagCount="responsive"
                style={{ flex: 1, minWidth: 120 }}
                placeholder={t('list.tagConditionTagsPlaceholder')}
                aria-label={t('list.tagConditionTagsPlaceholder')}
                loading={tagOptionsQuery.isLoading}
                disabled={tagOptionsFailed}
                value={condition.tags}
                onChange={(tags: string[]) => updateTagCondition(condition.rowId, { tags })}
                options={tagOptions}
                notFoundContent={t('list.tagConditionNoOptions')}
              />
              <Button
                type="text"
                className="aw-af-del"
                icon={<AwStrokeIcon name="trash" />}
                aria-label={t('list.removeTagCondition')}
                onClick={() => removeTagCondition(condition.rowId)}
              />
            </div>
          </div>
        ))}
        <div className="aw-af-row">
          <span className="aw-af-label" aria-hidden="true" />
          <Button className="aw-af-add" icon={<AwStrokeIcon name="plus" />} onClick={addTagCondition} disabled={tagConditionLimitReached || tagOptionsFailed}>
            {t('list.addTagCondition')}
          </Button>
          {tagConditionLimitReached
            ? <span className="aw-af-hint">{t('list.tagConditionLimitReached', { count: TAG_CONDITION_LIMIT })}</span>
            : null}
        </div>
        {applyAttempted && tagConditionsIncomplete ? (
          <div className="aw-af-error" role="alert">{t('list.tagConditionIncomplete')}</div>
        ) : null}
        {tagConditionsTooLong ? <div className="aw-af-error" role="alert">{t('list.tagConditionTooLong')}</div> : null}
        <div className="aw-af-row">
          <span className="aw-af-label">{t('list.squadLabel')}</span>
          <Select
            mode="multiple"
            showSearch
            allowClear
            maxTagCount="responsive"
            style={{ flex: '1 1 200px', minWidth: 0 }}
            placeholder={t('list.squadPlaceholder')}
            aria-label={t('list.squadLabel')}
            loading={squadsQuery.isLoading}
            value={draft.unassignedSquad ? [UNASSIGNED_SQUAD_ID] : draft.squadIds}
            onChange={(values: number[]) => setDraft((prev) => {
              const hasSentinel = values.includes(UNASSIGNED_SQUAD_ID);
              const selectedSquads = values.filter((value) => value !== UNASSIGNED_SQUAD_ID);
              // 已选「未归属」时再选具体小队：以具体小队为准，自动取消未归属
              if (hasSentinel && prev.unassignedSquad && selectedSquads.length > 0) {
                return { ...prev, squadIds: selectedSquads, unassignedSquad: false };
              }
              if (hasSentinel) {
                return { ...prev, squadIds: [], unassignedSquad: true };
              }
              return { ...prev, squadIds: selectedSquads, unassignedSquad: false };
            })}
            options={squadOptions}
            filterOption={(input, option) => String(option?.label ?? '')
              .toLowerCase()
              .includes(input.trim().toLowerCase())}
            notFoundContent={squadsFailed ? t('list.squadLoadFailed') : t('list.squadNoData')}
          />
        </div>
        {squadsFailed ? <Alert type="warning" showIcon message={t('list.squadLoadFailed')} /> : null}
      </Modal>
    </>
  );
}
