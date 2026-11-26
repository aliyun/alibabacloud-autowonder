import { Form, Modal, Radio } from 'antd';
import { useTranslation } from 'react-i18next';
import { DELIVERY_MODE, type PrdDesignVersion } from '../api';

interface ConfirmVersionModalProps {
  open: boolean;
  version: PrdDesignVersion | null;
  confirming: boolean;
  hasTarget: boolean;
  onOk: (deliveryMode: string) => void;
  onCancel: () => void;
}

/**
 * Confirm a specific design version and choose the delivery mode.
 *
 * <p>Confirmation is deliberately separate from starting a delivery: this dialog only records that the
 * reviewer accepts this exact content. The digest carried by the version is the one the reviewer saw,
 * and the server refuses to confirm if it no longer matches. Choosing PRD_DRIVEN is what makes later
 * deliveries enforce this version; LEGACY leaves the workitem on its existing path.
 */
export function ConfirmVersionModal({
  open,
  version,
  confirming,
  hasTarget,
  onOk,
  onCancel,
}: ConfirmVersionModalProps) {
  const { t } = useTranslation('prd');
  const [form] = Form.useForm();

  const prdDrivenDisabled = !hasTarget;

  return (
    <Modal
      open={open}
      title={t('confirm.title')}
      okText={t('confirm.ok')}
      cancelText={t('confirm.cancel')}
      className="prd-confirm-version-modal"
      width={520}
      confirmLoading={confirming}
      onCancel={onCancel}
      onOk={() => {
        void form.validateFields().then((values) => onOk(values.deliveryMode as string));
      }}
      destroyOnHidden
    >
      {version && (
        <div className="prd-confirm-version-content">
          <div className="prd-confirm-version-summary">
            <strong>{t('versionLabel', { versionNo: version.versionNo })}</strong>
            <span>{t('confirm.requirementCountValue', { count: version.requirementCount ?? 0 })}</span>
          </div>

          <Form form={form} layout="vertical" initialValues={{ deliveryMode: DELIVERY_MODE.PRD_DRIVEN }}>
            <Form.Item name="deliveryMode" label={t('confirm.modeLabel')} className="prd-confirm-version-mode">
              <Radio.Group className="prd-confirm-version-options">
                <Radio className="prd-confirm-version-option" value={DELIVERY_MODE.PRD_DRIVEN} disabled={prdDrivenDisabled}>
                  <span className="prd-confirm-version-option-copy">
                    <strong>{t('confirm.modePrdDrivenTitle')}</strong>
                    <span>{t('confirm.modePrdDrivenDescription')}</span>
                  </span>
                </Radio>
                <Radio className="prd-confirm-version-option" value={DELIVERY_MODE.LEGACY}>
                  <span className="prd-confirm-version-option-copy">
                    <strong>{t('confirm.modeLegacyTitle')}</strong>
                    <span>{t('confirm.modeLegacyDescription')}</span>
                  </span>
                </Radio>
              </Radio.Group>
            </Form.Item>
          </Form>

          {!hasTarget && (
            <div className="prd-confirm-version-note" role="status">
              <strong>{t('confirm.noTarget')}</strong>
              <span>{t('confirm.noTargetHint')}</span>
            </div>
          )}

          <p className="prd-confirm-version-hint">{t('confirm.immutableHint')}</p>
        </div>
      )}
    </Modal>
  );
}
