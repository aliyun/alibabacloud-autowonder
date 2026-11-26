import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Select, Space, message } from 'antd';
import { i18n } from '@/shared/i18n';
import {
  AGENT_SYSTEM_TAGS,
  getAgentSystemTagLabel,
  getAgentSystemTagLabelForLanguage,
  isAgentSystemTag,
  type AgentSystemTagCode,
} from '../constants';
import { useAgentTagOptions, useUpdateAgentTags } from '../hooks';
import type { Agent } from '../api';

const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 64;
const TAG_SEPARATORS = /[,，]/u;
const CUSTOM_TAG_PREFIX = '\u0000';

const customTagValue = (name: string) => `${CUSTOM_TAG_PREFIX}${name}`;
const customTagName = (value: string) => value.startsWith(CUSTOM_TAG_PREFIX) ? value.slice(CUSTOM_TAG_PREFIX.length) : value;

/** Trim, split on the comma separators, drop blanks and dedupe by exact value keeping first order. */
export function normalizeAgentTagValues(raw: string[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of raw) {
    for (const part of String(item).split(TAG_SEPARATORS)) {
      const value = part.trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}

/** Returns the i18n error message, or null when the draft can be saved. */
export function validateAgentTagValues(values: string[]): string | null {
  const t = i18n.getFixedT(null, 'agent');
  if (values.length > MAX_TAGS) {
    return t('tags.tooMany', { max: MAX_TAGS });
  }
  if (values.some((value) => customTagName(value).length > MAX_TAG_LENGTH)) {
    return t('tags.tooLong', { max: MAX_TAG_LENGTH });
  }
  const systemNames = new Set<string>();
  for (const language of ['zh-CN', 'en-US']) {
    for (const code of AGENT_SYSTEM_TAGS) {
      systemNames.add(getAgentSystemTagLabelForLanguage(code, language).trim().toLowerCase());
    }
  }
  const conflict = values.some((value) => !isAgentSystemTag(value)
    && systemNames.has(customTagName(value).trim().toLowerCase()));
  return conflict ? t('tags.systemConflict') : null;
}

/** Split the draft into canonical system codes (declaration order) and custom names (input order). */
export function splitAgentTagValues(values: string[]): { systemTags: AgentSystemTagCode[]; customTags: string[] } {
  return {
    systemTags: AGENT_SYSTEM_TAGS.filter((code) => values.includes(code)),
    customTags: values.filter((value) => !isAgentSystemTag(value)).map(customTagName),
  };
}

export interface AgentTagsEditorProps {
  agent: Agent;
  onClose: () => void;
}

/** Inline popover editor: system tags are fixed options, custom tags are free text. */
export function AgentTagsEditor({ agent, onClose }: AgentTagsEditorProps) {
  const { t } = useTranslation('agent');
  const [values, setValues] = useState<string[]>(
    () => [...(agent.systemTags ?? []).filter(isAgentSystemTag), ...(agent.customTags ?? []).map(customTagValue)],
  );
  const { data: suggestions = [] } = useAgentTagOptions();
  const update = useUpdateAgentTags();
  const error = validateAgentTagValues(values);
  const payload = splitAgentTagValues(values);

  // The dropdown is permanently open and rendered inside the popover; rc-select stops the
  // bubbling Escape keydown, so the listener must run in the capture phase to win first.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose]);

  // Recomputed every render so system option labels follow a live language switch.
  const options = [
    ...AGENT_SYSTEM_TAGS.map((code) => ({ value: code, label: getAgentSystemTagLabel(code) })),
    ...[...new Set([...suggestions, ...payload.customTags])]
      .map((name) => ({ value: customTagValue(name), label: name })),
  ];

  const changeValues = (next: string[]) => {
    // Selected custom tags retain their stored names. Only newly typed text is split on commas.
    const normalized = next.flatMap((value) => value.startsWith(CUSTOM_TAG_PREFIX) ? [value]
      : normalizeAgentTagValues([value]).map((name) => isAgentSystemTag(name) ? name : customTagValue(name)));
    setValues([...new Set(normalized)]);
  };

  const save = () => {
    if (error || update.isPending) return;
    update.mutate(
      { agentId: agent.id, payload: { systemTags: [...payload.systemTags], customTags: payload.customTags } },
      {
        onSuccess: () => {
          message.success(i18n.t('tags.saved', { ns: 'agent' }));
          onClose();
        },
        // Keep the draft and the popover open so the user can fix and retry.
        onError: (err) => message.error(err instanceof Error && err.message || i18n.t('tags.saveFailed', { ns: 'agent' })),
      },
    );
  };

  return (
    <div className="agent-tags-editor" data-testid="agent-tags-editor">
      {/* Keep every control above the Select: its dropdown opens downwards and must not cover
          the Save/Cancel buttons (AGENT-TAG-UI-01). */}
      <div className="agent-tags-editor-bar">
        <div className="agent-tags-editor-meta">
          <span className="agent-tags-editor-error" role="alert">{error ?? ''}</span>
          <span className="agent-tags-editor-count">{t('tags.count', { count: values.length, max: MAX_TAGS })}</span>
        </div>
        <Space className="agent-tags-editor-actions" size={4}>
          <Button size="small" onClick={onClose}>{t('tags.cancel')}</Button>
          <Button
            size="small"
            type="primary"
            loading={update.isPending}
            disabled={Boolean(error) || update.isPending}
            onClick={save}
          >
            {t('tags.save')}
          </Button>
        </Space>
      </div>
      <Select
        mode="tags"
        // Keep the dropdown inside the popover so option clicks do not count as outside clicks.
        getPopupContainer={(trigger) => trigger.parentElement ?? document.body}
        autoFocus
        open
        virtual={false}
        className="agent-tags-editor-select"
        aria-label={t('tags.selectAria')}
        placeholder={t('tags.placeholder')}
        value={values}
        onChange={changeValues}
        options={options}
        notFoundContent={null}
      />
    </div>
  );
}
