import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import { Icon } from '@/components/Icon';
import type { Project, TemplateManifest } from '@/types';

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Record<string, TemplateManifest>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch((e) => setError(e.message));
    api
      .listTemplates()
      .then((all) => setTemplates(Object.fromEntries(all.map((t) => [t.id, t]))))
      .catch(() => {});
  }, []);

  const running = projects.reduce(
    (n, p) => n + p.environments.filter((e) => e.status === 'running').length,
    0,
  );

  return (
    <div>
      <div className="page-head">
        <h1>Projekty</h1>
        <Link to="/new" className="btn btn-primary">
          <Icon name="plus" size={16} /> Nový projekt
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="stats">
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

      <p className="eyebrow">Poslední projekty</p>
      {projects.length === 0 ? (
        <div className="empty-state">
          Zatím žádné projekty. Vytvoř první přes „Nový projekt".
        </div>
      ) : (
        <div className="proj-list">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="proj">
              <span className="proj-icon">
                <Icon name="box" size={19} />
              </span>
              <div className="proj-body">
                <div className="proj-name">{p.name}</div>
                <div className="proj-sub">
                  {templates[p.templateId]?.name ?? p.templateId}
                </div>
              </div>
              <div className="proj-envs">
                {p.environments.map((e) => (
                  <span key={e.name} className="badge">
                    <span className={`dot ${e.status}`} />
                    {e.name} {e.version ? `v${e.version}` : '—'}
                  </span>
                ))}
              </div>
              <span className="proj-chevron">
                <Icon name="chevronRight" size={18} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
