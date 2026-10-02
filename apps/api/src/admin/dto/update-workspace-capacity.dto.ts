import { IsInt, Max, Min } from 'class-validator';

export class UpdateWorkspaceCapacityDto {
  @IsInt()
  @Min(1)
  @Max(100_000)
  maxProjects!: number;

  @IsInt()
  @Min(1)
  @Max(100_000)
  maxMembers!: number;

  @IsInt()
  @Min(1)
  @Max(10_000)
  maxTargets!: number;

  @IsInt()
  @Min(1)
  @Max(10_000)
  maxConcurrentOperations!: number;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxArtifactStorageGiB!: number;
}
