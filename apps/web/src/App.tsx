import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/auth';
import { Sidebar } from '@/components/organisms/Sidebar';

export default function App() {
  const { user, loading, logout } = useAuth();

  if (loading) return <div className="min-h-screen bg-background" />;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar user={user} onLogout={logout} />
      <main className="pl-16 lg:pl-60">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
