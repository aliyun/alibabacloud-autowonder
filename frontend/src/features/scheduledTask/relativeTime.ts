import { i18n, normalizeLocale } from '@/shared/i18n';

export function relativeTime(value: string) {
  const diff = new Date(value).getTime() - Date.now();
  if (Number.isNaN(diff)) return '';
  const format = new Intl.RelativeTimeFormat(normalizeLocale(i18n.language), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 3_600_000) return format.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return format.format(Math.round(diff / 3_600_000), 'hour');
  return format.format(Math.round(diff / 86_400_000), 'day');
}
