import type { ReactNode } from 'react';

/** Page-level white frame; the global AppLayout wrap covers single-frame pages, this is for pages that own their frames. */
export function PageFrame({ children, className, ...rest }: {
  children: ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return <section className={className == null ? 'aw-content-frame' : `aw-content-frame ${className}`} {...rest}>{children}</section>;
}
