import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Button, Form, Input, Modal, message } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { i18n } from '@/shared/i18n';
import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { RepoListPage } from './RepoListPage';
import { RepoMapPage } from './RepoMapPage';
import { createRepo } from './api';
import { isValidRepoName, isValidRepoUrl, repoNameInvalidMessage } from './repoNameValidation';
import { useAccessCommand } from '@/shared/auth/useAccessCommand';
import { HubPageShell, resolveHubTab, useHubTabParam } from '@/shared/ui/HubPage';

export const REPOS_HUB_TAB_KEYS = ['list', 'map'] as const;
export const DEFAULT_REPOS_HUB_TAB = 'list';

export function resolveReposHubTab(tabParam: string | null): string {
  return resolveHubTab(tabParam, REPOS_HUB_TAB_KEYS, DEFAULT_REPOS_HUB_TAB);
}

export function ReposHubPage() {
  const { t } = useTranslation('repo');
  const { activeTab, setTab } = useHubTabParam(REPOS_HUB_TAB_KEYS, DEFAULT_REPOS_HUB_TAB);
  const queryClient = useQueryClient();
  const runWithAccess = useAccessCommand();
  const [form] = Form.useForm();
  const [createOpen, setCreateOpen] = useState(false);
  useLocalizedValidation(form, createOpen);

  // 原型 15 页头 actions：新建主按钮 + Modal 常驻 hub 层，列表 tab 只保留表格。
  const createMutation = useMutation({
    mutationFn: createRepo,
    onSuccess: () => {
      message.success(i18n.t('repo:feedback.added'));
      setCreateOpen(false);
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
    onError: (error: Error) => {
      message.error(error.message || i18n.t('repo:errors.addRepo'));
    },
  });

  const handleCreateRepo = async () => {
    await runWithAccess('READ_WRITE', t('actions.addRepo'), async () => {
      // 校验失败时 antd 已在表单项下方展示错误信息，这里吞掉拒绝避免未处理 Promise。
      const values = await form.validateFields().catch(() => null);
      if (values) {
        createMutation.mutate(values);
      }
    });
  };

  return (
    <>
      <HubPageShell
        title={t('hub.title')}
        description={t('hub.hint')}
        actions={(
          <Button
            type="primary"
            icon={<AwStrokeIcon name="plus" />}
            onClick={() => runWithAccess('READ_WRITE', t('actions.addRepo'), () => setCreateOpen(true))}
          >
            {t('actions.addRepo')}
          </Button>
        )}
        activeTab={activeTab}
        onTabChange={setTab}
        items={[
          { key: 'list', label: t('hub.tabList'), children: <RepoListPage /> },
          { key: 'map', label: t('hub.tabMap'), children: <RepoMapPage /> },
        ]}
      />
      <Modal
        title={t('actions.addRepo')}
        open={createOpen}
        okText={t('actions.create')}
        cancelText={t('actions.cancel')}
        confirmLoading={createMutation.isPending}
        onOk={handleCreateRepo}
        onCancel={() => {
          setCreateOpen(false);
          form.resetFields();
        }}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
        >
          <Form.Item
            label={t('fields.repoName')}
            name="name"
            extra={t('form.nameHelp')}
            rules={[
              { required: true, message: t('validation.nameRequired') },
              {
                validator: (_, value) => (
                  isValidRepoName(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error(repoNameInvalidMessage()))
                ),
              },
            ]}
          >
            <Input placeholder="auto-wonder" />
          </Form.Item>
          <Form.Item
            label={t('fields.repoUrl')}
            name="url"
            rules={[
              { required: true, message: t('validation.urlRequired') },
              {
                validator: (_, value) => (
                  isValidRepoUrl(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('validation.urlInvalid')))
                ),
              },
            ]}
          >
            <Input placeholder={t('placeholders.urlExample')} />
          </Form.Item>
          <Form.Item label={t('fields.branch')} name="defaultBranch">
            <Input placeholder={t('placeholders.branchOptional')} />
          </Form.Item>
          <Form.Item label={t('fields.designBase')} name="designBaseBranch" extra={t('fields.designBaseHint')}>
            <Input maxLength={128} />
          </Form.Item>
          <Form.Item label={t('fields.description')} name="description">
            <Input placeholder={t('placeholders.repoDescription')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
