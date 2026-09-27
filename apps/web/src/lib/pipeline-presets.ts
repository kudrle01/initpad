import type { EnvName, PipelinePreset } from '@/types';

export const DEFAULT_PIPELINE_PRESET: PipelinePreset = 'dev-test-prod';

export const PIPELINE_PRESET_OPTIONS: Array<{
  value: PipelinePreset;
  label: string;
  description: string;
  stages: readonly EnvName[];
}> = [
  {
    value: 'dev-test-prod',
    label: 'Development, test, production',
    description: 'CI deploys to dev; promote the same verified build through test to production.',
    stages: ['dev', 'test', 'prod'],
  },
  {
    value: 'dev-prod',
    label: 'Development, production',
    description: 'CI deploys to dev; request the verified dev build for production.',
    stages: ['dev', 'prod'],
  },
  {
    value: 'prod-only',
    label: 'Production only',
    description: 'CI verifies a build without deploying it; production always requires approval.',
    stages: ['prod'],
  },
];

export function pipelineStages(preset: PipelinePreset): readonly EnvName[] {
  return PIPELINE_PRESET_OPTIONS.find((option) => option.value === preset)!.stages;
}

export function pipelinePresetLabel(preset: PipelinePreset): string {
  return PIPELINE_PRESET_OPTIONS.find((option) => option.value === preset)!.label;
}
