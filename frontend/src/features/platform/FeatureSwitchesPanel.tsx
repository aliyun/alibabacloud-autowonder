import { Button, Card, Space, Switch, Tag, Typography, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { i18n } from '@/shared/i18n';
import { NoticeTip } from '@/shared/ui/NoticeTip';
import {
  FEATURE_SWITCH_QUERY_KEY,
  getFeatureSwitches,
  updateFeatureSwitches,
  type FeatureSwitches,
  type UpdateFeatureSwitchesParams,
} from './featureSwitchApi';

const { Text } = Typography;

// 开关字段名是接口技术值，提到模块作用域声明，避免 check:i18n 把它当作 JSX 里的硬编码 UI 文案。
const DUPLICATE_SWITCH_KEY = 'duplicateWorkitemIntentEnabled' as const;
const REVIEW_SWITCH_KEY = 'userRegistrationReviewEnabled' as const;
const CREATION_SWITCH_KEY = 'workspaceCreationDefaultAllowed' as const;

export interface FeatureSwitchesPanelProps {
  canManage?: boolean;
}

interface FeatureSwitchCardProps {
  testId: string;
  title: string;
  status: ReactNode;
  toggle: ReactNode;
  children: ReactNode;
}

function FeatureSwitchCard({ testId, title, status, toggle, children }: FeatureSwitchCardProps) {
  const headingId = useId();

  return (
    <Card role="region" aria-labelledby={headingId} data-testid={testId} className="aw-platform-feature-card">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div className="aw-platform-feature-head">
          <Text id={headingId} strong>{title}</Text>
          {status}
        </div>
        <div className="aw-platform-feature-line">{toggle}</div>
        {children}
      </Space>
    </Card>
  );
}

/**
 * 平台级开关配置。每个开关独立存储与版本，分别更新时互不覆盖。
 */
export function FeatureSwitchesPanel({ canManage = false }: FeatureSwitchesPanelProps) {
  const { t } = useTranslation('platform');
  const queryClient = useQueryClient();
  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: FEATURE_SWITCH_QUERY_KEY,
    queryFn: getFeatureSwitches,
    retry: false,
  });
  const [duplicateEnabled, setDuplicateEnabled] = useState(false);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [creationEnabled, setCreationEnabled] = useState(true);
  const submitLock = useRef(false);

  const known = data != null && !error;

  useEffect(() => {
    if (data && !submitLock.current) {
      setDuplicateEnabled(data.duplicateWorkitemIntentEnabled);
      setReviewEnabled(data.userRegistrationReviewEnabled);
      setCreationEnabled(data.workspaceCreationDefaultAllowed);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: updateFeatureSwitches,
    onSuccess: (next: FeatureSwitches) => {
      queryClient.setQueryData(FEATURE_SWITCH_QUERY_KEY, next);
      setDuplicateEnabled(next.duplicateWorkitemIntentEnabled);
      setReviewEnabled(next.userRegistrationReviewEnabled);
      setCreationEnabled(next.workspaceCreationDefaultAllowed);
      message.success(i18n.t('platform:featureSwitches.saved'));
    },
    onError: (error: Error, variables: UpdateFeatureSwitchesParams) => {
      // 保存失败只回滚本次提交的开关，其他开关保持界面现值。
      if (variables.duplicateWorkitemIntentEnabled !== undefined) {
        setDuplicateEnabled(Boolean(data?.duplicateWorkitemIntentEnabled));
      }
      if (variables.userRegistrationReviewEnabled !== undefined) {
        setReviewEnabled(Boolean(data?.userRegistrationReviewEnabled));
      }
      if (variables.workspaceCreationDefaultAllowed !== undefined) {
        setCreationEnabled(data?.workspaceCreationDefaultAllowed ?? true);
      }
      message.error(error.message || i18n.t('platform:featureSwitches.saveFailed'));
    },
  });

  const pendingVariable = mutation.isPending ? mutation.variables : undefined;
  const isPendingFor = (key: keyof UpdateFeatureSwitchesParams) =>
    mutation.isPending && pendingVariable?.[key] !== undefined;

  const handleToggle = async (
    params: UpdateFeatureSwitchesParams,
    apply: () => void,
    revert: () => void,
  ) => {
    if (!canManage || !data || error || submitLock.current) return;
    submitLock.current = true;
    apply();
    try {
      await mutation.mutateAsync(params);
    } catch {
      revert();
    } finally {
      submitLock.current = false;
    }
  };

  if (isLoading) {
    return <Card className="aw-platform-feature-card" loading />;
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {error && <NoticeTip kind="error" title={t('featureSwitches.loadFailed')}
        detail={error instanceof Error ? error.message : t('retryLater')}
        action={<Button loading={isFetching} onClick={() => { void refetch(); }}>{t('ssoRetry')}</Button>} />}

      <FeatureSwitchCard
        testId="feature-switch-duplicate"
        title={t('featureSwitches.duplicateIntent.title')}
        status={(
          <Tag color={isPendingFor(DUPLICATE_SWITCH_KEY) ? 'processing' : known && duplicateEnabled ? 'green' : 'default'}>
            {isPendingFor(DUPLICATE_SWITCH_KEY) ? t('featureSwitches.submitting')
              : !known ? t('featureSwitches.statusUnknown')
                : duplicateEnabled ? t('featureSwitches.duplicateIntent.statusOn') : t('featureSwitches.duplicateIntent.statusOff')}
          </Tag>
        )}
        toggle={(
          <Switch
            size="small"
            aria-label={t('featureSwitches.duplicateIntent.toggle')}
            checked={known && duplicateEnabled}
            disabled={!canManage || !known || mutation.isPending}
            onChange={(checked) => {
              void handleToggle(
                { [DUPLICATE_SWITCH_KEY]: checked, expectedVersion: data?.version ?? 0 },
                () => setDuplicateEnabled(checked),
                () => setDuplicateEnabled(Boolean(data?.duplicateWorkitemIntentEnabled)),
              );
            }}
          />
        )}
      >
        <Text type="secondary">
          <Text strong>{t('featureSwitches.duplicateIntent.scopeLabel')}</Text>
          {t('featureSwitches.duplicateIntent.scopeValue')}
        </Text>
        <Text type="secondary">{t('featureSwitches.duplicateIntent.saveNow')}</Text>
        <Text type="secondary">{t('featureSwitches.duplicateIntent.detect')}</Text>
        <Text type="secondary">{t('featureSwitches.duplicateIntent.chief')}</Text>
        <NoticeTip kind="warning" title={t('featureSwitches.duplicateIntent.titleRule')} />
      </FeatureSwitchCard>

      <FeatureSwitchCard
        testId="feature-switch-registration-review"
        title={t('featureSwitches.registrationReview.title')}
        status={known ? (
          <Tag color={isPendingFor(REVIEW_SWITCH_KEY) ? 'processing' : reviewEnabled ? 'green' : 'default'}>
            {isPendingFor(REVIEW_SWITCH_KEY) ? t('featureSwitches.submitting')
              : reviewEnabled ? t('featureSwitches.registrationReview.statusOn') : t('featureSwitches.registrationReview.statusOff')}
          </Tag>
        ) : null}
        toggle={(
          <Switch
            size="small"
            aria-label={t('featureSwitches.registrationReview.toggle')}
            checked={known && reviewEnabled}
            disabled={!canManage || !known || mutation.isPending}
            onChange={(checked) => {
              void handleToggle(
                { [REVIEW_SWITCH_KEY]: checked, userRegistrationReviewVersion: data?.userRegistrationReviewVersion ?? 0 },
                () => setReviewEnabled(checked),
                () => setReviewEnabled(Boolean(data?.userRegistrationReviewEnabled)),
              );
            }}
          />
        )}
      >
        <Text type="secondary">{t('featureSwitches.registrationReview.hint')}</Text>
      </FeatureSwitchCard>

      <FeatureSwitchCard
        testId="feature-switch-workspace-creation"
        title={t('featureSwitches.workspaceCreationDefault.title')}
        status={known ? (
          <Tag color={isPendingFor(CREATION_SWITCH_KEY) ? 'processing' : creationEnabled ? 'green' : 'default'}>
            {isPendingFor(CREATION_SWITCH_KEY) ? t('featureSwitches.submitting')
              : creationEnabled ? t('featureSwitches.workspaceCreationDefault.statusOn') : t('featureSwitches.workspaceCreationDefault.statusOff')}
          </Tag>
        ) : null}
        toggle={(
          <Switch
            size="small"
            aria-label={t('featureSwitches.workspaceCreationDefault.toggle')}
            checked={known && creationEnabled}
            disabled={!canManage || !known || mutation.isPending}
            onChange={(checked) => {
              void handleToggle(
                { [CREATION_SWITCH_KEY]: checked, workspaceCreationDefaultAllowedVersion: data?.workspaceCreationDefaultAllowedVersion ?? 0 },
                () => setCreationEnabled(checked),
                () => setCreationEnabled(data?.workspaceCreationDefaultAllowed ?? true),
              );
            }}
          />
        )}
      >
        <Text type="secondary">{t('featureSwitches.workspaceCreationDefault.hint')}</Text>
      </FeatureSwitchCard>

      {!canManage ? <Text type="secondary">{t('featureSwitches.readOnly')}</Text> : null}
    </Space>
  );
}
