import { IsArray, IsIn, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { EnvName, ProviderKind } from '../../domain/types';

class EnvironmentConfigDto {
  @IsIn(['dev', 'test', 'prod'])
  name!: EnvName;

  @IsIn(['docker', 'sftp', 'ssh'])
  provider!: ProviderKind;
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
