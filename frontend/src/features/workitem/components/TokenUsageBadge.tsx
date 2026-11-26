import { i18n } from '@/shared/i18n';
import { useTranslation } from 'react-i18next';
import { Popover, Tooltip, Typography } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { ReactNode } from 'react';
import type { UsageSummary } from '@/shared/types/workitem';
import { formatCredits } from '@/shared/lib/tokenFormat';

const { Text } = Typography;

type PopoverTone = 'light' | 'dark';

function hasCredits(usage: UsageSummary): boolean {
  return (usage.credits ?? 0) > 0;
}

function creditsLabel(usage: UsageSummary): string {
  return i18n.t('workitem:usage.creditAmount', { amount: formatCredits(usage.credits) });
}

function UsageLabel({ tone, children }: { tone: PopoverTone; children: ReactNode }) {
  return (
    <span style={{ fontWeight: 600, color: tone === 'dark' ? 'rgba(255, 255, 255, 0.85)' : undefined }}>
      {children}
    </span>
  );
}

interface UsagePopoverContentProps {
  usage: UsageSummary;
  showModel?: boolean;
  tone?: PopoverTone;
}

function UsagePopoverContent({ usage, showModel = true, tone = 'light' }: UsagePopoverContentProps) {
  const { t } = useTranslation('workitem');
  return (
    <div style={{ minWidth: 200, lineHeight: '1.8', color: tone === 'dark' ? 'rgba(255, 255, 255, 0.95)' : undefined }}>
      {showModel && usage.model && (
        <div><UsageLabel tone={tone}>{t('usage.model')}</UsageLabel> {usage.model}</div>
      )}
      <div><UsageLabel tone={tone}>{t('usage.credits')}</UsageLabel> {formatCredits(usage.credits)}</div>
    </div>
  );
}

interface TokenUsageBadgeProps {
  usage: UsageSummary;
  showModel?: boolean;
}

export function TokenUsageBadge({ usage, showModel = true }: TokenUsageBadgeProps) {
  useTranslation('workitem');
  if (!hasCredits(usage)) return null;

  return (
    <Popover content={<UsagePopoverContent usage={usage} showModel={showModel} />} trigger="hover">
      <Text type="secondary" style={{ fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
        <span style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 2 }}><AwStrokeIcon name="zap" /></span>
        {creditsLabel(usage)}
      </Text>
    </Popover>
  );
}

interface StepTokenBadgeProps {
  usage: UsageSummary;
}

export function StepTokenBadge({ usage }: StepTokenBadgeProps) {
  useTranslation('workitem');
  if (!hasCredits(usage)) return null;

  return (
    <Tooltip title={<UsagePopoverContent usage={usage} showModel={false} tone="dark" />}>
      <Text type="secondary" style={{ fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 2 }}><AwStrokeIcon name="zap" size={13} /></span>
        {creditsLabel(usage)}
      </Text>
    </Tooltip>
  );
}
