import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/api';
import type { User, Workspace } from '@/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (user: User) => void;
  logout: () => Promise<void>;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  switchWorkspace: (workspaceId: string) => void;
  refreshWorkspaces: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signIn: () => {},
  logout: async () => {},
  workspaces: [],
  activeWorkspace: null,
  switchWorkspace: () => {},
  refreshWorkspaces: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);

  const refreshWorkspaces = useCallback(async () => {
    const rows = await api.listWorkspaces();
    const stored = localStorage.getItem('initpad.workspace');
    const selected = rows.find((w) => w.id === stored) ?? rows.find((w) => w.type === 'personal') ?? rows[0] ?? null;
    if (selected) localStorage.setItem('initpad.workspace', selected.id);
    else localStorage.removeItem('initpad.workspace');
    setWorkspaces(rows);
    setActiveWorkspace(selected);
  }, []);

  useEffect(() => {
    api.me()
      .then(async (current) => {
        setUser(current);
        await refreshWorkspaces();
      })
      .catch(() => {
        localStorage.removeItem('initpad.workspace');
        setUser(null);
        setWorkspaces([]);
        setActiveWorkspace(null);
      })
      .finally(() => setLoading(false));
  }, [refreshWorkspaces]);

  function signIn(next: User) {
    // A workspace selector belongs to the authenticated identity. Clear a
    // selector left by an expired/different session before page data starts
    // loading; refreshWorkspaces immediately chooses this user's personal one.
    localStorage.removeItem('initpad.workspace');
    setWorkspaces([]);
    setActiveWorkspace(null);
    setUser(next);
    void refreshWorkspaces();
  }

  function switchWorkspace(workspaceId: string) {
    if (!workspaceId || workspaceId === activeWorkspace?.id) return;
    localStorage.setItem('initpad.workspace', workspaceId);
    // Route data is page-local today; a reload guarantees every view is
    // refetched under the new tenant header and prevents mixed-workspace UI.
    window.location.assign('/');
  }

  async function logout() {
    await api.logout().catch(() => {});
    localStorage.removeItem('initpad.workspace');
    setUser(null);
    setWorkspaces([]);
    setActiveWorkspace(null);
  }

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      signIn,
      logout,
      workspaces,
      activeWorkspace,
      switchWorkspace,
      refreshWorkspaces,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
