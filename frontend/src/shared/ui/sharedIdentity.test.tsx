import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusTag, STATUS_TAG_PALETTE } from './StatusTag';
import { TimeCell } from './TimeCell';
import { AiIdentity } from './AiIdentity';
import { EmptyState } from './EmptyState';

describe('StatusTag', () => {
  it('maps every palette key onto shallow-bg + deep-text CSS vars', () => {
    expect(STATUS_TAG_PALETTE.green).toEqual({ background: 'var(--aw-success-bg)', color: 'var(--aw-success-deep)' });
    expect(STATUS_TAG_PALETTE.red).toEqual({ background: 'var(--aw-error-bg)', color: 'var(--aw-error-deep)' });
    expect(STATUS_TAG_PALETTE.amber).toEqual({ background: 'var(--aw-warning-bg)', color: 'var(--aw-warning-deep)' });
    expect(STATUS_TAG_PALETTE.blue).toEqual({ background: 'var(--aw-primary-weak)', color: 'var(--aw-accent-text)' });
    expect(STATUS_TAG_PALETTE.gray).toEqual({ background: 'var(--aw-gray-bg)', color: 'var(--aw-text-2)' });
    expect(STATUS_TAG_PALETTE.violet).toEqual({ background: 'var(--aw-ai-bg)', color: 'var(--aw-ai)' });
    expect(STATUS_TAG_PALETTE.outline).toEqual({ background: 'transparent', color: 'var(--aw-text-2)', borderColor: 'var(--aw-border)' });
  });

  it('renders label with default and sm geometry', () => {
    const { container } = render(<StatusTag label="执行中" colorKey="green" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveTextContent('执行中');
    expect(el.getAttribute('style')).toContain('height: 22px');
    const sm = render(<StatusTag label="P1" colorKey="red" size="sm" />).container.firstChild as HTMLElement;
    expect(sm.getAttribute('style')).toContain('height: 18px');
    expect(sm.getAttribute('style')).toContain('font-size: 11px');
  });

  it('dot renders a 6px currentColor circle', () => {
    const { container } = render(<StatusTag label="待决策" colorKey="amber" dot />);
    const dot = (container.firstChild as HTMLElement).firstChild as HTMLElement;
    expect(dot.getAttribute('style')).toContain('width: 6px');
    expect(dot.getAttribute('style')).toContain('background: currentColor');
  });
});

describe('TimeCell', () => {
  it('renders date line and micro time line', () => {
    render(<TimeCell value="2026-10-30T14:08:00+08:00" />);
    const block = screen.getByText(/2026/).parentElement as HTMLElement;
    const lines = block.children;
    expect(lines).toHaveLength(2);
    expect((lines[1] as HTMLElement).style.fontSize).toBe('11px');
    expect(lines[1]).toHaveTextContent('14:08');
  });

  it('renders dash for missing value', () => {
    render(<TimeCell value={null} />);
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('renders dash for invalid value', () => {
    render(<TimeCell value="not-a-date" />);
    expect(screen.getByText('-')).toBeInTheDocument();
  });
});

describe('AiIdentity', () => {
  it('renders violet AI badge next to name without avatar', () => {
    render(<AiIdentity name="后端开发" aiBadge />);
    expect(screen.getByText('后端开发')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('renders AI avatar with --aw-ai background', () => {
    const { container } = render(<AiIdentity name="DeepSeek" aiBadge avatar />);
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(container.querySelector('.ant-avatar')).not.toBeNull();
  });

  it('renders human avatar with a stable palette color', () => {
    const { container } = render(<AiIdentity name="冬萌" avatar />);
    expect(screen.getByText('冬')).toBeInTheDocument();
    const style = (container.querySelector('.ant-avatar') as HTMLElement | null)?.getAttribute('style') ?? '';
    expect(style).toMatch(/background-color:\s*rgb\(/i);
  });

  it('keeps long names shrinkable while preserving the badge and avatar', () => {
    const name = '超长数字员工名称'.repeat(15);
    const { container } = render(<AiIdentity name={name} title={name} aiBadge avatar icon />);
    expect(container.firstElementChild).toHaveStyle({ minWidth: 0, maxWidth: '100%' });
    expect(screen.getByText(name)).toHaveStyle({ minWidth: 0, flexShrink: 1, textOverflow: 'ellipsis' });
    expect(screen.getByText('AI')).toHaveStyle({ flexShrink: 0 });
    expect(container.querySelector('.ant-avatar')).toHaveStyle({ flexShrink: 0 });
    expect(screen.getByTitle(name)).toBeInTheDocument();
  });

  it('falls back when name missing', () => {
    render(<AiIdentity name={null} />);
    expect(screen.getByText('-')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('keeps legacy single-description rendering untouched', () => {
    render(<EmptyState description="暂无数据" />);
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });

  it('renders icon, title, subtext and action when provided', () => {
    render(<EmptyState icon={<span>x</span>} title="暂无工单" subtext="创建第一个工单" action={<button>新建</button>} />);
    expect(screen.getByText('暂无工单')).toBeInTheDocument();
    expect(screen.getByText('创建第一个工单')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建' })).toBeInTheDocument();
  });
});
