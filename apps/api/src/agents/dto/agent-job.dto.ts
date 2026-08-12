import {
  Equals,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const LEASE_TOKEN_PATTERN = /^initpad_lease_[A-Za-z0-9_-]{43}$/;

export class CreateAgentProbeJobDto {
  @IsUUID('4')
  requestId!: string;

  @IsInt()
  @Min(5)
  @Max(60)
  durationSeconds!: number;
}

export class CreateAgentLifecycleTestDto {
  @IsUUID('4')
  requestId!: string;
}

export class AgentClaimJobDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  version!: string;

  @IsInt()
  @Equals(1)
  protocolVersion!: number;
}

export class AgentLeaseDto {
  @IsString()
  @Matches(LEASE_TOKEN_PATTERN)
  leaseToken!: string;
}

export class AgentJobProgressDto extends AgentLeaseDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  sequence!: number;

  @IsInt()
  @Min(0)
  @Max(99)
  percent!: number;

  @IsString()
  @IsIn(['accepted', 'working', 'verifying'])
  stage!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  message!: string;
}

export class AgentJobCompleteDto extends AgentLeaseDto {
  @IsString()
  @IsIn(['succeeded', 'failed'])
  status!: 'succeeded' | 'failed';

  @IsString()
  @MinLength(1)
  @MaxLength(240)
  message!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9._-]{0,63}$/)
  resultCode?: string;
}
