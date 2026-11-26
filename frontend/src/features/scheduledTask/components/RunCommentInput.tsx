import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type KeyboardEvent } from 'react';
import { Button, Input, Space } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { MentionMenu, type MentionMenuRow, type MentionMenuSection } from '@/shared/ui/MentionMenu';
import { useScheduledTaskRunMentionCandidates } from '../hooks';
import type { ScheduledRunCommentBody, ScheduledRunMentionCandidate } from '../types';

interface RunCommentInputProps {
  runId?: number;
  onSubmit: (payload: ScheduledRunCommentBody) => void;
  loading?: boolean;
}

interface RunMentionOption {
  key: string;
  value: string;
  targetId: number;
  targetType: 'AGENT' | 'HUMAN';
  disabled: boolean;
  disabledReason: string | null;
  squadName: string | null;
  currentSquad: boolean;
  displayId: string | null;
  online: boolean | null;
}

const composerTextStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 14,
  lineHeight: '22px',
  letterSpacing: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
};

function findActiveMentionQuery(value: string, caretIndex: number): string | null {
  const textBeforeCaret = value.slice(0, caretIndex);
  const mentionStart = textBeforeCaret.lastIndexOf('@');

  if (mentionStart < 0) return null;

  const query = textBeforeCaret.slice(mentionStart + 1);
  if (/\s/.test(query)) return null;

  return query;
}

function targetTypeOf(candidate: ScheduledRunMentionCandidate): 'AGENT' | 'HUMAN' {
  const explicit = candidate.targetType?.toUpperCase();
  if (explicit === 'AGENT' || explicit === 'HUMAN') return explicit;
  return candidate.isAgent ? 'AGENT' : 'HUMAN';
}

export function RunCommentInput({ runId, onSubmit, loading }: RunCommentInputProps) {
  const { t } = useTranslation('scheduledTask');
  const [content, setContent] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [selectedMentionNames, setSelectedMentionNames] = useState<Map<string, string>>(new Map());
  const [targetAgentIds, setTargetAgentIds] = useState<number[]>([]);
  const [targetHumanIds, setTargetHumanIds] = useState<number[]>([]);
  const textAreaRef = useRef<TextAreaRef>(null);

  const { data: candidateData, isFetching: candidatesFetching } = useScheduledTaskRunMentionCandidates(
    runId,
    mentionQuery,
    mentionQuery !== null,
  );
  const candidates = useMemo(() => candidateData ?? [], [candidateData]);

  const candidateNameByTarget = useMemo(() => {
    const names = new Map<string, string>();
    candidates.forEach((candidate) => {
      if (typeof candidate.name === 'string' && candidate.name.trim() !== '') {
        names.set(`${targetTypeOf(candidate)}:${Number(candidate.userId)}`, candidate.name);
      }
    });
    return names;
  }, [candidates]);

  const mentionOptions = useMemo<RunMentionOption[]>(() => {
    const normalizedQuery = mentionQuery?.toLowerCase() ?? '';

    return candidates
      .filter((candidate) => typeof candidate.name === 'string' && candidate.name.trim() !== '')
      .filter((candidate) => Number.isFinite(Number(candidate.userId)))
      .filter((candidate) => candidate.name!.toLowerCase().includes(normalizedQuery)
        || String(candidate.displayId ?? candidate.userId).toLowerCase().includes(normalizedQuery))
      .map((candidate) => {
        const targetType = targetTypeOf(candidate);
        const targetId = Number(candidate.userId);
        const disabled = candidate.mentionable === false;
        const disabledReason = disabled
          ? (candidate.mentionDisabledReasonCode === 'NOT_FROZEN'
              ? t('comment.notFrozen')
              : (candidate.mentionDisabledReason || t('comment.notFrozen')))
          : null;
        return {
          key: `${targetType}:${targetId}`,
          value: candidate.name!,
          targetId,
          targetType,
          disabled,
          disabledReason,
          squadName: candidate.squadName ?? null,
          currentSquad: Boolean(candidate.currentSquad),
          displayId: candidate.displayId ?? null,
          online: candidate.online ?? null,
        };
      });
  }, [candidates, mentionQuery, t]);

  // 只有后端返回小队信息时才插入分组标题；旧数据与降级场景保持原来的平铺菜单。
  const showMentionSquadGroups = useMemo(
    () => mentionOptions.some((option) => option.currentSquad || option.squadName != null),
    [mentionOptions],
  );

  const enabledOptions = useMemo(() => mentionOptions.filter((option) => !option.disabled), [mentionOptions]);
  const activeOption = enabledOptions[activeMentionIndex];
  const activeKey = activeOption?.key ?? null;
  const optionsByKey = useMemo(() => new Map(mentionOptions.map((option) => [option.key, option])), [mentionOptions]);

  const toMentionRow = (option: RunMentionOption): MentionMenuRow => ({
    key: option.key,
    name: option.value,
    isAgent: option.targetType === 'AGENT',
    active: option.key === activeKey,
    disabled: option.disabled,
    online: option.online,
    meta: [
      option.targetType === 'AGENT' ? option.squadName : (option.displayId ?? option.squadName),
      option.targetType === 'AGENT' ? t('labels.agent') : t('comment.human'),
    ],
    reason: option.disabledReason,
    query: mentionQuery,
  });

  const mentionSections: MentionMenuSection[] = (() => {
    if (!showMentionSquadGroups) {
      return [{ key: 'all', rows: mentionOptions.map(toMentionRow) }];
    }

    const sections: MentionMenuSection[] = [];
    const currentSquadOptions = mentionOptions.filter((option) => option.currentSquad);
    if (currentSquadOptions.length > 0) {
      sections.push({
        key: 'current',
        label: t('comment.mentionGroupCurrentSquadUnknown'),
        squadName: currentSquadOptions[0].squadName,
        rows: currentSquadOptions.map(toMentionRow),
      });
    }
    const otherOptions = mentionOptions.filter((option) => !option.currentSquad);
    if (otherOptions.length > 0) {
      sections.push({
        key: 'others',
        label: t('comment.mentionGroupOthers'),
        rows: otherOptions.map(toMentionRow),
      });
    }
    return sections;
  })();

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionQuery]);

  useEffect(() => {
    setActiveMentionIndex((current) => {
      if (enabledOptions.length === 0) return 0;
      return Math.min(current, enabledOptions.length - 1);
    });
  }, [enabledOptions.length]);

  const hasMentionText = (value: string, targetType: 'AGENT' | 'HUMAN', targetId: number) => {
    const name = selectedMentionNames.get(`${targetType}:${targetId}`)
      ?? candidateNameByTarget.get(`${targetType}:${targetId}`);
    return name != null && value.includes(`@${name}`);
  };

  const syncSelectedMentions = (value: string) => {
    setTargetAgentIds((current) => current.filter((agentId) => hasMentionText(value, 'AGENT', agentId)));
    setTargetHumanIds((current) => current.filter((humanId) => hasMentionText(value, 'HUMAN', humanId)));
  };

  const resetMentionState = () => {
    setMentionQuery(null);
    setActiveMentionIndex(0);
    setSelectedMentionNames(new Map());
    setTargetAgentIds([]);
    setTargetHumanIds([]);
  };

  const handleSend = () => {
    const trimmed = content.trim();
    if (!trimmed) return;

    onSubmit({ contentMd: trimmed, targetAgentIds, targetHumanIds });
    setContent('');
    resetMentionState();
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    const caretIndex = event.target.selectionStart ?? nextValue.length;

    setContent(nextValue);
    syncSelectedMentions(nextValue);
    setMentionQuery(findActiveMentionQuery(nextValue, caretIndex));
  };

  const insertMention = (option: { value: string; targetType: 'AGENT' | 'HUMAN'; targetId: number }) => {
    const textarea = textAreaRef.current?.resizableTextArea?.textArea;
    const selectionStart = textarea?.selectionStart ?? content.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const textBeforeSelection = content.slice(0, selectionStart);
    const mentionStart = textBeforeSelection.lastIndexOf('@');
    const replaceStart = mentionStart >= 0 ? mentionStart : selectionStart;
    const mentionText = `@${option.value} `;
    const nextValue = `${content.slice(0, replaceStart)}${mentionText}${content.slice(selectionEnd)}`;
    const nextCaret = replaceStart + mentionText.length;

    setContent(nextValue);
    setMentionQuery(null);
    setActiveMentionIndex(0);
    setSelectedMentionNames((current) => {
      const next = new Map(current);
      next.set(`${option.targetType}:${option.targetId}`, option.value);
      return next;
    });
    syncSelectedMentions(nextValue);
    if (option.targetType === 'AGENT') {
      setTargetAgentIds((current) => current.includes(option.targetId) ? current : [...current, option.targetId]);
    } else {
      setTargetHumanIds((current) => current.includes(option.targetId) ? current : [...current, option.targetId]);
    }

    window.setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCaret, nextCaret);
    }, 0);
  };

  const moveActiveMention = (delta: number) => {
    if (enabledOptions.length === 0) return;
    setActiveMentionIndex((current) => (current + delta + enabledOptions.length) % enabledOptions.length);
  };

  const selectMentionRow = (row: MentionMenuRow) => {
    const option = optionsByKey.get(row.key);
    if (option && !option.disabled) insertMention(option);
  };

  const hoverMentionRow = (row: MentionMenuRow) => {
    const index = enabledOptions.findIndex((option) => option.key === row.key);
    if (index >= 0) setActiveMentionIndex(index);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (mentionQuery !== null) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionQuery(null);
        setActiveMentionIndex(0);
        return;
      }

      if (event.key === 'ArrowDown' && enabledOptions.length > 0) {
        event.preventDefault();
        moveActiveMention(1);
        return;
      }

      if (event.key === 'ArrowUp' && enabledOptions.length > 0) {
        event.preventDefault();
        moveActiveMention(-1);
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey && activeOption) {
        event.preventDefault();
        insertMention(activeOption);
        return;
      }
    }

    if (event.key !== 'Enter' || event.shiftKey) return;

    event.preventDefault();
    handleSend();
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;

    setMentionQuery(findActiveMentionQuery(content, event.currentTarget.selectionStart ?? content.length));
  };

  return (
    <Space.Compact style={{ width: '100%', alignItems: 'stretch' }} data-testid="run-comment-input">
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {mentionQuery !== null && (
          <MentionMenu
            className="aw-mm--floating"
            sections={mentionSections}
            loading={candidatesFetching}
            query={mentionQuery}
            onSelect={selectMentionRow}
            onHover={hoverMentionRow}
          />
        )}
        <Input.TextArea
          ref={textAreaRef}
          aria-label={t('comment.label')}
          value={content}
          onChange={handleChange}
          onClick={(event) => setMentionQuery(findActiveMentionQuery(content, event.currentTarget.selectionStart ?? content.length))}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          autoSize={{ minRows: 1, maxRows: 6 }}
          placeholder={t('comment.placeholder')}
          disabled={loading}
          style={{ width: '100%', ...composerTextStyle }}
        />
      </div>
      <Button
        aria-label={t('comment.send')}
        type="primary"
        style={{ alignSelf: 'stretch', height: 'auto' }}
        loading={loading}
        onClick={handleSend}
      >
        {t('comment.send')}
      </Button>
    </Space.Compact>
  );
}
