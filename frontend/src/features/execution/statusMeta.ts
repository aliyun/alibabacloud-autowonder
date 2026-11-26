import { i18n } from '@/shared/i18n';
import type { StatusColorKey } from '@/shared/ui/StatusTag';

export interface StatusMeta {
  label: string;
  color: StatusColorKey;
}

const META = {
  SUCCEEDED: { key: 'status.SUCCEEDED', color: 'green' },
  FAILED: { key: 'status.FAILED', color: 'red' },
  RUNNING: { key: 'status.RUNNING', color: 'blue' },
  PENDING: { key: 'status.PENDING', color: 'gray' },
  PACKAGING: { key: 'status.PACKAGING', color: 'blue' },
  DISPATCHED: { key: 'status.DISPATCHED', color: 'blue' },
  ACKED: { key: 'status.ACKED', color: 'blue' },
  TIMEOUT: { key: 'status.TIMEOUT', color: 'amber' },
  CANCELED: { key: 'status.CANCELED', color: 'gray' },
} as const;

export function statusMeta(status: string): StatusMeta {
  if (!Object.prototype.hasOwnProperty.call(META, status)) return { label: status, color: 'gray' };
  const meta = META[status as keyof typeof META];
  return { label: i18n.t(`execution:${meta.key}`), color: meta.color };
}

export const HAPPY_PATH: string[] = ['PENDING', 'PACKAGING', 'DISPATCHED', 'ACKED', 'RUNNING', 'SUCCEEDED'];
export const FAILURE_STATES: string[] = ['FAILED', 'TIMEOUT', 'CANCELED'];

export const ACCENT = 'var(--aw-accent-text)';
