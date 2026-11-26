import type { ReactNode } from 'react';

/** Prototype detail-page layout: fluid main column plus a fixed 380px aside stack. */
export function SplitPage({ children, aside }: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="aw-split">
      <div className="aw-split-main">{children}</div>
      {aside != null && <aside className="aw-split-aside">{aside}</aside>}
    </div>
  );
}
