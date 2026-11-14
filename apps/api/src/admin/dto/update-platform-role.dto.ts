import { IsIn } from 'class-validator';

export class UpdatePlatformRoleDto {
  @IsIn(['admin', 'user'])
  platformRole!: 'admin' | 'user';
}
