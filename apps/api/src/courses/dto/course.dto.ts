import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCourseDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @Matches(/^[a-z][a-z0-9-]{1,31}[a-z0-9]$/, {
    message: 'Slug: lowercase letters, digits and hyphens (3–33 chars)',
  })
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  enrollmentOpen?: boolean;

  @IsOptional()
  @IsBoolean()
  membershipLocked?: boolean;
}

export class JoinCourseDto {
  @IsString()
  @MinLength(10)
  @MaxLength(80)
  enrollmentCode!: string;
}

export class AddCourseMemberDto {
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identity!: string;

  @IsIn(['instructor', 'student'])
  role!: 'instructor' | 'student';
}

export class CreateCourseTeamDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @Matches(/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/, {
    message: 'Slug: lowercase letters, digits and hyphens (3–40 chars)',
  })
  slug!: string;
}
