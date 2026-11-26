import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PREVIEW_REASON, reviewClient, type PreviewEntry, type reviewEndpoint } from './review';

/** Both member and shared previews use the same reachability, recovery and renewal policy. */
export function usePrdPreview(endpoint: ReturnType<typeof reviewEndpoint>, identity: string, enabled: boolean) {
  const session = useRef<{ identity: string; entry: PreviewEntry; at: number } | null>(null);
  const entered = useRef<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const client = reviewClient(endpoint);
  const query = useQuery({
    queryKey: ['prd-preview-entry', identity], enabled, retry: false, refetchInterval: 5000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<PreviewEntry> => {
      try {
        const member = !endpoint.base.startsWith('/api/design-reviews/');
        const cached = session.current;
        const initial = member && entered.current !== identity;
        let firstEntry = initial ? await client.previewSession(true) : undefined;
        let status: Pick<PreviewEntry, 'status' | 'origin' | 'basePath' | 'reason'> = firstEntry ?? await client.previewStatus();
        if (status.reason === PREVIEW_REASON.RECOVERY_REQUIRED && member) {
          status = await client.recoverPreview();
          firstEntry = undefined;
        }
        if (status.status !== 'READY') {
          session.current = null;
          return { ...status, code: null, expiresAt: null };
        }
        if (cached?.identity === identity && cached.entry.origin === status.origin && cached.entry.basePath === status.basePath
          && Date.now() - cached.at < 12 * 60_000) return cached.entry;
        const entry = firstEntry ?? await client.previewSession(initial);
        if (entry.status === 'READY') entered.current = identity;
        session.current = { identity, entry, at: Date.now() };
        return entry;
      } catch {
        session.current = null;
        return { status: 'OFFLINE', origin: null, basePath: null, code: null, expiresAt: null };
      }
    },
  });
  return { entry: enabled ? query.data ?? null : null, connecting: reconnecting, reconnect: async () => {
    session.current = null;
    setReconnecting(true);
    try { await query.refetch(); }
    finally { setReconnecting(false); }
  } };
}
