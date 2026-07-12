import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const RUNTIMES = ['static', 'node', 'php', 'python'] as const;

// Updates a user target. Everything is optional; a blank secret keeps the
// stored one.
export class UpdateTargetDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['ssh', 'sftp'])
  kind?: 'ssh' | 'sftp';

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(RUNTIMES, { each: true })
  capabilities?: string[];

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsIn(['password', 'key'])
  auth?: 'password' | 'key';

  @IsOptional()
  @IsString()
  secret?: string;

  @IsOptional()
  @IsString()
  remotePath?: string;

  @IsOptional()
  @IsString()
  publicUrl?: string;
}
