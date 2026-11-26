import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Segmented, Select, Spin, message } from 'antd';
import { AimOutlined } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSquadOptions } from '@/features/squad/SquadFilterBar';
import { ApiError } from '@/shared/types/common';
import {
  generateSquadWorkflow,
  getSquadWorkflow,
  WORKFLOW_STALE_INPUT_CODE,
  type SquadWorkflowView,
} from './api';
import { WorkflowGraphCanvas, type WorkflowCanvasControls, type WorkflowSelection, type WorkflowViewMode } from './WorkflowGraphCanvas';
import { WorkflowDetails, WorkflowFindings } from './WorkflowDetails';
import { formatDateTime } from '@/shared/i18n/format';
import './workflow.css';

export const WORKFLOW_POLL_INTERVAL = 3000;
export const WORKFLOW_SLOW_POLL_INTERVAL = 10000;
export const WORKFLOW_FAST_POLL_WINDOW_MS = 30000;

function isActive(status: string | undefined): boolean {
  return status === 'GENERATING' || status === 'REPAIRING';
}

/**
 * Analysis starts with rapid polling so a fast result shows up immediately, then backs off so a
 * long Chief run does not keep hitting the server every three seconds.
 */
export function workflowPollInterval(active: boolean, elapsedMs: number): number | false {
  if (!active) return false;
  return elapsedMs < WORKFLOW_FAST_POLL_WINDOW_MS ? WORKFLOW_POLL_INTERVAL : WORKFLOW_SLOW_POLL_INTERVAL;
}

export function SquadWorkflowPanel() {
  const { t } = useTranslation('sdlc');
  const queryClient = useQueryClient();
  const { options, isLoading: squadsLoading } = useSquadOptions();
  const [squadId, setSquadId] = useState<number | null>(null);
  const [mode, setMode] = useState<WorkflowViewMode>('main');
  const [selection, setSelection] = useState<WorkflowSelection | null>(null);
  const activeSinceRef = useRef<number | null>(null);
  const canvasControlsRef = useRef<WorkflowCanvasControls | null>(null);

  const queryKey = ['squad-workflow', squadId];

  const workflowQuery = useQuery({
    queryKey,
    queryFn: () => getSquadWorkflow(squadId as number),
    enabled: squadId != null,
    refetchInterval: (query) => {
      const active = isActive(query.state.data?.status);
      const since = activeSinceRef.current;
      return workflowPollInterval(active, since == null ? 0 : Date.now() - since);
    },
  });

  const view = workflowQuery.data;

  useEffect(() => {
    setSelection(null);
    setMode('main');
    activeSinceRef.current = null;
  }, [squadId]);

  useEffect(() => {
    if (isActive(view?.status)) {
      if (activeSinceRef.current == null) activeSinceRef.current = Date.now();
    } else {
      activeSinceRef.current = null;
    }
  }, [squadId, view?.status]);

  const generateMutation = useMutation({
    mutationFn: (retry: boolean) => generateSquadWorkflow(squadId as number, {
      expectedInputHash: view?.inputHash ?? null,
      retry,
    }),
    onSuccess: (next) => {
      if (squadId != null) queryClient.setQueryData(['squad-workflow', squadId], next);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.code === WORKFLOW_STALE_INPUT_CODE) {
        if (error.data && squadId != null) {
          queryClient.setQueryData(['squad-workflow', squadId], error.data as SquadWorkflowView);
        }
        message.info(t('workflow.stale'));
        return;
      }
      message.error(error instanceof Error ? error.message : t('workflow.generationFailed'));
    },
  });

  const generate = (retry: boolean) => {
    if (squadId == null) return;
    generateMutation.mutate(retry);
  };

  const content = () => {
    if (squadId == null) return null;
    if (workflowQuery.isLoading) {
      return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
    }
    if (workflowQuery.isError) {
      const error = workflowQuery.error;
      return (
        <Alert
          type="error"
          showIcon
          message={error instanceof Error ? error.message : t('workflow.generationFailed')}
          action={<Button size="small" onClick={() => void workflowQuery.refetch()}>{t('workflow.refresh')}</Button>}
        />
      );
    }
    if (!view) return null;
    if (view.status === 'EMPTY') {
      return (
        <div className="aw-workflow-empty">
          <div className="aw-workflow-empty-title">{t('workflow.empty')}</div>
        </div>
      );
    }
    if (view.status === 'MISSING') {
      return (
        <div className="aw-workflow-empty">
          <div className="aw-workflow-empty-title">{t('workflow.missingTitle')}</div>
          <div className="aw-workflow-empty-hint">{t('workflow.missingHint')}</div>
          <Button type="primary" loading={generateMutation.isPending} onClick={() => generate(false)}>
            {t('workflow.generate')}
          </Button>
        </div>
      );
    }
    if (isActive(view.status)) {
      const repairing = view.status === 'REPAIRING';
      return (
        <div className="aw-workflow-gen">
          <span className="aw-workflow-spinner" aria-hidden="true" />
          <div>
            <div className="aw-workflow-gen-title">{repairing ? t('workflow.repairing') : t('workflow.generating')}</div>
            <div className="aw-workflow-gen-hint">{t('workflow.generatingHint')}</div>
          </div>
        </div>
      );
    }
    if (view.status === 'FAILED') {
      return (
        <Alert
          type="error"
          showIcon
          message={view.error?.message || t('workflow.failed')}
          description={view.error?.code}
          action={(
            <div className="aw-workflow-alert-actions">
              {view.error?.retryable !== false && (
                <Button type="primary" size="small" loading={generateMutation.isPending} onClick={() => generate(true)}>
                  {t('workflow.retry')}
                </Button>
              )}
              <Button size="small" onClick={() => void workflowQuery.refetch()}>{t('workflow.refresh')}</Button>
            </div>
          )}
        />
      );
    }
    if (!view.graph) {
      return (
        <Alert
          type="warning"
          showIcon
          message={t('workflow.graphEmpty')}
          action={<Button size="small" onClick={() => void workflowQuery.refetch()}>{t('workflow.refresh')}</Button>}
        />
      );
    }
    const nodes = view.graph.workflow.nodes;
    return (
      <>
        <div className="aw-workflow-stage">
          <div className="aw-workflow-canvas-wrap">
            <div className="aw-workflow-canvas-head">
              <span className="aw-workflow-canvas-title">{t('workflow.canvasLabel')}</span>
              <span className="aw-workflow-canvas-count">
                {t('workflow.memberCount', { count: nodes.filter(node => node.kind === 'MEMBER').length })}
                {t('workflow.referenceSeparator')}{t('workflow.transitionCount', { count: view.graph.workflow.edges.length })}
              </span>
              <Segmented
                aria-label={t('workflow.viewMode')}
                value={mode}
                onChange={(next) => { setMode(next as WorkflowViewMode); setSelection(null); }}
                options={[{ value: 'main', label: t('workflow.mainPath') }, { value: 'all', label: t('workflow.allPaths') }]}
              />
              <Button size="small" icon={<AimOutlined aria-hidden="true" />} onClick={() => canvasControlsRef.current?.fit()}>
                {t('workflow.fitView')}
              </Button>
            </div>
            <WorkflowGraphCanvas
              graph={view.graph}
              mode={mode}
              onSelect={setSelection}
              selection={selection}
              controlsRef={canvasControlsRef}
            />
            <div className="aw-workflow-legend" aria-label={t('workflow.legend')}>
              <span className="aw-workflow-legend-item"><i className="aw-workflow-legend-line" />{t('workflow.kinds.HANDOFF')}</span>
              <span className="aw-workflow-legend-item"><i className="aw-workflow-legend-line aw-workflow-legend-rework" />{t('workflow.kinds.REWORK')}</span>
              <span className="aw-workflow-legend-item"><i className="aw-workflow-legend-line aw-workflow-legend-escalation" />{t('workflow.kinds.ESCALATION')}</span>
              <span className="aw-workflow-legend-item">
                <span className="aw-workflow-legend-tag">{t('workflow.humanIntervention')}</span>
                {t('workflow.humanNode')}
              </span>
              <span className="aw-workflow-legend-hint">{t('workflow.graphHint')}</span>
            </div>
          </div>
          <WorkflowDetails graph={view.graph} selection={selection} onSelect={setSelection} />
        </div>
        <p className="aw-workflow-note">
          <AwStrokeIcon name="help" size={12} />
          <span>{t('workflow.staticNote')}</span>
          {view.generatedAt && <span className="aw-workflow-note-time">{t('workflow.generatedAt', { time: formatDateTime(view.generatedAt) })}</span>}
        </p>
        <WorkflowFindings graph={view.graph} />
      </>
    );
  };

  return (
    <div data-testid="squad-workflow-panel" className="aw-workflow-panel">
      <div className="aw-workflow-toolbar">
        <Select
          showSearch
          optionFilterProp="label"
          loading={squadsLoading}
          options={options}
          value={squadId}
          onChange={(next: number) => setSquadId(next)}
          placeholder={t('workflow.selectSquad')}
          aria-label={t('workflow.selectSquad')}
        />
        <Button icon={<AwStrokeIcon name="refresh" />} onClick={() => { if (squadId != null) void workflowQuery.refetch(); }}>
          {t('workflow.refresh')}
        </Button>
      </div>
      <p className="aw-workflow-hint">{t('workflow.selectHint')}</p>
      {content()}
    </div>
  );
}
