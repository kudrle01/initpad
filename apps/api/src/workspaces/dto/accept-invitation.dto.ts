import { Matches, MaxLength, MinLength } from 'class-validator';

// Registration bound to an invitation: the e-mail comes from the invitation,
// so only a username and password are supplied.
export class RegisterViaInvitationDto {
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,38}$/, {
    message: 'Username: letters, digits, dot, dash, underscore (2–39 chars)',
  })
  username!: string;

  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(128, { message: 'Password must be at most 128 characters' })
  password!: string;
}
