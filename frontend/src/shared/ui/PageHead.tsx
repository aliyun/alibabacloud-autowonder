import type { ReactNode } from 'react';

/** Prototype page header: title + description on the left, actions pushed right. */
export function PageHead({ title, description, actions }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="aw-page-head">
      <div className="aw-page-head-copy">
        <h1 className="aw-page-title">{title}</h1>
        {description != null && <div className="aw-page-desc">{description}</div>}
      </div>
      {actions != null && <div className="aw-page-actions">{actions}</div>}
    </div>
  );
}
