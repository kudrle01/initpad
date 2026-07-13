import { IsBoolean, IsOptional } from 'class-validator';

export class DeleteProjectDto {
  // Source code is the least reproducible project resource. Keep it unless
  // the user explicitly opts into deleting the SCM repository as well.
  @IsOptional()
  @IsBoolean()
  deleteRepository?: boolean;

  // A live/stopped/failed production deployment needs an independent,
  // server-enforced acknowledgement; typing the project name alone is not
  // enough for this higher-impact operation.
  @IsOptional()
  @IsBoolean()
  confirmProduction?: boolean;

  // Explicit escape hatch for shared hosting where the public application is
  // gone but protected, foreign-owned files require target-admin cleanup.
  @IsOptional()
  @IsBoolean()
  confirmCleanupDebt?: boolean;
}
