import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  IsOptional,
  MaxLength,
  Matches,
  MinLength,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const RUNTIMES = ['static', 'node', 'php', 'python'] as const;

// Registers a workspace-owned deployment target. SFTP carries a remote
// connection; Docker targets are outbound-only and connect through InitPad
// Agent, so they deliberately accept no host credentials. The `ssh` literal
// remains parseable only so older clients receive the service's explicit
// migration error instead of a generic validation failure.
export class CreateTargetDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsIn(['docker', 'ssh', 'sftp'])
  kind!: 'docker' | 'ssh' | 'sftp';

  @IsOptional()
  @IsIn(['direct-port', 'managed-gateway'])
  routingMode?: 'direct-port' | 'managed-gateway';

  // Which runtimes the server can run (e.g. ['static','php'] for a PHP host).
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(RUNTIMES, { each: true })
  capabilities!: string[];

  @ValidateIf((dto: CreateTargetDto) => dto.kind !== 'docker')
  @IsString()
  @MaxLength(253)
  host?: string;

  @ValidateIf((dto: CreateTargetDto) => dto.kind !== 'docker')
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @ValidateIf((dto: CreateTargetDto) => dto.kind !== 'docker')
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  username?: string;

  @ValidateIf((dto: CreateTargetDto) => dto.kind !== 'docker')
  @IsIn(['password', 'key'])
  auth?: 'password' | 'key';

  // Password or PEM private key (required when creating a target).
  @ValidateIf((dto: CreateTargetDto) => dto.kind !== 'docker')
  @IsString()
  @MinLength(1)
  @MaxLength(32_768)
  secret?: string;

  @ValidateIf((dto: CreateTargetDto) => dto.kind !== 'docker')
  @IsString()
  @Matches(/^SHA256:[A-Za-z0-9+/]{43}=?$/, {
    message: 'Host key fingerprint must use the OpenSSH SHA256:<base64> format',
  })
  hostKeyFingerprint?: string;

  // Writable root on the remote (SFTP web dir; legacy SSH deploy dir).
  @ValidateIf((dto: CreateTargetDto) => dto.kind !== 'docker')
  @IsString()
  @Matches(/^(?!.*(?:^|\/)\.\.(?:\/|$))\/[A-Za-z0-9._/-]+$/, {
    message: 'Remote path must be an absolute path without spaces or parent traversal',
  })
  @MaxLength(512)
  remotePath?: string;

  // Public URL where deployed apps/sites on this target are reachable.
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  publicUrl!: string;
}
