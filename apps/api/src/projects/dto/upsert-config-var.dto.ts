import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

// Sets or updates one application config variable for an environment (ADR-061).
export class UpsertConfigVarDto {
  @IsString()
  @MaxLength(8192)
  value!: string;

  // When true the value is stored encrypted and never returned in the clear.
  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;
}
