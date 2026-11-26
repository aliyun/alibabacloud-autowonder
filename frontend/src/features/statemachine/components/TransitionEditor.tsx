import { useTranslation } from 'react-i18next';
import { useSystemLabel } from '@/shared/i18n/systemLabels';
import { useState } from 'react';
import { Button, Popconfirm, Alert, Space } from 'antd';
import { Table } from '@/shared/theme/ThemedTable';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { StatusNode, StatusTransition, NodeCategory } from '../types';
import { TransitionFormModal } from './TransitionFormModal';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';

const CATEGORY_KEYS: NodeCategory[] = ['INIT', 'IN_PROGRESS', 'DONE', 'CANCELED'];

const categoryOf = (category: string): NodeCategory =>
  CATEGORY_KEYS.includes(category as NodeCategory) ? (category as NodeCategory) : 'IN_PROGRESS';

interface Props {
  transitions: StatusTransition[];
  nodes: StatusNode[];
  onCreate: (data: { fromNodeId: number; toNodeId: number; name: string }) => void;
  onUpdate: (tid: number, data: { fromNodeId: number; toNodeId: number; name: string }) => void;
  onDelete: (tid: number) => void;
  createLoading?: boolean;
  updateLoading?: boolean;
}

export function TransitionEditor({ transitions, nodes, onCreate, onUpdate, onDelete, createLoading, updateLoading }: Props) {
  const { t } = useTranslation('statemachine');
  const labelOf = useSystemLabel();
  const accessCommand = useAccessCommand();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<StatusTransition | null>(null);

  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const openCreate = () => accessCommand('READ_WRITE', t('actions.createTransition'), () => {
    setEditing(null);
    setModalOpen(true);
  });
  const openEdit = (tr: StatusTransition) => accessCommand('READ_WRITE', t('actions.editTransition'), () => {
    setEditing(tr);
    setModalOpen(true);
  });

  const handleSubmit = (values: { fromNodeId: number; toNodeId: number; name: string }) => {
    if (editing) {
      onUpdate(editing.id, values);
    } else {
      onCreate(values);
    }
    setModalOpen(false);
  };

  const renderNodeTag = (nodeId: number) => {
    const node = nodeMap[nodeId];
    if (!node) return <span className="aw-st-node aw-st-node--cell">?</span>;
    return (
      <span className={`aw-st-node aw-st-node--cell aw-st-node--${categoryOf(node.category)}`}>
        <span className="dot" />
        <b>{node.code}</b>
      </span>
    );
  };

  return (
    <div>
      <div className="aw-stpl-sec-head">
        <div>
          <div className="aw-stpl-sec-t">{t('transitions.title')}</div>
          <div className="aw-stpl-sec-hint">{t('transitions.help')}</div>
        </div>
        <Button icon={<AwStrokeIcon name="plus" />} onClick={openCreate}>{t('transitions.add')}</Button>
      </div>
      <Table<StatusTransition>
        className="aw-stpl-table"
        rowKey="id"
        dataSource={transitions}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: t('transitions.fromColumn'), dataIndex: 'fromNodeId', width: 160, render: renderNodeTag },
          { title: t('transitions.toColumn'), dataIndex: 'toNodeId', width: 160, render: renderNodeTag },
          { title: t('transitions.name'), dataIndex: 'name', width: 320, align: 'left', render: (value: string | null, tr) => labelOf(tr.systemLabelKey, value ?? '') },
          { title: t('transitions.actions'), align: 'right', render: (_, tr) => (
            <Space>
              <Button type="link" size="small" icon={<AwStrokeIcon name="edit" />} onClick={() => openEdit(tr)}>{t('common.edit')}</Button>
              <Popconfirm title={t('transitions.confirmDelete')} onConfirm={() => onDelete(tr.id)} okText={t('common.delete')} cancelText={t('common.cancel')}>
                <Button type="link" size="small" danger icon={<AwStrokeIcon name="trash" />}>{t('common.delete')}</Button>
              </Popconfirm>
            </Space>
          ) },
        ]}
      />
      <Alert
        type="warning"
        showIcon
        style={{ marginTop: 12 }}
        message={t('transitions.warning')}
      />
      <TransitionFormModal
        open={modalOpen}
        editing={editing}
        nodes={nodes}
        onSubmit={handleSubmit}
        onCancel={() => setModalOpen(false)}
        loading={createLoading || updateLoading}
      />
    </div>
  );
}
