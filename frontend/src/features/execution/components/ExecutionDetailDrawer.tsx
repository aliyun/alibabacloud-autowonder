import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/shared/i18n/format';
import { Drawer, Alert, Button, Empty, Space, Spin } from 'antd';
import { CloseCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from '../hooks';
import { statusMeta, HAPPY_PATH, FAILURE_STATES } from '../statusMeta';
import { StatusTag } from '@/shared/ui/StatusTag';
import { AiIdentity } from '@/shared/ui/AiIdentity';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { MarkdownView } from '@/shared/ui/MarkdownView';
import './executionDetailDrawer.css';

interface Props {
  dispatchId: number | null;
  open: boolean;
  onClose: () => void;
}

export function ExecutionDetailDrawer({ dispatchId, open, onClose }: Props) {
  const { t } = useTranslation('execution');
  const navigate = useNavigate();
  const { data, isLoading } = useDispatch(open ? dispatchId : null);

  const currentIdx = data ? HAPPY_PATH.indexOf(data.status) : -1;
  const isFailure = data ? FAILURE_STATES.includes(data.status) : false;
  const meta = data ? statusMeta(data.status) : null;

  // 六步时间线按源码 HAPPY_PATH 原序渲染；失败态在时间线后追加错误节点。
  const steps = HAPPY_PATH.map((s, i) => {
    const reached = currentIdx >= 0 && i <= currentIdx;
    const running = !isFailure && i === currentIdx;
    const state = running ? ' run' : reached ? ' done' : '';
    return (
      <div key={s} className={`exec-step${state}`}>
        <span className="nd" aria-hidden="true" />
        <span className="st">{statusMeta(s).label}</span>
      </div>
    );
  });
  if (isFailure && data) {
    steps.push(
      <div key={data.status} className="exec-step fail">
        <span className="nd" aria-hidden="true" />
        <span className="st">{statusMeta(data.status).label}</span>
      </div>,
    );
  }

  return (
    <Drawer
      title={
        <span className="exec-drawer-title-row">
          <span className="exec-drawer-title">{data ? t('detail.titleWithId', { id: data.id }) : t('detail.title')}</span>
          {meta ? <StatusTag dot label={meta.label} colorKey={meta.color} /> : null}
        </span>
      }
      width={640}
      open={open}
      onClose={onClose}
      closable={{ closeIcon: <AwStrokeIcon name="x" />, 'aria-label': t('detail.close') }}
      maskClosable
      footer={
        <Space>
          <Button
            type="primary"
            disabled={!data?.workitemId}
            onClick={() => { if (data?.workitemId) navigate(`/workitems/${data.workitemId}`); }}
          >
            {t('detail.openWorkitem')}
          </Button>
          <Button disabled={!data?.agentId} onClick={() => { if (data?.agentId) navigate(`/agents/${data.agentId}`); }}>
            {t('detail.viewAgent')}
          </Button>
        </Space>
      }
    >
      {isLoading || !data ? (
        <div className="exec-drawer-loading">
          <Spin aria-label={t('detail.loading')} />
        </div>
      ) : (
        <>
          <div className="exec-drawer-sec">
            <div className="exec-steps">{steps}</div>
          </div>

          {data.error ? (
            <div className="exec-drawer-sec">
              <Alert type="error" message={t('detail.error')} description={data.error} showIcon icon={<CloseCircleOutlined aria-hidden="true" />} />
            </div>
          ) : null}

          <div className="exec-drawer-sec">
            <div className="exec-kv-list">
              <span className="k">{t('detail.workitem')}</span>
              <span className="v">{data.workitemId ? (
                <a
                  title={`#${data.workitemId} ${data.workitemTitle}`}
                  onClick={() => navigate(`/workitems/${data.workitemId}`)}
                >
                  #{data.workitemId} {data.workitemTitle}
                </a>
              ) : (
                t('detail.emptyValue')
              )}</span>
              <span className="k">{t('detail.step')}</span>
              <span className="v">{data.sdlcStepId ?? t('detail.emptyValue')}</span>
              <span className="k">{t('detail.agent')}</span>
              <span className="v">{data.agentName ? (
                <span className="exec-agent-cell">
                  <AiIdentity name={data.agentName} avatar icon size="sm" />
                  {' '}
                  {data.agentVersionNo ? (
                    <StatusTag colorKey="outline" size="sm" label={<>v{data.agentVersionNo}</>} />
                  ) : null}
                </span>
              ) : (
                t('detail.emptyValue')
              )}</span>
              <span className="k">{t('detail.executor')}</span>
              <span className="v">{data.executorName ? <AiIdentity name={data.executorName} avatar size="sm" /> : t('detail.emptyValue')}</span>
              <span className="k">{t('detail.attempt')}</span>
              <span className="v">{data.attempt ?? t('detail.emptyValue')}</span>
              <span className="k">{t('detail.status')}</span>
              <span className="v">{meta ? <StatusTag dot label={meta.label} colorKey={meta.color} /> : null}</span>
            </div>
          </div>

          <div className="exec-drawer-sec">
            <div className="sec-t">{t('detail.summary')}</div>
            <div className="exec-result-summary">
              {data.resultSummary ? <MarkdownView content={data.resultSummary} /> : t('detail.emptyValue')}
            </div>
          </div>

          <div className="exec-drawer-sec">
            <div className="sec-t">{t('detail.artifacts', { count: data.artifacts?.length ?? 0, total: formatNumber(data.artifacts?.length ?? 0) })}</div>
            {data.artifacts && data.artifacts.length > 0 ? (
              <div>
                {data.artifacts.map((a) => (
                  <div key={a.id} className="exec-artifact-item">
                    <StatusTag colorKey="outline" size="sm" label={a.type} />
                    <span className="exec-artifact-name">{a.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('detail.noArtifacts')} />
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}
