import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { LocaleProvider } from '../src/shared/i18n/LocaleProvider';
import { i18n } from '../src/shared/i18n';
import { AppearanceProvider } from '../src/shared/theme/AppearanceProvider';
import { PlatformShell } from '../src/shared/ui/PlatformShell';
import { PageHeader } from '../src/shared/ui/PageHeader';
import { DEFAULT_BRANDING, type GroupChatConfig } from '../src/features/platform/brandingApi';
import type { PlatformAdmin, PlatformAdminCandidate } from '../src/features/platform/adminApi';
import { apiClient } from '@/shared/api/client';
import { useAuthStore } from '../src/shared/auth/store';
import { ApiError } from '../src/shared/types/common';

// Approved 09d/18 isolated component verification, not authorization or business E2E.
// Vite compiles this entry. No server, MSW, Node browser shim, cookies or access token.
const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'branding';
const scenario = params.get('scenario') || 'normal';
const canManage = scenario !== 'readonly';
const modes = ['branding', 'admins', 'messages', 'switches', 'dashboard'];
if (!modes.includes(mode)) throw new Error(`Unsupported synthetic mode: ${mode}`);
const tabs: Record<string, string> = { branding: 'branding', admins: 'platform-admin', messages: 'notification', switches: 'feature-switches' };
localStorage.setItem('autowonder.platform-config.tab', tabs[mode] || 'branding');
useAuthStore.setState({
  accessToken: null, refreshToken: null,
  user: { id: 910001, username: 'synthetic-reviewer', nickname: 'Synthetic reviewer', email: 'reviewer@example.invalid', isAdmin: canManage },
  currentWorkspace: { id: 910100, name: 'Synthetic scope', description: '' },
  // Deliberately ADMIN even in readonly mode: workspace ADMIN must not imply platform permission.
  accessLevel: 'ADMIN', readOnlyDomains: [],
});
const clone = <T,>(value: T): T => structuredClone(value);
const candidates: PlatformAdminCandidate[] = [
  { userId: 910011, username: 'golden-alpha', nickname: 'Golden Alpha', email: 'alpha@example.invalid' },
  { userId: 910012, username: 'golden-beta', nickname: 'Golden Beta', email: 'beta@example.invalid' },
  { userId: 910013, username: 'golden-gamma', nickname: 'Golden Gamma', email: 'gamma@example.invalid' },
  { userId: 910014, username: 'long-safe-name', nickname: 'Synthetic long display name '.repeat(9), email: 'long@example.invalid' },
  { userId: 910015, username: 'markup-text', nickname: '<img src=x onerror=window.__syntheticXss=1>', email: 'markup@example.invalid' },
];
let admins: PlatformAdmin[] = [
  { userId: 910001, username: 'synthetic-reviewer', nickname: 'Synthetic reviewer', email: 'reviewer@example.invalid', active: true, self: true, removable: false, removeDisabledReason: 'Synthetic self protection' },
  { userId: 910002, username: 'synthetic-existing', nickname: 'Synthetic existing', email: 'existing@example.invalid', active: true, self: false, removable: true, removeDisabledReason: null },
];
let branding = { ...DEFAULT_BRANDING, platformName: 'Synthetic AutoWonder', domain: 'https://synthetic.example.invalid', canManage };
let selection = { provider: 'DINGTALK', generation: 7, activatedAt: null as string | null };
let channels = ['DINGTALK', 'FEISHU'].map(provider => ({ provider, selected: provider === selection.provider, enabled: true, appKey: `synthetic-${provider.toLowerCase()}-app`, robotCode: 'synthetic-robot', secretConfigured: true, ready: true }));
const groupConfig = (provider: string): GroupChatConfig => ({
  provider, configured: true, ready: true, desiredEnabled: true, selected: provider === selection.provider,
  appKey: `synthetic-${provider.toLowerCase()}-group`, robotCode: 'synthetic-group-robot',
  secretConfigured: true, verificationTokenConfigured: true, encryptKeyConfigured: false,
  version: 4, routeVersion: 4, selectionGeneration: 7, status: 'ACTIVE', drainingCount: 2, failedCount: 1, unknownCount: 1,
});
const groups: Record<string, GroupChatConfig> = { DINGTALK: groupConfig('DINGTALK'), FEISHU: groupConfig('FEISHU') };
let switches = { duplicateWorkitemIntentEnabled: false, version: 3 };
type Attempt = { method: string; url: string; body?: unknown; params?: Record<string, unknown>; state: string };
const attempts: Attempt[] = [];
const forbidden: string[] = [];
const pending: Array<{ attempt: Attempt; resolve: () => void; reject: (error: Error) => void }> = [];
let holdWrites = false;
let candidateFailures = scenario === 'candidate-error' ? 1 : 0;
let selectionFailures = scenario === 'selection-error' ? 1 : 0;
let rosterFailures = 0;
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
const roster = () => clone({ admins, canManage });
const workspaces = Array.from({ length: 12 }, (_, index) => ({ id: 910100 + index, name: index === 0 ? 'Synthetic long workspace '.repeat(9) : index === 1 ? '<img src=x onerror=window.__syntheticXss=1>' : `Synthetic workspace ${index + 1}` }));
const rank = (value: number) => workspaces.map(workspace => ({ workspaceId: workspace.id, workspaceName: workspace.name, value }));
function overview(query: Record<string, unknown>) {
  return {
    platformAdmin: canManage, workspaceCount: 12, workspaces,
    agents: { workspaceCount: 12, agentCount: 123456789, humanCount: 4321, squadCount: 789 },
    delivery: { window: { start: query.deliveryStart, end: query.deliveryEnd, workTypes: String(query.workTypes).split(',') }, workitemCount: 123456789, completedCount: 1234567, inProgressCount: 987654, topCompleted: rank(123456789), topCompletedTotal: 12, bottomCompleted: rank(0), bottomCompletedTotal: 12 },
    cost: { window: { start: query.costStart, end: query.costEnd }, totalCredits: 123456789.25, dailyAverage: 1234567.89, completedWorkitemCount: 3456, perCompletedWorkitem: 1234567.89, topCredits: rank(123456789.25), topCreditsTotal: 12, bottomCredits: rank(0), bottomCreditsTotal: 12 },
  };
}
function denied(method: string, url: string): never {
  forbidden.push(`${method} ${url}`);
  throw new Error(`Unexpected synthetic contract: ${method} ${url}`);
}
apiClient.get = (async (url: string, options?: { params?: Record<string, unknown> }) => {
  const query = options?.params || {};
  attempts.push({ method: 'GET', url, params: clone(query), state: 'read' });
  if (url === '/api/platform/branding/public') return { data: clone({ ...branding, canManage: false }) };
  if (url === '/api/platform/branding') return { data: clone(branding) };
  if (url === '/api/platform/admins') {
    if (rosterFailures > 0) { rosterFailures--; throw new Error('Synthetic roster read failure'); }
    return { data: roster() };
  }
  if (url === '/api/platform/admins/candidates') {
    if (!canManage) return denied('GET', url);
    if (candidateFailures > 0) { candidateFailures--; throw new Error('Synthetic candidate lookup failure'); }
    const keyword = String(query.keyword || '').trim().toLowerCase();
    return { data: clone(candidates.filter(candidate => !admins.some(admin => admin.userId === candidate.userId) && (!keyword || `${candidate.username} ${candidate.nickname} ${candidate.email}`.toLowerCase().includes(keyword)))) };
  }
  if (url === '/api/platform/im-channels') return { data: clone(channels) };
  if (url === '/api/platform/im-channels/selection') {
    if (selectionFailures > 0) { selectionFailures--; throw new Error('Synthetic selection read failure'); }
    return { data: clone(selection) };
  }
  const group = /^\/api\/platform\/im-channels\/(DINGTALK|FEISHU)\/group-chat$/.exec(url);
  if (group) return { data: clone(groups[group[1]]) };
  if (url === '/api/platform/feature-switches') return { data: clone(switches) };
  if (url === '/api/space-dashboard/overview') return { data: clone(overview(query)) };
  return denied('GET', url);
}) as never;
async function write(method: string, url: string, body?: Record<string, unknown>) {
  const isSwitch = mode === 'dashboard' && /^\/api\/workspaces\/9101\d\d\/switch$/.test(url);
  if (!canManage && !isSwitch) return denied(method, url);
  const attempt: Attempt = { method, url, body: clone(body), state: 'pending' };
  attempts.push(attempt);
  if (holdWrites) await new Promise<void>((resolve, reject) => pending.push({ attempt, resolve, reject }));
  try {
    let data: unknown;
    if (method === 'POST' && url === '/api/platform/admins') {
      if ((scenario === 'partial-known' || scenario === 'partial-network' || scenario === 'partial-unknown') && body?.userId === 910012) {
        if (scenario === 'partial-known') throw new ApiError('31002', 'Synthetic candidate no longer available', null);
        if (scenario === 'partial-unknown') rosterFailures = 1;
        throw new ApiError('10000', 'Synthetic transport outcome unknown', null);
      }
      const candidate = candidates.find(item => item.userId === body?.userId);
      if (!candidate) return denied(method, url);
      admins.push({ ...candidate, active: true, self: false, removable: true, removeDisabledReason: null });
      data = roster();
    } else if (method === 'DELETE' && /^\/api\/platform\/admins\/910\d+$/.test(url)) {
      const id = Number(url.split('/').at(-1));
      if (!admins.some(admin => admin.userId === id && admin.removable)) return denied(method, url);
      admins = admins.filter(admin => admin.userId !== id); data = roster();
    } else if (method === 'PUT' && url === '/api/platform/branding') {
      branding = { ...branding, ...body }; data = clone(branding);
    } else if (method === 'PUT' && url === '/api/platform/im-channels/selection') {
      if (body?.expectedGeneration !== selection.generation) throw new ApiError('10409', 'Synthetic generation conflict', null);
      selection = { ...selection, provider: String(body?.provider), generation: selection.generation + 1 };
      channels = channels.map(channel => ({ ...channel, selected: channel.provider === selection.provider })); data = clone(selection);
    } else if (method === 'PUT' && /^\/api\/platform\/im-channels\/(dingtalk|feishu)$/.test(url)) {
      const provider = url.split('/').at(-1)!.toUpperCase();
      channels = channels.map(channel => channel.provider === provider ? { ...channel, ...body } : channel); data = clone(channels.find(channel => channel.provider === provider));
    } else if (method === 'PUT' && /^\/api\/platform\/im-channels\/(DINGTALK|FEISHU)\/group-chat$/.test(url)) {
      const provider = url.split('/')[4];
      groups[provider] = { ...groups[provider], desiredEnabled: Boolean(body?.enabled), version: groups[provider].version! + 1 }; data = clone(groups[provider]);
    } else if (method === 'PUT' && url === '/api/platform/feature-switches') {
      if (body?.expectedVersion !== switches.version) throw new ApiError('10409', 'Synthetic version conflict', null);
      switches = { duplicateWorkitemIntentEnabled: Boolean(body?.duplicateWorkitemIntentEnabled), version: switches.version + 1 }; data = clone(switches);
    } else if (method === 'POST' && isSwitch) {
      // Exercise the real switch hook with an in-memory response, never an authentication token.
      data = { accessToken: null, accessLevel: 'ADMIN' };
    } else return denied(method, url);
    attempt.state = 'fulfilled'; return { data };
  } catch (error) { attempt.state = 'rejected'; throw error; }
}
apiClient.put = ((url: string, body: Record<string, unknown>) => write('PUT', url, body)) as never;
apiClient.post = ((url: string, body?: Record<string, unknown>) => write('POST', url, body)) as never;
apiClient.delete = ((url: string) => write('DELETE', url)) as never;
const fixture = {
  snapshot: () => clone({ mode, scenario, attempts, forbidden, admins, branding, selection, switches, pending: pending.length, auth: { accessToken: useAuthStore.getState().accessToken, refreshToken: useAuthStore.getState().refreshToken, authenticated: useAuthStore.getState().isAuthenticated(), accessLevel: useAuthStore.getState().accessLevel } }),
  hold: () => { holdWrites = true; },
  releaseOne: () => { const next = pending.shift(); if (!next) throw new Error('No synthetic pending write'); next.resolve(); },
  rejectOne: () => { const next = pending.shift(); if (!next) throw new Error('No synthetic pending write'); next.attempt.state = 'rejected'; next.reject(new ApiError('10409', 'Synthetic save rejected; preserve drafts', null)); },
  candidateFailure: () => { candidateFailures++; },
  refetchMessages: () => Promise.all([client.invalidateQueries({ queryKey: ['platform-im-channels'] }), client.invalidateQueries({ queryKey: ['platform-im-group-chat'] })]),
  language: (locale: string) => i18n.changeLanguage(locale),
};
(window as unknown as { __platformPanels: typeof fixture }).__platformPanels = fixture;
function NavigationEvidence() {
  const current = useLocation();
  return <output data-testid="synthetic-navigation" hidden>{current.pathname}</output>;
}
// Load genuine page implementations only after the synthetic client and token-free state are installed.
const [{ BrandingConfigPage }, { SpaceDashboardPage }] = await Promise.all([
  import('../src/features/platform/BrandingConfigPage'),
  import('../src/features/spaceDashboard/SpaceDashboardPage'),
]);
createRoot(document.getElementById('root')!).render(
  <LocaleProvider><AppearanceProvider accent="#0064C8"><QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[mode === 'dashboard' ? '/workspaces/dashboard' : '/platform/config']}>
      <NavigationEvidence />
      <Routes>
        <Route path="/platform/config" element={<BrandingConfigPage />} />
        <Route path="/workspaces/dashboard" element={<PlatformShell topbar={<PageHeader brandTo="/workspaces" />}><SpaceDashboardPage /></PlatformShell>} />
        <Route path="/insights" element={<output data-testid="synthetic-drilldown">Synthetic drilldown destination</output>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider></AppearanceProvider></LocaleProvider>,
);
