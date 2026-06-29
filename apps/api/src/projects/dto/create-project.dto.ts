import { IsString, Matches } from 'class-validator';

export class CreateProjectDto {
  @Matches(/^[a-z][a-z0-9-]{1,40}$/, {
    message: 'Název: malá písmena, číslice a pomlčky (2–41 znaků), začíná písmenem',
  })
  name!: string;

  @IsString()
  templateId!: string;
}
