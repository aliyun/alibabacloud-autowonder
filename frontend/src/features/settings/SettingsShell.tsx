import { Outlet } from 'react-router-dom';
import './SettingsCenter.css';

/** 设置页正文直接沿用原来的设置页面，导航在轨道面板里，正文不再加额外页头。 */
export function SettingsShell() {
  return (
    <div className="aw-detail-canvas settings-shell">
      <div className="aw-card settings-body-card">
        <div className="settings-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
