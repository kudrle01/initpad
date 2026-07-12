import { IsArray, IsIn, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { EnvName } from '../../domain/types';

class EnvironmentConfigDto {
  @IsIn(['dev', 'test', 'prod'])
  name!: EnvName;

  // The target this environment should deploy to. Optional — omitted
  // environments fall back to a sensible default (dev/test: built-in Docker;
  // prod: the built-in target for the template's natural kind).
  @IsOptional()
  @IsString()
  targetId?: string;
}

export class CreateProjectDto {
  @Matches(/^[a-z][a-z0-9-]{1,40}$/, {
    message: 'Name: lowercase letters, digits and hyphens (2–41 chars), must start with a letter',
  })
  name!: string;

  @IsString()
  templateId!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EnvironmentConfigDto)
  environments?: EnvironmentConfigDto[];
}
