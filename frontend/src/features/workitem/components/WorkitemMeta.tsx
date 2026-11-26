import { externalPrincipalName } from '../runtimeLabels';
import type { ExternalPrincipalNameFallback } from '@/shared/types/workitem';
import { Button, Tag } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { displayNameWithoutId } from '../nameDisplay';
import { Trans, useTranslation } from 'react-i18next';
import { WorkitemTagList } from './WorkitemTagList';

interface WorkitemMetaProps {
  workitemId?: number | string | null;
  assigneeName: string | null;
  assigneeDisplayName?: string | null;
  assigneeNameFallback?: ExternalPrincipalNameFallback | null;
  assigneeType: string;
  creatorDisplayName?: string | null;
  sdlcName: string | null;
  tags?: string[];
  tagsEditable?: boolean;
  onEditTags?: () => void;
}

export function WorkitemMeta({ workitemId, assigneeName, assigneeDisplayName, assigneeNameFallback, assigneeType, creatorDisplayName, sdlcName, tags, tagsEditable = false, onEditTags }: WorkitemMetaProps) {
  const { t } = useTranslation('workitem');
  const assigneeText = externalPrincipalName(displayNameWithoutId(assigneeDisplayName, assigneeName), assigneeNameFallback);
  const isAgent = assigneeType === 'AGENT';
  const hasTags = !!tags && tags.length > 0;

  return (
    <div className="aw-workitem-meta">
      {workitemId != null && (
        <span>
          <Trans t={t} i18nKey="meta.id" components={{ value: <b className="aw-meta-mono">{workitemId}</b> }} />
        </span>
      )}
      {creatorDisplayName && (
        <span><Trans t={t} i18nKey="meta.creator" components={{ value: <b>{displayNameWithoutId(creatorDisplayName)}</b> }} /></span>
      )}
      <span>
        <Trans t={t} i18nKey="meta.assignee" components={{ value: <b>{isAgent && <Tag color="purple" style={{ margin: 0 }}>AI</Tag>}{isAgent ? ' ' : ''}{assigneeText ?? t('assignee.unassigned')}</b> }} />
      </span>
      {sdlcName && (
        <span><Trans t={t} i18nKey="meta.sdlc" components={{ value: <b>{sdlcName}</b> }} /></span>
      )}
      {tagsEditable || hasTags ? (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
          <Trans t={t} i18nKey="meta.tags" components={{ value: <span /> }} />
          <WorkitemTagList tags={tags} showEmpty={tagsEditable} />
          {tagsEditable ? (
            <Button
              type="text"
              size="small"
              className="aw-meta-tag-edit"
              aria-label={hasTags ? t('tags.editAria') : t('tags.add')}
              title={hasTags ? t('tags.edit') : t('tags.add')}
              icon={<AwStrokeIcon name="edit" />}
              onClick={onEditTags}
            >
              {hasTags ? null : t('tags.add')}
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
