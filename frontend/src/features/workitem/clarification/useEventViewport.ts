import { useEffect, useRef, useState } from 'react';

/** Only visible historical turns read content; the active turn keeps receiving while offscreen. */
export function useEventViewport() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [height, setHeight] = useState(1);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      const leaving = entries.find(entry => !entry.isIntersecting);
      if (leaving) setHeight(Math.max(1, leaving.boundingClientRect?.height ?? ref.current?.getBoundingClientRect().height ?? 1));
      setVisible(entries.some(entry => entry.isIntersecting));
    }, { rootMargin: '400px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, visible, height };
}
