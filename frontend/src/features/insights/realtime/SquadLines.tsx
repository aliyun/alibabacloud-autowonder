import { Trans, useTranslation } from 'react-i18next';
import { Card } from 'antd';
import type { SquadLine } from './api';

const NAMELESS_INITIAL = '?';

interface Props {
  squads: SquadLine[];
}

/** 小队产线卡：原型 .squad-card 结构 —— 头像 + 名称、四项计数、忙碌占比条与摘要。 */
export default function SquadLines({ squads }: Props) {
  const { t } = useTranslation('insights');
  return (
    <Card
      title={<>{t('squadLines.title')}{' '}<span className="insight-card-hint">{t('squadLines.hint')}</span></>}
      style={{ minWidth: 0 }}
    >
      {squads.length === 0 ? (
        <div className="insight-empty-note">{t('squadLines.empty')}</div>
      ) : (
        <div className="insight-squad-grid">
          {squads.map((s) => {
            const pct = s.members > 0 ? Math.min((s.busy / s.members) * 100, 100) : 0;
            return (
              <div key={s.squadId} className="insight-squad-card">
                <div className="insight-squad-top">
                  <span className="insight-squad-av" aria-hidden="true">{Array.from(s.name || NAMELESS_INITIAL)[0]}</span>
                  <span className="insight-squad-name insight-truncate" title={s.name}>{s.name}</span>
                </div>
                <div className="insight-squad-nums">
                  <span>{t('squadLines.runningTasks')} <b>{s.runningTasks}</b></span>
                  <span>{t('squadLines.members')} <b>{s.members}</b></span>
                  <span>{t('squadLines.online')} <b>{s.online}</b></span>
                  <span>{t('squadLines.busy')} <b>{s.busy}</b></span>
                </div>
                <div
                  className="insight-busy-track"
                  role="img"
                  aria-label={t('squadLines.busyAria', { busy: s.busy, members: s.members })}
                >
                  <span className="insight-busy-fill" style={{ width: `${pct}%` }} />
                </div>
                <p className="insight-squad-sum">
                  <Trans
                    t={t}
                    i18nKey="squadLines.summary"
                    components={{
                      fraction: <b className="insight-realtime-metric">{s.busy}/{s.members}</b>,
                      count: <b className="insight-realtime-metric">{s.inProgressWorkitems}</b>,
                    }}
                  />
                </p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
