import { i18n } from '@/shared/i18n';
import { useTranslation } from 'react-i18next';
import { Menu, Badge, Segmented } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  BranchesOutlined,
  BookOutlined,
  BulbOutlined,
  ApartmentOutlined,
  NodeIndexOutlined,
  SettingOutlined,
  AuditOutlined,
  LineChartOutlined,
  HistoryOutlined,
  ClockCircleOutlined,
  ApiOutlined,
  CompassOutlined,
  ExperimentOutlined,
  KeyOutlined,
  RestOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import type { MenuProps } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import { useAgentPendingReviewCount } from '@/features/agent/hooks';
import { useScheduledTaskCapability } from '@/features/scheduledTask/hooks';
import { isScheduledTaskCapabilityQueryReady } from '@/features/scheduledTask/ScheduledTaskCapabilityGate';
import { useNavMode, type NavMode } from '@/features/workbench/navMode';
import { RobotHeadIcon } from '@/shared/ui/RobotHeadIcon';
import './Sidebar.css';

export interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  aliases?: string[];
  /** 入口不在菜单中渲染，但仍保留路由选中态与页头标题解析 */
  hidden?: boolean;
}

export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

// 「系统设置」入口暂时隐藏，置回 true 即可恢复；路由与页面均保留。
const SETTINGS_MENU_ENABLED = false;

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'delivery',
    get label() { return i18n.t('shell:nav.delivery'); },
    items: [
      { key: '/workbench', get label() { return i18n.t('shell:nav.workbench'); }, icon: <AppstoreOutlined aria-hidden="true" /> },
      { key: '/overview', get label() { return i18n.t('shell:nav.overview'); }, icon: <DashboardOutlined aria-hidden="true" />, hidden: true },
      { key: '/workitems', get label() { return i18n.t('shell:nav.workitems'); }, icon: <FileTextOutlined aria-hidden="true" /> },
      { key: '/scheduled-tasks', get label() { return i18n.t('shell:nav.scheduledTasks'); }, icon: <ClockCircleOutlined aria-hidden="true" /> },
      { key: '/executions', get label() { return i18n.t('shell:nav.executions'); }, icon: <HistoryOutlined aria-hidden="true" /> },
      { key: '/workitems/recycled', get label() { return i18n.t('shell:nav.recycled'); }, icon: <RestOutlined aria-hidden="true" /> },
    ],
  },
  {
    key: 'workers-group',
    get label() { return i18n.t('shell:nav.agentsGroup'); },
    items: [
      { key: '/agents', get label() { return i18n.t('shell:nav.agents'); }, icon: <RobotHeadIcon aria-hidden="true" /> },
      { key: '/sdlcs', get label() { return i18n.t('shell:nav.sdlc'); }, icon: <ApartmentOutlined aria-hidden="true" /> },
      { key: '/executors', get label() { return i18n.t('shell:nav.executors'); }, icon: <ThunderboltOutlined aria-hidden="true" /> },
    ],
  },
  {
    key: 'knowledge-group',
    get label() { return i18n.t('shell:nav.knowledge'); },
    items: [
      { key: '/repos', get label() { return i18n.t('shell:nav.repos'); }, icon: <BranchesOutlined aria-hidden="true" /> },
      { key: '/memories', get label() { return i18n.t('shell:nav.memories'); }, icon: <BookOutlined aria-hidden="true" /> },
      { key: '/skills', get label() { return i18n.t('shell:nav.skills'); }, icon: <BulbOutlined aria-hidden="true" /> },
    ],
  },
  {
    key: 'config-group',
    get label() { return i18n.t('shell:nav.configuration'); },
    items: [
      { key: '/status-templates', get label() { return i18n.t('shell:nav.statusTemplates'); }, icon: <NodeIndexOutlined aria-hidden="true" /> },
      { key: '/integrations', get label() { return i18n.t('shell:nav.integrations'); }, icon: <ApiOutlined aria-hidden="true" /> },
      {
        key: '/settings/members',
        get label() { return i18n.t('shell:nav.members'); },
        icon: <TeamOutlined aria-hidden="true" />,
        aliases: ['/settings/members-roles', '/settings/roles'],
      },
      { key: '/settings/backups', get label() { return i18n.t('shell:nav.backups'); }, icon: <HistoryOutlined aria-hidden="true" /> },
      { key: '/settings/environment-variables', get label() { return i18n.t('shell:nav.environment'); }, icon: <KeyOutlined aria-hidden="true" /> },
      { key: '/settings', get label() { return i18n.t('shell:nav.settings'); }, icon: <SettingOutlined aria-hidden="true" />, hidden: !SETTINGS_MENU_ENABLED },
    ],
  },
  {
    key: 'insight-group',
    get label() { return i18n.t('shell:nav.insightsGroup'); },
    items: [
      { key: '/insights', get label() { return i18n.t('shell:nav.insights'); }, icon: <LineChartOutlined aria-hidden="true" /> },
      { key: '/audit-logs', get label() { return i18n.t('shell:nav.audit'); }, icon: <AuditOutlined aria-hidden="true" /> },
      { key: '/evolution', get label() { return i18n.t('shell:nav.evolution'); }, icon: <ExperimentOutlined aria-hidden="true" />, hidden: true },
    ],
  },
  {
    key: 'about-group',
    get label() { return i18n.t('shell:nav.learn'); },
    items: [
      { key: '/about', get label() { return i18n.t('shell:nav.about'); }, icon: <CompassOutlined aria-hidden="true" /> },
    ],
  },
];

export function navItemMatchesPath(item: NavItem, pathname: string) {
  return [item.key, ...(item.aliases ?? [])].some((key) => pathname.startsWith(key));
}

const FOCUSED_NAV_GROUPS = new Set(['delivery', 'insight-group', 'about-group']);

export function buildMenuItems(
  badges?: Record<string, number>,
  collapsed?: boolean,
  scheduledTaskAvailable = false,
  mode: NavMode = 'full',
): ItemType[] {
  return NAV_GROUPS
    .map((group) => {
      const items = group.items
        .filter((item) => !item.hidden && (item.key !== '/scheduled-tasks' || scheduledTaskAvailable))
        .filter(() => mode === 'full' || FOCUSED_NAV_GROUPS.has(group.key));
      return {
        key: group.key,
        label: group.label,
        type: 'group' as const,
        children: items.map((item) => {
          const count = badges?.[item.key] ?? 0;
          const icon = count > 0 && collapsed
            ? <Badge dot><span>{item.icon}</span></Badge>
            : item.icon;
          const itemLabel = item.label;
          const label = count > 0 && !collapsed
            ? <span className="app-sidebar-label"><span>{itemLabel}</span><Badge count={count} overflowCount={99} /></span>
            : itemLabel;
          return { key: item.key, icon, label };
        }),
      };
    })
    .filter((group) => group.children.length > 0);
}

export function resolveSelectedNavKey(pathname: string) {
  const allItems = NAV_GROUPS.flatMap((group) => group.items);
  return [...allItems]
    .filter((item) => navItemMatchesPath(item, pathname))
    .sort((a, b) => b.key.length - a.key.length)[0]?.key || '';
}

export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation('shell');
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, setMode } = useNavMode();

  const { data: agentCount = 0 } = useAgentPendingReviewCount();
  const scheduledTaskCapability = useScheduledTaskCapability();

  const badges: Record<string, number> = {};
  if (agentCount > 0) badges['/agents'] = agentCount;

  const menuItems: MenuProps['items'] = buildMenuItems(
    badges,
    collapsed,
    isScheduledTaskCapabilityQueryReady(scheduledTaskCapability),
    mode,
  ).map((item) =>
    collapsed && item && item.type === 'group' ? { ...item, label: '' } : item,
  );
  const selectedKey = resolveSelectedNavKey(location.pathname);

  return (
      <div className="aw-sidebar-nav">
        {!collapsed && (
          <div className="aw-sidebar-navmode">
            <Segmented
              className="aw-sidebar-navmode-control"
              size="small"
              block
              value={mode}
              aria-label={t('navMode.label')}
              onChange={(value) => setMode(value as NavMode)}
              options={[
                { value: 'compact', label: t('navMode.compact') },
                { value: 'full', label: t('navMode.full') },
              ]}
            />
          </div>
        )}
        <Menu
          className="app-sidebar"
          mode="inline"
          inlineCollapsed={collapsed}
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0 }}
        />
      </div>
  );
}
