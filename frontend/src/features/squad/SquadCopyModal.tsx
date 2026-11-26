import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { Alert, Button, Checkbox, Empty, Input, Modal, Pagination, Spin, Tag } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError } from '@/shared/types/common';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { checkSquadCopy, copySquadToWorkspaces, listSquadCopyTargets } from './api';
import type { Squad, SquadCopyTarget, SquadCopyTargetResult } from './api';

const TARGET_PAGE_SIZE = 10;
const KEYWORD_DEBOUNCE_MS = 300;

// 每个“用户明确的复制意图”绑定一个请求标识：同一意图重发（响应丢失后再次确认）由服务端幂等回放，
// 关闭弹窗后重新发起才是新操作。
function newRequestId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `squad-copy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface SquadCopyModalProps {
  squad: Squad | null;
  onClose: () => void;
}

export function SquadCopyModal({ squad, onClose }: SquadCopyModalProps) {
  const { t } = useTranslation('squad');
  const squadId = squad?.id ?? null;
  const open = squadId !== null;

  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  // 已选目标独立于当前页与搜索词保存，翻页/改词不会丢选择。
  const [selected, setSelected] = useState<Map<number, string>>(new Map());
  // 第二次确认的目标集合与请求标识；非空即确认弹窗打开。
  const [pending, setPending] = useState<{ requestId: string; ids: number[] } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [results, setResults] = useState<SquadCopyTargetResult[] | null>(null);
  const [retryIds, setRetryIds] = useState<number[]>([]);

  useEffect(() => {
    setKeyword('');
    setPage(1);
    setSelected(new Map());
    setPending(null);
    setSubmitError(null);
    setResults(null);
    setRetryIds([]);
  }, [squadId]);

  const debouncedKeyword = useDebouncedValue(keyword, KEYWORD_DEBOUNCE_MS);

  const checkQuery = useQuery({
    queryKey: ['squad-copy-check', squadId],
    queryFn: () => checkSquadCopy(squadId as number),
    enabled: open,
  });
  const eligible = checkQuery.data?.eligible === true;
  const missingOnlineVersions = checkQuery.data?.missingOnlineVersions ?? [];
  const missingDependencies = checkQuery.data?.missingDependencies ?? [];

  // 服务端依赖引用形如 agent#42 / skill#7 / plugin#name，这里转成可读文案；未知种类原样展示。
  const dependencyLabel = (reference: string) => {
    const separator = reference.indexOf('#');
    const kind = separator < 0 ? '' : reference.slice(0, separator);
    const value = separator < 0 ? reference : reference.slice(separator + 1);
    switch (kind) {
      case 'agent':
        return t('copyDependencyAgent', { value });
      case 'skill':
        return t('copyDependencySkill', { value });
      case 'plugin':
        return t('copyDependencyPlugin', { value });
      case 'environment_variable':
        return t('copyDependencyEnvironmentVariable', { value });
      case 'sdlc':
        return t('copyDependencySdlc', { value });
      default:
        return reference;
    }
  };

  const targetsQuery = useQuery({
    queryKey: ['squad-copy-targets', squadId, debouncedKeyword, page],
    queryFn: () => listSquadCopyTargets(squadId as number, {
      keyword: debouncedKeyword,
      pageNum: page,
      pageSize: TARGET_PAGE_SIZE,
    }),
    enabled: open && eligible,
  });

  const copyMut = useMutation({
    mutationFn: (payload: { requestId: string; targetWorkspaceIds: number[] }) =>
      copySquadToWorkspaces(squadId as number, payload),
    onSuccess: (resp) => {
      setResults((prev) => {
        if (!prev) return resp.results;
        // 重试只覆盖本次重试的目标，成功副本的结果保持原样。
        const fresh = new Map(resp.results.map((item) => [item.workspaceId, item]));
        return prev.map((item) => fresh.get(item.workspaceId) ?? item);
      });
      setRetryIds([]);
      setPending(null);
      setSubmitError(null);
    },
    onError: (error) => {
      setSubmitError(error instanceof ApiError ? error.message : t('copySubmitFailed'));
    },
  });

  const targets = targetsQuery.data?.list ?? [];
  const total = targetsQuery.data?.total ?? 0;

  const toggleSelection = (id: number, name: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (checked) {
        next.set(id, name);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const nameById = useMemo(() => {
    const names = new Map<number, string>(selected);
    results?.forEach((item) => names.set(item.workspaceId, item.workspaceName));
    return names;
  }, [selected, results]);

  const pendingNames = pending
    ? pending.ids.map((id) => nameById.get(id) ?? i18n.t('squadFallback', { ns: 'squad', id }))
    : [];
  const failedResults = results?.filter((item) => !item.success) ?? [];

  const openConfirm = (ids: number[]) => {
    if (ids.length === 0 || copyMut.isPending) return;
    setSubmitError(null);
    setPending({ requestId: newRequestId(), ids });
  };

  const submitCopy = () => {
    if (!pending || copyMut.isPending) return;
    setSubmitError(null);
    copyMut.mutate({ requestId: pending.requestId, targetWorkspaceIds: pending.ids });
  };

  const succeededCount = results ? results.length - failedResults.length : 0;
  const chipCloseIcon = <span><AwStrokeIcon name="x" size={10} /></span>;

  return (
    <>
      <Modal
        className="squad-sm-modal"
        closable={{ 'aria-label': t('close'), closeIcon: <AwStrokeIcon name="x" /> }}
        title={results ? t('copyResultTitle') : t('copyToWorkspace')}
        open={open}
        onCancel={onClose}
        footer={null}
        width={640}
      >
        <div className="squad-sm-sub">
          {results
            ? t('copyResultSummary', { success: succeededCount, failed: failedResults.length })
            : t('copyConfirmSourceLine', { name: squad?.name ?? '' })}
        </div>
        {checkQuery.isLoading ? (
          <div className="squad-detail-loading">
            <Spin aria-label={t('loading')} />
          </div>
        ) : checkQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message={t('copyCheckFailed')}
            action={(
              <Button size="small" icon={<AwStrokeIcon name="refresh" />} onClick={() => checkQuery.refetch()}>
                {t('copyRetryCheck')}
              </Button>
            )}
          />
        ) : !eligible ? (
          <div data-testid="copy-blocked">
            {missingOnlineVersions.length > 0 ? (
              <div className="squad-blk-group">
                <Alert type="error" showIcon message={t('copyIneligible')} />
                <div className="squad-blk-list" data-testid="copy-blocked-list">
                  {missingOnlineVersions.map((item) => (
                    <div key={item.agentId} className="squad-blk-row">
                      <span className="squad-member-avatar" aria-hidden>{(item.agentName ?? '').slice(0, 2)}</span>
                      <span>{item.agentName}</span>
                    </div>
                  ))}
                </div>
                <div className="squad-blk-hint">{t('copyIneligibleHint')}</div>
              </div>
            ) : null}
            {missingDependencies.length > 0 ? (
              <div className="squad-blk-group" data-testid="copy-blocked-dependencies">
                <Alert type="error" showIcon message={t('copyDependenciesMissing')} />
                <div className="squad-blk-list" data-testid="copy-blocked-dependencies-list">
                  {missingDependencies.map((reference) => (
                    <div key={reference} className="squad-blk-row">{dependencyLabel(reference)}</div>
                  ))}
                </div>
                <div className="squad-blk-hint">{t('copyDependenciesMissingHint')}</div>
              </div>
            ) : null}
          </div>
        ) : results ? (
          <div>
            <div className="squad-cp-list squad-cp-list--flush">
              {results.map((item) => {
                const retrying = retryIds.includes(item.workspaceId);
                return (
                  <div
                    key={item.workspaceId}
                    data-testid={`copy-result-${item.workspaceId}`}
                    className={`squad-cp-row is-static${retrying ? ' is-sel' : ''}`}
                  >
                    {item.success ? null : (
                      <Checkbox
                        aria-label={t('copyRetrySelect', { name: item.workspaceName })}
                        checked={retrying}
                        onChange={(event) => setRetryIds((prev) => (
                          event.target.checked
                            ? [...prev, item.workspaceId]
                            : prev.filter((id) => id !== item.workspaceId)
                        ))}
                      />
                    )}
                    <div className="squad-cp-tx">
                      <div className="squad-cp-nm">{item.workspaceName}</div>
                      {item.success ? (
                        <div className="squad-cp-ds">
                          <a className="squad-text-link" href={`/squads?squadId=${item.squadId}&workspaceId=${item.workspaceId}`}>
                            {t('copyResultSquadLink', { id: item.squadId ?? '' })}
                          </a>
                        </div>
                      ) : (
                        <div className="squad-cp-err">{item.message || item.errorCode}</div>
                      )}
                    </div>
                    <span className="squad-cp-end">
                      {item.success
                        ? <Tag color="green">{t('copyResultSuccess')}</Tag>
                        : <Tag color="red">{t('copyResultFailed')}</Tag>}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="squad-sm-foot">
              <span className="squad-sm-foot-left">
                {failedResults.length > 0 ? t('copyRetryHint') : null}
              </span>
              {failedResults.length > 0 ? (
                <Button disabled={retryIds.length === 0} onClick={() => openConfirm(retryIds)}>
                  {t('copyRetrySelected', { count: retryIds.length })}
                </Button>
              ) : null}
              <Button type="primary" onClick={onClose}>{t('copyDone')}</Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="squad-cp-search">
              <Input
                aria-label={t('copyTargetsSearch')}
                placeholder={t('copyTargetsSearch')}
                prefix={<AwStrokeIcon name="search" />}
                allowClear
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value);
                  // 改搜索词后停留在旧页码会落在空页上。
                  setPage(1);
                }}
              />
              <span className="squad-cp-cnt">{t('copyTargetsTotal', { count: total })}</span>
            </div>

            {targetsQuery.isLoading ? (
              <div className="squad-detail-loading">
                <Spin aria-label={t('loading')} />
              </div>
            ) : targets.length === 0 ? (
              <Empty
                description={debouncedKeyword.trim()
                  ? t('copyTargetsNoMatch', { keyword: debouncedKeyword.trim() })
                  : t('copyTargetsEmpty')}
              />
            ) : (
              <div className="squad-cp-list">
                {targets.map((target: SquadCopyTarget) => {
                  const checked = selected.has(target.id);
                  return (
                    <div key={target.id} className={`squad-cp-row${checked ? ' is-sel' : ''}`}>
                      <Checkbox
                        aria-label={target.name}
                        checked={checked}
                        onChange={(event) => toggleSelection(target.id, target.name, event.target.checked)}
                      />
                      {/* 点击行文本同样切换选择；antd Checkbox 自带 label，行容器不能再用 label 包裹。 */}
                      <div
                        className="squad-cp-tx"
                        onClick={() => toggleSelection(target.id, target.name, !checked)}
                      >
                        <div className="squad-cp-nm">{target.name}</div>
                        <div className="squad-cp-ds">{target.description || t('noDescription')}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {total > TARGET_PAGE_SIZE ? (
              <div className="squad-cp-pager">
                <Pagination
                  size="small"
                  current={page}
                  pageSize={TARGET_PAGE_SIZE}
                  total={total}
                  showSizeChanger={false}
                  onChange={setPage}
                />
              </div>
            ) : null}

            <div data-testid="copy-selected-summary">
              {selected.size > 0 ? (
                <div className="squad-chips">
                  {Array.from(selected.entries()).map(([id, name]) => (
                    <Tag key={id} closable closeIcon={chipCloseIcon} onClose={() => toggleSelection(id, name, false)}>{name}</Tag>
                  ))}
                </div>
              ) : null}
              <div className="squad-sm-foot">
                <span className="squad-sm-foot-left">
                  <Trans t={t} ns="squad" i18nKey="copySelectedCount" count={selected.size} components={{ number: <b /> }} />
                </span>
                <Button onClick={onClose}>{t('cancel')}</Button>
                <Button type="primary" disabled={selected.size === 0} onClick={() => openConfirm(Array.from(selected.keys()))}>
                  {t('copyConfirmAction')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        className="squad-sm-modal"
        closable={copyMut.isPending ? false : { 'aria-label': t('close'), closeIcon: <AwStrokeIcon name="x" /> }}
        title={t('copyConfirmTitle')}
        open={pending !== null}
        width={480}
        okText={t('copyConfirmAction')}
        cancelText={t('cancel')}
        confirmLoading={copyMut.isPending}
        cancelButtonProps={{ disabled: copyMut.isPending }}
        maskClosable={false}
        onOk={submitCopy}
        onCancel={() => {
          if (copyMut.isPending) return;
          setPending(null);
          setSubmitError(null);
        }}
      >
        <div className="squad-cf-kv">
          <div className="squad-cf-k">{t('copySource')}</div>
          <div className="squad-cf-v">{squad?.name ?? ''}</div>
          <div className="squad-cf-k">{t('copyConfirmTargets')}</div>
          <div className="squad-cf-v">
            <div className="squad-chips">
              {pendingNames.map((name) => <Tag key={name} className="squad-chip-plain">{name}</Tag>)}
            </div>
          </div>
          <div className="squad-cf-k">{t('copyConfirmScope')}</div>
          <div className="squad-cf-v">
            <ul>
              <li>{t('copyConfirmScopeValue')}</li>
              <li>{t('copyConfirmReposExcluded')}</li>
              <li>{t('copyConfirmAgentsOnline')}</li>
              <li>{t('copyConfirmExecutorRestart')}</li>
            </ul>
          </div>
        </div>
        {copyMut.isPending ? <div className="squad-cf-status"><Spin aria-label={t('copyRunning')} /></div> : null}
        {submitError ? <div className="squad-cf-status"><Alert type="error" showIcon message={submitError} /></div> : null}
      </Modal>
    </>
  );
}
