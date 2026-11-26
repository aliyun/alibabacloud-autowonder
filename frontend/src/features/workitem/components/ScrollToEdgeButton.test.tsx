import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { ScrollToEdgeButton } from './ScrollToEdgeButton';

function createMockContainer(opts: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop?: number;
}) {
  const el = document.createElement('div');
  el.style.paddingRight = '38px';
  Object.defineProperty(el, 'scrollHeight', { value: opts.scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: opts.clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: opts.scrollTop ?? 0, writable: true, configurable: true });
  const scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options === 'object' && typeof options.top === 'number') {
      Object.defineProperty(el, 'scrollTop', { value: options.top, writable: true, configurable: true });
      el.dispatchEvent(new Event('scroll'));
    }
  });
  Object.defineProperty(el, 'scrollTo', { value: scrollTo, configurable: true });
  return el;
}

function Wrapper({ containerEl }: { containerEl: HTMLElement }) {
  return <ScrollToEdgeButton containerRef={{ current: containerEl }} />;
}

describe('ScrollToEdgeButton', () => {
  it('reenables the bottom arrow when more timeline content is appended', async () => {
    const el = createMockContainer({ scrollHeight: 2000, clientHeight: 600, scrollTop: 1400 });
    render(<Wrapper containerEl={el} />);
    expect(screen.getByTitle('到达底部')).toBeDisabled();
    await act(async () => {
      Object.defineProperty(el, 'scrollHeight', { value: 4000, configurable: true });
      el.appendChild(document.createElement('div'));
    });
    expect(screen.getByTitle('到达底部')).toBeEnabled();
  });
  it('renders compact buttons anchored inside the scroll region', () => {
    const el = createMockContainer({ scrollHeight: 2000, clientHeight: 600 });
    const { container } = render(<Wrapper containerEl={el} />);
    expect(screen.getByTitle('回到顶部')).toBeInTheDocument();
    expect(screen.getByTitle('到达底部')).toBeInTheDocument();

    // jsdom 中 offsetWidth === clientWidth，相当于叠加滚动条：
    // 中线压右边框 = 右内边距 38 - 按钮 22 / 2 = 27px
    expect(container.querySelector('[data-testid="scroll-edge-controls"]')).toHaveStyle({
      position: 'absolute',
      right: '27px',
      bottom: '12px',
    });
    container.querySelectorAll('button').forEach((button) => {
      expect(button).toHaveStyle({ width: '22px', height: '22px', padding: '0px' });
    });
  });

  it('calls scrollTo with top=scrollHeight when clicking "到达底部"', () => {
    const el = createMockContainer({ scrollHeight: 2000, clientHeight: 600 });
    render(<Wrapper containerEl={el} />);
    fireEvent.click(screen.getByTitle('到达底部'));
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: 'smooth' });
  });

  it('calls scrollTo with top=0 when clicking "回到顶部"', () => {
    const el = createMockContainer({ scrollHeight: 2000, clientHeight: 600, scrollTop: 500 });
    render(<Wrapper containerEl={el} />);
    fireEvent.click(screen.getByTitle('回到顶部'));
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('renders nothing when content is not scrollable', () => {
    const el = createMockContainer({ scrollHeight: 400, clientHeight: 600 });
    const { container } = render(<Wrapper containerEl={el} />);
    expect(container).toBeEmptyDOMElement();
  });
});
