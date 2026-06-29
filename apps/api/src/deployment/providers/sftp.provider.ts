import { Injectable } from '@nestjs/common';
import { ProviderKind } from '../../domain/types';
import {
  DeployInput,
  DeployResult,
  DeploymentProvider,
} from '../deployment-provider.interface';

// Nahrání souborů na file hosting (statika, PHP) – sem patří ESO jako preset.
// TODO: reálný SFTP upload (temp složka → atomické přepnutí). Zatím simulováno.
@Injectable()
export class SftpProvider implements DeploymentProvider {
  readonly kind: ProviderKind = 'sftp';

  async deploy(input: DeployInput): Promise<DeployResult> {
    return {
      status: 'running',
      url: `https://hosting.example/${input.projectName}`,
    };
  }
}
