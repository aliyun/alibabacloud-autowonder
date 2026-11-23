import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EventSyncStatus } from './EventSyncStatus';

describe('EventSyncStatus', () => {
  it.each(['PREPARING', 'PARTIAL', 'DEFERRED', 'READY', 'EMPTY'] as const)(
    'keeps normal %s synchronization silent', preparationStatus => {
      const { container } = render(<EventSyncStatus preparationStatus={preparationStatus} syncing error={false} />);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it('does not announce successful synchronization', () => {
    const { container } = render(<EventSyncStatus preparationStatus="READY" syncing={false} error={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reports an explicit unavailable state instead of an empty panel', () => {
    render(<EventSyncStatus preparationStatus="UNAVAILABLE" syncing={false} error={false} />);
    expect(screen.getByText('部分执行过程不可用')).toBeInTheDocument();
  });

  it('keeps existing content and offers a retry after a failure', () => {
    const onRetry = vi.fn();
    render(
      <EventSyncStatus preparationStatus="PARTIAL" syncing error onRetry={onRetry} />,
    );
    expect(screen.getByText('执行详情加载失败')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for a turn that genuinely has no events', () => {
    const { container } = render(
      <EventSyncStatus preparationStatus="EMPTY" syncing={false} error={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
