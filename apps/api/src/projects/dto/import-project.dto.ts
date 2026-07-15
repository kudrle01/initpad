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

class ImportEnvironmentDto {
  @IsIn(['dev', 'test', 'prod'])
  name!: EnvName;

  @IsOptional()
  @Matches(/^(?:builtin-(?:docker|ssh|sftp)|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)
  targetId?: string;
}

// Gitea repository name (owned by the user), not the full owner/name.
const REPO_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;

export class ImportPreflightDto {
  @Matches(REPO_NAME, { message: 'Invalid repository name' })
  repo!: string;

  @Matches(/^[a-z0-9-]{1,64}$/)
  templateId!: string;
}

export class ImportProjectDto {
  @Matches(REPO_NAME, { message: 'Invalid repository name' })
  repo!: string;

  @Matches(/^[a-z0-9-]{1,64}$/)
  templateId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique((environment: ImportEnvironmentDto) => environment.name)
  @ValidateNested({ each: true })
  @Type(() => ImportEnvironmentDto)
  environments?: ImportEnvironmentDto[];
}
