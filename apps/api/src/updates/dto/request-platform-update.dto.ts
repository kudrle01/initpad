import { IsUUID } from 'class-validator';

export class RequestPlatformUpdateDto {
  @IsUUID('4')
  requestId!: string;
}
