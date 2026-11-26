import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../src/shared/i18n/LocaleProvider';
import { AppearanceProvider } from '../src/shared/theme/AppearanceProvider';
import { RecoveryControls } from '../src/features/workitem/components/RecoveryControls';
import { WorkitemActionBar } from '../src/features/workitem/components/WorkitemActionBar';
import { apiClient } from '../src/shared/api/client';
import { useAuthStore } from '../src/shared/auth/store';

// 工单详情交付开关真实浏览器 fixture：真实 RecoveryControls/WorkitemActionBar + 真实主题 CSS。
// 接口用内存 mock（无后端/DB/凭据）：GET /api/workitems/<id>/recovery 直接返回下面的状态，
// POST 挂起直到 runner 调 __deliveryFixture.releasePosts()，用于观察提交中布局与重复提交。
// 901=开启，902=已关闭可重开，903=已关闭但等待停止（不可重开）。
// Run: node e2e-tests/delivery-control-layout/run.cjs

type Recovery = { closed: boolean; canReopen?: boolean; executions: unknown[] };
const states: Record<string, Recovery> = {
  '901': { closed: false, executions: [] },
  '902': { closed: true, canReopen: true, executions: [] },
  '903': { closed: true, canReopen: false, executions: [] },
};
const pendingPosts: Array<(value: unknown) => void> = [];
const writes: Array<{ url: string; body: unknown }> = [];
const reads: string[] = [];

apiClient.get = (async (url: string) => {
  const id = /^\/api\/workitems\/(\d+)\/recovery$/.exec(url)?.[1];
  if (!id || !states[id]) throw new Error(`Unexpected fixture GET ${url}`);
  reads.push(id);
  return { data: states[id] };
}) as never;
apiClient.post = ((url: string, body: unknown) => {
  if (!/^\/api\/workitems\/90[123]\/recovery$/.test(url)) throw new Error(`Unexpected fixture POST ${url}`);
  writes.push({ url, body });
  return new Promise((resolve) => { pendingPosts.push(resolve); });
}) as never;

(window as unknown as {
  __deliveryFixture: {
    setState: (id: string, next: Recovery) => void;
    releasePosts: () => void;
    postCount: () => number;
    writes: () => typeof writes;
    reads: () => string[];
  };
}).__deliveryFixture = {
  setState(id, next) { states[id] = next; },
  releasePosts() { pendingPosts.splice(0).forEach((resolve) => resolve({ data: null })); },
  postCount() { return writes.length; },
  writes() { return [...writes]; },
  reads() { return [...reads]; },
};

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } },
});

// 写操作受 useAccessCommand 的读写权限约束：fixture 以可写成员身份运行。
useAuthStore.setState({ accessLevel: 'READ_WRITE' });

function Panel({ id, title }: { id: string; title: string }) {
  const [watched, setWatched] = useState(false);
  const [actions, setActions] = useState<string[]>([]);
  const record = (action: string) => setActions((current) => [...current, action]);
  return <section data-testid={`panel-${id}`} className="aw-content-frame" style={{ margin: '0 auto 16px', maxWidth: 1440 }}>
    <div className="aw-detail-title"><span>{title}</span></div>
    <RecoveryControls workitemId={id} renderActions={(deliveryControl) => <WorkitemActionBar
      workType="TASK"
      statusName="Synthetic review"
      priority={1}
      hasSdlc={id !== '902'}
      watched={watched}
      deliveryControl={deliveryControl}
      onStartDelivery={() => record('start')}
      onAssignHuman={() => record('assign-human')}
      onTransition={() => record('transition')}
      onToggleWatch={() => { setWatched((value) => !value); record('watch'); }}
      onSyncExternal={() => record('reconcile')}
      onAddComment={() => record('comment')}
      onDelete={() => record('delete')}
    />} />
    <output data-testid="fixture-action-log">{actions.join(',')}</output>
  </section>;
}

createRoot(document.getElementById('root')!).render(
  <LocaleProvider>
    <AppearanceProvider accent="#f97316">
      <QueryClientProvider client={client}>
        <div data-testid="delivery-control-fixture" style={{ padding: 24 }}>
          <Panel id="901" title="交付开启" />
          <Panel id="902" title="交付关闭可重开" />
          <Panel id="903" title="交付关闭等待停止" />
        </div>
      </QueryClientProvider>
    </AppearanceProvider>
  </LocaleProvider>,
);
