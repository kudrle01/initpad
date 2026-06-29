import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { Project } from '@/types';

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch((e) => setError(e.message));
  }, []);

  const running = projects.reduce(
    (n, p) => n + p.environments.filter((e) => e.status === 'running').length,
    0,
  );

  return (
    <div>
      <div className="page-head">
        <h1>Přehled</h1>
        <Link to="/new" className="btn btn-primary">
          + Nový projekt
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Projekty</div>
          <div className="stat-value">{projects.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Běžící deploye</div>
          <div className="stat-value">{running}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Prostředí</div>
          <div className="stat-value">3</div>
        </div>
      </div>

      <h2 className="section-title">Poslední projekty</h2>
      {projects.length === 0 ? (
        <p className="muted">Zatím žádné projekty. Vytvoř první přes „Nový projekt“.</p>
      ) : (
        <div className="list">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="row">
              <div>
                <div className="row-title">{p.name}</div>
                <div className="row-sub">{p.templateId}</div>
              </div>
              <div className="env-badges">
                {p.environments.map((e) => (
                  <span key={e.name} className={`pill pill-${e.status}`}>
                    {e.name} {e.version ? `v${e.version}` : '—'}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
