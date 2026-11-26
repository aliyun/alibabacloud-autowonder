import { useTranslation } from 'react-i18next';
import { Tag, Tooltip } from 'antd';
import { getAgentSystemTagLabel } from '../constants';

export interface AgentTagListProps {
  systemTags?: string[] | null;
  customTags?: string[] | null;
  /** null/undefined shows every tag; a number folds the rest into a +N chip. */
  maxVisible?: number | null;
  emptyText?: string;
  testId?: string;
}

interface TagEntry {
  key: string;
  label: string;
  system: boolean;
}

/** Read-only tag strip: system tags first (accent color), then custom tags in creation order. */
export function AgentTagList({
  systemTags,
  customTags,
  maxVisible,
  emptyText,
  testId = 'agent-tags',
}: AgentTagListProps) {
  const { t } = useTranslation('agent');
  const entries: TagEntry[] = [
    ...(systemTags ?? []).map((code) => ({ key: `system:${code}`, label: getAgentSystemTagLabel(code), system: true })),
    ...(customTags ?? []).map((name) => ({ key: `custom:${name}`, label: name, system: false })),
  ];

  if (entries.length === 0) {
    return <span className="agent-tags-empty" data-testid={testId}>{emptyText ?? t('tags.empty')}</span>;
  }

  const limit = maxVisible == null ? entries.length : Math.max(0, maxVisible);
  const visible = entries.slice(0, limit);
  const hidden = entries.slice(visible.length);

  return (
    <span className="agent-tags" data-testid={testId}>
      {visible.map((entry) => (
        <Tag key={entry.key} color={entry.system ? 'blue' : undefined} className="agent-tag">
          <span className="agent-tag-text">{entry.label}</span>
        </Tag>
      ))}
      {hidden.length > 0 && (
        <Tooltip title={hidden.map((entry) => entry.label).join(t('tags.overflowSeparator'))}>
          <Tag className="agent-tag agent-tags-overflow">{t('tags.overflow', { count: hidden.length })}</Tag>
        </Tooltip>
      )}
    </span>
  );
}
