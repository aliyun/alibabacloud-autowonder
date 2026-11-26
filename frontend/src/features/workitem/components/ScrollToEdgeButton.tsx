import { useTranslation } from 'react-i18next';
import { useEffect, useState, useCallback } from 'react';
import { Button } from 'antd';
import { AwStrokeIcon } from '@/shared/ui/AwStrokeIcon';
import type { CSSProperties } from 'react';

interface ScrollToEdgeButtonProps {
  containerRef: React.RefObject<HTMLElement>;
}

const THRESHOLD = 8;
const BUTTON_SIZE = 22;

const CONTROL_STYLE: CSSProperties = {
  width: BUTTON_SIZE,
  height: BUTTON_SIZE,
  minWidth: BUTTON_SIZE,
  padding: 0,
  fontSize: 12,
  background: 'var(--aw-panel)',
  borderColor: 'var(--aw-border)',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
};

/** 按钮中线压在内容卡右边框上：边框距容器外沿 = 滚动条宽（叠加滚动条为 0）+ 右内边距，可为负值外溢。 */
function computeCenteredRight(el: HTMLElement): number {
  const scrollbarWidth = Math.max(0, el.offsetWidth - el.clientWidth);
  const gutter = parseFloat(getComputedStyle(el).paddingRight) || 0;
  return scrollbarWidth + gutter - BUTTON_SIZE / 2;
}

export function ScrollToEdgeButton({ containerRef }: ScrollToEdgeButtonProps) {
  const { t } = useTranslation('workitem');
  const [state, setState] = useState<{ scrollable: boolean; atTop: boolean; atBottom: boolean }>({
    scrollable: false,
    atTop: true,
    atBottom: false,
  });
  const [rightOffset, setRightOffset] = useState(0);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollHeight, clientHeight, scrollTop } = el;
    const scrollable = scrollHeight > clientHeight;
    const atTop = scrollTop <= THRESHOLD;
    const atBottom = scrollTop + clientHeight >= scrollHeight - THRESHOLD;
    setState({ scrollable, atTop, atBottom });
    setRightOffset(computeCenteredRight(el));
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure);
    const observer = new MutationObserver(measure);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [containerRef, measure]);

  if (!state.scrollable) return null;

  const scrollToTop = () => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToBottom = () => {
    const el = containerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div
      data-testid="scroll-edge-controls"
      style={{
        position: 'absolute',
        right: rightOffset,
        bottom: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <Button
        shape="circle"
        aria-label={t('detail.scrollTop')}
        title={t('detail.scrollTop')}
        icon={<AwStrokeIcon name="top" />}
        disabled={state.atTop}
        style={CONTROL_STYLE}
        onClick={scrollToTop}
      />
      <Button
        shape="circle"
        aria-label={t('detail.scrollBottom')}
        title={t('detail.scrollBottom')}
        icon={<AwStrokeIcon name="down" />}
        disabled={state.atBottom}
        style={CONTROL_STYLE}
        onClick={scrollToBottom}
      />
    </div>
  );
}
