import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/i18n/format';
import type { RuntimeTraceEvent } from '@/shared/types/workitem';
import { Button } from 'antd';
import { aggregateRuntimeMessages } from './runtimeLogMessages';

const THINKING_MARKER = 'thinking';
const KIND_COLORS: Record<string, string> = { thinking: '#d2a8ff', tool: '#79c0ff', assistant: '#7ee787', activity: '#7ee787' };
function decodeValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}
function renderValue(value: unknown): string {
  const decoded = decodeValue(value);
  return typeof decoded === 'string' ? decoded : JSON.stringify(decoded, null, 2);
}
function presentation(event: ReturnType<typeof aggregateRuntimeMessages>[number]) {
  const d = event.detail;
  const type = event.eventType;
  const providerType = String(d.providerType ?? d.type ?? '');
  const compact = type === 'context.compact_started' ? 'started' : type === 'context.compact_completed' ? 'completed' : null;
  const thinking = type.includes('thinking') || providerType === 'thinking';
  const input = decodeValue(d.input ?? d.arguments ?? d.inputSummary);
  const params = input && typeof input === 'object' ? input as Record<string, unknown> : null;
  const tool = d.toolName ?? d.tool ?? d.name ?? params?.tool;
  const isTool = Boolean(tool) || /tool|mcp|command/.test(type) || providerType === 'tool_use';
  const output = d.output ?? d.result ?? d.outputSummary;
  const message = event.messageText ?? d.content ?? d.text ?? d.message ?? d.contentSummary;
  return {
    compact,
    compactProvider: typeof d.provider === 'string' ? d.provider : null,
    compactAuto: d.trigger === 'auto',
    compactManual: d.trigger === 'manual',
    compactDuration: compact === 'completed' && typeof d.durationMs === 'number' ? d.durationMs : null,
    kind: thinking ? 'thinking' : isTool ? 'tool' : type === 'agent.message' ? 'assistant' : 'activity',
    tool: tool == null ? '' : renderValue(tool),
    description: params?.description,
    command: params?.command ?? d.command,
    input: params?.command != null ? null : input,
    output,
    message: message === THINKING_MARKER ? null : message,
  };
}
const COMPACT_MUTED = '#8A8F98';
const TERM_COLORS = { base: '#C8C8CC', bright: '#D6D8DB', dim: COMPACT_MUTED, blue: '#6FB3FF', green: '#57C775', amber: '#E5C07B', red: '#E06C75' };
const COMPACT_KIND_COLORS: Record<string, string> = { thinking: TERM_COLORS.dim, tool: TERM_COLORS.blue, assistant: TERM_COLORS.green, activity: TERM_COLORS.dim };
function isFailure(event: ReturnType<typeof aggregateRuntimeMessages>[number]) {
  const d = event.detail;
  return event.eventType.includes('fail') || Boolean(d.error) || d.status === 'failed' || d.isError === true;
}
const TIME_OPTIONS = { dateStyle: 'medium', timeStyle: 'medium' } as const;
const COMPACT_TIME_OPTIONS = { timeStyle: 'medium' } as const;

function EventDetails({ event }: { event: ReturnType<typeof aggregateRuntimeMessages>[number] }) {
  const { t } = useTranslation('workitem');
  const [open, setOpen] = useState(false);
  return <details style={{ color: '#8b949e', fontSize: 11 }} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary style={{ cursor: 'pointer' }}>{t('runtimeLog.terminalDetails')}</summary>
    {open && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit' }}>{JSON.stringify(event.fragments ?? event, null, 2)}</pre>}
  </details>;
}

/** Plain text only: runtime content must never execute HTML or terminal escape commands. */
export function RuntimeTerminal({ events, query, height = 'min(65vh, 650px)', compact = false }: { events: RuntimeTraceEvent[]; query: string; height?: string; compact?: boolean }) {
  const { t } = useTranslation('workitem');
  const viewport = useRef<HTMLDivElement>(null);
  const [followOutput, setFollowOutput] = useState(true);
  // The API exposes arrival IDs as seq, including after executor failover.
  const ordered = useMemo(() => [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)), [events]);
  const rows = useMemo(() => aggregateRuntimeMessages(ordered).filter(event => !query || JSON.stringify(event).toLowerCase().includes(query.toLowerCase())), [ordered, query]);
  const last = ordered[ordered.length - 1];
  useEffect(() => {
    if (followOutput && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [events, query, followOutput]);
  const screen = <div ref={viewport} role="region" aria-label={t('runtimeLog.terminal')} tabIndex={0} data-testid="runtime-terminal" className={compact ? 'runtime-terminal-screen' : undefined}
      onScroll={() => { const element = viewport.current; if (element) setFollowOutput(element.scrollHeight - element.scrollTop - element.clientHeight < 32); }}
      style={compact
        ? { height, overflow: 'auto', background: '#1D1D20', color: TERM_COLORS.base, padding: '10px 12px', fontFamily: 'var(--aw-font-mono)', fontSize: 11, lineHeight: '18px' }
        : { height, overflow: 'auto', background: '#0d1117', color: '#e6edf3', borderRadius: 8, padding: 20, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13, lineHeight: 1.65 }}>
      {rows.length === 0 && <div>{t('runtimeLog.terminalEmpty')}</div>}
      {rows.map(event => {
        const view = presentation(event);
        const failed = compact && isFailure(event);
        const color = !compact ? KIND_COLORS[view.kind] : failed ? TERM_COLORS.red : view.compact ? TERM_COLORS.amber : COMPACT_KIND_COLORS[view.kind];
        const time = event.fragments?.at(-1)?.eventTime ?? event.eventTime;
        return <div key={event.eventId ?? `${event.seq}-${event.eventType}`} style={{ marginBottom: compact ? 6 : 20 }}>
          <div style={{ display: 'flex', gap: compact ? 8 : 12, alignItems: 'baseline', color }}>
            <span>{view.compact ? t(view.compact === 'started' ? 'runtimeLog.compactStarted' : 'runtimeLog.compactCompleted') : t(`runtimeLog.terminalKinds.${view.kind as 'thinking' | 'tool' | 'assistant' | 'activity'}`)}{view.tool && <span style={compact ? { color: TERM_COLORS.bright } : undefined}>{t('runtimeLog.terminalToolName', { name: view.tool })}</span>}</span>
            <time style={{ color: compact ? COMPACT_MUTED : '#8b949e', fontSize: 11, order: compact ? -1 : undefined }} dateTime={time ?? undefined} title={compact && time ? formatDateTime(time, TIME_OPTIONS) : undefined}>{time ? formatDateTime(time, compact ? COMPACT_TIME_OPTIONS : TIME_OPTIONS) : t('runtimeLog.unknownTime')}</time>
          </div>
          {view.compact && <div style={{ color: compact ? COMPACT_MUTED : '#a5b4c4' }}>
            {view.compactProvider && <div>{view.compactProvider}</div>}
            {view.compactAuto && <span>{t('runtimeLog.compactAuto')}</span>}
            {view.compactManual && <span>{t('runtimeLog.compactManual')}</span>}
            {view.compactDuration != null && <div>{t('runtimeLog.compactDuration', { milliseconds: view.compactDuration })}</div>}
          </div>}
          {view.description != null && <div style={{ color: compact ? COMPACT_MUTED : '#a5b4c4' }}>{renderValue(view.description)}</div>}
          {view.command != null && <pre style={{ margin: '4px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit', color: compact ? TERM_COLORS.green : '#e6edf3' }}>{t('runtimeLog.terminalCommand', { command: renderValue(view.command) })}</pre>}
          {[view.message, view.input, view.output].filter(value => value != null).map((value, index) => <pre key={index} style={{ margin: compact ? '2px 0' : '4px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit', ...(compact ? { color: failed ? TERM_COLORS.red : view.kind === 'thinking' ? TERM_COLORS.dim : view.kind === 'assistant' ? TERM_COLORS.bright : undefined, fontStyle: view.kind === 'thinking' ? 'italic' : undefined } : {}) }}>{renderValue(value)}</pre>)}
          <EventDetails event={event} />
        </div>;
      })}
    </div>;
  const follow = !followOutput && <Button size={compact ? 'small' : undefined} className={compact ? 'runtime-terminal-follow' : undefined} style={compact ? undefined : { marginTop: 8 }} onClick={() => setFollowOutput(true)}>{t('workbench.followOutput')}</Button>;
  return <>
    <div className={compact ? 'runtime-terminal-last' : undefined} style={compact ? undefined : { marginBottom: 8 }}>{t('runtimeLog.lastOutput', { time: last?.eventTime ? formatDateTime(last.eventTime, TIME_OPTIONS) : t('runtimeLog.unknownTime') })}</div>
    {compact ? <div className="runtime-terminal-wrap">{screen}{follow}</div> : <>{screen}{follow}</>}
  </>;
}
