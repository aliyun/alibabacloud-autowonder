import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/shared/auth/store';
import type { WorkspaceAccessLevel } from '@/shared/types/common';

/** 导航展示版本：只影响菜单展示，不是权限开关。 */
export type NavMode = 'compact' | 'full';

interface NavModeState {
  mode: NavMode;
  setMode: (mode: NavMode) => void;
}

const NavModeContext = createContext<NavModeState | null>(null);
export const NAV_MODE_STORAGE_KEY = 'aw.navigation.view';

function readSelection(): NavMode | null {
  try {
    const value = localStorage.getItem(NAV_MODE_STORAGE_KEY);
    return value === 'compact' || value === 'full' ? value : null;
  } catch {
    return null;
  }
}

/** 空间管理员默认完整版本，其他成员默认简略版本；权限尚未加载时按简略（不放开管理入口）。 */
export function defaultNavMode(accessLevel: WorkspaceAccessLevel | null): NavMode {
  return accessLevel === 'ADMIN' ? 'full' : 'compact';
}

export function NavModeProvider({ children }: { children: React.ReactNode }) {
  const accessLevel = useAuthStore((state) => state.accessLevel);
  const [selection, setSelection] = useState<NavMode | null>(readSelection);
  const mode = selection ?? defaultNavMode(accessLevel);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === NAV_MODE_STORAGE_KEY || event.key === null) setSelection(readSelection());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const setMode = useCallback((next: NavMode) => {
    setSelection(next);
    try { localStorage.setItem(NAV_MODE_STORAGE_KEY, next); } catch { /* Retain the in-memory choice when storage is unavailable. */ }
  }, []);
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <NavModeContext.Provider value={value}>{children}</NavModeContext.Provider>;
}

export function useNavMode(): NavModeState {
  const value = useContext(NavModeContext);
  if (!value) {
    // 未挂载 Provider 的独立渲染（如组件测试）按完整版本展示，保持旧行为可预期。
    return { mode: 'full', setMode: () => undefined };
  }
  return value;
}
