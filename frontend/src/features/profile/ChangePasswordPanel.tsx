import { useLocalizedValidation } from '@/shared/i18n/useLocalizedValidation';
import { useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { useState } from 'react';
import { Button, Form, Input, message } from 'antd';
import { EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { useMutation } from '@tanstack/react-query';
import { changePassword } from './profileApi';

import { NoticeTip } from '@/shared/ui/NoticeTip';

type PasswordFormValues = {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
};

function getApiMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ChangePasswordPanel() {
  const { t } = useTranslation('profile');
  const [form] = Form.useForm<PasswordFormValues>();
  useLocalizedValidation(form);
  const [successVisible, setSuccessVisible] = useState(false);
  const oldPassword = Form.useWatch('oldPassword', form) ?? '';
  const newPassword = Form.useWatch('newPassword', form) ?? '';
  const confirmPassword = Form.useWatch('confirmPassword', form) ?? '';
  const canSubmit = Boolean(oldPassword && newPassword && confirmPassword);

  const mutation = useMutation({
    mutationFn: async () => {
      const values = await form.validateFields();
      return changePassword({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
    },
    onSuccess: () => {
      form.resetFields();
      setSuccessVisible(true);
      message.success(i18n.t('profile:password.success'));
    },
    onError: (error) => {
      message.error(getApiMessage(error, i18n.t('profile:password.failed')));
    },
  });

  return (
    <section className="aw-card prof-panel" aria-label={t('password.title')}>
      <div className="prof-sec-head">
        <div className="prof-sec-head-text">
          <b>{t('password.submit')}</b>
          <div className="prof-sec-desc">{t('password.desc')}</div>
        </div>
      </div>
      <div className="prof-sec-body">
        <Form
          form={form}
          layout="vertical"
          disabled={mutation.isPending}
          onFinish={() => mutation.mutate()}
        >
        <Form.Item
          label={t('password.current')}
          name="oldPassword"
          rules={[{ required: true, message: t('password.currentRequired') }]}
        >
          <Input.Password
            iconRender={visible => <Button type="text" htmlType="button" aria-label={t(visible ? 'password.hide' : 'password.show')} disabled={mutation.isPending}
              icon={visible ? <EyeOutlined aria-hidden="true" /> : <EyeInvisibleOutlined aria-hidden="true" />} style={{ padding: 0, width: 16, height: 16 }} />}
            prefix={<AwStrokeIcon name="lock" />}
            placeholder={t('password.currentRequired')}
            autoComplete="current-password"
          />
        </Form.Item>

        <Form.Item
          label={t('password.new')}
          name="newPassword"
          rules={[
            { required: true, message: t('password.newRequired') },
            { min: 6, message: t('password.min') },
          ]}
        >
          <Input.Password
            iconRender={visible => <Button type="text" htmlType="button" aria-label={t(visible ? 'password.hide' : 'password.show')} disabled={mutation.isPending}
              icon={visible ? <EyeOutlined aria-hidden="true" /> : <EyeInvisibleOutlined aria-hidden="true" />} style={{ padding: 0, width: 16, height: 16 }} />}
            prefix={<AwStrokeIcon name="lock" />}
            placeholder={t('password.newRequired')}
            autoComplete="new-password"
          />
        </Form.Item>

        <Form.Item
          label={t('password.confirm')}
          name="confirmPassword"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: t('password.confirmRequired') },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error(t('password.mismatch')));
              },
            }),
          ]}
        >
          <Input.Password
            iconRender={visible => <Button type="text" htmlType="button" aria-label={t(visible ? 'password.hide' : 'password.show')} disabled={mutation.isPending}
              icon={visible ? <EyeOutlined aria-hidden="true" /> : <EyeInvisibleOutlined aria-hidden="true" />} style={{ padding: 0, width: 16, height: 16 }} />}
            prefix={<AwStrokeIcon name="lock" />}
            placeholder={t('password.confirmRequired')}
            autoComplete="new-password"
          />
        </Form.Item>

        {successVisible ? (
          <NoticeTip
            kind="success"
            title={t('password.successHint')}
            style={{ marginBottom: 14 }}
          />
        ) : null}

        <div className="prof-actions" style={{ marginTop: 4 }}>
          <Button aria-label={t('password.submit')}
            type="primary"
            htmlType="submit"
            icon={<AwStrokeIcon name="check" />}
            disabled={!canSubmit}
            loading={mutation.isPending}
          >{t('password.submit')}</Button>
        </div>
        </Form>
      </div>
    </section>
  );
}
