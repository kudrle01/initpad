import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Body for configuring a user deployment target (prod: your own server).
export class SetTargetDto {
  @IsIn(['sftp', 'ssh'])
  kind!: 'sftp' | 'ssh';

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

  // Password or PEM private key. Optional on update (keep the existing secret).
  @IsOptional()
  @IsString()
  secret?: string;

  @IsString()
  path!: string;

  @IsString()
  publicUrl!: string;
}
