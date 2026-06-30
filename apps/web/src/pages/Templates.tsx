import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import { Icon } from '@/components/Icon';
import type { TemplateManifest } from '@/types';

export default function Templates() {
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listTemplates().then(setTemplates).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1>Templates</h1>
        <Link to="/new" className="btn btn-primary">
          <Icon name="plus" size={16} /> New project
        </Link>
      </div>
      <p className="lead" style={{ marginTop: '-18px', marginBottom: 26 }}>
        Catalog of project templates. Each one ships with code, a Dockerfile and a
        CI/CD pipeline, so a new project is ready to build and deploy.
      </p>

      {error && <p className="error">{error}</p>}

      <div className="tpl-grid">
        {templates.map((t) => (
          <div key={t.id} className="tpl-card">
            <div className="tpl-card-head">
              <span className="proj-icon">
                <Icon name="box" size={20} />
              </span>
              <div>
                <div className="tpl-card-name">{t.name}</div>
                <div className="tpl-card-lang">{t.language}</div>
              </div>
            </div>
            <p className="tpl-card-desc">{t.description}</p>
            <div className="tpl-card-meta">
              <span className="chip">{t.artifact}</span>
              {t.compatibleProviders.map((p) => (
                <span key={p} className="chip chip-muted">
                  {p}
                </span>
              ))}
            </div>
            <Link to="/new" className="tpl-card-use">
              Use template <Icon name="arrowRight" size={14} />
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
