import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateProductionDeploymentRequestDto {
  @IsIn(['promote', 'redeploy', 'rollback'])
  kind!: 'promote' | 'redeploy' | 'rollback';

  @IsOptional()
  @IsUUID('4')
  candidateOperationId?: string;

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/i)
  stateToken?: string;
}

export class ReviewProductionDeploymentRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
