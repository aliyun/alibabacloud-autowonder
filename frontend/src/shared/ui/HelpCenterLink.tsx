import { useTranslation } from 'react-i18next';
import { Button } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';

export function HelpCenterLink() {
  const { t } = useTranslation('shared');
  return (
    <Button type="text" href="/help" target="_blank" rel="noopener noreferrer" aria-label={t('help')} title={t('help')} icon={<AwStrokeIcon name="help" size={16} />} />
  );
}
