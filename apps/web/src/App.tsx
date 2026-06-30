import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/auth';
import { Icon } from '@/components/Icon';

function initials(name: string) {
  return name.split(/[\s.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

export default function App() {
  const { user, loading, logout } = useAuth();

  if (loading) return <div className="login-screen" />;
  if (!user) return <Navigate to="/login" replace />;

  const display = user.name || user.username;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">IP</span>
          <span className="brand-name">InitPad</span>
          <span className="brand-badge">beta</span>
        </div>

        <nav className="nav">
          <NavLink to="/" end className="nav-item">
            <Icon name="dashboard" size={17} /> Dashboard
          </NavLink>
          <NavLink to="/projects" className="nav-item">
            <Icon name="layers" size={17} /> Projects
          </NavLink>
          <NavLink to="/templates" className="nav-item">
            <Icon name="folder" size={17} /> Templates
          </NavLink>
          <NavLink to="/new" className="nav-item">
            <Icon name="plus" size={17} /> New project
          </NavLink>

          <div className="nav-label">Platform</div>
          <NavLink to="/environments" className="nav-item">
            <Icon name="server" size={17} /> Environments
          </NavLink>
          <NavLink to="/activity" className="nav-item">
            <Icon name="activity" size={17} /> Activity
          </NavLink>
          <NavLink to="/infrastructure" className="nav-item">
            <Icon name="network" size={17} /> Infrastructure
          </NavLink>
          <NavLink to="/settings" className="nav-item">
            <Icon name="settings" size={17} /> Settings
          </NavLink>
        </nav>

        <div className="sidebar-foot">
          <div className="user">
            <span className="avatar">{initials(display)}</span>
            <div className="user-info">
              <div className="user-name">{display}</div>
              <div className="user-sub">@{user.username}</div>
            </div>
            <button className="icon-btn" title="Sign out" onClick={logout}>
              <Icon name="external" size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="container">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
