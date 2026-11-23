import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuthStore } from '@/shared/auth/store';
import { defaultNavMode, NAV_MODE_STORAGE_KEY, NavModeProvider, useNavMode } from './navMode';

function Probe() {
  const { mode, setMode } = useNavMode();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <button onClick={() => setMode(mode === 'compact' ? 'full' : 'compact')}>toggle</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  localStorage.removeItem(NAV_MODE_STORAGE_KEY);
  useAuthStore.getState().clear();
});

describe('defaultNavMode', () => {
  it('defaults admins to full and other members to compact', () => {
    expect(defaultNavMode('ADMIN')).toBe('full');
    expect(defaultNavMode('READ_WRITE')).toBe('compact');
    expect(defaultNavMode('READ_ONLY')).toBe('compact');
    expect(defaultNavMode(null)).toBe('compact');
  });
});

describe('NavModeProvider', () => {
  it('persists a manual choice across workspaces and provider remounts', async () => {
    useAuthStore.getState().setUser({ id: 7, username: 'u', nickname: 'U', email: 'u@example.com' });
    useAuthStore.getState().setCurrentWorkspace({ id: 1, name: 'W1', description: '' }, 'READ_WRITE');
    render(<NavModeProvider><Probe /></NavModeProvider>);

    expect(screen.getByTestId('mode')).toHaveTextContent('compact');
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('full');

    act(() => {
      useAuthStore.getState().setCurrentWorkspace({ id: 2, name: 'W2', description: '' }, 'READ_WRITE');
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('full');
    expect(localStorage.getItem(NAV_MODE_STORAGE_KEY)).toBe('full');
    cleanup();
    render(<NavModeProvider><Probe /></NavModeProvider>);
    expect(screen.getByTestId('mode')).toHaveTextContent('full');
  });

  it('ignores invalid saved values and synchronizes other browser tabs', () => {
    localStorage.setItem(NAV_MODE_STORAGE_KEY, 'invalid');
    render(<NavModeProvider><Probe /></NavModeProvider>);
    expect(screen.getByTestId('mode')).toHaveTextContent('compact');
    act(() => {
      localStorage.setItem(NAV_MODE_STORAGE_KEY, 'full');
      window.dispatchEvent(new StorageEvent('storage', { key: NAV_MODE_STORAGE_KEY }));
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('full');
  });

  it('falls back to full mode outside a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('mode')).toHaveTextContent('full');
  });
});
