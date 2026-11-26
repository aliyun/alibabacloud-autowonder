import { Card, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';

/** 排行卡最多展示的空间条数；完整并列清单放在「等 N 个空间」的 tooltip 里。 */
export const RANK_DISPLAY_LIMIT = 10;

export interface RankEntry {
  id: number;
  name: string;
  /** 已按指标口径格式化好的数值文本。 */
  value: string;
  /** 未格式化数值，驱动条形长度；缺省按 0 处理。 */
  num?: number;
}

/**
 * 最多/最少空间排行卡：条形长度按本卡最大值等比缩放，数值并列的空间全部由后端返回，
 * 前端只截断展示；点击行触发下钻（切换空间并跳到该空间的洞察页）。
 */
export function WorkspaceRankCard({ testId, title, entries, total, emptyText, hint, tooltip, tone = 'high', onSelect }: {
  testId: string;
  title: string;
  entries: RankEntry[];
  /** 并列总数，可能大于 entries.length。 */
  total: number;
  emptyText: string;
  hint?: string;
  tooltip?: string;
  /** high=榜首卡（主色条），low=垫底卡（中性条）。 */
  tone?: 'high' | 'low';
  onSelect: (workspaceId: number) => void;
}) {
  const { t } = useTranslation('spaceDashboard');
  const shown = entries.slice(0, RANK_DISPLAY_LIMIT);
  const remaining = Math.max(total - shown.length, 0);
  const allNames = entries.map((entry) => entry.name).join('、');
  const max = shown.reduce((acc, entry) => Math.max(acc, entry.num ?? 0), 0);
  const barWidth = (num: number) => (max > 0 && num > 0 ? `${Math.max((num / max) * 100, 4)}%` : '0%');

  return (
    <Card className={`space-dashboard-stat space-dashboard-rank space-dashboard-rank--${tone}`} data-testid={testId}
      styles={{ body: { padding: '14px 16px' } }}>
      <div className="space-dashboard-stat-label">
        <span>{title}</span>
        {tooltip != null && (
          <Tooltip title={tooltip}>
            <span role="img" aria-label={tooltip} className="space-dashboard-stat-info"><AwStrokeIcon name="info" size={12} /></span>
          </Tooltip>
        )}
      </div>
      <div className="space-dashboard-rank-list">
        {shown.length === 0 ? (
          <span className="space-dashboard-rank-empty">{emptyText}</span>
        ) : shown.map((entry) => (
          <Tooltip key={entry.id} title={t('rank.drilldownWithValue', { name: entry.name, value: entry.value })}>
            <button
              type="button"
              className="space-dashboard-rank-row"
              data-testid={`${testId}-item-${entry.id}`}
              onClick={() => onSelect(entry.id)}
            >
              <span className="space-dashboard-rank-name" title={entry.name}>{entry.name}</span>
              <span className="space-dashboard-rank-track" aria-hidden="true">
                <span className="space-dashboard-rank-fill" style={{ width: barWidth(entry.num ?? 0) }} />
              </span>
              <span className="space-dashboard-rank-value" title={entry.value}>{entry.value}</span>
            </button>
          </Tooltip>
        ))}
        {remaining > 0 && (
          <Tooltip title={t('rank.moreTooltip', { total, shown: shown.length, names: allNames })}>
            <span className="space-dashboard-rank-more" data-testid={`${testId}-more`}>
              {t('rank.more', { total })}
            </span>
          </Tooltip>
        )}
      </div>
      {hint != null && <div className="space-dashboard-stat-hint">{hint}</div>}
    </Card>
  );
}
