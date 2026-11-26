import type { ReactNode } from 'react';

/** 看板版块容器：标题（可带副标题）与右侧筛选同一行，窄屏自然换行。 */
export function DashboardSection({ title, subtitle, toolbar, children }: {
  title: string;
  subtitle?: string;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-dashboard-section">
      <div className="space-dashboard-section-head">
        <div className="space-dashboard-section-heading">
          <h2 className="space-dashboard-section-title">{title}</h2>
          {subtitle != null && <p className="space-dashboard-section-subtitle">{subtitle}</p>}
        </div>
        {toolbar != null && <div className="space-dashboard-toolbar">{toolbar}</div>}
      </div>
      {children}
    </section>
  );
}
