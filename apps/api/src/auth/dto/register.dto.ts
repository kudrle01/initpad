import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  // Mirrors Gitea username rules: letters/digits/._-, must start alphanumeric.
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,38}$/, {
    message: 'Username: letters, digits, dot, dash, underscore (2–39 chars)',
  })
  username!: string;

  @IsEmail({}, { message: 'Valid e-mail required' })
  email!: string;

  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(128, { message: 'Password must be at most 128 characters' })
  password!: string;

  @IsOptional()
  @IsString()
  @MinLength(10, { message: 'Enrollment code is too short' })
  @MaxLength(80, { message: 'Enrollment code is too long' })
  enrollmentCode?: string;
}
