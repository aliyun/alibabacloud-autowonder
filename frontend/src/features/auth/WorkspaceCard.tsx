import { useTranslation } from 'react-i18next';
import { LoadingOutlined } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import type { WorkspaceInfo, WorkspaceListItem } from '@/shared/types/common';

type CardWorkspace = WorkspaceInfo & Partial<Pick<WorkspaceListItem, 'membershipStatus'>>;

interface WorkspaceCardProps<T extends CardWorkspace> {
  workspace: T;
  current: boolean;
  discovery?: boolean;
  switching?: boolean;
  switchBlocked?: boolean;
  onEnter: (workspace: T) => void;
  onBackground: (workspace: T) => void;
  onEdit: (workspace: T) => void;
  onDelete: (workspace: T) => void;
  onApply?: (workspace: T) => void;
  onCancelRequest?: (workspace: T) => void;
}

export function WorkspaceCard<T extends CardWorkspace>({ workspace, current, discovery = false, switching = false, switchBlocked = false, onEnter, onBackground, onEdit, onDelete, onApply, onCancelRequest }: WorkspaceCardProps<T>) {
  const { t } = useTranslation('auth');
  const member = workspace.membershipStatus === 'MEMBER';
  const pending = workspace.membershipStatus === 'PENDING';
  const manageable = workspace.canManage === true;
  const readable = !discovery || member || manageable;
  const prefix = discovery ? 'all-workspace' : 'workspace';
  const body = <>
    <span className="ws-card-head">
      <span className="ws-mark" aria-hidden="true">{workspace.name.trim().slice(0, 2).toUpperCase() || t('workspace.emptyName')}</span>
      <span className="ws-title">
        <span className="ws-name"><EllipsisText tooltip={workspace.name}>{workspace.name}</EllipsisText></span>
        {current && <span className="ws-cur">{t('workspace.current')}</span>}
        {discovery && <span className="ws-membership">{t(member ? 'workspace.member' : manageable ? 'workspace.manageable' : pending ? 'workspace.pending' : 'workspace.notMember')}</span>}
      </span>
    </span>
    <span className="ws-desc"><EllipsisText tooltip={workspace.description || t('workspace.noDescription')} lines={2}>{workspace.description || t('workspace.noDescription')}</EllipsisText></span>
  </>;
  const enterLabel = discovery && member
    ? switching ? 'workspace.enteringMember' : 'workspace.enterMember'
    : switching ? 'workspace.enteringName' : 'workspace.enterName';

  return <div
    data-testid={discovery ? `${prefix}-card-${workspace.id}` : `workspace-card-shell-${workspace.id}`}
    className={`ws-card${current ? ' ws-card--current' : ''}${readable ? '' : ' is-unjoined'}`}
  >
    {readable ? <button type="button" className="ws-card-enter"
      data-testid={discovery ? `${prefix}-enter-${workspace.id}` : `workspace-card-${workspace.id}`}
      aria-label={t(enterLabel, { name: workspace.name })} aria-busy={switching}
      disabled={switchBlocked} onClick={() => onEnter(workspace)}
    >{body}{switching && <LoadingOutlined className="ws-switching" />}</button> : <div className="ws-card-enter">{body}</div>}
    <div className="ws-foot">
      {readable && <div className="ws-stats">
        {workspace.memberCount != null && <span className="ws-count" title={t('workspace.memberCount', { count: workspace.memberCount })}><AwStrokeIcon name="team" size={11} /><span>{t('workspace.memberCount', { count: workspace.memberCount })}</span></span>}
        {workspace.workitemCount != null && <span className="ws-count" title={t('workspace.workitemCount', { count: workspace.workitemCount })}><AwStrokeIcon name="file" size={11} /><span>{t('workspace.workitemCount', { count: workspace.workitemCount })}</span></span>}
        <button type="button" className="ws-background" aria-label={t('workspace.viewBackground', { name: workspace.name })} onClick={() => onBackground(workspace)}><AwStrokeIcon name="book" size={11} />{t('workspace.backgroundShort')}</button>
      </div>}
      {manageable && <div className="ws-ops" data-testid={`${prefix}-manage-area-${workspace.id}`}>
        <button type="button" className="ws-op aw-card-manage-button" data-testid={discovery ? `${prefix}-edit-${workspace.id}` : `edit-workspace-${workspace.id}`} aria-label={t('workspace.editName', { name: workspace.name })} onClick={() => onEdit(workspace)}><AwStrokeIcon name="edit" size={14} /></button>
        <button type="button" className="ws-op ws-op--danger aw-card-manage-button aw-card-manage-button--danger" data-testid={discovery ? `${prefix}-delete-${workspace.id}` : `delete-workspace-${workspace.id}`} aria-label={t('workspace.deleteName', { name: workspace.name })} onClick={() => onDelete(workspace)}><AwStrokeIcon name="trash" size={14} /></button>
      </div>}
      {!readable && <div className="ws-access-line">
        {pending
          ? <button type="button" className="aw-apply-access-button" onClick={() => onCancelRequest?.(workspace)}>{t('workspace.withdraw')}</button>
          : <button type="button" className="aw-apply-access-button" data-testid={`apply-access-${workspace.id}`} onClick={() => onApply?.(workspace)}>{t('workspace.requestAccess')}</button>}
      </div>}
    </div>
  </div>;
}
