import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDefined,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AgentDockerCapabilitiesDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  engineVersion!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  apiVersion!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  os!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  arch!: string;

  @IsBoolean()
  rootless!: boolean;

  @IsInt()
  @Min(1)
  @Max(4096)
  cpus!: number;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  memoryBytes!: number;
}

export class AgentHeartbeatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  version!: string;

  @IsInt()
  @Equals(1)
  protocolVersion!: number;

  @IsDefined()
  @ValidateNested()
  @Type(() => AgentDockerCapabilitiesDto)
  docker!: AgentDockerCapabilitiesDto;
}
