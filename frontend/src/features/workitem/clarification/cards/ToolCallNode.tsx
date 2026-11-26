import { formatNumber } from '@/shared/i18n/format';
import { useTranslation } from 'react-i18next';
import { ToolOutlined } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { ReactElement } from 'react';
import type { AcpToolKind } from '../types';
import type { TimelineToolCall } from '../timeline';
import { CLARIFICATION_THEME } from '../theme';
import { PersistentFold } from '../PersistentFold';

interface ToolCallNodeProps {
  tool: TimelineToolCall;
  foldKey?: string;
}

const STATUS_LABEL = { running: 'clarification.toolRunning', completed: 'clarification.toolCompleted', failed: 'clarification.toolFailed' } as const;

const KIND_ICON: Record<AcpToolKind, ReactElement> = {
  execute: <span data-testid="tool-icon-execute"><AwStrokeIcon name="code" size={13} /></span>,
  read: <span data-testid="tool-icon-read"><AwStrokeIcon name="file" size={13} /></span>,
  edit: <span data-testid="tool-icon-edit"><AwStrokeIcon name="edit" size={13} /></span>,
  delete: <span data-testid="tool-icon-delete"><AwStrokeIcon name="trash" size={13} /></span>,
  move: <span data-testid="tool-icon-move"><AwStrokeIcon name="shuffle" size={13} /></span>,
  search: <span data-testid="tool-icon-search"><AwStrokeIcon name="search" size={13} /></span>,
  think: <span data-testid="tool-icon-think"><AwStrokeIcon name="bulb" size={13} /></span>,
  fetch: <span data-testid="tool-icon-fetch"><AwStrokeIcon name="dl" size={13} /></span>,
  other: <ToolOutlined data-testid="tool-icon-other" />,
};

const SUMMARY_STYLE = {
  cursor: 'pointer' as const, fontSize: 13, color: CLARIFICATION_THEME.textMuted,
};

export function ToolCallNode({ tool, foldKey }: ToolCallNodeProps) {
  const { t } = useTranslation('workitem');
  const icon = KIND_ICON[tool.toolKind ?? 'other'] ?? KIND_ICON.other;
  const diffs = tool.diffs ?? [];
  const hasLocations = !!tool.locations && tool.locations.length > 0;
  const hasBody = hasLocations || diffs.length > 0 || !!tool.terminalOutput || !!tool.input || !!tool.output;

  return (
    <details className="aw-cl-step" data-testid={`tool-call-${tool.callId}`}>
      <summary>
        <span className="ic">{icon}</span>
        <span className="t" data-testid="tool-call-title" title={tool.title || tool.tool}>
          {tool.title || tool.tool}
        </span>
        <span className="r">
          <span className={statusClass(tool.status)}>
            {Object.prototype.hasOwnProperty.call(STATUS_LABEL, tool.status) ? t(STATUS_LABEL[tool.status as keyof typeof STATUS_LABEL]) : tool.status}
          </span>
          {tool.durationMs != null && <span>{t('clarification.toolDuration', { duration: formatNumber(tool.durationMs) })}</span>}
          {hasBody ? <span className="chev"><AwStrokeIcon name="chev-d" size={12} /></span> : null}
        </span>
      </summary>

      {hasBody ? (
        <div className="aw-cl-step-body">
          {hasLocations ? (
            <div data-testid="tool-locations">
              {tool.locations!
                .map((loc) => (loc.line != null ? `${loc.path}:${loc.line}` : loc.path))
                .join(t('clarification.locationSeparator'))}
            </div>
          ) : null}

          {diffs.length > 0 ? (
            <div data-testid="tool-diffs">
              {diffs.map((diff, index) => (
                <div key={index} data-testid={`tool-diff-${index}`}>
                  <div className="k">{diff.path}</div>
                  <pre className="aw-cl-pre">
                    {diff.oldText ? (
                      <span className="del" style={{ display: 'block' }} data-testid={`tool-diff-old-${index}`}>{prefixLines(diff.oldText, '-')}</span>
                    ) : null}
                    {diff.newText ? (
                      <span className="add" style={{ display: 'block' }} data-testid={`tool-diff-new-${index}`}>{prefixLines(diff.newText, '+')}</span>
                    ) : null}
                  </pre>
                </div>
              ))}
            </div>
          ) : null}

          {tool.terminalOutput ? (
            <pre className="aw-cl-pre" data-testid="tool-terminal-output">{tool.terminalOutput}</pre>
          ) : null}

          {tool.input ? (
            <PersistentFold foldKey={`${foldKey ?? tool.callId}:input`} style={{ marginTop: 4 }}
              className="aw-cl-subfold" summaryStyle={SUMMARY_STYLE}
              summary={<><span className="k">{t('clarification.toolInput')}</span>
                <span className="chev" data-testid="tool-input-chevron"><AwStrokeIcon name="chev-d" size={12} /></span></>}>
              <pre className="aw-cl-pre" data-testid="tool-input">{tool.input}</pre>
            </PersistentFold>
          ) : null}

          {tool.output ? (
            <PersistentFold foldKey={`${foldKey ?? tool.callId}:output`} style={{ marginTop: 4 }}
              className="aw-cl-subfold" summaryStyle={SUMMARY_STYLE}
              summary={<><span className="k">{t('clarification.toolOutput')}</span>
                <span className="chev" data-testid="tool-output-chevron"><AwStrokeIcon name="chev-d" size={12} /></span></>}>
              <pre className="aw-cl-pre" data-testid="tool-output">{tool.output}</pre>
            </PersistentFold>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function statusClass(status: string): string {
  if (status === 'completed') return 'aw-cl-st-ok';
  if (status === 'failed') return 'aw-cl-st-fail';
  return 'aw-cl-st-run';
}

function prefixLines(text: string, prefix: string): string {
  return text.split('\n').map((line) => `${prefix} ${line}`).join('\n');
}
