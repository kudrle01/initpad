import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api';
import { useToast } from '@/toast';
import { Icon } from '@/components/Icon';
import type { Commit, EnvName, Project, TemplateManifest } from '@/types';

// Projekt se po vytvoření dotahuje na pozadí (dev: deploying → running) a CI
// běží asynchronně – dokud něco "pracuje", detail se sám periodicky obnovuje.
function isLive(project: Project | null, commits: Commit[]): boolean {
  const envBusy = project?.environments.some((e) => e.status === 'deploying') ?? false;
  const ciBusy = commits.some((c) => c.pipeline.some((s) => s.status === 'running'));
  return envBusy || ciBusy;
}

function DetailSkeleton() {
  return (
    <div className="skeleton">
      <div className="skel skel-line" style={{ width: 180, height: 26 }} />
      <div className="skel skel-line" style={{ width: 260 }} />
      <div className="skel-pipeline">
        <div className="skel skel-card" />
        <div className="skel skel-card" />
        <div className="skel skel-card" />
      </div>
      <div className="skel skel-line" style={{ width: 120, marginTop: 24 }} />
      <div className="skel skel-line" style={{ width: '100%' }} />
      <div className="skel skel-line" style={{ width: '100%' }} />
    </div>
  );
}

const NEXT: Record<string, EnvName | null> = { dev: 'test', test: 'prod', prod: null };

// Souhrnný stav commitu z jeho pipeline stagí (zobrazený v hlavičce commitu).
function commitStatus(pipeline: { status: string }[]): { label: string; dot: string } {
  if (pipeline.some((s) => s.status === 'failed')) return { label: 'failed', dot: 'failed' };
  if (pipeline.length > 0 && pipeline.every((s) => s.status === 'success'))
    return { label: 'passed', dot: 'success' };
  if (pipeline.some((s) => s.status === 'running')) return { label: 'running', dot: 'running' };
  return { label: 'awaiting CI', dot: 'pending' };
}

// Odkazy do Gitey vede přes /user/login?redirect_to=… – odhlášený dostane login
// stránku s tlačítkem „Sign in with InitPad" (SSO) místo 404 u privátního repa,
// přihlášený se rovnou prokliká na cíl.
function giteaLink(targetUrl: string | null): string | undefined {
  if (!targetUrl) return undefined;
  try {
    const u = new URL(targetUrl);
    return `${u.origin}/user/login?redirect_to=${encodeURIComponent(u.pathname + u.search)}`;
  } catch {
    return targetUrl;
  }
}

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
        {copied ? 'copied' : 'copy'}
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
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [logsEnv, setLogsEnv] = useState<EnvName | null>(null);
  const [logsText, setLogsText] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  function openLogs(envName: EnvName) {
    if (!id) return;
    setLogsEnv(envName);
    setLogsText('');
    setLogsLoading(true);
    api
      .getLogs(id, envName)
      .then((r) => setLogsText(r.logs || '(no output)'))
      .catch((e) => setLogsText(`Error: ${(e as Error).message}`))
      .finally(() => setLogsLoading(false));
  }

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, c] = await Promise.all([
        api.getProject(id),
        api.getCommits(id).catch(() => [] as Commit[]),
      ]);
      setProject(p);
      setCommits(c);
      setOpenSha((cur) => cur ?? c[0]?.sha ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // První načtení (se skeletonem).
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Dokud něco "žije" (deploying / CI running), periodicky obnovuj.
  useEffect(() => {
    if (!isLive(project, commits)) return;
    const t = setTimeout(load, 2500);
    return () => clearTimeout(t);
  }, [project, commits, load]);

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
    try {
      setProject(await api.promote(id, target));
      toast.success(`Promoted to ${target}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function redeploy(envName: EnvName) {
    if (!id) return;
    setBusy(`redeploy-${envName}`);
    try {
      setProject(await api.redeploy(id, envName));
      toast.success(`Redeploying ${envName}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doDelete() {
    if (!id || !project) return;
    setDeleting(true);
    try {
      await api.deleteProject(id);
      toast.success(`Deleted ${project.name}`);
      navigate('/');
    } catch (e) {
      toast.error((e as Error).message);
      setDeleting(false);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (loading && !project) return <DetailSkeleton />;
  if (!project) return <div className="empty-state">Loading…</div>;

  const created = new Date(project.createdAt).toLocaleDateString('en-GB');
  const cloneUrl = project.repoUrl ? `${project.repoUrl}.git` : null;
  const byEnv = Object.fromEntries(project.environments.map((e) => [e.name, e]));

  return (
    <div>
      <Link to="/" className="back">
        <Icon name="arrowLeft" size={16} /> Projects
      </Link>

      <div className="page-head">
        <div className="detail-title">
          <span className="proj-icon">
            <Icon name="box" size={20} />
          </span>
          <h1>{project.name}</h1>
        </div>
        <div className="head-actions">
          {project.repoUrl && (
            <a href={giteaLink(project.repoUrl)} target="_blank" rel="noreferrer" className="btn">
              <Icon name="git" size={16} /> Open repo
            </a>
          )}
          <div className="menu-wrap">
            <button
              className="btn btn-icon"
              aria-label="More actions"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <Icon name="more" size={16} />
            </button>
            {menuOpen && (
              <>
                <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="menu">
                  <button
                    className="menu-item danger"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmText('');
                      setConfirmOpen(true);
                    }}
                  >
                    <Icon name="trash" size={15} /> Delete project
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {template && (
        <p className="lead" style={{ marginTop: '-10px' }}>
          {template.name} · created {created}
        </p>
      )}

      <div className="section">
        <p className="eyebrow">Repository</p>
        {project.repoUrl && (
          <a href={giteaLink(project.repoUrl)} target="_blank" rel="noreferrer" className="repo-link">
            <Icon name="git" size={15} /> {project.repoUrl}
          </a>
        )}
        {cloneUrl && <CopyableCommand command={`git clone ${cloneUrl}`} />}
      </div>

      <div className="section">
        <p className="eyebrow">Environments</p>
        <div className="pipeline">
          {project.environments.map((env, i) => {
            const next = NEXT[env.name];
            const target = next ? byEnv[next] : undefined;
            const synced =
              !!target && !!env.version && target.status === 'running' && target.version === env.version;
            const canPromote = busy === null && env.status === 'running' && !synced;
            const deploying = busy === next;
            const state = synced ? 'is-synced' : deploying ? 'is-busy' : canPromote ? 'is-ready' : 'is-idle';
            return (
              <Fragment key={env.name}>
                <div className={`env ${env.name}`}>
                  <div className="env-top">
                    <span className="env-name">{env.name}</span>
                    <span className="env-top-right">
                      {env.version ? (
                        <button
                          className="badge badge-btn"
                          title="View deploy detail & logs"
                          onClick={() => openLogs(env.name)}
                        >
                          <span className={`dot ${env.status}`} />
                          {env.status}
                        </button>
                      ) : (
                        <span className="badge">
                          <span className={`dot ${env.status}`} />
                          {env.status}
                        </span>
                      )}
                      {env.version && (
                        <button
                          className="env-redeploy"
                          disabled={busy !== null}
                          title="Redeploy this environment"
                          onClick={() => redeploy(env.name)}
                        >
                          <Icon name="refresh" size={13} />
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="env-version">{env.version ? `v${env.version.slice(0, 7)}` : '—'}</div>
                  <div className="env-meta">{env.provider}</div>
                  <a
                    className="env-url"
                    href={env.url ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    style={{ visibility: env.url ? 'visible' : 'hidden' }}
                  >
                    <Icon name="external" size={12} /> {env.url?.replace(/^https?:\/\//, '') ?? '—'}
                  </a>
                  {env.status === 'failed' && env.statusReason && (
                    <button className="env-reason" onClick={() => openLogs(env.name)}>
                      <Icon name="alert" size={12} /> {env.statusReason}
                    </button>
                  )}
                </div>

                {next && (
                  <div className={`promote ${state}`}>
                    {synced ? (
                      <>
                        <span className="promote-node"><Icon name="check" size={16} /></span>
                        <span className="promote-cap">in sync</span>
                      </>
                    ) : deploying ? (
                      <>
                        <span className="promote-node"><span className="promote-spin" /></span>
                        <span className="promote-cap">deploying…</span>
                      </>
                    ) : (
                      <>
                        <button
                          className="promote-node"
                          disabled={!canPromote}
                          onClick={() => promote(next)}
                          title={
                            canPromote
                              ? `Deploy v${env.version} from ${env.name} to ${next}`
                              : `Deploy to ${env.name} first`
                          }
                        >
                          <Icon name="arrowRight" size={16} />
                        </button>
                        <span className="promote-cap">
                          {canPromote ? `Deploy to ${next}` : next}
                        </span>
                      </>
                    )}
                  </div>
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
            const ci = commitStatus(c.pipeline);
            return (
              <div className="commit" key={c.sha}>
                <div
                  className="commit-head"
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenSha(open ? null : c.sha)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setOpenSha(open ? null : c.sha);
                  }}
                >
                  <span className={`commit-chevron ${open ? 'open' : ''}`}>
                    <Icon name="chevronRight" size={16} />
                  </span>
                  {project.repoUrl && c.sha !== 'initial' ? (
                    <a
                      className="commit-sha commit-sha-link"
                      href={giteaLink(`${project.repoUrl}/commit/${c.sha}`)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title="View commit in Gitea"
                    >
                      {c.sha.slice(0, 7)}
                    </a>
                  ) : (
                    <span className="commit-sha">{c.sha.slice(0, 7)}</span>
                  )}
                  <span className="commit-msg">{c.message}</span>
                  <span className="badge">
                    <span className={`dot ${ci.dot}`} /> {ci.label}
                  </span>
                  <span className="commit-author">{c.author}</span>
                </div>
                {open && (
                  <>
                    <div className="stages">
                      {c.pipeline.map((s, i) => (
                        <Fragment key={s.name}>
                          {s.url ? (
                            <a
                              className="stage stage-link"
                              href={giteaLink(s.url)}
                              target="_blank"
                              rel="noreferrer"
                              title="View job log in Gitea"
                            >
                              <span className={`dot ${s.status}`} />
                              {s.name}
                              <Icon name="external" size={11} />
                            </a>
                          ) : (
                            <span className="stage">
                              <span className={`dot ${s.status}`} />
                              {s.name}
                            </span>
                          )}
                          {i < c.pipeline.length - 1 && (
                            <span className="stage-arrow">
                              <Icon name="chevronRight" size={13} />
                            </span>
                          )}
                        </Fragment>
                      ))}
                    </div>
                    {(() => {
                      const runUrl =
                        c.pipeline.find((s) => s.url)?.url ??
                        (project.repoUrl ? `${project.repoUrl}/actions` : null);
                      if (ci.label === 'awaiting CI') {
                        return (
                          <p className="stages-note">
                            Waiting for the Gitea Actions runner to pick up this commit.
                          </p>
                        );
                      }
                      return runUrl ? (
                        <a
                          className="stages-link"
                          href={giteaLink(runUrl)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View run &amp; logs in Gitea <Icon name="external" size={12} />
                        </a>
                      ) : null;
                    })()}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {confirmOpen && (
        <div
          className="modal-overlay"
          onClick={() => !deleting && setConfirmOpen(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              <Icon name="trash" size={18} /> Delete project
            </div>
            <p className="modal-text">
              This permanently stops and removes all containers and images,
              deletes the Git repository in Gitea, and removes the project. This
              action cannot be undone.
            </p>
            <p className="modal-text">
              Type <strong>{project.name}</strong> to confirm:
            </p>
            <input
              className="modal-input"
              value={confirmText}
              autoFocus
              placeholder={project.name}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && confirmText === project.name) doDelete();
                if (e.key === 'Escape' && !deleting) setConfirmOpen(false);
              }}
            />
            <div className="modal-actions">
              <button
                className="btn"
                onClick={() => setConfirmOpen(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={doDelete}
                disabled={confirmText !== project.name || deleting}
              >
                <Icon name="trash" size={15} />{' '}
                {deleting ? 'deleting…' : 'Delete project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {logsEnv && (
        <div className="modal-overlay" onClick={() => setLogsEnv(null)}>
          <div className="modal logs-modal" onClick={(e) => e.stopPropagation()}>
            <div className="logs-head">
              <div className="logs-title">
                <Icon name="terminal" size={16} /> {project.name} · {logsEnv} · logs
              </div>
              <button
                className="env-redeploy"
                title="Refresh"
                disabled={logsLoading}
                onClick={() => openLogs(logsEnv)}
              >
                <Icon name="refresh" size={13} />
              </button>
            </div>
            <pre className="logs-body">
              {logsLoading ? 'Loading…' : logsText}
            </pre>
            <div className="modal-actions">
              <button className="btn" onClick={() => setLogsEnv(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
