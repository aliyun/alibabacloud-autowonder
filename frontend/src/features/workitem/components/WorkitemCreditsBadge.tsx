import { i18n } from '@/shared/i18n';
import { useTranslation } from 'react-i18next';
import { Popover, Typography } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { WorkitemUsageSummary } from '@/shared/types/workitem';
import { formatCredits, formatCreditsFixed } from '@/shared/lib/tokenFormat';
import { creditRunLabel, creditRuns } from './creditsBreakdown';

const { Text } = Typography;

function CreditsBreakdown({ usage }: { usage: WorkitemUsageSummary }) {
  const { t } = useTranslation('workitem');
  const runs = creditRuns(usage);
  return (
    <div data-testid="workitem-credits-breakdown" style={{ minWidth: 200, lineHeight: '1.8' }}>
      {runs.map(({ run, sourceIndex }, index) => (
        <div key={`${run.agentId ?? 'unknown'}-${run.runIndex ?? index + 1}-${sourceIndex}`}>
          <span style={{ fontWeight: 600 }}>{creditRunLabel(run, index)}:</span> {t('usage.creditAmount', { amount: formatCredits(run.credits) })}
        </div>
      ))}
      <div>
        <span style={{ fontWeight: 600 }}>{t('usage.total')}</span> {t('usage.totalAmount', { amount: formatCreditsFixed(usage.credits) })}
      </div>
    </div>
  );
}

interface WorkitemCreditsBadgeProps {
  usage?: WorkitemUsageSummary | null;
}

/** 工单详情页顶部的累计 credits 徽标，hover 展开按执行轮次拆分的费用清单。 */
export function WorkitemCreditsBadge({ usage }: WorkitemCreditsBadgeProps) {
  useTranslation('workitem');
  const credits = usage?.credits ?? 0;
  if (!usage || !(credits > 0)) return null;

  return (
    <Popover content={<CreditsBreakdown usage={usage} />} trigger="hover">
      <Text
        data-testid="workitem-credits-badge"
        type="secondary"
        style={{ fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        <span style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 2 }}><AwStrokeIcon name="zap" /></span>
        {i18n.t('workitem:usage.totalAmount', { amount: formatCreditsFixed(credits) })}
      </Text>
    </Popover>
  );
}
