import { IsDateString, IsIn, IsOptional } from 'class-validator';

export type WorkspaceMetricsFormat = 'json' | 'csv';

export class WorkspaceMetricsQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @IsOptional()
  @IsIn(['json', 'csv'])
  format: WorkspaceMetricsFormat = 'json';
}
