import type { ReactNode } from 'react';

/** Standalone platform pages (09/18): 48px top bar plus a 1080px centered column. */
export function PlatformShell({ topbar, children }: {
  topbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="aw-platform-shell">
      {topbar}
      <main className="ws-wrap">{children}</main>
    </div>
  );
}
