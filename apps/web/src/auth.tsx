import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, AUTH_EXPIRED_EVENT } from '@/api';
import type { User, Workspace } from '@/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (user: User) => void;
  logout: () => Promise<void>;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  switchWorkspace: (workspaceId: string, destination?: string) => void;
  refreshWorkspaces: () => Promise<void>;
  /** Why the workspace list could not be loaded; pages cannot work without it. */
  workspacesError: string | null;
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
  workspacesError: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [workspacesError, setWorkspacesError] = useState<string | null>(null);

  const refreshWorkspaces = useCallback(async () => {
    let rows: Workspace[];
    try {
      rows = await api.listWorkspaces();
    } catch (cause) {
      setWorkspacesError((cause as Error).message);
      throw cause;
    }
    setWorkspacesError(null);
    const stored = localStorage.getItem('initpad.workspace');
    const selected =
      rows.find((w) => w.id === stored) ??
      rows.find((w) => w.type === 'personal') ??
      rows[0] ??
      null;
    if (selected) localStorage.setItem('initpad.workspace', selected.id);
    else localStorage.removeItem('initpad.workspace');
    setWorkspaces(rows);
    setActiveWorkspace(selected);
  }, []);

  useEffect(() => {
    const clearSession = () => {
      localStorage.removeItem('initpad.workspace');
      setUser(null);
      setWorkspaces([]);
      setActiveWorkspace(null);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, clearSession);
    api
      .me()
      .then(async (current) => {
        setUser(current);
        // A forced password change blocks workspace endpoints (they are not on
        // the allowlist), so skip the fetch — the change-password gate renders
        // instead. A transient workspaces error must not sign the user out.
        if (!current.mustChangePassword) {
          await refreshWorkspaces().catch(() => undefined);
        }
      })
      .catch(clearSession)
      .finally(() => setLoading(false));
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, clearSession);
  }, [refreshWorkspaces]);

  function signIn(next: User) {
    // A workspace selector belongs to the authenticated identity. Clear a
    // selector left by an expired/different session before page data starts
    // loading; refreshWorkspaces immediately chooses this user's personal one.
    localStorage.removeItem('initpad.workspace');
    setWorkspaces([]);
    setActiveWorkspace(null);
    setUser(next);
    // Skip while a password change is forced (workspace endpoints are blocked
    // until it is done); the change-password gate handles the next step.
    if (!next.mustChangePassword) void refreshWorkspaces().catch(() => undefined);
  }

  function switchWorkspace(workspaceId: string, destination = '/') {
    if (!workspaceId || workspaceId === activeWorkspace?.id) return;
    localStorage.setItem('initpad.workspace', workspaceId);
    // Route data is page-local today; a reload guarantees every view is
    // refetched under the new tenant header and prevents mixed-workspace UI.
    window.location.assign(destination);
  }

  async function logout() {
    await api.logout().catch(() => {});
    localStorage.removeItem('initpad.workspace');
    setUser(null);
    setWorkspaces([]);
    setActiveWorkspace(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signIn,
        logout,
        workspaces,
        activeWorkspace,
        switchWorkspace,
        refreshWorkspaces,
        workspacesError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
