import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateUserDto {
  // Mirrors Gitea username rules: letters/digits/._-, must start alphanumeric.
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,38}$/, {
    message: 'Username: letters, digits, dot, dash, underscore (2–39 chars)',
  })
  username!: string;

  @IsEmail({}, { message: 'Valid e-mail required' })
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(['admin', 'user'])
  platformRole?: 'admin' | 'user';
}
