import { useTranslation } from 'react-i18next';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';

const STEP_DONE = 'done';

/** 三段进度：PENDING 卡与 Chief 面板内的讲解条共用同一套圆标与连线。 */
export function GuideStepper({ phase }: { phase: number }) {
  const { t } = useTranslation('workspaceGuide');
  const status = (index: 1 | 2 | 3) => (phase > index ? STEP_DONE : phase === index ? 'on' : 'todo');
  return <div className="aw-guide-stepper" aria-hidden="true">
    {([1, 2, 3] as const).map((index, position) => {
      const state = status(index);
      return <span key={index} className="aw-guide-stepper-part">
        {position > 0 && <span className="aw-guide-stepper-line" />}
        <span className={`aw-guide-stepper-step is-${state}`}>
          <span className="aw-guide-stepper-dot">
            {state === STEP_DONE ? <AwStrokeIcon name="check" /> : index}
          </span>
          <span className="aw-guide-stepper-label">
            {t(index === 1 ? 'stepper.access' : index === 2 ? 'stepper.send' : 'stepper.start')}
          </span>
        </span>
      </span>;
    })}
  </div>;
}
