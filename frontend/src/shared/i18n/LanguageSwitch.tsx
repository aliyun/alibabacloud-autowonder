import { Button, Dropdown } from 'antd';
import { useTranslation } from 'react-i18next';
import { useLocale } from './LocaleProvider';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
export function LanguageSwitch() {
  const { locale, setLocale } = useLocale();
  const { t } = useTranslation('common');
  return <Dropdown trigger={['click']} placement="bottomRight" menu={{
    selectable: true, selectedKeys: [locale],
    items: [{ key: 'zh-CN', label: '中文' }, { key: 'en-US', label: 'English' }],
    onClick: ({ key }) => { if (key === 'zh-CN' || key === 'en-US') setLocale(key); },
  }}><Button type="text" icon={<AwStrokeIcon name="globe" size={16} />} aria-label={t('language.switch')} title={t('language.switch')} /></Dropdown>;
}
