import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/i18n/format';

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };
const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

/** 日期正文 + 时间微字两行，表格时间列共用；空值/非法值显示「-」。inline 时渲染为行内两行（tag 旁的时间副信息）。 */
export function TimeCell({ value, inline }: { value: string | null | undefined; inline?: boolean }) {
  useTranslation();
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const dateText = formatDateTime(date, DATE_OPTIONS);
  const timeText = formatDateTime(date, TIME_OPTIONS);
  if (inline) {
    return (
      <span style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 6, whiteSpace: 'nowrap', color: 'var(--aw-text-3)' }}>
        <span style={{ display: 'block' }}>{dateText}</span>
        <span style={{ display: 'block', fontSize: 11 }}>{timeText}</span>
      </span>
    );
  }
  return (
    <div style={{ whiteSpace: 'nowrap' }}>
      <div>{dateText}</div>
      <div style={{ color: 'var(--aw-text-3)', fontSize: 11 }}>{timeText}</div>
    </div>
  );
}
