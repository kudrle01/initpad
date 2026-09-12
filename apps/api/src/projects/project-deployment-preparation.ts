import { Logger } from '@nestjs/common';
import { basename, join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { AppConfigService } from './app-config.service';
import { DeploymentService } from '../deployment/deployment.service';
import { exportVersion } from '../deployment/providers/source-export';
import { prepareProtectedWebLayout, PRIVATE_APP_DIR } from '../deployment/providers/sftp-layout';
import { ProviderKind, TemplateManifest } from '../domain/types';
import { RepoArchive, ScmActor, ScmRepositoryRef } from '../scm/scm-provider';
import { WorkspaceScmService } from '../scm/workspace-scm.service';
import { registryImageRef } from './project-deployment-identity';

export interface PreparedDeployment {
  repoPath: string;
  artifactDir?: string;
  protectedWebLayout: boolean;
  writableDirs?: string[];
  envVars: Record<string, string>;
  cleanup(): void;
}

interface PrepareDeploymentInput {
  environmentId: string;
  provider: ProviderKind;
  template: TemplateManifest;
  repository: ScmRepositoryRef;
  projectRepoPath: string;
  version: string;
  useRegistry: boolean;
  testedImageRef?: string;
  resolveActor(): Promise<ScmActor>;
  onProgress(message: string): void;
}

/** Owns temporary source/artifact material used to invoke a deploy provider. */
export class ProjectDeploymentPreparation {
  private readonly logger = new Logger('ProjectDeploymentPreparation');

  constructor(
    private readonly deployment: DeploymentService,
    private readonly workspaceScm: WorkspaceScmService,
    private readonly appConfig: AppConfigService,
  ) {}

  async prepare(input: PrepareDeploymentInput): Promise<PreparedDeployment> {
    const useBuildExtract = input.provider === 'sftp' && !!input.template.buildArtifactPath;
    const needsSource = !useBuildExtract && (input.provider !== 'docker' || !input.useRegistry);
    let source: RepoArchive | null = null;
    let extractedDir: string | null = null;
    let repoPath = input.projectRepoPath;
    let artifactDir = input.template.artifactDir;
    let writableDirs = input.template.writableDirs;
    let protectedWebLayout = false;

    try {
      if (useBuildExtract) {
        input.onProgress('Fetching & extracting tested artifact');
        extractedDir = mkdtempSync(join(tmpdir(), 'initpad-artifact-'));
        await this.deployment.extractArtifact(
          input.testedImageRef ?? registryImageRef(input.repository, input.version),
          input.template.buildArtifactPath!,
          extractedDir,
        );
        // getArchive packs the requested directory itself, so the extracted
        // application tree lives below its basename.
        repoPath = join(extractedDir, basename(input.template.buildArtifactPath!));
        artifactDir = undefined;
        if (input.template.webRoot) {
          repoPath = prepareProtectedWebLayout(repoPath, extractedDir, input.template.webRoot);
          writableDirs = (input.template.writableDirs ?? []).map(
            (directory) => `${PRIVATE_APP_DIR}/${directory.replace(/^\/+|\/+$/g, '')}`,
          );
          protectedWebLayout = true;
        }
      } else if (needsSource) {
        const actor = await input.resolveActor();
        const scm = this.workspaceScm.provider(input.repository.provider);
        source =
          (await scm.downloadArchive(input.repository, input.version, actor)) ??
          (await exportVersion(input.projectRepoPath, input.version));
        repoPath = source?.dir ?? input.projectRepoPath;
      }

      const envVars = await this.appConfig.configVarsForDeploy(input.environmentId);
      let cleaned = false;
      return {
        repoPath,
        artifactDir,
        protectedWebLayout,
        writableDirs,
        envVars,
        cleanup: () => {
          if (cleaned) return;
          cleaned = true;
          this.cleanup(source, extractedDir);
        },
      };
    } catch (error) {
      this.cleanup(source, extractedDir);
      throw error;
    }
  }

  private cleanup(source: RepoArchive | null, extractedDir: string | null): void {
    try {
      source?.cleanup();
    } catch (error) {
      this.logger.warn(`Could not clean up deployment source: ${(error as Error).message}`);
    }
    if (!extractedDir) return;
    try {
      rmSync(extractedDir, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn(
        `Could not clean up extracted deployment artifact: ${(error as Error).message}`,
      );
    }
  }
}
