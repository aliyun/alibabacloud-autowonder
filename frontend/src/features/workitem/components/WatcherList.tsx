import { useTranslation } from 'react-i18next';
import { Spin } from 'antd';
import { useWatchers } from '../hooks';
import { HumanInitial } from './SquadMembers';

interface WatcherListProps {
  workitemId: number | string;
}

/**
 * 工单关注人列表。关注关系独立于负责人/参与者，这里只展示当前有效的关注人；
 * 失去工作空间访问权的用户由后端过滤，不会出现在列表中。
 */
export function WatcherList({ workitemId }: WatcherListProps) {
  const { t } = useTranslation('workitem');
  const { data: watchers = [], isLoading } = useWatchers(workitemId);

  return (
    <div className="aw-task-group" data-testid="workitem-watcher-list">
      <h3 className="aw-task-group-title">
        {watchers.length ? t('watchers.titleCount', { count: watchers.length }) : t('watchers.title')}
      </h3>
      {isLoading ? (
        <Spin size="small" />
      ) : watchers.length === 0 ? (
        <p className="aw-task-empty">{t('watchers.empty')}</p>
      ) : (
        <ul className="aw-task-list">
          {watchers.map((w) => (
            <li key={String(w.userId)}>
              <span className="aw-task-avatar" role="img" aria-label={t('watchers.avatar')}><HumanInitial name={w.name} /></span>
              <div>
                <div className="aw-task-name">{w.name}</div>
                <div className="aw-task-secondary">{t('watchers.identity', { id: w.displayId ?? w.userId })}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
