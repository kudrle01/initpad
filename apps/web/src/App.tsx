import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/auth';
import { Sidebar } from '@/components/organisms/Sidebar';
import ChangePassword from '@/pages/ChangePassword';

export default function App() {
  const { user, loading, logout } = useAuth();

  if (loading) return <div className="min-h-screen bg-background" />;
  if (!user) return <Navigate to="/login" replace />;
  // A forced password change blocks the whole app until it is resolved, exactly
  // as the API blocks every other endpoint.
  if (user.mustChangePassword) return <ChangePassword />;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar user={user} onLogout={() => void logout()} />
      <main className="pt-16 lg:pl-60 lg:pt-0">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
