import type { ReactNode } from 'react';

/** Prototype stat card: 24px value with optional unit, label below, and a muted foot line. */
export function StatCard({ label, value, unit, foot }: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div className="aw-card aw-stat-card">
      <div className="aw-stat-value">
        {value}
        {unit != null && <span className="aw-stat-unit">{unit}</span>}
      </div>
      <div className="aw-stat-label">{label}</div>
      {foot != null && <div className="aw-stat-foot">{foot}</div>}
    </div>
  );
}
