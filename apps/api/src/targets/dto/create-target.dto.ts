import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  MaxLength,
  Matches,
  MinLength,
  Max,
  Min,
} from 'class-validator';

const RUNTIMES = ['static', 'node', 'php', 'python'] as const;

// Registers a user deployment target (your own server). Docker targets are
// built-in only, so a user target is always ssh or sftp.
export class CreateTargetDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsIn(['ssh', 'sftp'])
  kind!: 'ssh' | 'sftp';

  // Which runtimes the server can run (e.g. ['static','php'] for a PHP host).
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(RUNTIMES, { each: true })
  capabilities!: string[];

  @IsString()
  @MaxLength(253)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  username!: string;

  @IsIn(['password', 'key'])
  auth!: 'password' | 'key';

  // Password or PEM private key (required when creating a target).
  @IsString()
  @MinLength(1)
  @MaxLength(32_768)
  secret!: string;

  // Writable root on the remote (SFTP: web dir; SSH: deploy dir).
  @IsString()
  @Matches(/^(?!.*(?:^|\/)\.\.(?:\/|$))\/[A-Za-z0-9._/-]+$/, {
    message: 'Remote path must be an absolute path without spaces or parent traversal',
  })
  @MaxLength(512)
  remotePath!: string;

  // Public URL where deployed apps/sites on this target are reachable.
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  publicUrl!: string;
}
