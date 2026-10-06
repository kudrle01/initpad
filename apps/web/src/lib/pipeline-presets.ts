import type { EnvName, PipelinePreset } from '@/types';
import { msg, type MessageKey } from '@/i18n';

export const DEFAULT_PIPELINE_PRESET: PipelinePreset = 'dev-test-prod';

export const PIPELINE_PRESET_OPTIONS: Array<{
  value: PipelinePreset;
  label: MessageKey;
  description: MessageKey;
  stages: readonly EnvName[];
}> = [
  {
    value: 'dev-test-prod',
    label: msg('Development, test, production'),
    description: msg(
      'CI deploys to dev; promote the same verified build through test to production.',
    ),
    stages: ['dev', 'test', 'prod'],
  },
  {
    value: 'dev-prod',
    label: msg('Development, production'),
    description: msg('CI deploys to dev; request the verified dev build for production.'),
    stages: ['dev', 'prod'],
  },
  {
    value: 'prod-only',
    label: msg('Production only'),
    description: msg(
      'CI verifies a build without deploying it; production always requires approval.',
    ),
    stages: ['prod'],
  },
];

export function pipelineStages(preset: PipelinePreset): readonly EnvName[] {
  return PIPELINE_PRESET_OPTIONS.find((option) => option.value === preset)!.stages;
}

export function pipelinePresetLabel(preset: PipelinePreset): MessageKey {
  return PIPELINE_PRESET_OPTIONS.find((option) => option.value === preset)!.label;
}
