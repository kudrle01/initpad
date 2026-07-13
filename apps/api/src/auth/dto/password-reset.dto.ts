import { IsString, MaxLength, MinLength } from 'class-validator';

export class RequestPasswordResetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identity!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token!: string;

  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(128, { message: 'Password must be at most 128 characters' })
  newPassword!: string;
}
