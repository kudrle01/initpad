import { IsString } from 'class-validator';

// Body for pointing an environment at a target (by id). The target itself
// (server + encrypted credentials) is managed under /targets.
export class SetTargetDto {
  @IsString()
  targetId!: string;
}
