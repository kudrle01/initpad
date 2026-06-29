import { NavLink, Outlet } from 'react-router-dom';
import { Icon } from '@/components/Icon';

export default function App() {
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
          <NavLink to="/new" className="nav-item">
            <Icon name="plus" size={17} /> Nový projekt
          </NavLink>
        </nav>

        <div className="sidebar-foot">
          <div className="user">
            <span className="avatar">JK</span>
            <div>
              <div className="user-name">Jan Kudrlička</div>
              <div className="user-sub">InitPad</div>
            </div>
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
