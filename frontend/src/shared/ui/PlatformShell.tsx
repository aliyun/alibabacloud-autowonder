import type { ReactNode } from 'react';

/** 独立平台页默认使用居中内容区；列表页可复用应用内的全宽内容布局。 */
export function PlatformShell({ topbar, children, fullWidth = false }: {
  topbar?: ReactNode;
  children: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className="aw-platform-shell">
      {topbar}
      <main className={fullWidth ? 'aw-content' : 'ws-wrap'}>{children}</main>
    </div>
  );
}
