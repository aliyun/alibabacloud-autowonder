import { Trans, useTranslation } from 'react-i18next';
import { i18n } from '@/shared/i18n';
import { useState } from 'react';
import { Button, Input, Modal, Space, Tag, Typography, message } from 'antd';
import { StopOutlined } from '@ant-design/icons';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import { NoticeTip } from '@/shared/ui/NoticeTip';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/shared/auth/store';
import { deleteMyAccount } from './profileApi';

const { Text } = Typography;

function getApiMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function DeactivationPanel() {
  const { t } = useTranslation('profile');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmInput, setConfirmInput] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const username = useAuthStore((s) => s.user?.username ?? '');
  const clear = useAuthStore((s) => s.clear);

  const deleteMutation = useMutation({
    mutationFn: () => deleteMyAccount(confirmInput),
    onSuccess: () => {
      message.success(i18n.t('profile:deactivation.deleted'));
      setModalOpen(false);
      setConfirmInput('');
      clear();
      queryClient.clear();
      navigate('/login');
    },
    onError: (error) => {
      message.error(getApiMessage(error, i18n.t('profile:deactivation.deleteFailed')));
    },
  });

  return (
    <section className="aw-card prof-panel" aria-label={t('deactivation.title')}>
      <div className="prof-sec-head">
        <div className="prof-sec-head-text">
          <b>{t('deactivation.title')}</b>
          <div className="prof-sec-desc">{t('deactivation.desc')}</div>
        </div>
        <div className="prof-sec-extra">
          <Tag color="red">{t('deactivation.dangerTag')}</Tag>
        </div>
      </div>
      <div className="prof-sec-body">
        <div className="prof-danger-zone">
          <NoticeTip
            kind="warning"
            title={t('deactivation.warning')}
            detail={t('deactivation.notice')}
          />
          <ul className="prof-rules">
            {[t('deactivation.rule1'), t('deactivation.rule2'), t('deactivation.rule3')].map((rule, index) => (
              <li key={rule}>
                <b>{index + 1}</b>
                <span>{rule.replace(/^\d+\.\s*/, '')}</span>
              </li>
            ))}
          </ul>
          <div className="prof-actions" style={{ borderTop: 'none', paddingTop: 14, marginTop: 4 }}>
            <span className="prof-actions-left prof-foot-hint">{t('deactivation.confirmHint')}</span>
            <Button aria-label={t('deactivation.request')}
              danger
              icon={<StopOutlined aria-hidden="true" />}
              onClick={() => setModalOpen(true)}
            >{t('deactivation.request')}</Button>
          </div>
        </div>
      </div>

      <Modal
        closable={{ closeIcon: <AwStrokeIcon name="x" />, 'aria-label': t('close') }}
        title={t('deactivation.confirmTitle')}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setConfirmInput(''); }}
        footer={null}
        destroyOnClose
      >
        <NoticeTip
          kind="warning"
          title={t('deactivation.warning')}
          detail={(
            <Space direction="vertical" size={4}>
              <Text>{t('deactivation.rule1')}</Text>
              <Text>{t('deactivation.rule2')}</Text>
              <Text>{t('deactivation.rule3')}</Text>
            </Space>
          )}
          style={{ marginBottom: 16 }}
        />
        <Text><Trans t={t} i18nKey="deactivation.confirmPrompt" components={{ identity: <Text strong>{username || t('deactivation.unavailable')}</Text> }} /></Text>
        <Input
          style={{ marginTop: 8 }}
          placeholder={t('deactivation.username')}
          aria-label={t('deactivation.username')}
          value={confirmInput}
          onChange={(e) => setConfirmInput(e.target.value)}
          onPressEnter={() => {
            if (username && confirmInput === username && !deleteMutation.isPending) deleteMutation.mutate();
          }}
        />
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Space>
            <Button aria-label={t('cancel')} onClick={() => { setModalOpen(false); setConfirmInput(''); }}>{t('cancel')}</Button>
            <Button aria-label={t('deactivation.confirm')}
              danger
              type="primary"
              disabled={confirmInput !== username || !username}
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >{t('deactivation.confirm')}</Button>
          </Space>
        </div>
      </Modal>
    </section>
  );
}
