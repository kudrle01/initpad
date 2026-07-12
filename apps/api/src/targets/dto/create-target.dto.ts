import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Max,
  Min,
} from 'class-validator';

const RUNTIMES = ['static', 'node', 'php', 'python'] as const;

// Registers a user deployment target (your own server). Docker targets are
// built-in only, so a user target is always ssh or sftp.
export class CreateTargetDto {
  @IsString()
  name!: string;

  @IsIn(['ssh', 'sftp'])
  kind!: 'ssh' | 'sftp';

  // Which runtimes the server can run (e.g. ['static','php'] for a PHP host).
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(RUNTIMES, { each: true })
  capabilities!: string[];

  @IsString()
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsString()
  username!: string;

  @IsIn(['password', 'key'])
  auth!: 'password' | 'key';

  // Password or PEM private key (required when creating a target).
  @IsString()
  secret!: string;

  // Writable root on the remote (SFTP: web dir; SSH: deploy dir).
  @IsString()
  remotePath!: string;

  // Public URL where deployed apps/sites on this target are reachable.
  @IsString()
  publicUrl!: string;
}
