import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Download,
  Layers,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/molecules/PageHeader';
import { StatCard } from '@/components/molecules/StatCard';
import { Badge } from '@/components/ui/badge';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { EmptyState } from '@/components/molecules/EmptyState';
import { EnvironmentStatusList } from '@/components/molecules/EnvironmentStatusList';
import {
  List,
  ListRow,
  listRowClassName,
  listRowInteractiveClassName,
} from '@/components/molecules/List';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { Notice } from '@/components/molecules/Notice';
import { Section } from '@/components/molecules/Section';
import { TemplateIcon } from '@/components/atoms/TemplateIcon';
import { cn } from '@/lib/utils';
import type { WorkspacePortfolio } from '@/api';
import type { ProvisioningStatus, TemplateManifest } from '@/types';
import { useConfirmation } from '@/confirmation';
import { WorkspaceMetricsDialog } from '@/components/organisms/WorkspaceMetricsDialog';
import { t, plural } from '@/i18n';
import { statusLabel, termLabel } from '@/i18n/labels';

const RECENT_LIMIT = 6;

export default function Dashboard() {
  const navigate = useNavigate();
  const confirmAction = useConfirmation();
  const { activeWorkspace } = useAuth();
  const workspaceId = activeWorkspace?.id;
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
      if (!workspaceId) return;
      const [portfolioRows, templateRows, provisioningRows] = await Promise.all([
        api.getWorkspacePortfolio(workspaceId),
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
  }, [workspaceId]);

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
    const refreshProvisioning = () => {
      if (document.visibilityState !== 'visible') return;
      void api
        .listProvisioning()
        .then((rows) => {
          if (current) setProvisioning(rows);
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(refreshProvisioning, 15_000);
    document.addEventListener('visibilitychange', refreshProvisioning);
    return () => {
      current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshProvisioning);
    };
  }, [workspaceId]);

  async function retryOperation(id: string) {
    setOperationBusy(id);
    setActionError(null);
    try {
      const project = await api.retryProvisioning(id);
      void navigate(`/projects/${project.id}`);
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
      title: t('Retry cleanup for {project}?', {
        project: operation?.projectName ?? t('incomplete project'),
      }),
      description: t('Cleanup reconciles resources left behind by an interrupted or failed setup.'),
      confirmLabel: t('Retry cleanup'),
      tone: 'warning',
      details: operation
        ? [
            { label: t('Operation'), value: termLabel(operation.kind) },
            { label: t('Attempt'), value: operation.attempt },
          ]
        : undefined,
      consequences: [
        t(
          'InitPad may delete the partial repository, generated files or project record owned by this failed setup.',
        ),
        t('Successfully provisioned unrelated resources are not touched.'),
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

  const stats = portfolio?.stats;
  const figure = (value: number | undefined) => (loading || loadError ? '—' : (value ?? 0));

  return (
    <div>
      <PageHeader
        title={t('Overview')}
        description={
          activeWorkspace ? t('{name} workspace', { name: activeWorkspace.name }) : undefined
        }
        actions={
          <>
            {canExportMetrics && (
              <Button variant="secondary" onClick={() => setMetricsOpen(true)}>
                <Download className="h-4 w-4" /> {t('Export metrics')}
              </Button>
            )}
            <Button asChild>
              <Link to="/new">
                <Plus className="h-4 w-4" /> {t('New project')}
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

      <div className="flex flex-col gap-4 sm:gap-6">
        {actionError && (
          <Notice tone="danger" role="alert">
            {actionError}
          </Notice>
        )}
        {loadError && <LoadErrorState message={loadError} onRetry={loadDashboard} />}

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard
            label={t('Projects')}
            value={figure(stats?.projects)}
            hint={stats ? plural('{count} environments', stats.environments) : undefined}
            icon={Layers}
          />
          <StatCard
            label={t('Running')}
            value={figure(stats?.runningEnvironments)}
            hint={stats ? plural('{count} server accesses', stats.activeAllocations) : undefined}
            icon={Play}
            tone="brand"
          />
          <StatCard
            label={t('Needs attention')}
            value={figure(stats?.attentionProjects)}
            hint={
              stats
                ? stats.cleanupDebt > 0
                  ? plural('{count} cleanup items', stats.cleanupDebt)
                  : t('Nothing to clean up')
                : undefined
            }
            icon={AlertTriangle}
            tone={stats && stats.attentionProjects + stats.cleanupDebt > 0 ? 'warning' : 'neutral'}
          />
          <StatCard
            label={t('Pending approvals')}
            value={figure(stats?.pendingApprovals)}
            hint={stats ? t('Production requests') : undefined}
            icon={ShieldCheck}
            tone={stats && stats.pendingApprovals > 0 ? 'warning' : 'neutral'}
          />
        </div>

        {operationsNeedingAttention.length > 0 && (
          <Section
            title={t('Provisioning needs attention')}
            headingId="provisioning-heading"
            description={t(
              'A project setup did not finish. Retry it, or clean up what it left behind.',
            )}
            flush
          >
            <List aria-labelledby="provisioning-heading">
              {operationsNeedingAttention.map((operation) => {
                const detail =
                  operation.status === 'interrupted'
                    ? t('Interrupted — external state must be reconciled.')
                    : operation.message || t('Current step: {step}', { step: operation.step });
                return (
                  <ListRow
                    key={operation.id}
                    className="flex-col items-stretch xl:flex-row xl:items-center"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
                        <AlertTriangle className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" title={operation.projectName}>
                          {operation.projectName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t('{kind} · attempt {attempt}', {
                            kind: termLabel(operation.kind),
                            attempt: operation.attempt,
                          })}
                        </p>
                        <p
                          className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground"
                          title={detail}
                        >
                          {detail}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 pl-11 xl:pl-0">
                      {operation.projectId && (
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/projects/${operation.projectId}`}>{t('View project')}</Link>
                        </Button>
                      )}
                      {operation.needsCleanup && canMaintain && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={operationBusy === operation.id}
                          onClick={() => retryCleanup(operation.id)}
                        >
                          <Wrench className="h-3.5 w-3.5" /> {t('Retry cleanup')}
                        </Button>
                      )}
                      {operation.canRetry && (
                        <Button
                          size="sm"
                          disabled={operationBusy === operation.id}
                          onClick={() => retryOperation(operation.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> {t('Retry setup')}
                        </Button>
                      )}
                    </div>
                  </ListRow>
                );
              })}
            </List>
          </Section>
        )}

        {!loadError && !loading && stats?.projects === 0 ? (
          <EmptyState
            icon={Layers}
            title={t('No projects yet')}
            description={t(
              "Create your first project from a template — you'll get a Git repository, CI/CD pipeline and a running dev environment out of the box.",
            )}
            action={
              <Button asChild>
                <Link to="/new">
                  <Plus className="h-4 w-4" /> {t('New project')}
                </Link>
              </Button>
            }
          />
        ) : !loadError && !loading ? (
          <Section
            title={t('Recent projects')}
            flush
            actions={
              (stats?.projects ?? 0) > 0 && (
                <Button asChild variant="ghost" size="sm">
                  <Link to="/projects">
                    {t('View all')} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              )
            }
          >
            <List>
              {recent.map((project) => {
                const templateName = templates[project.templateId]?.name ?? project.templateId;
                return (
                  <li key={project.id}>
                    <Link
                      to={`/projects/${project.id}`}
                      className={cn(listRowClassName, listRowInteractiveClassName, 'group')}
                    >
                      <TemplateIcon
                        templateId={project.templateId}
                        language={templateName}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium" title={project.name}>
                            {project.name}
                          </span>
                          {project.health === 'attention' && (
                            <Badge variant="danger">{t('attention')}</Badge>
                          )}
                          {project.health === 'deploying' && (
                            <Badge variant="warning">{t('deploying')}</Badge>
                          )}
                          {project.pendingApprovals > 0 && (
                            <Badge variant="warning" className="hidden sm:inline-flex">
                              {plural('{count} approvals', project.pendingApprovals)}
                            </Badge>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {templateName}
                          {' · '}
                          {project.lastBuild
                            ? t('build {sha} {status}', {
                                sha: project.lastBuild.commitSha.slice(0, 7),
                                status: statusLabel(project.lastBuild.status),
                              })
                            : t('no verified build yet')}
                          {project.lastDeployment
                            ? ` · ${project.lastDeployment.environment} ${termLabel(project.lastDeployment.kind)} ${statusLabel(project.lastDeployment.status)}`
                            : ''}
                        </p>
                        <EnvironmentStatusList
                          environments={project.environments}
                          className="mt-1.5 md:hidden"
                        />
                      </div>
                      <EnvironmentStatusList
                        environments={project.environments}
                        className="hidden shrink-0 justify-end md:flex"
                      />
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </Link>
                  </li>
                );
              })}
            </List>
          </Section>
        ) : !loadError ? (
          <ContentLoading label={t('Loading projects')} />
        ) : null}
      </div>
    </div>
  );
}
