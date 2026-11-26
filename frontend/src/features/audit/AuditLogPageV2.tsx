import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Descriptions, Drawer } from 'antd';
import { CloseCircleOutlined } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { PageHead } from '@/shared/ui/PageHead';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { usePageSizePreference } from '@/shared/lib/usePageSizePreference';
import { listAllAgents } from '@/features/agent/api';
import { countAuditLogs, listAuditLogs } from './api';
import type { AuditLog } from './api';
import { EMPTY_AUDIT_FILTERS, readInitialFilters, toQueryFilters } from './auditFilters';
import type { AuditFilterState } from './auditFilters';
import { parseDetail, triggerText } from './auditDetail';
import { AuditLogFilterBar } from './AuditLogFilterBar';
import { AuditLogTable } from './AuditLogTable';
import { AuditJsonBlock } from './AuditJsonBlock';
import './AuditLogPageV2.css';

const KEYWORD_DEBOUNCE_MS = 300;

export function AuditLogPageV2() {
  const { t } = useTranslation('audit');
  const [searchParams] = useSearchParams();
  const initialFilters = useMemo(() => readInitialFilters(searchParams), [searchParams]);
  const [filters, setFilters] = useState<AuditFilterState>(initialFilters);
  const [keywordInput, setKeywordInput] = useState(initialFilters.keyword);
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSizePreference('autowonder.auditLogs.pageSize', [10, 20, 50, 100, 200], 10);
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const keyword = useDebouncedValue(keywordInput, KEYWORD_DEBOUNCE_MS);

  useEffect(() => {
    setPage(1);
  }, [keyword]);

  const countFilters = useMemo(() => toQueryFilters(filters, keyword), [filters, keyword]);
  const queryFilters = useMemo(() => ({ page, size, ...countFilters }), [countFilters, page, size]);

  const { data: rows = [], isFetching, isError } = useQuery({
    queryKey: ['audit-logs', queryFilters],
    queryFn: () => listAuditLogs(queryFilters),
    placeholderData: keepPreviousData,
  });

  const { data: total = 0 } = useQuery({
    queryKey: ['audit-logs-count', countFilters],
    queryFn: () => countAuditLogs(countFilters),
    placeholderData: keepPreviousData,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['audit-log-agents'],
    queryFn: () => listAllAgents({}),
    enabled: filters.actorType === 'AGENT',
  });

  const updateFilters = (next: AuditFilterState) => {
    setFilters(next);
    setPage(1);
  };

  const resetFilters = () => {
    setFilters({ ...EMPTY_AUDIT_FILTERS });
    setKeywordInput('');
    setPage(1);
  };

  const detail = selected ? parseDetail(selected) : null;

  return (
    <div className="audit-page">
      <PageHead
        title={t('title')}
        description={t('headDescription', { subtitle: t('subtitle'), description: t('description') })}
      />
      {/* 筛选卡独立成块：首行关键词/时间范围/条数/重置，次行维度筛选等宽换行。 */}
      <div className="audit-filter-card">
        <AuditLogFilterBar
          value={filters}
          keywordInput={keywordInput}
          agents={agents}
          total={total}
          onChange={updateFilters}
          onKeywordChange={setKeywordInput}
          onReset={resetFilters}
        />
      </div>
      {isError && (
        <Alert
          type="error"
          showIcon
          icon={<CloseCircleOutlined aria-hidden="true" />}
          message={t('loadFailed')}
          className="audit-error"
        />
      )}
      <div className="audit-table-card">
        <AuditLogTable
          rows={rows}
          total={total}
          loading={isFetching}
          page={page}
          size={size}
          onPageChange={(nextPage, nextSize) => {
            setPage(nextPage);
            setSize(nextSize);
          }}
          onSelect={setSelected}
        />
      </div>
      <Drawer
        closable={{ closeIcon: <AwStrokeIcon name="x" />, 'aria-label': t('close') }}
        title={t('detailTitle')}
        width="min(760px, 95vw)"
        open={selected !== null}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <Descriptions column={1} bordered size="small" items={[
              { key: 'id', label: t('logId'), children: <span className="audit-mono">{selected.id}</span> },
              { key: 'action', label: t('rawAction'), children: <span className="audit-mono">{selected.action}</span> },
              { key: 'trigger', label: t('trigger'), children: triggerText(selected) },
              { key: 'event', label: t('eventType'), children: <span className="audit-mono">{detail?.eventType ? String(detail.eventType) : t('emptyValue')}</span> },
            ]} />
            <AuditJsonBlock titleKey="fullRecord" value={selected} />
            <AuditJsonBlock titleKey="eventDetail" value={detail ?? {}} />
          </>
        )}
      </Drawer>
    </div>
  );
}
