import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/api';
import { Icon } from '@/components/Icon';
import type { Commit, EnvName, Project, TemplateManifest } from '@/types';

const NEXT: Record<string, EnvName | null> = { dev: 'test', test: 'prod', prod: null };
const ARTIFACT_LABEL: Record<string, string> = {
  static: 'statický build',
  runtime: 'běžící proces',
};

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      <code>{command}</code>
      <button
        className="copy-btn"
        onClick={() => {
          navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={13} />
        {copied ? 'zkopírováno' : 'kopírovat'}
      </button>
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [template, setTemplate] = useState<TemplateManifest | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [openSha, setOpenSha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getProject(id).then(setProject).catch((e) => setError(e.message));
    api.getCommits(id).then((c) => {
      setCommits(c);
      if (c[0]) setOpenSha(c[0].sha);
    }).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!project) return;
    api
      .listTemplates()
      .then((all) => setTemplate(all.find((t) => t.id === project.templateId) ?? null))
      .catch(() => {});
  }, [project]);

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
  if (!project) return <div className="empty-state">Načítám…</div>;

  const created = new Date(project.createdAt).toLocaleString('cs-CZ');
  const cloneUrl = project.repoUrl ? `${project.repoUrl}.git` : null;

  return (
    <div>
      <Link to="/" className="back">
        <Icon name="arrowLeft" size={16} /> Projekty
      </Link>

      <div className="page-head">
        <div className="detail-title">
          <span className="proj-icon">
            <Icon name="box" size={20} />
          </span>
          <h1>{project.name}</h1>
        </div>
        {project.repoUrl && (
          <a href={project.repoUrl} target="_blank" rel="noreferrer" className="btn">
            <Icon name="git" size={16} /> Otevřít repo
          </a>
        )}
      </div>
      {template && <p className="lead" style={{ marginTop: '-16px' }}>{template.description}</p>}

      <div className="section">
        <p className="eyebrow">O projektu</p>
        <div className="card">
          <div className="meta-grid">
            <div className="meta-row">
              <span className="k">Šablona</span>
              <span className="v">{template ? template.name : project.templateId}</span>
            </div>
            <div className="meta-row">
              <span className="k">Jazyk</span>
              <span className="v">{template?.language ?? '—'}</span>
            </div>
            <div className="meta-row">
              <span className="k">Typ artefaktu</span>
              <span className="v">
                {template ? ARTIFACT_LABEL[template.artifact] ?? template.artifact : '—'}
              </span>
            </div>
            <div className="meta-row">
              <span className="k">Vytvořeno</span>
              <span className="v">{created}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <p className="eyebrow">Repozitář</p>
        {project.repoUrl ? (
          <>
            <a href={project.repoUrl} target="_blank" rel="noreferrer" className="repo-link">
              <Icon name="git" size={15} /> {project.repoUrl}
            </a>
            {cloneUrl && <CopyableCommand command={`git clone ${cloneUrl}`} />}
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>
            Lokální složka (Gitea nenakonfigurována): <span className="mono">{project.repoPath}</span>
          </p>
        )}
      </div>

      <div className="section">
        <p className="eyebrow">Prostředí</p>
        <div className="pipeline">
          {project.environments.map((env, i) => {
            const next = NEXT[env.name];
            return (
              <Fragment key={env.name}>
                <div className={`env ${env.name}`}>
                  <div className="env-top">
                    <span className="env-name">{env.name}</span>
                    <span className="badge">
                      <span className={`dot ${env.status}`} />
                      {env.status}
                    </span>
                  </div>
                  <div className="env-version">{env.version ? `v${env.version}` : '—'}</div>
                  <div className="env-meta">{env.provider}</div>
                  {env.url && (
                    <a className="env-url" href={env.url} target="_blank" rel="noreferrer">
                      <Icon name="external" size={12} /> {env.url.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  {next && (
                    <div className="env-foot">
                      <button
                        className="btn btn-sm btn-block"
                        disabled={busy !== null || env.status !== 'running'}
                        onClick={() => promote(next)}
                      >
                        {busy === next ? '…' : (
                          <>
                            promote <Icon name="arrowRight" size={14} /> {next}
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
                {i < project.environments.length - 1 && (
                  <span className="pipe-arrow">
                    <Icon name="chevronRight" size={18} />
                  </span>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      <div className="section">
        <p className="eyebrow">Commits</p>
        <div className="commits">
          {commits.map((c) => {
            const open = openSha === c.sha;
            return (
              <div className="commit" key={c.sha}>
                <button
                  className="commit-head"
                  onClick={() => setOpenSha(open ? null : c.sha)}
                >
                  <span className={`commit-chevron ${open ? 'open' : ''}`}>
                    <Icon name="chevronRight" size={16} />
                  </span>
                  <span className="commit-sha">{c.sha.slice(0, 7)}</span>
                  <span className="commit-msg">{c.message}</span>
                  <span className="badge">
                    <span className="dot pending" /> čeká na CI
                  </span>
                  <span className="commit-author">{c.author}</span>
                </button>
                {open && (
                  <>
                    <div className="stages">
                      {c.pipeline.map((s, i) => (
                        <Fragment key={s.name}>
                          <span className="stage">
                            <span className={`dot ${s.status}`} />
                            {s.name}
                          </span>
                          {i < c.pipeline.length - 1 && (
                            <span className="stage-arrow">
                              <Icon name="chevronRight" size={13} />
                            </span>
                          )}
                        </Fragment>
                      ))}
                    </div>
                    <p className="stages-note">
                      Pipeline se spustí po zapojení CI/CD (Gitea Actions).
                    </p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
