import { IsEmail, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  // Mirrors Gitea username rules: letters/digits/._-, must start alphanumeric.
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,38}$/, {
    message: 'Username: letters, digits, dot, dash, underscore (2–39 chars)',
  })
  username!: string;

  @IsEmail({}, { message: 'Valid e-mail required' })
  email!: string;

  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;
}
