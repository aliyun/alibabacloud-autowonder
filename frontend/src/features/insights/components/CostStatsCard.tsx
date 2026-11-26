import { useTranslation } from 'react-i18next';
import { formatCredits } from '@/shared/lib/tokenFormat';
import FlashValue from '../realtime/FlashValue';

export interface CostStatsValues {
  total: number;
  perTask: number;
  perDay: number;
}

/** 成本分析面板的统计块：按原型 .stat-grid 三格白卡呈现，标签在上、数值在下。 */
export function CostStatsCard({ values }: { values: CostStatsValues }) {
  const { t } = useTranslation('insights');
  const kpis = [
    { label: t('cost.totalCredits'), value: formatCredits(values.total) },
    { label: t('cost.perTask'), value: formatCredits(values.perTask) },
    { label: t('cost.dailyAverage'), value: formatCredits(values.perDay) },
  ];

  return (
    <div className="cost-card">
      <div className="metric-card-kpis is-centered cost-kpis">
        {kpis.map(kpi => (
          <div key={kpi.label} className="cost-kpi">
            <span className="cost-kpi-label">{kpi.label}</span>
            <span className="cost-kpi-reading">
              <span className="cost-kpi-value"><FlashValue value={kpi.value} /><small>{t('cost.creditsUnit')}</small></span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
