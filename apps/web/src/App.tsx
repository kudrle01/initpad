import { Link, NavLink, Outlet } from 'react-router-dom';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">IP</span>
          <span>InitPad</span>
          <span className="badge">prototyp</span>
        </Link>
      </header>
      <div className="layout">
        <nav className="sidebar">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/new">Nový projekt</NavLink>
        </nav>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
