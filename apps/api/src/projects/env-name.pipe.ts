import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { EnvName } from '../domain/types';

const ENV_NAMES: readonly string[] = ['dev', 'test', 'prod'] satisfies EnvName[];

/** Rejects an `:env` route parameter that names no pipeline environment. */
export class EnvNamePipe implements PipeTransform<string, EnvName> {
  transform(value: string): EnvName {
    if (!ENV_NAMES.includes(value)) {
      throw new BadRequestException('Environment must be dev, test or prod');
    }
    return value as EnvName;
  }
}
