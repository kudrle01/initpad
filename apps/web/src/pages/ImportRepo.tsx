import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AlertTriangle, Check, DownloadCloud, Github, LayoutTemplate } from 'lucide-react';
import { api, type GitHubStatus } from '@/api';
import { useToast } from '@/toast';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { InfoTip } from '@/components/molecules/InfoTip';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { Notice } from '@/components/molecules/Notice';
import { PageHeader } from '@/components/molecules/PageHeader';
import { Section } from '@/components/molecules/Section';
import { StepBadge } from '@/components/molecules/StepBadge';
import { Spinner } from '@/components/atoms/Spinner';
import { PipelinePresetField } from '@/components/organisms/PipelinePresetField';
import { DEFAULT_PIPELINE_PRESET, pipelineStages } from '@/lib/pipeline-presets';
import {
  EnvironmentTargetFields,
  environmentTargetHelp,
  suggestedEnvironmentTargets,
  type EnvironmentTargets,
} from '@/components/organisms/EnvironmentTargetFields';
import type {
  EnvName,
  ImportableRepo,
  ImportPreflight,
  PipelinePreset,
  Target,
  TemplateManifest,
} from '@/types';
import { t, rich } from '@/i18n';

// Import an existing repository: pick a repo + template, run a preflight against
// the runtime contract, then record the project without touching the code.
export default function ImportRepo() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeWorkspace, user } = useAuth();
  const readOnly = activeWorkspace?.role === 'viewer';
  const hosted = user?.edition === 'saas';

  const [repos, setRepos] = useState<ImportableRepo[]>([]);
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [repositoryId, setRepositoryId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [pipelinePreset, setPipelinePreset] = useState<PipelinePreset>(DEFAULT_PIPELINE_PRESET);
  const [preflight, setPreflight] = useState<ImportPreflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloadingWorkflow, setDownloadingWorkflow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null);
  const [environmentTargets, setEnvironmentTargets] = useState<EnvironmentTargets>({
    dev: '',
    test: '',
    prod: '',
  });
  const selectedStages = pipelineStages(pipelinePreset);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError(null);
    setRepos([]);
    setTemplates([]);
    setTargets([]);
    setRepositoryId('');
    setTemplateId('');
    setPreflight(null);
    setGhStatus(null);
    Promise.all([
      api.listImportableRepos(),
      api.listTemplates(),
      api.listTargets(),
      hosted ? api.githubStatus() : Promise.resolve(null),
    ])
      .then(([repoRows, templateRows, targetRows, github]) => {
        if (!current) return;
        setRepos(repoRows);
        setTemplates(templateRows);
        setTargets(targetRows);
        setGhStatus(github);
        if (templateRows[0]) setTemplateId(templateRows[0].id);
        const firstImportable = repoRows.find((x) => !x.alreadyImported && !x.empty);
        if (firstImportable) setRepositoryId(firstImportable.repositoryId);
      })
      .catch((e) => {
        if (current) setLoadError((e as Error).message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [hosted, activeWorkspace?.id, reloadKey]);

  // A fresh choice invalidates the previous preflight.
  useEffect(() => setPreflight(null), [repositoryId, templateId]);

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.repositoryId === repositoryId) ?? null,
    [repos, repositoryId],
  );
  const template = useMemo(
    () => templates.find((item) => item.id === templateId) ?? null,
    [templates, templateId],
  );

  useEffect(() => {
    setEnvironmentTargets(suggestedEnvironmentTargets(template, targets, hosted));
  }, [template, targets, hosted]);

  function chooseTarget(environment: EnvName, targetId: string) {
    setEnvironmentTargets((current) => ({ ...current, [environment]: targetId }));
  }

  async function runPreflight() {
    if (!repositoryId || !templateId) return;
    setChecking(true);
    try {
      setPreflight(await api.importPreflight(repositoryId, templateId));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function doImport() {
    if (
      readOnly ||
      !preflight?.canImport ||
      selectedStages.some((stage) => !environmentTargets[stage])
    )
      return;
    setBusy(true);
    try {
      const project = await api.importRepo(
        repositoryId,
        templateId,
        selectedStages.map((environment) => ({
          name: environment,
          targetId: environmentTargets[environment],
        })),
        pipelinePreset,
      );
      toast.success(t('Repository imported'));
      void navigate(`/projects/${project.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  async function downloadStarterWorkflow() {
    if (!templateId || !selectedRepo) return;
    setDownloadingWorkflow(true);
    try {
      const file = await api.downloadTemplateWorkflow(templateId, selectedRepo.provider);
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(t('Starter workflow downloaded'));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDownloadingWorkflow(false);
    }
  }

  const canImport =
    !!preflight &&
    !readOnly &&
    !busy &&
    preflight.canImport &&
    !(hosted && !ghStatus?.ciCallbackReady) &&
    selectedStages.every((environment) => environmentTargets[environment]);

  return (
    <div>
      <PageHeader
        title={t('Import existing repository')}
        description={t(
          'Connect a repository you already have. InitPad validates it — your code is never rewritten.',
        )}
        help={[
          {
            title: t('Import'),
            description: t('Records the project, connects CI and prepares its environments.'),
          },
          {
            title: t('Source code'),
            description: t('Your repository contents are validated, never rewritten.'),
          },
        ]}
        actions={
          <Button asChild variant="secondary">
            <Link to="/new">
              <LayoutTemplate className="h-4 w-4" /> {t('Start from a template')}
            </Link>
          </Button>
        }
      />

      {(readOnly || (hosted && ghStatus && !ghStatus.ciCallbackReady)) && (
        <div className="mb-4 flex flex-col gap-3">
          {readOnly && (
            <Notice tone="warning" role="alert">
              {t(
                'Viewer access is read-only. Ask a workspace admin for a member or maintainer role to import projects.',
              )}
            </Notice>
          )}
          {hosted && ghStatus && !ghStatus.ciCallbackReady && (
            <Notice tone="danger" role="alert">
              {rich(
                '{issue} Configure a public HTTPS <code>INITPAD_PUBLIC_URL</code> before importing.',
                {
                  issue:
                    ghStatus.ciCallbackIssue ?? t('GitHub cannot reach the InitPad CI callback.'),
                  code: (chunk) => <code className="font-mono">{chunk}</code>,
                },
              )}
            </Notice>
          )}
        </div>
      )}

      {loadError ? (
        <LoadErrorState message={loadError} onRetry={() => setReloadKey((value) => value + 1)} />
      ) : loading ? (
        <ContentLoading label={t('Loading repositories')} variant="detail" />
      ) : (
        <div className="grid items-start gap-4 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
            <Section
              title={t('Repository')}
              description={t(
                'The repository to import and the runtime contract it already follows.',
              )}
              media={<StepBadge step={1} />}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor="import-repository">{t('Repository')}</Label>
                  <Select
                    id="import-repository"
                    value={repositoryId}
                    aria-label={t('Repository')}
                    onChange={(e) => setRepositoryId(e.target.value)}
                  >
                    <option value="" disabled>
                      {t('Choose a repository…')}
                    </option>
                    {repos.map((r) => (
                      <option
                        key={`${r.provider}:${r.repositoryId}`}
                        value={r.repositoryId}
                        disabled={r.alreadyImported || r.empty}
                      >
                        {r.fullName}
                        {r.alreadyImported
                          ? ` — ${t('already imported')}`
                          : r.empty
                            ? ` — ${t('empty')}`
                            : ''}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex h-5 items-center gap-1">
                    <Label htmlFor="import-template">{t('Runtime template')}</Label>
                    <InfoTip label={t('About the runtime template')}>
                      {t(
                        'Choose the runtime contract this repository already follows. Import validates the repository but never rewrites its code.',
                      )}
                    </InfoTip>
                  </div>
                  <Select
                    id="import-template"
                    value={templateId}
                    aria-label={t('Template')}
                    onChange={(e) => setTemplateId(e.target.value)}
                  >
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} · {template.language}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              {repos.length === 0 &&
                !loadError &&
                (hosted && ghStatus?.installations.length === 0 ? (
                  <Notice icon={Github} className="mt-3">
                    {rich(
                      'No GitHub installation is authorized for this workspace. <link>Open account settings</link>',
                      {
                        link: (chunk) => (
                          <Link to="/settings/account" className="text-link font-medium">
                            {chunk}
                          </Link>
                        ),
                      },
                    )}
                  </Notice>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t('No repositories available to import.')}
                  </p>
                ))}
            </Section>

            <Section
              title={t('Pipeline')}
              description={t('The stages a verified build moves through.')}
              media={<StepBadge step={2} />}
            >
              <PipelinePresetField value={pipelinePreset} onChange={setPipelinePreset} hideLegend />
            </Section>

            <Section
              title={t('Deployment targets')}
              description={t('Where each environment runs.')}
              help={environmentTargetHelp(hosted)}
              helpLabel={t('About environment targets')}
              media={<StepBadge step={3} />}
            >
              <EnvironmentTargetFields
                template={template}
                targets={targets}
                values={environmentTargets}
                hosted={hosted}
                onChange={chooseTarget}
                environments={selectedStages}
                hideLabel
              />
            </Section>
          </div>

          {/* Check first, then import: both steps live in one card that stays in view. */}
          <Card className="p-5 sm:p-6 xl:sticky xl:top-10">
            <div className="flex items-start gap-3">
              <StepBadge step={4} />
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-snug tracking-tight">
                  {t('Check and import')}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('Preflight inspects the repository before anything is changed.')}
                </p>
              </div>
            </div>

            <Button
              variant={preflight ? 'secondary' : 'default'}
              className="mt-5 w-full"
              onClick={runPreflight}
              disabled={!repositoryId || !templateId || checking}
            >
              {checking ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {checking
                ? t('Checking…')
                : preflight
                  ? t('Run preflight again')
                  : t('Run preflight check')}
            </Button>

            {preflight && (
              <div className="mt-5 border-t border-border/70 pt-5" aria-live="polite">
                <h3 className="break-words text-sm font-semibold">
                  {t('Preflight — {repo}', { repo: preflight.repo })}
                </h3>
                <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">{t('Default branch')}</dt>
                  <dd className="break-all text-right font-medium">{preflight.branch}</dd>
                  <dt className="text-muted-foreground">{t('Runtime')}</dt>
                  <dd className="text-right font-medium">{preflight.runtime}</dd>
                  <dt className="text-muted-foreground">{t('Dockerfile')}</dt>
                  <dd className="text-right font-medium">
                    {preflight.hasDockerfile ? t('found') : t('not found')}
                  </dd>
                  <dt className="text-muted-foreground">{t('InitPad workflow')}</dt>
                  <dd className="text-right font-medium">
                    {preflight.hasCompatibleWorkflow ? t('compatible') : t('not found')}
                  </dd>
                </dl>
                {preflight.warnings.length > 0 && (
                  <ul className="mt-4 flex flex-col gap-2">
                    {preflight.warnings.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                        <span className="min-w-0 break-words text-muted-foreground">{w}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {!preflight.hasCompatibleWorkflow && selectedRepo && (
                  <Notice className="mt-4" title={t('Add the starter CI workflow')}>
                    {rich(
                      'Download it, save it as <code>{path}</code>, review the build and test commands, commit it, then run preflight again.',
                      {
                        path:
                          selectedRepo.provider === 'github'
                            ? '.github/workflows/ci.yml'
                            : '.gitea/workflows/ci.yml',
                        code: (chunk) => (
                          <code className="break-all font-mono text-xs">{chunk}</code>
                        ),
                      },
                    )}
                    <Button
                      className="mt-3 w-full"
                      size="sm"
                      variant="secondary"
                      disabled={downloadingWorkflow}
                      onClick={downloadStarterWorkflow}
                    >
                      <DownloadCloud className="h-3.5 w-3.5" />
                      {downloadingWorkflow ? t('Downloading…') : t('Download starter workflow')}
                    </Button>
                  </Notice>
                )}
                <Button className="mt-5 w-full" disabled={!canImport} onClick={doImport}>
                  {busy ? <Spinner className="h-4 w-4" /> : <DownloadCloud className="h-4 w-4" />}
                  <span className="truncate">
                    {busy
                      ? t('Importing…')
                      : t('Import {name}', { name: selectedRepo?.name ?? t('repository') })}
                  </span>
                </Button>
                {!preflight.canImport && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('Resolve the issues above before importing.')}
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
