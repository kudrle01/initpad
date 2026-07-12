import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Matches,
  MinLength,
  Max,
  Min,
} from 'class-validator';

const RUNTIMES = ['static', 'node', 'php', 'python'] as const;

// Updates a user target. Everything is optional; a blank secret keeps the
// stored one.
export class UpdateTargetDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(['ssh', 'sftp'])
  kind?: 'ssh' | 'sftp';

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(RUNTIMES, { each: true })
  capabilities?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(253)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  username?: string;

  @IsOptional()
  @IsIn(['password', 'key'])
  auth?: 'password' | 'key';

  @IsOptional()
  @IsString()
  @MaxLength(32_768)
  secret?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?!.*(?:^|\/)\.\.(?:\/|$))\/[A-Za-z0-9._/-]+$/, {
    message: 'Remote path must be an absolute path without spaces or parent traversal',
  })
  @MaxLength(512)
  remotePath?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  publicUrl?: string;
}
