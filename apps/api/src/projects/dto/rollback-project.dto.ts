import { IsUUID, Matches } from 'class-validator';

export class RollbackProjectDto {
  @IsUUID('4')
  candidateOperationId!: string;

  // Optimistic concurrency guard returned by the preview. It binds the
  // confirmation to the environment version, artifact, target and state that
  // the user actually reviewed.
  @Matches(/^[a-f0-9]{64}$/)
  stateToken!: string;
}
