import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @Matches(/^(?!personal-)[a-z][a-z0-9-]{1,39}$/, {
    message: 'Slug: lowercase letters, digits and hyphens (2–40 chars); personal-* is reserved',
  })
  slug!: string;
}

export class UpdateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;
}
