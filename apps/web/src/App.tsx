import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth';
import { Sidebar } from '@/components/organisms/Sidebar';
import ChangePassword from '@/pages/ChangePassword';
import { loginPath } from '@/lib/login-path';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { t } from '@/i18n';

export default function App() {
  const { user, loading, logout, activeWorkspace, workspacesError, refreshWorkspaces } = useAuth();
  const location = useLocation();

  if (loading) return <div className="min-h-dvh bg-background" />;
  // Also reached when the session expires mid-visit: the sign-in page returns
  // to the page the user was on.
  if (!user) return <Navigate to={loginPath(location)} replace />;
  // A forced password change blocks the whole app until it is resolved, exactly
  // as the API blocks every other endpoint.
  if (user.mustChangePassword) return <ChangePassword />;

  return (
    <div className="min-h-dvh bg-background">
      <Sidebar user={user} onLogout={() => void logout()} />
      <main className="pt-16 lg:pl-64 lg:pt-0">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          {workspacesError && !activeWorkspace ? (
            <LoadErrorState
              title={t('Could not load your workspaces')}
              message={workspacesError}
              onRetry={() => void refreshWorkspaces().catch(() => undefined)}
            />
          ) : (
            <Outlet />
          )}
        </div>
      </main>
    </div>
  );
}
