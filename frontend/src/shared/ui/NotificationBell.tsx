import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { useNavigate } from 'react-router-dom';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';

export function NotificationBell({ fetchUnread = true }: { fetchUnread?: boolean }) {
  const { t } = useTranslation('shared');
  const navigate = useNavigate();

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    enabled: fetchUnread,
    queryFn: async () => {
      const resp = await apiClient.get<number>('/api/notifications/unread-count');
      return resp.data;
    },
    refetchInterval: fetchUnread ? 30000 : false,
  });

  return (
    // role=img 的图标 span 不可聚焦，包一层原生 button 才能让键盘用户进入通知中心
    // 原型 02+ 顶栏铃铛：6px error 圆点表示有未读（不显示数字）
    <button
      type="button"
      className="aw-bell-btn"
      aria-label={t('notifications')}
      onClick={() => navigate('/notifications')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        padding: 0,
        border: 'none',
        background: 'transparent',
        color: 'var(--aw-text-2)',
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      <AwStrokeIcon name="bell" size={16} />
      {unreadCount > 0 && <span className="aw-bell-dot" />}
    </button>
  );
}
