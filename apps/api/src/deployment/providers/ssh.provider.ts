import { Injectable } from '@nestjs/common';
import { ProviderKind } from '../../domain/types';
import {
  DeployInput,
  DeployResult,
  DeploymentProvider,
} from '../deployment-provider.interface';

// Nasazení na vzdálený host přes SSH; cíl může být reálná VPS i fake-vps kontejner.
// TODO: reálné SSH spojení + start procesu (pm2/systemd). Zatím simulováno.
@Injectable()
export class SshProvider implements DeploymentProvider {
  readonly kind: ProviderKind = 'ssh';

  async deploy(input: DeployInput): Promise<DeployResult> {
    return {
      status: 'running',
      url: `https://${input.projectName}.vps.example`,
    };
  }
}
