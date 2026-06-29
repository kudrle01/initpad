import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/api';
import type { EnvName, Project } from '@/types';

const NEXT: Record<string, EnvName | null> = { dev: 'test', test: 'prod', prod: null };

export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (id) api.getProject(id).then(setProject).catch((e) => setError(e.message));
  }, [id]);

  async function promote(target: EnvName) {
    if (!id) return;
    setBusy(target);
    setError(null);
    try {
      setProject(await api.promote(id, target));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!project) return <p className="muted">Načítám…</p>;

  return (
    <div>
      <div className="page-head">
        <h1>{project.name}</h1>
        <Link to="/" className="btn">
          ← Zpět
        </Link>
      </div>
      <p className="muted">
        {project.templateId} · poslední commit: {project.lastCommit}
      </p>

      <h2 className="section-title">Promotion pipeline</h2>
      <div className="pipeline">
        {project.environments.map((env) => {
          const next = NEXT[env.name];
          return (
            <div key={env.name} className={`env-card env-${env.name}`}>
              <div className="env-head">
                <span className="env-name">{env.name}</span>
                <span className={`pill pill-${env.status}`}>{env.status}</span>
              </div>
              <div className="env-version">{env.version ? `v${env.version}` : '—'}</div>
              <div className="env-provider">{env.provider}</div>
              {env.url && (
                <a className="env-url" href={env.url} target="_blank" rel="noreferrer">
                  {env.url}
                </a>
              )}
              {next && (
                <button
                  className="btn btn-small"
                  disabled={busy !== null || env.status !== 'running'}
                  onClick={() => promote(next)}
                >
                  {busy === next ? '…' : `promote → ${next}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="muted small">
        Repo: {project.repoPath}
      </p>
    </div>
  );
}
