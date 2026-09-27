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
import type { EnvName, PipelinePreset } from '../../domain/types';
import { PIPELINE_PRESETS } from '../pipeline-preset';

class PipelineEnvironmentTargetDto {
  @IsIn(['dev', 'test', 'prod'])
  name!: EnvName;

  @IsOptional()
  @Matches(
    /^(?:builtin-(?:docker|ssh|sftp)|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )
  targetId?: string;
}

export class UpdatePipelinePresetDto {
  @IsIn(PIPELINE_PRESETS)
  pipelinePreset!: PipelinePreset;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique((environment: PipelineEnvironmentTargetDto) => environment.name)
  @ValidateNested({ each: true })
  @Type(() => PipelineEnvironmentTargetDto)
  environments?: PipelineEnvironmentTargetDto[];
}
