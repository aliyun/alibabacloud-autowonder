import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '../src/shared/i18n/LocaleProvider';
import { AppearanceProvider } from '../src/shared/theme/AppearanceProvider';
import { ExecutionActionBar } from '../src/features/workitem/components/ExecutionActionBar';
import { ExecutionControlTimeline } from '../src/features/workitem/components/ExecutionControlTimeline';
import { DeliveryProgress } from '../src/features/workitem/components/DeliveryProgress';
import { CommentInteractionCard } from '../src/features/workitem/components/CommentInteractionCard';
import { InteractionStopControl } from '../src/features/workitem/components/InteractionStopControl';
import type { InteractionStopAction } from '../src/features/workitem/components/InteractionStopControl';
import type { Artifact, TimelineItem, DispatchAttempt, DispatchControlCapabilities, ExecutionControlDetail, DeliveryControlDetail, CommentInteraction } from '../src/shared/types/workitem';
import type { ExecutionActionKind } from '../src/features/workitem/hooks';

// 工单执行控制面板浏览器 fixture：真实 Chrome 验证统一执行操作栏按控制能力渲染
// 主操作/溢出/禁用操作及原因、结束/继续超时/强制结束确认弹窗、控制时间线按派发
// 过滤与加载更早、交付进度执行卡片长状态不挤压执行名称、产物行布局与交互、中英文文案。
// 无后端/DB：mock 控制能力、时间线事件与产物，onAction 回调记录到页面日志。
// Run: node e2e-tests/workitem-execution-control-panel/run.cjs

function caps(overrides: Partial<DispatchControlCapabilities>): DispatchControlCapabilities {
  const off = { allowed: false };
  return { pause: off, end: off, forceEnd: off, resume: off, ...overrides } as DispatchControlCapabilities;
}

function attempt(id: number, status: string | null, overrides: Partial<DispatchAttempt> = {}): DispatchAttempt {
  return {
    dispatchId: id,
    agentId: 20000,
    agentName: '数字员工甲',
    executorId: null,
    executorName: null,
    status,
    startedAt: null,
    endedAt: null,
    durationMs: 60000,
    waitingReason: null,
    error: null,
    resumeMode: null,
    ...overrides,
  };
}

const ACTION_ATTEMPTS: Array<{ id: string; attempt: DispatchAttempt }> = [
  {
    id: 'action-row-101',
    attempt: attempt(101, 'RUNNING', { control: caps({ pause: { allowed: true }, end: { allowed: true } }) }),
  },
  {
    id: 'action-row-102',
    attempt: attempt(102, 'PAUSE_FAILED', {
      control: caps({ pause: { allowed: false, reasonKey: 'recovery.waitingPause' }, resume: { allowed: true, targetDispatchId: 103, mode: 'RESUME' } }),
    }),
  },
  {
    id: 'action-row-103',
    attempt: attempt(103, 'TIMEOUT', {
      control: caps({ resume: { allowed: true, targetDispatchId: 104, mode: 'RESUME', targetStatus: 'TIMEOUT', targetStopPending: true } }),
    }),
  },
  {
    id: 'action-row-104',
    attempt: attempt(104, 'FAILED', { control: caps({ end: { allowed: true } }) }),
  },
  {
    id: 'action-row-105',
    attempt: attempt(105, 'RUNNING', { control: caps({ end: { allowed: true }, forceEnd: { allowed: true } }) }),
  },
  {
    id: 'action-row-106',
    attempt: attempt(106, 'CANCELED', { control: caps({ resume: { allowed: false, reasonKey: 'recovery.agentNotPublished' } }) }),
  },
  {
    id: 'action-row-107',
    attempt: attempt(107, 'PAUSED', { canContinue: true }),
  },
  {
    id: 'action-row-108',
    attempt: attempt(108, 'RUNNING', { canPause: true }),
  },
];

function ActionBarShowcase() {
  const [log, setLog] = useState<string[]>([]);
  const onAction = (rowAttempt: DispatchAttempt, action: ExecutionActionKind) => {
    setLog((current) => [...current, `${action}:${rowAttempt.dispatchId}`]);
  };
  return (
    <div data-testid="execution-control-fixture" style={{ maxWidth: 960 }}>
      <output data-testid="action-log">{log.join(',')}</output>
      {ACTION_ATTEMPTS.map(({ id, attempt: rowAttempt }) => (
        <div key={id} data-testid={id} style={{ padding: '6px 0', borderBottom: '1px dashed #ddd' }}>
          <span style={{ display: 'inline-block', width: 90, color: '#888' }}>#{rowAttempt.dispatchId}</span>
          <ExecutionActionBar attempt={rowAttempt} pending={null} onAction={(action) => onAction(rowAttempt, action)} />
        </div>
      ))}
    </div>
  );
}

function sysItem(id: number, executionControl: ExecutionControlDetail): TimelineItem {
  return {
    id,
    type: 'system',
    eventType: 'EXECUTION_CONTROL',
    executionControl,
    deliveryControl: null,
    authorId: null,
    authorName: executionControl.requestedByName ?? null,
    authorType: 'HUMAN',
    isAgent: false,
    content: '',
    gmtCreate: new Date(Date.UTC(2026, 9, 20, 8, 0, 0) - id * 1000).toISOString(),
  };
}

function deliverySysItem(id: number, deliveryControl: DeliveryControlDetail): TimelineItem {
  return {
    id,
    type: 'system',
    eventType: 'DELIVERY_CONTROL',
    executionControl: null,
    deliveryControl,
    authorId: null,
    authorName: deliveryControl.requestedByName ?? null,
    authorType: 'HUMAN',
    isAgent: false,
    content: '',
    gmtCreate: new Date(Date.UTC(2026, 9, 20, 8, 0, 0) - id * 1000).toISOString(),
  };
}

// 最新在前；dispatch 101 共 15 条（含重开记录但重开不归属任何派发），dispatch 103 仅 1 条恢复记录。
function makeControlItems(): TimelineItem[] {
  const items: TimelineItem[] = [
    sysItem(9000, { action: 'START', phase: 'CONFIRMED', origin: 'ASSIGNMENT', dispatchId: 100, requestedByName: '首次指派人' }),
    sysItem(9001, { action: 'PAUSE', phase: 'CONFIRMED', dispatchId: 101, requestedByName: '张三' }),
    sysItem(9002, { action: 'PAUSE', phase: 'REQUESTED', dispatchId: 101, requestedByName: '张三' }),
    sysItem(9003, { action: 'RESUME', phase: 'CONFIRMED', dispatchId: 101, sourceDispatchId: 101, targetDispatchId: 103, requestedByName: '张三' }),
    deliverySysItem(9004, { action: 'CLOSE', requestedByName: '李四', reason: '需求已验收', affectedDispatches: [{ dispatchId: 101, fromStatus: 'RUNNING', toStatus: 'CANCELED' }] }),
    deliverySysItem(9005, { action: 'REOPEN', requestedByName: '李四', affectedDispatches: [] }),
  ];
  for (let seq = 1; seq <= 11; seq += 1) {
    items.push(sysItem(9010 + seq, { action: 'CANCEL', phase: 'REQUESTED', dispatchId: 101, requestedByName: '王五' }));
  }
  return items;
}

function ControlTimelineShowcase() {
  const [items] = useState<TimelineItem[]>(() => makeControlItems());
  return (
    <div data-testid="control-timeline-fixture" style={{ maxWidth: 960, marginTop: 24 }}>
      <div data-testid="timeline-full-100">
        <ExecutionControlTimeline dispatchId={100} items={items} />
      </div>
      <div data-testid="timeline-full-101">
        <ExecutionControlTimeline dispatchId={101} items={items} />
      </div>
      <div data-testid="timeline-full-103">
        <ExecutionControlTimeline dispatchId={103} items={items} />
      </div>
      <div data-testid="timeline-compact-101">
        <ExecutionControlTimeline dispatchId={101} items={items} compact />
      </div>
    </div>
  );
}

const LONG_STATUS = 'WAITING_FOR_EXECUTOR_RECONNECT_AND_PENDING_OPERATOR_CONFIRMATION';

const LONG_ARTIFACT_NAME = `artifacts/output/handoff/${'release-notes-and-a-very-long-artifact-file-name-for-layout-verification-'.repeat(2)}final.md`;

// 产物行断言数据：覆盖 B/KB/MB、size=0、size 缺失、未知类型回退、验证证据分类与超长文件名。
const ARTIFACTS: Artifact[] = [
  { id: 501, workitemId: 100, dispatchId: 101, name: 'artifacts/output/handoff/summary.md', type: 'HANDOFF', size: 12595, gmtCreate: '2026-10-20T08:00:00Z' },
  { id: 502, workitemId: 100, dispatchId: 101, name: 'artifacts/output/handoff/empty.txt', type: 'HANDOFF', size: 0, gmtCreate: '2026-10-20T08:00:01Z' },
  { id: 503, workitemId: 100, dispatchId: 101, name: 'artifacts/output/handoff/bundle.bin', type: 'HANDOFF', size: 2097152, gmtCreate: '2026-10-20T08:00:02Z' },
  { id: 504, workitemId: 100, dispatchId: 101, name: 'artifacts/output/handoff/no-size.md', type: 'HANDOFF', size: null, gmtCreate: '2026-10-20T08:00:03Z' },
  { id: 505, workitemId: 100, dispatchId: 101, name: LONG_ARTIFACT_NAME, type: 'HANDOFF', size: 5120, gmtCreate: '2026-10-20T08:00:04Z' },
  { id: 506, workitemId: 100, dispatchId: 101, name: 'artifacts/output/evidence/probe-result.json', type: 'EVIDENCE', size: 20500, gmtCreate: '2026-10-20T08:00:05Z' },
  { id: 507, workitemId: 100, dispatchId: 101, name: 'artifacts/output/other/custom.bin', type: 'CUSTOM_TYPE', size: 100, gmtCreate: '2026-10-20T08:00:06Z' },
];

function WorkbenchShowcase() {
  const [items] = useState<TimelineItem[]>(() => makeControlItems());
  const [log, setLog] = useState<string[]>([]);
  const activeAttempt = attempt(101, 'RUNNING', {
    control: caps({ pause: { allowed: true }, end: { allowed: true } }),
  });
  const longStatusAttempt = attempt(102, LONG_STATUS, { agentId: 20002, agentName: '数字员工乙' });
  return (
    <div data-testid="delivery-progress-fixture" style={{ maxWidth: 960, marginTop: 24 }}>
      <output data-testid="workbench-action-log">{log.join(',')}</output>
      <DeliveryProgress
        showWorkflowPlan={false}
        progress={{
          executions: [activeAttempt, longStatusAttempt],
          steps: [],
          agents: [
            {
              agentId: 20000,
              agentName: '数字员工甲',
              status: 'active',
              durationMs: 60000,
              executionStatus: 'RUNNING',
              steps: [
                {
                  stepId: 1,
                  name: 'SDLC 步骤',
                  status: 'done',
                  planStatus: null,
                  sourceAttempt: null,
                  agentName: '数字员工甲',
                  executorId: null,
                  executorName: null,
                  error: null,
                  subSteps: null,
                  durationMs: 60000,
                  attempts: [activeAttempt],
                },
              ],
            },
            {
              agentId: 20002,
              agentName: '数字员工乙',
              status: 'finished',
              durationMs: 30000,
              executionStatus: LONG_STATUS,
              steps: [],
            },
          ],
          totalDurationMs: null,
          closed: false,
        }}
        artifacts={ARTIFACTS}
        renderControlTimeline={(dispatchId, compact) => (
          <ExecutionControlTimeline dispatchId={dispatchId} items={items} compact={compact} />
        )}
        onExecutionAction={(rowAttempt, action) => {
          setLog((current) => [...current, `${action}:${rowAttempt.dispatchId}`]);
        }}
      />
    </div>
  );
}

// 评论交互卡片停止控件：真实 CommentInteractionCard + InteractionStopControl，控制能力/运行事件由
// 本 fixture 传入。覆盖图标无障碍名称、精简确认框（无评论编号/数字人行）、取消零请求、按 dispatch
// 隔离的 loading 与错误、取消中/停止未确认状态、只读不传渲染位。
function commentInteraction(dispatchId: number, overrides: Partial<CommentInteraction> = {}): CommentInteraction {
  return {
    guidanceId: dispatchId,
    dispatchId,
    executionStatus: 'RUNNING',
    targetAgentId: 20000,
    targetAgentName: '数字员工甲',
    status: 'DELIVERED',
    error: null,
    replyCommentId: null,
    replyContent: null,
    repliedAt: null,
    controlEligible: true,
    cancelRequested: false,
    stopPending: false,
    control: { end: { allowed: true }, forceEnd: { allowed: false } },
    ...overrides,
  };
}

const COMMENT_CARDS: Array<{ testId: string; interaction: CommentInteraction; withActions: boolean; failOnConfirm?: boolean }> = [
  { testId: 'comment-card-201', interaction: commentInteraction(201), withActions: true },
  {
    testId: 'comment-card-202',
    interaction: commentInteraction(202, {
      status: 'CANCELED',
      executionStatus: 'PAUSING',
      cancelRequested: true,
      stopPending: true,
      control: {
        end: { allowed: false, reasonKey: 'delivery.controlReason.cancelling' },
        forceEnd: { allowed: true },
      },
    }),
    withActions: true,
  },
  {
    testId: 'comment-card-203',
    interaction: commentInteraction(203, {
      status: 'CANCELED',
      executionStatus: 'CANCELED',
      cancelRequested: true,
      stopPending: true,
      control: {
        end: { allowed: false, reasonKey: 'delivery.controlReason.terminal' },
        forceEnd: { allowed: false, reasonKey: 'delivery.controlReason.terminal' },
      },
    }),
    withActions: true,
  },
  {
    testId: 'comment-card-204',
    interaction: commentInteraction(204, {
      status: 'APPLIED',
      executionStatus: 'SUCCEEDED',
      replyCommentId: 300,
      replyContent: '已完成分析。',
      repliedAt: '2026-10-20T08:05:00Z',
      control: {
        end: { allowed: false, reasonKey: 'delivery.controlReason.terminal' },
        forceEnd: { allowed: false, reasonKey: 'delivery.controlReason.terminal' },
      },
    }),
    withActions: true,
  },
  // 只读成员/无渲染位：同一交互但不传 actions，必须没有任何停止控件。
  { testId: 'comment-card-205', interaction: commentInteraction(205), withActions: false },
  { testId: 'comment-card-206', interaction: commentInteraction(206), withActions: true, failOnConfirm: true },
];

function CommentStopShowcase() {
  const [log, setLog] = useState<string[]>([]);
  const [refreshes, setRefreshes] = useState(0);
  const [pending, setPending] = useState<{ dispatchId: number; action: InteractionStopAction } | null>(null);
  const runAction = (dispatchId: number, action: InteractionStopAction, fail: boolean) => async () => {
    setPending({ dispatchId, action });
    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (fail) throw new Error('fixture rejects the end request');
      setLog((current) => [...current, `${action}:${dispatchId}`]);
    } finally {
      setPending(null);
    }
  };
  const renderActions = (dispatchId: number, fail: boolean) => (interaction: CommentInteraction) => (
    <InteractionStopControl
      interaction={interaction}
      pending={pending?.dispatchId === dispatchId ? pending.action : null}
      onAction={(action) => runAction(dispatchId, action, fail)()}
      onRefresh={() => setRefreshes((value) => value + 1)}
    />
  );
  return (
    <div data-testid="comment-stop-fixture" style={{ maxWidth: 960, marginTop: 24 }}>
      <output data-testid="comment-action-log">{log.join(',')}</output>
      <output data-testid="comment-refresh-log">{refreshes}</output>
      {COMMENT_CARDS.map(({ testId, interaction, withActions, failOnConfirm }) => (
        <div key={testId} data-testid={testId} style={{ padding: '6px 0', borderBottom: '1px dashed #ddd' }}>
          <CommentInteractionCard
            interaction={interaction}
            createdAt="2026-10-20T08:00:00Z"
            actions={withActions ? renderActions(interaction.dispatchId!, Boolean(failOnConfirm))(interaction) : undefined}
          />
        </div>
      ))}
    </div>
  );
}

// A06-A08 approved UI acceptance: synthetic Dispatch snapshots, not real dispatch or business PASS.
// Historical 301 shares stage IDs with current 304, deliberately with different status/plan/substeps.
// This catches accidental reuse of the agent's latest stage list for a pinned historical Dispatch.
const LONG_STAGE = 'Synthetic requirements analysis with an exceptionally long entry-stage name for truncation';
const REPAIR_EXECUTIONS = [
  attempt(301, 'PAUSED', { agentId: 21000, agentName: 'Synthetic analyst', durationMs: 120000,
    startedAt: '2026-10-20T08:00:00Z', endedAt: '2026-10-20T08:02:00Z',
    stepTimings: [{ stepId: 11, name: LONG_STAGE, status: 'done', durationMs: 80000 }, { stepId: 12, name: 'Historical review', status: 'paused', durationMs: 40000 }],
    control: caps({ resume: { allowed: true } }) }),
  attempt(302, 'SUCCEEDED', { agentId: 21001, agentName: 'Synthetic builder with a deliberately long lane name', durationMs: 60000,
    startedAt: '2026-10-20T08:02:00Z', endedAt: '2026-10-20T08:03:00Z',
    stepTimings: [{ stepId: 21, name: 'Synthetic implementation', status: 'done', durationMs: 60000 }] }),
  attempt(303, 'SUCCEEDED', { agentId: 21001, agentName: 'Synthetic builder with a deliberately long lane name', durationMs: 30000,
    startedAt: '2026-10-20T08:03:00Z', endedAt: '2026-10-20T08:03:30Z',
    stepTimings: [{ stepId: 22, name: 'Synthetic verification', status: 'done', durationMs: 30000 }] }),
  attempt(304, 'RUNNING', { agentId: 21000, agentName: 'Synthetic analyst', durationMs: 180000,
    startedAt: '2026-10-20T08:04:00Z',
    stepTimings: [{ stepId: 11, name: 'Latest analysis', status: 'reused', durationMs: 0 }, { stepId: 12, name: 'Latest review', status: 'done', durationMs: 60000 }, { stepId: 13, name: 'Latest delivery', status: 'active', durationMs: 120000 }],
    control: caps({ pause: { allowed: true }, end: { allowed: true } }) }),
];

function RepairWorkbenchShowcase() {
  return <section data-testid="repair-workbench-fixture" style={{ maxWidth: 960, marginTop: 24 }}>
    <DeliveryProgress showWorkflowPlan={false} progress={{
      executions: REPAIR_EXECUTIONS,
      steps: [],
      agents: [
        { agentId: 21000, agentName: 'Synthetic analyst', status: 'active', durationMs: 300000,
          steps: [11, 12, 13].map((stepId, index) => ({
            stepId, name: ['Latest analysis', 'Latest review', 'Latest delivery'][index],
            status: index === 2 ? 'active' as const : 'done' as const,
            currentDispatchId: 304, planStatus: 'REUSED', sourceAttempt: 7,
            agentName: 'Synthetic analyst', executorId: null, executorName: null, error: null,
            subSteps: [{ name: 'LATEST_ONLY_SUBSTEP', status: 'done' as const }], durationMs: 60000,
            attempts: [REPAIR_EXECUTIONS[0], REPAIR_EXECUTIONS[3]],
          })) },
        { agentId: 21001, agentName: 'Synthetic builder with a deliberately long lane name', status: 'finished', durationMs: 90000, steps: [] },
      ],
      processGraph: {
        nodes: REPAIR_EXECUTIONS.map((execution, index) => ({
          key: `dispatch-${execution.dispatchId}`, dispatchId: execution.dispatchId, agentId: execution.agentId,
          agentName: execution.agentName!, stepId: execution.stepTimings![0].stepId,
          stepName: index === 0 ? LONG_STAGE : execution.stepTimings![0].name,
          status: execution.status, startedAt: execution.startedAt, durationMs: execution.durationMs,
        })),
        edges: [
          { sourceKey: 'dispatch-301', targetKey: 'dispatch-302', type: 'HANDOFF', sourceDispatchId: 301, targetDispatchId: 302, label: 'Synthetic handoff' },
          { sourceKey: 'dispatch-302', targetKey: 'dispatch-303', type: 'CONTINUE', sourceDispatchId: 302, targetDispatchId: 303, label: 'Synthetic continuation' },
          { sourceKey: 'dispatch-303', targetKey: 'dispatch-304', type: 'COMMENT_REWORK', sourceDispatchId: 303, targetDispatchId: 304, commentId: 800, label: 'Synthetic rework' },
        ],
      },
      totalDurationMs: 390000, closed: false,
    }} artifacts={[]} renderControlTimeline={(dispatchId, compact) => <ExecutionControlTimeline dispatchId={dispatchId} compact={compact} items={[
      sysItem(9500 + dispatchId, { action: 'PAUSE', phase: 'CONFIRMED', dispatchId, requestedByName: 'Synthetic operator' }),
    ]} />} />
  </section>;
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <LocaleProvider>
    <AppearanceProvider accent="#2563eb">
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/']}>
          <div style={{ padding: 24 }}>
            <ActionBarShowcase />
            <ControlTimelineShowcase />
            <WorkbenchShowcase />
            <RepairWorkbenchShowcase />
            <CommentStopShowcase />
          </div>
        </MemoryRouter>
      </QueryClientProvider>
    </AppearanceProvider>
  </LocaleProvider>,
);
