import { useTranslation } from 'react-i18next';
import { useMemo, type CSSProperties } from 'react';
import { Segmented, Select, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { listAllSquads } from './api';
import { buildSquadNameById, type SquadOption } from './squadGrouping';

export function useSquadOptions() {
  // Walks every page: a single wide page would silently hide the squads past the cap from the
  // dropdown and from the grouped view. The queryKey prefix stays ['squads', 'filter-options']
  // because the agent / SDLC / squad pages invalidate it after squad CRUD.
  const { data, isLoading } = useQuery({
    queryKey: ['squads', 'filter-options'],
    queryFn: () => listAllSquads(),
    staleTime: 60_000,
  });

  const options = useMemo<SquadOption[]>(
    () => (data ?? []).map((squad) => ({ value: squad.id, label: squad.name })),
    [data],
  );
  const nameById = useMemo(() => buildSquadNameById(options), [options]);

  return { options, nameById, isLoading };
}

export interface SquadFilterBarProps {
  options: SquadOption[];
  value: number[];
  onChange: (next: number[]) => void;
  grouped: boolean;
  onGroupedChange: (next: boolean) => void;
  loading?: boolean;
  listLabel?: string;
  groupLabel?: string;
}

export function SquadViewSwitch({ grouped, onGroupedChange, listLabel, groupLabel }: Pick<SquadFilterBarProps, 'grouped' | 'onGroupedChange' | 'listLabel' | 'groupLabel'>) {
  const { t } = useTranslation('squad');
  return (
    <Segmented
      value={grouped ? 'group' : 'list'}
      onChange={(next) => onGroupedChange(next === 'group')}
      options={[
        { value: 'group', label: groupLabel ?? t('grouped') },
        { value: 'list', label: listLabel ?? t('list') },
      ]}
      aria-label={t('switchView')}
    />
  );
}

export function SquadSelect({ options, value, onChange, loading, style, single }: Pick<SquadFilterBarProps, 'options' | 'value' | 'onChange' | 'loading'> & { style?: CSSProperties; single?: boolean }) {
  const { t } = useTranslation('squad');
  if (single) {
    return (
      <Select
        allowClear
        showSearch
        optionFilterProp="label"
        placeholder={t('filter')}
        style={style ?? { minWidth: 220 }}
        loading={loading}
        value={value[0]}
        onChange={(next) => onChange(next == null ? [] : [next])}
        options={options}
        aria-label={t('filter')}
      />
    );
  }
  return (
    <Select
      mode="multiple"
      allowClear
      showSearch
      optionFilterProp="label"
      placeholder={t('filter')}
      style={style ?? { minWidth: 220 }}
      loading={loading}
      value={value}
      onChange={onChange}
      options={options}
      maxTagCount="responsive"
      aria-label={t('filter')}
    />
  );
}

export function SquadFilterBar({
  options, value, onChange, grouped, onGroupedChange, loading,
  listLabel, groupLabel,
}: SquadFilterBarProps) {
  return (
    <Space wrap>
      {/* 原型 21/24 工具栏：视图切换 Segmented 在前，小队筛选 Select 在后。 */}
      <SquadViewSwitch grouped={grouped} onGroupedChange={onGroupedChange} listLabel={listLabel} groupLabel={groupLabel} />
      <SquadSelect options={options} value={value} onChange={onChange} loading={loading} />
    </Space>
  );
}
