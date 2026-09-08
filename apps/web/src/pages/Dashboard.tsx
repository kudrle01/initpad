import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Download, Layers, Play, Plus, RotateCcw, ShieldCheck, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/molecules/PageHeader';
import { StatCard } from '@/components/molecules/StatCard';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { EmptyState } from '@/components/molecules/EmptyState';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import type { WorkspacePortfolio } from '@/api';
import type { ProvisioningStatus, TemplateManifest } from '@/types';
import { useConfirmation } from '@/confirmation';
import { WorkspaceMetricsDialog } from '@/components/organisms/WorkspaceMetricsDialog';

const RECENT_LIMIT = 6;

export default function Dashboard() {
  const navigate = useNavigate();
  const confirmAction = useConfirmation();
  const { activeWorkspace } = useAuth();
  const [portfolio, setPortfolio] = useState<WorkspacePortfolio | null>(null);
  const [provisioning, setProvisioning] = useState<ProvisioningStatus[]>([]);
  const [templates, setTemplates] = useState<Record<string, TemplateManifest>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [operationBusy, setOperationBusy] = useState<string | null>(null);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const requestSequence = useRef(0);

  const loadDashboard = useCallback(async () => {
    const request = ++requestSequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      if (!activeWorkspace) return;
      const [portfolioRows, templateRows, provisioningRows] = await Promise.all([
        api.getWorkspacePortfolio(activeWorkspace.id),
        api.listTemplates().catch(() => [] as TemplateManifest[]),
        api.listProvisioning().catch(() => [] as ProvisioningStatus[]),
      ]);
      if (request !== requestSequence.current) return;
      setPortfolio(portfolioRows);
      setTemplates(Object.fromEntries(templateRows.map((template) => [template.id, template])));
      setProvisioning(provisioningRows);
    } catch (cause) {
      if (request === requestSequence.current) setLoadError((cause as Error).message);
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    setPortfolio(null);
    setProvisioning([]);
    void loadDashboard();
    return () => {
      requestSequence.current += 1;
    };
  }, [loadDashboard]);

  useEffect(() => {
    let current = true;
    const timer = window.setInterval(() => {
      void api.listProvisioning()
        .then((rows) => {
          if (current) setProvisioning(rows);
        })
        .catch(() => undefined);
    }, 15_000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [activeWorkspace?.id]);

  async function retryOperation(id: string) {
    setOperationBusy(id);
    setActionError(null);
    try {
      const project = await api.retryProvisioning(id);
      navigate(`/projects/${project.id}`);
    } catch (e) {
      setActionError((e as Error).message);
      setProvisioning(await api.listProvisioning().catch(() => provisioning));
    } finally {
      setOperationBusy(null);
    }
  }

  async function retryCleanup(id: string) {
    const operation = provisioning.find((candidate) => candidate.id === id);
    const confirmed = await confirmAction({
      title: `Retry cleanup for ${operation?.projectName ?? 'incomplete project'}?`,
      description: 'Cleanup reconciles resources left behind by an interrupted or failed setup.',
      confirmLabel: 'Retry cleanup',
      tone: 'warning',
      details: operation ? [
        { label: 'Operation', value: operation.kind },
        { label: 'Attempt', value: operation.attempt },
      ] : undefined,
      consequences: [
        'InitPad may delete the partial repository, generated files or project record owned by this failed setup.',
        'Successfully provisioned unrelated resources are not touched.',
      ],
    });
    if (!confirmed) return;
    setOperationBusy(id);
    setActionError(null);
    try {
      await api.cleanupProvisioning(id);
      const [nextOperations, nextPortfolio] = await Promise.all([
        api.listProvisioning(),
        api.getWorkspacePortfolio(activeWorkspace!.id),
      ]);
      setProvisioning(nextOperations);
      setPortfolio(nextPortfolio);
    } catch (e) {
      setActionError((e as Error).message);
      setProvisioning(await api.listProvisioning().catch(() => provisioning));
    } finally {
      setOperationBusy(null);
    }
  }

  const recent = portfolio?.projects.slice(0, RECENT_LIMIT) ?? [];
  const operationsNeedingAttention = provisioning
    .filter((operation) => !['succeeded', 'retried'].includes(operation.status))
    .slice(0, 5);
  const canMaintain = ['owner', 'admin', 'maintainer'].includes(activeWorkspace?.role ?? '');
  const canExportMetrics = ['owner', 'admin'].includes(activeWorkspace?.role ?? '');

  return (
    <div>
      <PageHeader
        title="Overview"
        actions={
          <>
            {canExportMetrics && (
              <Button variant="secondary" onClick={() => setMetricsOpen(true)}>
                <Download className="h-4 w-4" /> Export metrics
              </Button>
            )}
            <Button asChild>
              <Link to="/new">
                <Plus className="h-4 w-4" /> New project
              </Link>
            </Button>
          </>
        }
      />

      {activeWorkspace && canExportMetrics && (
        <WorkspaceMetricsDialog
          workspaceId={activeWorkspace.id}
          open={metricsOpen}
          onOpenChange={setMetricsOpen}
        />
      )}

      {actionError && (
        <p role="alert" className="mb-4 text-sm text-destructive">{actionError}</p>
      )}
      {loadError && (
        <LoadErrorState className="mb-4" message={loadError} onRetry={loadDashboard} />
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Projects" value={loading || loadError ? '—' : portfolio?.stats.projects ?? 0} icon={Layers} />
        <StatCard label="Running" value={loading || loadError ? '—' : portfolio?.stats.runningEnvironments ?? 0} icon={Play} />
        <StatCard label="Needs attention" value={loading || loadError ? '—' : portfolio?.stats.attentionProjects ?? 0} icon={AlertTriangle} />
        <StatCard label="Pending approvals" value={loading || loadError ? '—' : portfolio?.stats.pendingApprovals ?? 0} icon={ShieldCheck} />
      </div>

      {!loading && !loadError && portfolio && (
        <div className="mb-8 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-border bg-secondary/30 px-4 py-3 text-xs text-muted-foreground">
          <span><strong className="text-foreground">{portfolio.stats.environments}</strong> environments</span>
          <span><strong className="text-foreground">{portfolio.stats.activeAllocations}</strong> active server accesses</span>
          <span className={portfolio.stats.cleanupDebt ? 'text-warning' : undefined}>
            <strong className="text-foreground">{portfolio.stats.cleanupDebt}</strong> cleanup items
          </span>
        </div>
      )}

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
        {(portfolio?.stats.projects ?? 0) > 0 && (
          <Link
            to="/projects"
            className="text-link inline-flex items-center gap-1 text-xs font-medium"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      {!loadError && !loading && portfolio?.stats.projects === 0 ? (
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
      ) : !loadError && !loading ? (
        <div className="flex flex-col gap-2">
          {recent.map((project) => {
            const status = project.health === 'attention'
              ? 'failed'
              : project.health === 'deploying'
                ? 'deploying'
                : project.health === 'healthy'
                  ? 'running'
                  : 'empty';
            return (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold group-hover:text-primary">{project.name}</span>
                      <StatusBadge status={status} label={project.health === 'attention' ? 'attention' : project.health} />
                      {project.pendingApprovals > 0 && (
                        <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                          {project.pendingApprovals} approval{project.pendingApprovals === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {templates[project.templateId]?.name ?? project.templateId}
                      {project.lastBuild ? ` · build ${project.lastBuild.commitSha.slice(0, 7)} ${project.lastBuild.status}` : ' · no verified build yet'}
                      {project.lastDeployment ? ` · ${project.lastDeployment.environment} ${project.lastDeployment.kind} ${project.lastDeployment.status}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {project.environments.map((environment) => (
                      <span key={environment.name} className="text-[11px] text-muted-foreground">
                        {environment.name} <strong className="font-medium text-foreground">{environment.status}</strong>
                      </span>
                    ))}
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : !loadError ? (
        <div className="h-28 animate-pulse rounded-lg border border-border bg-card/60" aria-label="Loading projects" />
      ) : null}
    </div>
  );
}
