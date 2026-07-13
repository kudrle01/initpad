import { IsEmail, IsIn } from 'class-validator';
import { ASSIGNABLE_ROLES, AssignableRole } from './member.dto';

export class CreateInvitationDto {
  @IsEmail({}, { message: 'Valid e-mail required' })
  email!: string;

  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;
}
