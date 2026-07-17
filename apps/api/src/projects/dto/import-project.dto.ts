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

// Immutable opaque provider repository id. Gitea and GitHub currently use
// decimal ids; the conservative token shape leaves room for another adapter
// without accepting paths or URLs from the client.
const REPOSITORY_ID = /^[a-zA-Z0-9:_-]{1,128}$/;

export class ImportPreflightDto {
  @Matches(REPOSITORY_ID, { message: 'Invalid repository id' })
  repositoryId!: string;

  @Matches(/^[a-z0-9-]{1,64}$/)
  templateId!: string;
}

export class ImportProjectDto {
  @Matches(REPOSITORY_ID, { message: 'Invalid repository id' })
  repositoryId!: string;

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
