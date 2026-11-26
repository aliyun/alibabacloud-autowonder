import { useTranslation } from 'react-i18next';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import { useState } from 'react';
import { Button, Popconfirm } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { StatusNode, NodeCategory } from '../types';
import { NodeFormModal } from './NodeFormModal';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';

const CATEGORY_KEYS: NodeCategory[] = ['INIT', 'IN_PROGRESS', 'DONE', 'CANCELED'];

const categoryOf = (category: string): NodeCategory =>
  CATEGORY_KEYS.includes(category as NodeCategory) ? (category as NodeCategory) : 'IN_PROGRESS';

interface Props {
  nodes: StatusNode[];
  onCreate: (data: { code: string; name: string; category: string; sort: number }) => void;
  onUpdate: (nodeId: number, data: { code: string; name: string; category: string; sort: number }) => void;
  onDelete: (nodeId: number) => void;
  createLoading?: boolean;
  updateLoading?: boolean;
}

export function StatusNodeEditor({ nodes, onCreate, onUpdate, onDelete, createLoading, updateLoading }: Props) {
  const { t } = useTranslation('statemachine');
  const labelOf = useSystemLabel();
  const categoryLabel: Record<NodeCategory, string> = {
    INIT: t('categories.INIT'), IN_PROGRESS: t('categories.IN_PROGRESS'), DONE: t('categories.DONE'), CANCELED: t('categories.CANCELED'),
  };
  const accessCommand = useAccessCommand();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<StatusNode | null>(null);

  const openCreate = () => accessCommand('READ_WRITE', t('actions.createNode'), () => {
    setEditing(null);
    setModalOpen(true);
  });
  const openEdit = (node: StatusNode) => accessCommand('READ_WRITE', t('actions.editNode'), () => {
    setEditing(node);
    setModalOpen(true);
  });

  const handleSubmit = (values: { code: string; name: string; category: string; sort: number }) => {
    if (editing) {
      onUpdate(editing.id, values);
    } else {
      onCreate(values);
    }
    setModalOpen(false);
  };

  const nextSort = nodes.length > 0 ? Math.max(...nodes.map((n) => n.sort)) + 1 : 0;

  return (
    <div>
      <div className="aw-stpl-sec-head">
        <div>
          <div className="aw-stpl-sec-t">{t('nodes.title')}</div>
          <div className="aw-stpl-sec-hint">{t('nodes.help')}</div>
        </div>
        <Button icon={<AwStrokeIcon name="plus" />} onClick={openCreate}>{t('nodes.add')}</Button>
      </div>
      <div className="aw-stpl-node-wrap">
        {nodes.map((node) => (
          <span key={node.id} className={`aw-st-node aw-st-node--${categoryOf(node.category)}`}>
            <span className="dot" />
            <b>{node.code}</b>
            <span className="nm">{labelOf(node.systemLabelKey, node.name)}</span>
            <span className="n-ops">
              <Button type="text" size="small" aria-label={t('nodes.editLabel', { code: node.code })} icon={<AwStrokeIcon name="edit" size={13} />} onClick={() => openEdit(node)} />
              <Popconfirm title={t('nodes.confirmDelete')} onConfirm={() => onDelete(node.id)} okText={t('common.delete')} cancelText={t('common.cancel')}>
                <Button type="text" size="small" danger aria-label={t('nodes.deleteLabel', { code: node.code })} icon={<AwStrokeIcon name="trash" size={13} />} />
              </Popconfirm>
            </span>
          </span>
        ))}
      </div>
      <div className="aw-stpl-legend">
        {CATEGORY_KEYS.map((cat) => (
          <span key={cat} className="lg">
            <span aria-hidden="true" className={`aw-stpl-dot aw-stpl-dot--${cat}`} />
            {categoryLabel[cat]}
          </span>
        ))}
      </div>
      <NodeFormModal
        open={modalOpen}
        editing={editing}
        nextSort={nextSort}
        onSubmit={handleSubmit}
        onCancel={() => setModalOpen(false)}
        loading={createLoading || updateLoading}
      />
    </div>
  );
}
