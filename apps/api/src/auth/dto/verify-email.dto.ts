import { IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token!: string;
}
