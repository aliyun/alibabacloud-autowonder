import { useTranslation } from 'react-i18next';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import './PrdWorkitemEntry.css';

interface PrdWorkitemEntryProps {
  onClarify?: () => void;
}

/** The Community workitem detail shows the clarification entry. */
export function PrdWorkitemEntry({ onClarify }: PrdWorkitemEntryProps) {
  const { t } = useTranslation('prd');
  if (!onClarify) return null;
  return (
    <nav className="workitem-design-entry" aria-label={t('entry.tools')}>
      <button type="button" className="workitem-design-entry__item" onClick={onClarify}>
        <span className="workitem-design-entry__icon"><AwStrokeIcon name="spark" size={17} /></span>
        <span className="workitem-design-entry__text">
          <strong>{t('entry.clarification')}</strong>
          <small>{t('entry.clarificationHint')}</small>
        </span>
      </button>
    </nav>
  );
}
