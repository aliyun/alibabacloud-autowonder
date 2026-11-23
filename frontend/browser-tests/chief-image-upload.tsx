import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../src/shared/auth/store';
import { AppearanceProvider } from '../src/shared/theme/AppearanceProvider';
import { LocaleProvider } from '../src/shared/i18n/LocaleProvider';
import { i18n } from '../src/shared/i18n';
import { apiClient } from '../src/shared/api/client';
import { ChiefOfStaff } from '../src/features/chiefOfStaff/ChiefOfStaff';

// 真实 ChiefOfStaff + 内存 stub 平台接口（真实 Chrome）。
// 粘贴、文件选择、图片校验与发送体全部走产品实现；
// stub 只记录上传请求并返回确定性图片对象，不模拟 React 行为或校验规则。
const CONVERSATION_ID = 101;
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type E2eImage = { id: string; name: string; contentType: string; size: number; url: string };
type E2eTurn = { id: number; direction: string; content: string; status: string; error: string | null; gmtCreate: string; images?: E2eImage[] };
type E2eUpload = { name: string; type: string; size: number };
type E2eRequest = { method: string; url: string; body?: unknown; upload?: E2eUpload };

const e2e = {
  requests: [] as E2eRequest[],
  uploads: [] as E2eUpload[],
  setLocale: (locale: 'zh-CN' | 'en-US') => i18n.changeLanguage(locale),
};
declare global {
  interface Window {
    __e2e: typeof e2e;
    __imageUploadRealtimeProbe: { mode: string; appConstructed: number };
  }
}
window.__e2e = e2e;

const history: E2eTurn[] = [
  { id: 200, direction: 'IN', content: '历史问题', status: 'SUCCESS', error: null, gmtCreate: '' },
  { id: 201, direction: 'OUT', content: '历史回答', status: 'SUCCESS', error: null, gmtCreate: '' },
];
const sent: E2eTurn[] = [];
const storedImages = new Map<string, E2eImage>();
let nextImageId = 1;

const conversation = () => ({
  id: CONVERSATION_ID, agentId: 42, agentName: 'Chief of Staff', title: 'Image upload', archivedAt: null,
  status: 'ACTIVE', executorOnline: true, streamingSupported: true, cancelSupported: true,
  processingStatus: 'IDLE', processingTurnId: null, lastTurnAt: null,
  turns: [...history, ...sent], pendingElicitations: [],
});

apiClient.defaults.adapter = async config => {
  const url = String(config.url || '');
  const method = String(config.method || 'get').toLowerCase();
  const record: E2eRequest = { method, url };
  e2e.requests.push(record);
  const respond = (payload: unknown) => ({
    data: { success: true, code: '0', message: '', traceId: null, data: payload },
    status: 200, statusText: 'OK', headers: {}, config,
  });
  if (method === 'get' && url === '/api/platform-agent/setup') {
    return respond({ agentId: 42, executorId: 5, agentConfigured: true, skillsConfigured: true,
      executorConfigured: true, launchConfigured: true, ready: true, missingSkills: [] });
  }
  if (method === 'get' && url === `/api/platform/conversations/${CONVERSATION_ID}`) return respond(conversation());
  if (method === 'get' && url === '/api/platform/conversations') return respond([]);
  if (method === 'get' && url === `/api/platform/conversations/${CONVERSATION_ID}/action-plans`) return respond([]);
  if (method === 'get' && new RegExp(`^/api/platform/conversations/${CONVERSATION_ID}/turns/\\d+/events$`).test(url)) return respond([]);
  if (method === 'get' && new RegExp(`^/api/platform/conversations/${CONVERSATION_ID}/turns/\\d+/events/page$`).test(url)) {
    return respond({ rows: [], nextAfterId: 0, hasMore: false });
  }
  if (method === 'get' && new RegExp(`^/api/platform/conversations/${CONVERSATION_ID}/turns/\\d+/event-summaries$`).test(url)) {
    return respond({ items: [], nextCursor: null, hasMore: false, preparationStatus: 'READY',
      projectionVersion: 'v1', pendingCount: 0, failedCount: 0, retryAfterMs: null });
  }
  if (method === 'get' && new RegExp(`^/api/platform/conversations/${CONVERSATION_ID}/turns/\\d+/event-summaries/\\d+/content$`).test(url)) {
    return respond({ eventId: 0, content: '', segmentIndex: 0, previousCursor: null, nextCursor: null,
      hasMore: false, projectionVersion: 'v1', state: 'READY', retryAfterMs: null });
  }
  if (method === 'get' && url === '/api/users/me/settings/ui.locale') return respond({ key: 'ui.locale', valueJson: null });
  if (method === 'put' && url === '/api/users/me/settings/ui.locale') return respond({ key: 'ui.locale', valueJson: '"zh-CN"' });
  if (method === 'post' && url === `/api/platform/conversations/${CONVERSATION_ID}/images`) {
    const form = config.data as FormData;
    const file = form.get('file') as File;
    const upload: E2eUpload = { name: file.name, type: file.type, size: file.size };
    e2e.uploads.push(upload);
    record.upload = upload;
    const image: E2eImage = { id: `img-${nextImageId++}`, name: file.name, contentType: file.type, size: file.size, url: PIXEL };
    storedImages.set(image.id, image);
    return respond(image);
  }
  if (method === 'post' && url === `/api/platform/conversations/${CONVERSATION_ID}/turns`) {
    const body = JSON.parse(String(config.data)) as { content: string; imageIds?: string[] };
    record.body = body;
    const images = (body.imageIds ?? []).map(id => storedImages.get(id)).filter((image): image is E2eImage => Boolean(image));
    sent.push({ id: 300 + sent.length, direction: 'IN', content: body.content, status: 'SUCCESS', error: null, gmtCreate: '', images });
    sent.push({ id: 400 + sent.length, direction: 'OUT', content: '已收到图片', status: 'SUCCESS', error: null, gmtCreate: '' });
    return respond({});
  }
  throw new Error(`chief-image-upload fixture does not serve: ${method} ${url}`);
};

useAuthStore.getState().setUser({ id: 7, username: 'owner', nickname: 'Owner', email: '' });
useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'Project', description: '' }, 'ADMIN');
useAuthStore.setState({ accessLevel: 'ADMIN' });
// 固定打开内置会话，避免依赖历史列表交互。
try { localStorage.setItem('chief-of-staff:7:1', JSON.stringify({ conversationId: CONVERSATION_ID })); } catch { /* storage may be blocked */ }
// 内存 WebSocket fixture 需要已认证身份，避免真实网络出口。
const claims = btoa(JSON.stringify({ uid: 7, workspace: 1, exp: Math.floor(Date.now() / 1000) + 3600 }));
useAuthStore.getState().setTokens(`fixture.${claims}.test-only`, 'fixture-refresh');

const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <LocaleProvider>
    <AppearanceProvider accent="#f97316">
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/workitems/128']}>
          <ChiefOfStaff />
        </MemoryRouter>
      </QueryClientProvider>
    </AppearanceProvider>
  </LocaleProvider>,
);
