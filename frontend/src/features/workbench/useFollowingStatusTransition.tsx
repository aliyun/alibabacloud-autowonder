import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseOutlined } from '@ant-design/icons';
import { Button, message, Modal, Space, Typography } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { i18n } from '@/shared/i18n';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import type { Workitem, WorkitemDetail } from '@/shared/types/workitem';
import type { StatusNode } from '@/features/statemachine/types';
import { getTemplateDetail } from '@/features/statemachine/api';
import { transitionWarningText } from '@/features/workitem/runtimeLabels';
import { getWorkitem, transitionWorkitem } from '@/features/workitem/api';

interface Choice {
  item: WorkitemDetail;
  nodes: StatusNode[];
  recommendedIds: Set<string>;
}

/**
 * 工作台「我在跟进」直接改状态：候选来自工单所属模板且推荐目标优先；
 * 提交携带 fromNodeId/expectedVersion，列表行已被更新时先提示并刷新，
 * 不在前端预测权限或流转后的落列（与看板拖拽同一口径）。
 */
export function useFollowingStatusTransition() {
  const { t } = useTranslation('workbench');
  const systemLabel = useSystemLabel();
  const queryClient = useQueryClient();
  const accessCommand = useAccessCommand();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['workbench'] });
    void queryClient.invalidateQueries({ queryKey: ['workitems'] });
  };

  const close = () => setChoice(null);

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
        const recommendedIds = new Set(template.transitions
          .filter(edge => String(edge.fromNodeId) === String(item.statusNodeId))
          .map(edge => String(edge.toNodeId)));
        const nodes = template.nodes
          .filter(node => String(node.id) !== String(item.statusNodeId))
          .sort((a, b) => Number(recommendedIds.has(String(b.id))) - Number(recommendedIds.has(String(a.id))));
        if (nodes.length === 0) {
          throw new Error(t('following.changeStatus.noTarget'));
        }
        setChoice({ item, nodes, recommendedIds });
      } catch (error) {
        message.error(error instanceof Error ? error.message : t('following.changeStatus.loadFailed'));
        refresh();
      } finally {
        setPendingId(null);
      }
    });
  };

  const commit = async (item: WorkitemDetail, node: StatusNode) => {
    setSaving(true);
    try {
      await accessCommand('READ_WRITE', i18n.t('workitem:actions.transition'), async () => {
        const updated = await transitionWorkitem(item.id, node.id, {
          fromNodeId: item.statusNodeId!, expectedVersion: item.version,
        });
        message.success(i18n.t('workitem:transition.updated', { name: systemLabel(node.systemLabelKey, node.name) }));
        // 越界流转放行但提示（规格 3.3）：警告由服务端在响应中下发。
        if (updated.transitionWarning) {
          message.warning(transitionWarningText(updated));
        }
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : i18n.t('workitem:transition.updateFailed'));
    } finally {
      setSaving(false);
      setChoice(null);
      refresh();
    }
  };

  const dialog = (
    <Modal
      title={i18n.t('workitem:transition.choose')}
      open={!!choice}
      footer={null}
      onCancel={close}
      closeIcon={<CloseOutlined aria-hidden="true" />}
      closable={!saving && { 'aria-label': i18n.t('workitem:projection.close') }}
      maskClosable={!saving}
      keyboard={!saving}
    >
      <Typography.Paragraph>
        {i18n.t('workitem:transition.choices', {
          name: choice ? systemLabel(choice.item.statusLabelKey, choice.item.statusName ?? '') : '',
        })}
      </Typography.Paragraph>
      <Space wrap>
        {choice?.nodes.map(node => (
          <Button
            key={String(node.id)}
            disabled={saving}
            type={choice.recommendedIds.has(String(node.id)) ? 'primary' : 'default'}
            aria-label={i18n.t('workitem:detail.transitionTo', { name: node.name })}
            onClick={() => void commit(choice.item, node)}
          >
            {systemLabel(node.systemLabelKey, node.name)}
          </Button>
        ))}
      </Space>
    </Modal>
  );

  return { open, pendingId, dialog };
}
