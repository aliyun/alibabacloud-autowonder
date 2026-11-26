import type { HTMLAttributes, ReactNode } from 'react';

/** Prototype aw-card: header with title/extra and a padded (or flush) body. */
export function SectionCard({ title, extra, flush, children, className, ...rest }: {
  title?: ReactNode;
  extra?: ReactNode;
  flush?: boolean;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'title'>) {
  return (
    <div className={className == null ? 'aw-card' : `aw-card ${className}`} {...rest}>
      {title != null && (
        <div className="aw-card-head">
          <span className="aw-card-title">{title}</span>
          {extra != null && <div className="aw-card-extra">{extra}</div>}
        </div>
      )}
      <div className={flush ? 'aw-card-body aw-card-body-flush' : 'aw-card-body'}>{children}</div>
    </div>
  );
}
