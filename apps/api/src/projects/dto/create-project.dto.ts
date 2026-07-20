import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EnvName } from '../../domain/types';

class EnvironmentConfigDto {
  @IsIn(['dev', 'test', 'prod'])
  name!: EnvName;

  // The target this environment should deploy to. Self-hosted may omit it and
  // use built-in defaults; SaaS validates an explicit workspace target for all
  // three environments because its control plane has no local deploy host.
  @IsOptional()
  @Matches(/^(?:builtin-(?:docker|ssh|sftp)|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)
  targetId?: string;
}

export class CreateProjectDto {
  @Matches(/^[a-z][a-z0-9-]{1,40}$/, {
    message: 'Name: lowercase letters, digits and hyphens (2–41 chars), must start with a letter',
  })
  name!: string;

  @Matches(/^[a-z0-9-]{1,64}$/)
  templateId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique((environment: EnvironmentConfigDto) => environment.name)
  @ValidateNested({ each: true })
  @Type(() => EnvironmentConfigDto)
  environments?: EnvironmentConfigDto[];

  // Required by the SaaS edition. The API verifies that the installation is
  // active and explicitly granted to the current workspace.
  @IsOptional()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  scmInstallationId?: string;
}
