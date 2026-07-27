import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const RUNTIMES = ['static', 'node', 'php', 'python'] as const;

// Creates a workspace-scoped allocation of a target (ADR-060). The physical
// target is referenced by id; credentials stay on it. The namespace is derived
// server-side from the workspace, never taken from the client.
export class CreateTargetAllocationDto {
  @IsString()
  @MaxLength(64)
  targetId!: string;

  // Subset of the target's capabilities this workspace may use. Defaults to the
  // target's full set when omitted.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(RUNTIMES, { each: true })
  capabilities?: string[];

  // Public URL apps deployed through this allocation are reached at. Defaults to
  // the target's public URL.
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  publicUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxEnvironments?: number;
}
