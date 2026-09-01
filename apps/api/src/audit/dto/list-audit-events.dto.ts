import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class ListAuditEventsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;

  @IsOptional()
  @IsUUID('4')
  cursor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z][a-z0-9_.-]*$/)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[a-z][a-z0-9_-]*$/)
  resourceType?: string;

  @IsOptional()
  @IsIn(['succeeded', 'failed'])
  outcome?: 'succeeded' | 'failed';
}
