import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const RUNTIMES = ['static', 'node', 'php', 'python'] as const;

// Updates the usage of an existing allocation. The bound target, workspace and
// namespace are immutable here; only usage/limits/status change.
export class UpdateTargetAllocationDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(RUNTIMES, { each: true })
  capabilities?: string[];

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  publicUrl?: string;

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxEnvironments?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(64000)
  cpuLimitMillicores?: number;

  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(65536)
  memoryLimitMb?: number;

  @IsOptional()
  @IsInt()
  @Min(32)
  @Max(32768)
  pidsLimit?: number;

  // Null explicitly disables a previously configured TTL.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8760)
  devTtlHours?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8760)
  testTtlHours?: number | null;
}
