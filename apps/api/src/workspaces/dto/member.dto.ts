import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const ASSIGNABLE_ROLES = ['admin', 'maintainer', 'member', 'viewer'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export class AddWorkspaceMemberDto {
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identity!: string;

  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;
}

export class UpdateWorkspaceMemberDto {
  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;
}

export class TransferWorkspaceOwnershipDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  userId!: string;
}

export class CreateWorkspaceInvitationDto {
  @IsEmail({}, { message: 'Valid e-mail required' })
  @MaxLength(254)
  email!: string;

  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;
}

export class InvitationTokenDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token!: string;
}
