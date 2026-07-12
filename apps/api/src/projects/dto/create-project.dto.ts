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

  // The target this environment should deploy to. Optional — omitted
  // environments fall back to a sensible default (dev/test: built-in Docker;
  // prod: the built-in target for the template's natural kind).
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
}
