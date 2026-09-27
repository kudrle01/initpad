import { BadRequestException } from '@nestjs/common';
import type { EnvName, PipelinePreset } from '../domain/types';

export const DEFAULT_PIPELINE_PRESET: PipelinePreset = 'dev-test-prod';

export const PIPELINE_PRESETS = [
  'dev-test-prod',
  'dev-prod',
  'prod-only',
] as const satisfies readonly PipelinePreset[];

const PIPELINE_STAGES: Record<PipelinePreset, readonly EnvName[]> = {
  'dev-test-prod': ['dev', 'test', 'prod'],
  'dev-prod': ['dev', 'prod'],
  'prod-only': ['prod'],
};

export function isPipelinePreset(value: unknown): value is PipelinePreset {
  return typeof value === 'string' && PIPELINE_PRESETS.includes(value as PipelinePreset);
}

export function pipelinePreset(value: unknown): PipelinePreset {
  if (!isPipelinePreset(value)) {
    throw new BadRequestException(`Unsupported pipeline preset '${String(value)}'`);
  }
  return value;
}

/** The only source of truth for configured stage order in the API. */
export function pipelineStages(value: PipelinePreset): readonly EnvName[] {
  return PIPELINE_STAGES[value];
}

export function previousPipelineStage(value: PipelinePreset, target: EnvName): EnvName | null {
  const stages = pipelineStages(value);
  const index = stages.indexOf(target);
  return index > 0 ? stages[index - 1] : null;
}

export function productionSourceStage(value: PipelinePreset): EnvName | null {
  return previousPipelineStage(value, 'prod');
}
