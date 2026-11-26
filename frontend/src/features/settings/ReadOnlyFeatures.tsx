import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, Segmented } from 'antd';
import { workspaceDomainLabel } from '@/shared/auth/access';
import type { WorkspaceDomain } from '@/shared/types/common';

export type ConfigurableDomain = Exclude<WorkspaceDomain, 'AUTH' | 'USER' | 'MCP'>;

interface DomainGroup {
  key: string;
  labelKey: 'readOnlyFeatures.group.delivery' | 'readOnlyFeatures.group.workers' | 'readOnlyFeatures.group.knowledge' | 'readOnlyFeatures.group.configuration' | 'readOnlyFeatures.group.insights' | 'readOnlyFeatures.advancedShort';
  domains: readonly ConfigurableDomain[];
  advanced?: boolean;
}

export const CONFIGURABLE_GROUPS: readonly DomainGroup[] = [
  { key: 'delivery', labelKey: 'readOnlyFeatures.group.delivery', domains: ['WORKITEM', 'PRD', 'SCHEDULEDTASK', 'DISPATCH', 'ARTIFACT', 'CLARIFICATION', 'CONVERSATION', 'DEBUGLOG'] },
  { key: 'workers', labelKey: 'readOnlyFeatures.group.workers', domains: ['AGENT', 'SQUAD', 'EXECUTOR'] },
  { key: 'knowledge', labelKey: 'readOnlyFeatures.group.knowledge', domains: ['REPO', 'MEMORY', 'SKILL', 'CATEGORY'] },
  { key: 'configuration', labelKey: 'readOnlyFeatures.group.configuration', domains: ['SDLC', 'TEMPLATE', 'STATEMACHINE', 'INTEGRATION', 'WORKSPACE', 'BACKUP', 'ENVIRONMENT'] },
  { key: 'insights', labelKey: 'readOnlyFeatures.group.insights', domains: ['DASHBOARD', 'INSIGHTS', 'AUDIT'] },
  { key: 'advanced', labelKey: 'readOnlyFeatures.advancedShort', domains: ['AI', 'AIUSAGE', 'SETTING', 'EVOLUTION'], advanced: true },
];

export const CONFIGURABLE_DOMAINS: readonly ConfigurableDomain[] = CONFIGURABLE_GROUPS.flatMap((group) => group.domains);

export function ReadOnlyFeatures({ value = [], onChange, id, disabled = false }: {
  value?: WorkspaceDomain[];
  onChange?: (value: WorkspaceDomain[]) => void;
  id?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation('settings');
  const instanceId = useId();
  const [activeKey, setActiveKey] = useState(CONFIGURABLE_GROUPS[0].key);
  const active = CONFIGURABLE_GROUPS.find((group) => group.key === activeKey) ?? CONFIGURABLE_GROUPS[0];
  const groupLabel = t(active.labelKey);
  const readOnlyCount = active.domains.filter((domain) => value.includes(domain)).length;
  const permissionOptions = [
    { label: t('readOnlyFeatures.readWrite'), value: 'readWrite' as const },
    { label: t('readOnlyFeatures.readOnly'), value: 'readOnly' as const },
  ];

  const setDomainPermission = (domain: ConfigurableDomain, readOnly: boolean) => {
    onChange?.(readOnly
      ? value.includes(domain) ? value : [...value, domain]
      : value.filter((selected) => selected !== domain));
  };
  const setGroupPermission = (readOnly: boolean) => {
    onChange?.(readOnly
      ? [...value, ...active.domains.filter((domain) => !value.includes(domain))]
      : value.filter((domain) => !active.domains.some((item) => item === domain)));
  };

  return <div className="aw-perm" id={id}>
    <div className="aw-perm-nav" role="tablist" aria-label={t('readOnlyFeatures.categories')} aria-orientation="vertical">
      {CONFIGURABLE_GROUPS.map((group) => {
        const label = t(group.labelKey);
        const count = group.domains.filter((domain) => value.includes(domain)).length;
        return <button
          key={group.key}
          type="button"
          role="tab"
          aria-selected={group.key === active.key}
          aria-controls={`${instanceId}-panel`}
          className={group.key === active.key ? 'is-active' : undefined}
          onClick={() => setActiveKey(group.key)}
        >
          <span className="aw-perm-nav-name">{label}</span>
          <span className="aw-perm-nav-count">
            {t('readOnlyFeatures.groupStatus', { readOnly: count, readWrite: group.domains.length - count })}
          </span>
        </button>;
      })}
    </div>
    <div className="aw-perm-panel" id={`${instanceId}-panel`} role="tabpanel" aria-label={groupLabel}>
      <div className="aw-perm-panel-head">
        <span className="aw-perm-panel-title">{groupLabel}</span>
        <Checkbox
          checked={readOnlyCount === active.domains.length}
          indeterminate={readOnlyCount > 0 && readOnlyCount < active.domains.length}
          disabled={disabled}
          onChange={(event) => setGroupPermission(event.target.checked)}
        >
          {t('readOnlyFeatures.bulkReadOnly')}
        </Checkbox>
      </div>
      {active.advanced && <p className="aw-perm-hint">{t('readOnlyFeatures.advancedHint')}</p>}
      <div className="aw-perm-rows">
        {active.domains.map((domain) => {
          const label = workspaceDomainLabel(domain);
          const readOnly = value.includes(domain);
          return <div className="aw-perm-row" key={domain}>
            <div className="aw-perm-info">
              <div className="aw-perm-name">{label}</div>
              <div className="aw-perm-desc">{t(`readOnlyFeatures.description.${domain}`)}</div>
            </div>
            <div className="aw-perm-control">
              <Segmented
                size="small"
                className="aw-perm-seg"
                options={permissionOptions}
                value={readOnly ? 'readOnly' : 'readWrite'}
                disabled={disabled}
                aria-label={t('readOnlyFeatures.domainPermission', { domain: label })}
                onChange={(next) => setDomainPermission(domain, next === 'readOnly')}
              />
            </div>
          </div>;
        })}
      </div>
      <p className="aw-perm-hint">{t('readOnlyFeatures.permissionHint')}</p>
    </div>
  </div>;
}
