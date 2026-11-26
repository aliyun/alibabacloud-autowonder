import { Button, Tooltip } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useNavigate } from 'react-router-dom';

/** Icon-only beside navigated page titles; full label on standalone pages. */
export function PageBackButton({ to, label, compact = true }: { to: string; label: string; compact?: boolean }) {
  const navigate = useNavigate();
  const button = (
    <Button
      aria-label={label}
      icon={<AwStrokeIcon name="chev-l" size={14} />}
      onClick={() => navigate(to)}
      className={compact ? 'aw-back-btn' : undefined}
      style={{ flexShrink: 0 }}
    >
      {compact ? undefined : label}
    </Button>
  );
  return compact ? <Tooltip title={label}>{button}</Tooltip> : button;
}
