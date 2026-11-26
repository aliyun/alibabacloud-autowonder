import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Input, message, Modal } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { i18n } from '@/shared/i18n';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { ApiError, ErrorCodes } from '@/shared/types/common';
import type { Workitem, WorkitemDetail } from '@/shared/types/workitem';
import type { StatusNode } from '@/features/statemachine/types';
import { getTemplateDetail } from '@/features/statemachine/api';
import { workTypeMap } from '@/features/workitem/constants';
import { transitionWarningText } from '@/features/workitem/runtimeLabels';
import { transitionDotColor, type TransitionDotColor } from '@/features/workitem/transition';
import { getWorkitem, transitionWorkitem } from '@/features/workitem/api';
import { TRANSITION_REASON_MAX_LENGTH } from '@/features/workitem/transitionLimits';
import '@/features/workitem/transitionModal.css';

interface Recommendation {
  node: StatusNode;
  edgeName: string;
  edgeLabelKey: string | null;
}

interface Choice {
  record: Workitem;
  item: WorkitemDetail;
  recommended: Recommendation[];
  others: StatusNode[];
}

interface SubmitError {
  message: string;
  conflict: boolean;
}

/** 列表分类到圆点颜色；与推荐目标使用的 transitionDotColor 保持同一组色。 */
function statusCategoryDot(category?: string | null): TransitionDotColor {
  switch ((category ?? '').toUpperCase()) {
    case 'DONE': return 'green';
    case 'CANCELED':
    case 'NEW': return 'gray';
    case 'PENDING_DECISION': return 'amber';
    default: return 'blue';
  }
}

/**
 * 工作台「我在跟进」直接改状态：入口是状态标签本身（右侧箭头常驻）；
 * 弹窗先给工单上下文与「当前 → 目标」，推荐流转与其他状态分组，
 * 提交携带 fromNodeId/expectedVersion/reason，版本冲突留在弹窗内重新加载。
 */
export function useFollowingStatusTransition() {
  const { t } = useTranslation('workbench');
  const systemLabel = useSystemLabel();
  const queryClient = useQueryClient();
  const accessCommand = useAccessCommand();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<SubmitError | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['workbench'] });
    void queryClient.invalidateQueries({ queryKey: ['workitems'] });
  };

  const close = () => {
    setChoice(null);
    setTargetId(null);
    setReason('');
    setError(null);
  };

  const open = (record: Workitem) => {
    void accessCommand('READ_WRITE', i18n.t('workitem:actions.transition'), async () => {
      setPendingId(record.id);
      try {
        // 列表行可能已被他人更新：先取最新状态与模板，避免按陈旧候选提交。
        const item = await getWorkitem(record.id);
        if (item.version !== record.version || String(item.statusNodeId) !== String(record.statusNodeId)) {
          throw new Error(t('following.changeStatus.stale'));
        }
        if (item.templateId == null || item.statusNodeId == null) {
          throw new Error(t('following.changeStatus.noWorkflow'));
        }
        const template = await getTemplateDetail(item.templateId);
        const nodeById = new Map(template.nodes.map(node => [String(node.id), node]));
        const edges = template.transitions.filter(edge => String(edge.fromNodeId) === String(item.statusNodeId));
        const recommendedIds = new Set(edges.map(edge => String(edge.toNodeId)));
        const recommended: Recommendation[] = [];
        const seen = new Set<string>();
        for (const edge of edges) {
          const key = String(edge.toNodeId);
          const node = nodeById.get(key);
          if (!node || seen.has(key)) continue;
          seen.add(key);
          recommended.push({ node, edgeName: edge.name, edgeLabelKey: edge.systemLabelKey ?? null });
        }
        const others = template.nodes.filter(node => (
          String(node.id) !== String(item.statusNodeId) && !recommendedIds.has(String(node.id))
        ));
        if (recommended.length === 0 && others.length === 0) {
          throw new Error(t('following.changeStatus.noTarget'));
        }
        setChoice({ record, item, recommended, others });
        setTargetId(null);
        setReason('');
        setError(null);
      } catch (loadError) {
        message.error(loadError instanceof Error ? loadError.message : t('following.changeStatus.loadFailed'));
        refresh();
      } finally {
        setPendingId(null);
      }
    });
  };

  const reload = () => {
    const record = choice?.record;
    close();
    if (record) open(record);
  };

  const commit = async () => {
    if (!choice || targetId == null) return;
    setSaving(true);
    setError(null);
    try {
      await accessCommand('READ_WRITE', i18n.t('workitem:actions.transition'), async () => {
        const updated = await transitionWorkitem(choice.item.id, targetId, {
          fromNodeId: choice.item.statusNodeId!,
          expectedVersion: choice.item.version,
          reason: reason.trim() || undefined,
        });
        const node = [...choice.recommended.map(entry => entry.node), ...choice.others]
          .find(candidate => Number(candidate.id) === targetId);
        message.success(i18n.t('workitem:transition.updated', {
          name: node ? systemLabel(node.systemLabelKey, node.name) : '',
        }));
        // 越界流转放行但提示（规格 3.3）：警告由服务端在响应中下发。
        if (updated.transitionWarning) {
          message.warning(transitionWarningText(updated));
        }
        close();
        refresh();
      });
    } catch (submitError) {
      const conflict = (submitError as ApiError).code === ErrorCodes.WORKITEM_VERSION_CONFLICT;
      setError({
        message: conflict
          ? t('following.changeStatus.stale')
          : submitError instanceof Error ? submitError.message : i18n.t('workitem:transition.updateFailed'),
        conflict,
      });
      if (conflict) refresh();
    } finally {
      setSaving(false);
    }
  };

  const currentLabel = choice
    ? systemLabel(choice.item.statusLabelKey, choice.item.statusName ?? '') || t('fields.emptyValue')
    : '';
  const targetNode = choice
    ? [...choice.recommended.map(entry => entry.node), ...choice.others]
      .find(node => Number(node.id) === targetId) ?? null
    : null;
  const targetLabel = targetNode ? systemLabel(targetNode.systemLabelKey, targetNode.name) : '';
  const ownerName = choice
    ? (choice.item.assigneeType === 'HUMAN' || choice.item.assigneeType === 'AGENT') && choice.item.assigneeRef != null
      ? choice.item.assigneeDisplayName || choice.item.assigneeName || `#${choice.item.assigneeRef}`
      : t('fields.unassigned')
    : '';
  const typeLabel = choice ? workTypeMap[choice.item.workType]?.label ?? choice.item.workType : '';
  const options = choice ? [
    ...choice.recommended.map(entry => ({ node: entry.node, desc: t('following.changeStatus.transitionEdge', {
      name: systemLabel(entry.edgeLabelKey, entry.edgeName),
    }) })),
    ...choice.others.map(node => ({ node, desc: t('following.changeStatus.outOfTemplateHint') })),
  ] : [];
  const scrollable = options.length >= 5;

  const onOptionsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!step || saving || options.length === 0) return;
    event.preventDefault();
    const index = options.findIndex(option => Number(option.node.id) === targetId);
    const next = (index + step + options.length) % options.length;
    setTargetId(Number(options[next].node.id));
    const radios = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios[next]?.focus();
  };

  const renderOption = (node: StatusNode, desc: string) => {
    const checked = targetId === Number(node.id);
    const first = targetId == null && Number(options[0].node.id) === Number(node.id);
    return (
      <button
        key={String(node.id)}
        type="button"
        role="radio"
        aria-checked={checked}
        aria-label={systemLabel(node.systemLabelKey, node.name)}
        className={`aw-state-opt ${checked ? 'is-on' : ''}`}
        disabled={saving || !!error?.conflict}
        tabIndex={checked || first ? 0 : -1}
        onClick={() => setTargetId(Number(node.id))}
      >
        <span className={`aw-state-dot is-${transitionDotColor(node)}`} aria-hidden="true" />
        <span className="aw-state-opt-name">{systemLabel(node.systemLabelKey, node.name)}</span>
        <span className="aw-state-desc">{desc}</span>
      </button>
    );
  };

  const dialog = (
    <Modal
      className="aw-transition-modal aw-wb-transition"
      width={460}
      open={!!choice}
      title={(
        <span className="aw-transition-title">
          <AwStrokeIcon name="transfer" size={14} />
          {t('following.changeStatus.title')}
        </span>
      )}
      closeIcon={<AwStrokeIcon name="x" size={14} />}
      onCancel={close}
      closable={!saving && { 'aria-label': t('following.changeStatus.close') }}
      maskClosable={!saving}
      keyboard={!saving}
      okText={t('following.changeStatus.confirm')}
      cancelText={t('following.changeStatus.cancel')}
      confirmLoading={saving}
      onOk={() => void commit()}
      okButtonProps={{ size: 'small', disabled: targetId == null || saving || !!error?.conflict }}
      cancelButtonProps={{ size: 'small', disabled: saving }}
    >
      {choice ? (
        <>
          <div className="aw-wb-transition-context">
            <div className="aw-wb-transition-context-title" title={choice.item.title}>{choice.item.title}</div>
            <div className="aw-wb-transition-context-meta">
              {t('following.changeStatus.contextMeta', { id: choice.item.id, type: typeLabel, owner: ownerName })}
            </div>
          </div>
          {error ? (
            <Alert
              className="aw-wb-transition-alert"
              type={error.conflict ? 'warning' : 'error'}
              showIcon
              message={error.message}
              description={error.conflict ? t('following.changeStatus.staleHint') : undefined}
              action={error.conflict
                ? <Button size="small" type="link" onClick={reload}>{t('following.changeStatus.staleReload')}</Button>
                : undefined}
            />
          ) : null}
          <div className="aw-wb-transition-strip">
            <span>
              {t('following.changeStatus.current')}
              <span className="aw-wb-transition-strip-name">
                <span className={`aw-state-dot is-${statusCategoryDot(choice.item.statusCategory)}`} aria-hidden="true" />
                {currentLabel}
              </span>
            </span>
            <span className="aw-wb-transition-arrow" aria-hidden="true" />
            <span>
              {t('following.changeStatus.target')}
              <span className={targetNode ? 'aw-wb-transition-strip-name' : 'aw-wb-transition-strip-placeholder'}>
                {targetNode ? targetLabel : t('following.changeStatus.targetPlaceholder')}
              </span>
            </span>
          </div>
          <div
            className={scrollable ? 'aw-wb-transition-options is-scroll' : 'aw-wb-transition-options'}
            role="radiogroup"
            aria-label={t('following.changeStatus.title')}
            aria-disabled={saving}
            onKeyDown={onOptionsKeyDown}
          >
            {choice.recommended.length > 0 ? (
              <div className="aw-state-group">
                <div className="aw-state-group-title">
                  {t('following.changeStatus.recommended')}
                  <span className="aw-state-group-count">{choice.recommended.length}</span>
                </div>
                <div className="aw-state-opts">
                  {choice.recommended.map(entry => renderOption(
                    entry.node,
                    t('following.changeStatus.transitionEdge', { name: systemLabel(entry.edgeLabelKey, entry.edgeName) }),
                  ))}
                </div>
              </div>
            ) : null}
            {choice.others.length > 0 ? (
              <div className="aw-state-group">
                <div className="aw-state-group-title">
                  {t('following.changeStatus.others')}
                  <span className="aw-state-group-count">{choice.others.length}</span>
                </div>
                <div className="aw-state-opts">
                  {choice.others.map(node => renderOption(node, t('following.changeStatus.outOfTemplateHint')))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="aw-transition-reason">
            <Input.TextArea
              variant="borderless"
              aria-label={t('following.changeStatus.reasonLabel')}
              placeholder={t('following.changeStatus.reasonPlaceholder')}
              value={reason}
              disabled={saving}
              onChange={event => setReason(event.target.value)}
              maxLength={TRANSITION_REASON_MAX_LENGTH}
              showCount
              rows={2}
            />
          </div>
        </>
      ) : null}
    </Modal>
  );

  return { open, pendingId, dialog };
}
