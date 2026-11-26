import { afterEach as resetAfterEach } from 'vitest';
import { act } from '@testing-library/react';
import { i18n } from '@/shared/i18n';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RUN_STATUS_TAG_COLOR, RunStatusTag } from './RunStatusTag';

describe('RunStatusTag', () => {
  it('renders labeled dot tags for known run statuses and maps prototype colors', () => {
    render(
      <>
        <RunStatusTag status="SUCCEEDED" />
        <RunStatusTag status="FAILED" />
        <RunStatusTag status="SKIPPED" />
        <RunStatusTag status="RUNNING" />
        <RunStatusTag status="CANCELED" />
      </>,
    );
    expect(screen.getByText('成功')).toBeInTheDocument();
    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText('跳过')).toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
    expect(screen.getByText('已取消')).toBeInTheDocument();
    expect(RUN_STATUS_TAG_COLOR.SUCCEEDED).toBe('green');
    expect(RUN_STATUS_TAG_COLOR.FAILED).toBe('red');
    expect(RUN_STATUS_TAG_COLOR.TIMED_OUT).toBe('red');
    expect(RUN_STATUS_TAG_COLOR.RUNNING).toBe('blue');
    expect(RUN_STATUS_TAG_COLOR.WAITING_HUMAN).toBe('amber');
    expect(RUN_STATUS_TAG_COLOR.PAUSED).toBe('amber');
    expect(RUN_STATUS_TAG_COLOR.QUEUED).toBe('gray');
    expect(RUN_STATUS_TAG_COLOR.SKIPPED).toBe('gray');
    expect(RUN_STATUS_TAG_COLOR.CANCELED).toBe('gray');
  });

  it('falls back to the raw status text for unknown statuses', () => {
    render(<RunStatusTag status="SERVER_NEW_STATUS" />);
    expect(screen.getByText('SERVER_NEW_STATUS')).toBeInTheDocument();
  });
});

it('switches all eleven known statuses and keeps prototype-like unknowns literal', async () => {
  const codes = ['QUEUED', 'STARTING', 'WAITING_EXECUTOR', 'WAITING_HUMAN', 'RUNNING', 'PAUSED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELED', 'SKIPPED'];
  const { container } = render(<>{[...codes, 'toString', '__proto__'].map(status => <div key={status} data-testid="cell"><RunStatusTag status={status} /></div>)}</>);
  expect(Array.from(container.querySelectorAll('[data-testid="cell"]')).map(cell => cell.textContent)).toEqual(['排队中', '启动中', '等待执行器', '等待人工处理', '运行中', '已暂停', '成功', '失败', '已超时', '已取消', '跳过', 'toString', '__proto__']);
  await act(() => i18n.changeLanguage('en-US'));
  expect(Array.from(container.querySelectorAll('[data-testid="cell"]')).map(cell => cell.textContent)).toEqual(['Queued', 'Starting', 'Waiting for executor', 'Waiting for human', 'Running', 'Paused', 'Succeeded', 'Failed', 'Timed out', 'Canceled', 'Skipped', 'toString', '__proto__']);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  await act(() => i18n.changeLanguage('zh-CN'));
});

resetAfterEach(async () => { await act(() => i18n.changeLanguage('zh-CN')); });
