import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChiefGuidedSetup, type ChiefGuidedSetupProps } from './ChiefGuidedSetup';
import * as api from './api';
import { buildExecutorLaunchCommand, type ExecutorLaunchCommandVO } from '@/features/executor/api';
import { copyTextToClipboard } from '@/shared/lib/clipboard';

vi.mock('./api');
vi.mock('@/features/executor/api');
vi.mock('@/shared/lib/clipboard');

const launchCommand: ExecutorLaunchCommandVO = {
  executorId: 20,
  clientKind: 'QODER_CLI',
  provider: 'qoder',
  memoryMode: 'platform',
  model: null,
  reasoningEffort: null,
  contextWindow: null,
  wsUrl: 'ws://localhost',
  runtimeVersion: '1.0.0',
  os: 'posix',
  debug: false,
  shell: null,
  command: 'launch-cmd',
};

const baseSetup: api.SetupStatus = {
  agentId: 10,
  executorId: 20,
  agentConfigured: true,
  skillsConfigured: true,
  executorConfigured: true,
  launchConfigured: true,
  ready: false,
  missingSkills: [],
};

function renderGuided(overrides: Partial<ChiefGuidedSetupProps> = {}) {
  const handlers = {
    onClientKindChange: vi.fn(),
    onOsChange: vi.fn(),
    onCommandChange: vi.fn(),
    onAdvance: vi.fn(),
    onCheckStatus: vi.fn(),
    onResetWait: vi.fn(),
  };
  const props: ChiefGuidedSetupProps = {
    setup: baseSetup,
    substep: 0,
    clientKind: 'QODER_CLI',
    os: 'posix',
    command: null,
    waitExpired: false,
    ...handlers,
    ...overrides,
  };
  return { ...render(<ChiefGuidedSetup {...props} />), handlers };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('ChiefGuidedSetup', () => {
  it('completes setup, generates, and copies in one click', async () => {
    vi.mocked(api.completeSetup).mockResolvedValue({ ...baseSetup, executorConfigured: true });
    vi.mocked(buildExecutorLaunchCommand).mockResolvedValue(launchCommand);
    vi.mocked(copyTextToClipboard).mockResolvedValue(true);
    const { handlers } = renderGuided({ setup: { ...baseSetup, executorConfigured: false } });
    const user = userEvent.setup();

    expect(screen.getByRole('radio', { name: 'Qoder' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Qoder 中国版' })).toBeInTheDocument();
    expect(screen.getByText('生成并复制命令')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '生成并复制命令' }));

    await waitFor(() => expect(api.completeSetup).toHaveBeenCalledWith('QODER_CLI'));
    expect(buildExecutorLaunchCommand).toHaveBeenCalledWith(20, { os: 'posix' });
    expect(handlers.onCommandChange).toHaveBeenCalledWith('launch-cmd');
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledWith('launch-cmd'));
    expect(handlers.onAdvance).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing executor and skips the first substep', async () => {
    const { handlers } = renderGuided();

    await waitFor(() => expect(handlers.onAdvance).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('radio', { name: 'Qoder' })).toBeDisabled();
  });

  it('changing the host OS updates the segmented control', () => {
    const { handlers } = renderGuided({ setup: { ...baseSetup, executorConfigured: false } });

    fireEvent.click(screen.getByText('Windows'));
    expect(handlers.onOsChange).toHaveBeenCalledWith('windows');
  });

  it('stays on the step with the error when completing setup fails', async () => {
    vi.mocked(api.completeSetup).mockRejectedValue(new Error('draft requires review'));
    const { handlers } = renderGuided({ setup: { ...baseSetup, executorConfigured: false } });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '生成并复制命令' }));

    expect(await screen.findByText('draft requires review')).toBeInTheDocument();
    expect(buildExecutorLaunchCommand).not.toHaveBeenCalled();
    expect(handlers.onAdvance).not.toHaveBeenCalled();
  });

  it('falls back to the localized failure message for non-Error rejections', async () => {
    vi.mocked(buildExecutorLaunchCommand).mockRejectedValue('offline');
    const { handlers } = renderGuided({ command: 'launch-cmd' });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '生成并复制命令' }));

    expect(await screen.findByText('操作未成功，请重试；仍停留在当前步骤。')).toBeInTheDocument();
    expect(handlers.onAdvance).not.toHaveBeenCalled();
  });

  it('reports a failure instead of generating without an executor', async () => {
    vi.mocked(api.completeSetup).mockResolvedValue({ ...baseSetup, executorId: null, executorConfigured: true });
    const { handlers } = renderGuided({ setup: { ...baseSetup, executorId: null, executorConfigured: false } });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '生成并复制命令' }));

    expect(await screen.findByText('操作未成功，请重试；仍停留在当前步骤。')).toBeInTheDocument();
    expect(buildExecutorLaunchCommand).not.toHaveBeenCalled();
    expect(handlers.onAdvance).not.toHaveBeenCalled();
  });

  it('offers a manual copy path when the clipboard write fails', async () => {
    vi.mocked(buildExecutorLaunchCommand).mockResolvedValue(launchCommand);
    vi.mocked(copyTextToClipboard).mockResolvedValue(false);
    const { handlers } = renderGuided({ command: 'launch-cmd' });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '复制命令' }));

    expect(await screen.findByText('复制失败，请手动选择上方文本复制。')).toBeInTheDocument();
    expect(handlers.onAdvance).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '已手动复制' }));
    expect(handlers.onAdvance).toHaveBeenCalledTimes(1);
  });

  it('marks the command as copied after a successful copy', async () => {
    vi.mocked(copyTextToClipboard).mockResolvedValue(true);
    renderGuided({ command: 'launch-cmd' });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '复制命令' }));

    expect(await screen.findByText('已复制')).toBeInTheDocument();
    expect(screen.getByText('等待粘贴执行')).toBeInTheDocument();
  });

  it('waits online with the command, status, and a manual check', async () => {
    const { handlers } = renderGuided({ substep: 1, command: 'launch-cmd' });
    const user = userEvent.setup();

    expect(screen.getByText('启动命令（macOS / Linux）')).toBeInTheDocument();
    expect(screen.getByText('launch-cmd')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在探测执行器');
    await user.click(screen.getByRole('button', { name: '手动检查' }));

    expect(handlers.onCheckStatus).toHaveBeenCalledTimes(1);
    expect(handlers.onAdvance).not.toHaveBeenCalled();
    expect(screen.queryByText(/暂未检测到执行器在线/)).not.toBeInTheDocument();
  });

  it('regenerates a missing command in the waiting substep without advancing', async () => {
    vi.mocked(buildExecutorLaunchCommand).mockResolvedValue(launchCommand);
    vi.mocked(copyTextToClipboard).mockResolvedValue(true);
    const { handlers } = renderGuided({ substep: 1, command: null });
    const user = userEvent.setup();

    expect(screen.getByText('检测到已配置的执行器，当前不在线。重新生成启动命令，在原机器上重启即可继续。')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'macOS / Linux' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: '生成并复制命令' }));

    await waitFor(() => expect(handlers.onCommandChange).toHaveBeenCalledWith('launch-cmd'));
    expect(buildExecutorLaunchCommand).toHaveBeenCalledWith(20, { os: 'posix' });
    expect(copyTextToClipboard).toHaveBeenCalledWith('launch-cmd');
    expect(handlers.onAdvance).not.toHaveBeenCalled();
  });

  it('shows the timeout notice and resets the wait window', async () => {
    const { handlers, rerender } = renderGuided({ substep: 1, command: 'launch-cmd', waitExpired: true });
    expect(screen.getByRole('status')).toHaveTextContent('自动探测已暂停');
    const user = userEvent.setup();

    expect(screen.getByText(/暂未检测到执行器在线/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(handlers.onResetWait).toHaveBeenCalledTimes(1);

    act(() => {
      rerender(<ChiefGuidedSetup
        setup={baseSetup}
        substep={1}
        clientKind="QODER_CLI"
        os="posix"
        command="launch-cmd"
        waitExpired={false}
        {...handlers}
      />);
    });
    expect(screen.queryByText(/暂未检测到执行器在线/)).not.toBeInTheDocument();
  });
});
