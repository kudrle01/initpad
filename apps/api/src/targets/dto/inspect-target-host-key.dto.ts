import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class InspectTargetHostKeyDto {
  @IsString()
  @MaxLength(253)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;
}
