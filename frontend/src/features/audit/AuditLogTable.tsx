import { useTranslation } from 'react-i18next';
import { Spin, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Table } from '@/shared/theme/ThemedTable';
import { EllipsisText } from '@/shared/ui/EllipsisText';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { AuditLog } from './api';
import { auditTime, detailText, parseDetail, triggerText } from './auditDetail';
import { MODULE_KEYS, RISK_KEYS, TARGET_KEYS } from './auditLabels';

const ACTOR_TAGS: Record<string, string> = { HUMAN: 'human', AGENT: 'agent', SYSTEM: 'system' };
const RISK_HELP_SYMBOL = '?';
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200];

interface AuditLogTableProps {
  rows: AuditLog[];
  total: number;
  loading: boolean;
  page: number;
  size: number;
  onPageChange: (page: number, size: number) => void;
  onSelect: (record: AuditLog) => void;
}

function DetailCell({ text }: { text: string }) {
  return (
    <EllipsisText tooltip={text} style={{ maxWidth: 360 }}>
      <span className="audit-detail">
        {text}
      </span>
    </EllipsisText>
  );
}

export function AuditLogTable({ rows, total, loading, page, size, onPageChange, onSelect }: AuditLogTableProps) {
  const { t } = useTranslation('audit');
  // 03b ④：首屏加载表头常驻、正文区居中「加载」+ 旋转图标；非首屏刷新走表格加载遮罩保留旧行。
  const firstLoadPending = loading && rows.length === 0;
  const emptyText = firstLoadPending ? (
    <div className="audit-loading-note" role="status" aria-label={t('loading')}>
      <Spin />
      <span>{t('loading')}</span>
    </div>
  ) : (
    <div className="audit-empty-box">
      <AwStrokeIcon name="audit" size={30} className="audit-empty-icon" />
      <div className="audit-empty-text">{t('empty')}</div>
    </div>
  );

  const columns: ColumnsType<AuditLog> = [
    {
      title: t('time'),
      dataIndex: 'gmtCreate',
      width: 168,
      render: (value: string) => <span className="audit-mono">{auditTime(value)}</span>,
    },
    {
      title: t('actor'),
      width: 168,
      render: (_, record) => {
        const name = record.actorName || (record.actorId != null ? `#${record.actorId}` : '-');
        const tagClass = ACTOR_TAGS[record.actorType ?? ''] ?? '';
        return (
          <span className="audit-actor">
            <EllipsisText tooltip={name} style={{ fontWeight: 500 }}>{name}</EllipsisText>
            {tagClass ? <span className={`audit-actor-tag ${tagClass}`}>{record.actorType}</span> : null}
          </span>
        );
      },
    },
    {
      title: t('moduleAction'),
      width: 188,
      render: (_, record) => {
        const moduleLabel = record.module in MODULE_KEYS
          ? t(MODULE_KEYS[record.module as keyof typeof MODULE_KEYS])
          : record.module;
        return (
          <span className="audit-module-action">
            <span className="audit-module-tag">{moduleLabel}</span>
            <span className="audit-mono" title={record.action}>{record.action}</span>
          </span>
        );
      },
    },
    {
      title: (
        <span className="audit-risk-head">
          {t('risk')}
          <Tooltip title={t('riskTooltip')}>
            <span role="img" aria-label={t('riskTooltipAria')} className="audit-risk-help">{RISK_HELP_SYMBOL}</span>
          </Tooltip>
        </span>
      ),
      width: 90,
      render: (_, record) => {
        const risk = record.riskLevel ?? '';
        const label = risk in RISK_KEYS ? t(RISK_KEYS[risk as keyof typeof RISK_KEYS]) : (risk || '-');
        return <span className={`audit-risk-pill ${risk || 'low'}`}>{label}</span>;
      },
    },
    {
      title: t('target'),
      width: 176,
      render: (_, record) => {
        const typeLabel = record.targetType
          ? (record.targetType in TARGET_KEYS
            ? t(TARGET_KEYS[record.targetType as keyof typeof TARGET_KEYS])
            : record.targetType)
          : '-';
        const target = record.targetId != null ? `${typeLabel} #${record.targetId}` : typeLabel;
        return <span className="audit-mono audit-target" title={target}>{target}</span>;
      },
    },
    {
      title: t('triggerEvent'),
      width: 184,
      render: (_, record) => {
        const eventType = parseDetail(record).eventType;
        const eventLabel = eventType ? String(eventType) : '-';
        const trigger = triggerText(record);
        return (
          <span className="audit-trigger-event">
            <span className="audit-trigger" title={trigger}>{trigger}</span>
            <span className="audit-mono" title={eventLabel}>{eventLabel}</span>
          </span>
        );
      },
    },
    {
      title: t('summary'),
      render: (_, record) => <DetailCell text={detailText(record)} />,
    },
  ];

  return (
    <Table<AuditLog>
      className="audit-table"
      tableLayout="fixed"
      scroll={{ x: 1180 }}
      rowKey="id"
      columns={columns}
      dataSource={rows}
      loading={{ spinning: loading && rows.length > 0, tip: t('loading') }}
      onRow={(record) => ({ onClick: () => onSelect(record) })}
      pagination={{
        current: page,
        total,
        pageSize: size,
        pageSizeOptions: PAGE_SIZE_OPTIONS,
        showSizeChanger: true,
        onChange: onPageChange,
        showTotal: (count) => t('total', { count }),
      }}
      locale={{ emptyText }}
    />
  );
}
