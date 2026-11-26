import { Button, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import type { WorkspaceInfo } from '@/shared/types/common';

interface WorkspaceBackgroundModalProps {
  workspace: WorkspaceInfo | null;
  onClose: () => void;
  onEdit: (workspace: WorkspaceInfo) => void;
}

export function WorkspaceBackgroundModal({ workspace, onClose, onEdit }: WorkspaceBackgroundModalProps) {
  const { t } = useTranslation('auth');
  return <Modal
    className="ws-modal ws-background-modal" width={520} centered styles={{ mask: { backgroundColor: 'rgba(0,0,0,.45)' } }}
    // 原型用原生 dialog，关闭后不把焦点还给「背景」触发按钮；antd 默认还原会留下 :focus-visible 蓝框。
    focusTriggerAfterClose={false}
    title={workspace?.name ?? ''}
    open={workspace !== null} onCancel={onClose} destroyOnHidden
    footer={<>
      <Button onClick={onClose}>{t('action.close')}</Button>
      {workspace?.canManage === true && <Button type="primary" onClick={() => { onClose(); onEdit(workspace); }}>{t('action.edit')}</Button>}
    </>}
  >
    <p className="ws-background-description">{workspace?.description || t('workspace.noDescription')}</p>
    <h3 className="ws-background-label">{t('workspace.backgroundShort')}</h3>
    <div className="ws-background-text">{workspace?.background || t('workspace.emptyBackground')}</div>
  </Modal>;
}
