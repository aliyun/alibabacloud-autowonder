import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VisualState } from './scene/visual';

type Renderer = typeof import('./scene/scene');
const rendererUrl = '/office/renderer-v1.js';
function loadRenderer(): Promise<Renderer> {
  return import.meta.env.DEV ? import('./scene/scene') : import(/* @vite-ignore */ rendererUrl);
}

export function OfficeScene({ visual, onMember, onTick }: {
  visual: VisualState;
  onMember: (id: number) => void;
  onTick?: () => void;
}) {
  const { t, i18n } = useTranslation('office');
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const tick = useRef(onTick);
  const select = useRef(onMember);
  tick.current = onTick;
  select.current = onMember;
  const [engine, setEngine] = useState<Renderer>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    loadRenderer().then(renderer => { if (active) setEngine(renderer); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const container = host.current;
    if (!engine || !container || !labels.current) return;
    let frame = 0;
    let previous: number | undefined;
    let lastUpdate = 0;
    setFailed(false);
    let created: ReturnType<Renderer['createOffice']> | undefined;
    try {
      created = engine.createOffice(container, labels.current, visual, id => select.current(id), t);
      created.render(visual.time);
    } catch {
      created?.dispose();
      setFailed(true);
      return;
    }
    const scene = created;
    const canvas = container.querySelector('canvas');
    function onContextLost(event: Event) {
      event.preventDefault();
      cancelAnimationFrame(frame);
      setFailed(true);
    }
    function onContextRestored() {
      setFailed(false);
      previous = undefined;
      frame = requestAnimationFrame(animate);
    }
    function animate(now: number) {
      const elapsed = previous === undefined ? 0 : (now - previous) / 1000;
      if (previous !== undefined && elapsed < 1 / 33) {
        frame = requestAnimationFrame(animate);
        return;
      }
      previous = now;
      visual.advance(Math.min(elapsed, 0.18));
      scene.render(visual.time);
      if (now - lastUpdate >= 400) {
        tick.current?.();
        lastUpdate = now;
      }
      frame = requestAnimationFrame(animate);
    }
    canvas?.addEventListener('webglcontextlost', onContextLost);
    canvas?.addEventListener('webglcontextrestored', onContextRestored);
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      canvas?.removeEventListener('webglcontextlost', onContextLost);
      canvas?.removeEventListener('webglcontextrestored', onContextRestored);
      scene.dispose();
    };
  }, [engine, visual, i18n.language, t]);
  return (
    <div className="awo-viewport">
      <div className="awo-canvas" ref={host} />
      <div className="awo-labels" ref={labels} />
      {failed && <div className="awo-scene-fallback" role="status">{t('webglError')}</div>}
    </div>
  );
}
