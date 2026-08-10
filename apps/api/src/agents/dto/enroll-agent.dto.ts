import { Equals, IsInt, IsString, MaxLength, MinLength } from 'class-validator';

export class EnrollAgentDto {
  @IsString()
  @MinLength(48)
  @MaxLength(128)
  token!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  version!: string;

  @IsInt()
  @Equals(1)
  protocolVersion!: number;
}
