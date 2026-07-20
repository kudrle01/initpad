import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Layers, Play, Plus, RotateCcw, Server, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/molecules/PageHeader';
import { StatCard } from '@/components/molecules/StatCard';
import { ProjectRow } from '@/components/molecules/ProjectRow';
import { EmptyState } from '@/components/molecules/EmptyState';
import type { Project, ProvisioningStatus, TemplateManifest } from '@/types';

const RECENT_LIMIT = 6;

export default function Dashboard() {
  const navigate = useNavigate();
  const { activeWorkspace } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [provisioning, setProvisioning] = useState<ProvisioningStatus[]>([]);
  const [templates, setTemplates] = useState<Record<string, TemplateManifest>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [operationBusy, setOperationBusy] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch((e) => setError(e.message)).finally(() => setLoading(false));
    api
      .listTemplates()
      .then((all) => setTemplates(Object.fromEntries(all.map((t) => [t.id, t]))))
      .catch(() => {});
    api.listProvisioning().then(setProvisioning).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void api.listProvisioning().then(setProvisioning).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  async function retryOperation(id: string) {
    setOperationBusy(id);
    setError(null);
    try {
      const project = await api.retryProvisioning(id);
      navigate(`/projects/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setProvisioning(await api.listProvisioning().catch(() => provisioning));
    } finally {
      setOperationBusy(null);
    }
  }

  async function retryCleanup(id: string) {
    setOperationBusy(id);
    setError(null);
    try {
      await api.cleanupProvisioning(id);
      const [nextOperations, nextProjects] = await Promise.all([
        api.listProvisioning(),
        api.listProjects(),
      ]);
      setProvisioning(nextOperations);
      setProjects(nextProjects);
    } catch (e) {
      setError((e as Error).message);
      setProvisioning(await api.listProvisioning().catch(() => provisioning));
    } finally {
      setOperationBusy(null);
    }
  }

  const running = projects.reduce(
    (n, p) => n + p.environments.filter((e) => e.status === 'running').length,
    0,
  );
  const environmentCount = projects.reduce((n, p) => n + p.environments.length, 0);
  const recent = projects.slice(0, RECENT_LIMIT);
  const operationsNeedingAttention = provisioning
    .filter((operation) => !['succeeded', 'retried'].includes(operation.status))
    .slice(0, 5);
  const canMaintain = ['owner', 'admin', 'maintainer'].includes(activeWorkspace?.role ?? '');

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your projects and their environments."
        actions={
          <Button asChild>
            <Link to="/new">
              <Plus className="h-4 w-4" /> New project
            </Link>
          </Button>
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Projects" value={loading ? '—' : projects.length} icon={Layers} />
        <StatCard label="Running deploys" value={loading ? '—' : running} icon={Play} />
        <StatCard label="Environments" value={loading ? '—' : environmentCount} icon={Server} />
      </div>

      {operationsNeedingAttention.length > 0 && (
        <section className="mb-8" aria-labelledby="provisioning-heading">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <p id="provisioning-heading" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Provisioning attention
            </p>
          </div>
          <div className="space-y-2">
            {operationsNeedingAttention.map((operation) => (
              <div key={operation.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {operation.projectName} · {operation.kind} · attempt {operation.attempt}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {operation.status === 'interrupted' ? 'Interrupted — external state must be reconciled.' : operation.message || `Current step: ${operation.step}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {operation.projectId && (
                      <Button asChild size="sm" variant="ghost">
                        <Link to={`/projects/${operation.projectId}`}>View project</Link>
                      </Button>
                    )}
                    {operation.needsCleanup && canMaintain && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={operationBusy === operation.id}
                        onClick={() => retryCleanup(operation.id)}
                      >
                        <Wrench className="h-3.5 w-3.5" /> Retry cleanup
                      </Button>
                    )}
                    {operation.canRetry && (
                      <Button
                        size="sm"
                        disabled={operationBusy === operation.id}
                        onClick={() => retryOperation(operation.id)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Retry setup
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mb-3 flex items-baseline justify-between gap-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recent projects
        </p>
        {projects.length > 0 && (
          <Link
            to="/projects"
            className="text-link inline-flex items-center gap-1 text-xs font-medium"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      {!loading && projects.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No projects yet"
          description="Create your first project from a template — you'll get a Git repository, CI/CD pipeline and a running dev environment out of the box."
          action={
            <Button asChild>
              <Link to="/new">
                <Plus className="h-4 w-4" /> New project
              </Link>
            </Button>
          }
        />
      ) : !loading ? (
        <div className="flex flex-col gap-2">
          {recent.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              templateName={templates[p.templateId]?.name ?? p.templateId}
            />
          ))}
        </div>
      ) : <div className="h-28 animate-pulse rounded-lg border border-border bg-card/60" aria-label="Loading projects" />}
    </div>
  );
}
