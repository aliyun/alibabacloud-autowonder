import { formatDateTime } from '@/shared/i18n/format';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { StatusTag } from '@/shared/ui/StatusTag';
import type { Notification, NotificationLink } from '@/shared/types/notification';
import { TYPE_TAG_COLOR, relatedText, typeLabel } from './notificationMeta';

const WORKITEM_PATH_PREFIX = '/workitems/';
const DATE_FORMAT = { dateStyle: 'medium', timeStyle: 'medium' } as const;
const DETAIL_SEPARATOR = '·';

interface Props {
  notification: Notification | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Only a complete snapshot with server-issued workitem links is renderable. Anything else must
 * fall back to the plain-text body instead of producing an empty or unsafe anchor.
 */
function splitDuplicateLinks(notification: Notification | null) {
  if (!notification || notification.type !== 'DUPLICATE_INTENT' || !notification.relatedLinks) return null;
  const valid = notification.relatedLinks.filter((item) => (
    (item.kind === 'SUBMITTED' || item.kind === 'DUPLICATE')
    && typeof item.title === 'string' && item.title.trim().length > 0
    && typeof item.url === 'string' && item.url.startsWith(WORKITEM_PATH_PREFIX)
  ));
  const submitted = valid.filter((item) => item.kind === 'SUBMITTED');
  const duplicates = valid.filter((item) => item.kind === 'DUPLICATE');
  return submitted.length > 0 && duplicates.length > 0 ? { submitted, duplicates } : null;
}

/** 详情里能列出多个工单目标时，列表行必须先打开详情让用户挑选，而不是直接跳单一链接。 */
export function hasDuplicateLinks(notification: Notification | null): boolean {
  return splitDuplicateLinks(notification) !== null;
}

function DuplicateIntentLinks({ submitted, duplicates, t }: {
  submitted: NotificationLink[];
  duplicates: NotificationLink[];
  t: TFunction<'notification'>;
}) {
  const renderLinks = (items: NotificationLink[]) => items.map((item) => (
    <Typography.Link
      key={`${item.kind}:${item.url}`}
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {item.title}
    </Typography.Link>
  ));
  return (
    <div className="ntf-detail-links">
      <div className="ntf-link-group">
        <span className="ntf-link-label">{t('submittedWorkitem')}</span>
        <div className="ntf-link-list">{renderLinks(submitted)}</div>
      </div>
      <div className="ntf-link-group">
        <span className="ntf-link-label">{t('duplicateWorkitems')}</span>
        <div className="ntf-link-list">{renderLinks(duplicates)}</div>
      </div>
    </div>
  );
}

export function NotificationDetailModal({ notification, open, onClose }: Props) {
  const { t } = useTranslation('notification');
  const navigate = useNavigate();
  const link = notification?.link;
  const duplicateLinks = splitDuplicateLinks(notification);
  const related = relatedText(notification, t);
  const body = notification?.content;

  return (
    <Modal
      className="ntf-detail-modal"
      title={t('details')}
      closable={{ 'aria-label': t('close') }}
      open={open}
      onCancel={onClose}
      footer={link ? (
        <Button type="primary" onClick={() => navigate(link)}>
          {t('openRelated')}
        </Button>
      ) : null}
      width={520}
      centered
      maskClosable
    >
      {notification && (
        <>
          <div className="ntf-detail-meta">
            <StatusTag
              label={typeLabel(notification.type, t)}
              colorKey={TYPE_TAG_COLOR[notification.type] ?? 'gray'}
              size="sm"
            />
            <span>{formatDateTime(notification.gmtCreate, DATE_FORMAT)}</span>
            {related && (
              <>
                <span aria-hidden="true">{DETAIL_SEPARATOR}</span>
                <span className="ntf-detail-ref">{related}</span>
              </>
            )}
          </div>
          <div className="ntf-detail-title">{notification.title}</div>
        </>
      )}
      {duplicateLinks ? (
        <DuplicateIntentLinks submitted={duplicateLinks.submitted} duplicates={duplicateLinks.duplicates} t={t} />
      ) : (
        <div className={`ntf-detail-body${body ? '' : ' is-empty'}`}>{body || t('noBody')}</div>
      )}
    </Modal>
  );
}
