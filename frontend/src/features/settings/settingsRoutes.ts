/** 仍由设置中心外壳承载的配置页；/agents 等页面归入导航的设置空间（面板项）。 */
export const SETTINGS_NAV_PREFIXES = [
  '/status-templates',
  '/integrations',
  '/audit-logs',
  '/settings',
] as const;

export function isSettingsRoute(pathname: string) {
  return SETTINGS_NAV_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
